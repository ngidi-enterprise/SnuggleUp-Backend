import crypto from 'crypto';

// CJ Dropshipping API client (lightweight, pluggable for your credentials)
// This implementation supports two modes:
// 1) Token mode: Provide CJ_ACCESS_TOKEN (recommended quick start)
// 2) App mode (scaffold): Provide CJ_APP_KEY/CJ_APP_SECRET and implement token/sign per CJ docs


const CJ_BASE_URL = process.env.CJ_BASE_URL || 'https://developers.cjdropshipping.com/api2.0/v1';
// Per CJ docs, getAccessToken only needs apiKey. We keep email optional if their backend still accepts it.
const CJ_EMAIL = process.env.CJ_EMAIL || '';
const CJ_API_KEY = process.env.CJ_API_KEY || '';
const CJ_WEBHOOK_SECRET = process.env.CJ_WEBHOOK_SECRET || '';
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN || ''; // Optional: pre-set token to avoid rate limits

let cjTokenCache = {
  accessToken: CJ_ACCESS_TOKEN, // Start with env token if provided
  refreshToken: '',
  accessTokenExpiry: CJ_ACCESS_TOKEN ? Date.now() + (15 * 24 * 60 * 60 * 1000) : 0, // 15 days if pre-set
  refreshTokenExpiry: 0,
};

// CJ has a strict QPS limit (often 1 request/second). We'll throttle and retry.
let lastCJCallAt = 0;
const CJ_MIN_INTERVAL_MS = 1100; // a bit over 1s for safety

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function ensureThrottle() {
  const now = Date.now();
  const diff = now - lastCJCallAt;
  if (diff < CJ_MIN_INTERVAL_MS) {
    await sleep(CJ_MIN_INTERVAL_MS - diff);
  }
  lastCJCallAt = Date.now();
}


// Helper: simple fetch wrapper (uses global fetch in Node >=18)
async function http(method, url, { query, body, headers } = {}) {
  let fullUrl = url;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    fullUrl += '?' + params.toString();
  }

  // Up to 3 attempts with backoff on 429 Too Many Requests
  const maxAttempts = 3;
  let attempt = 0;
  while (true) {
    attempt += 1;
    await ensureThrottle();
    const res = await fetch(fullUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    if (res.ok) return json;

    const err = new Error(`CJ HTTP ${res.status}`);
    err.status = res.status;
    err.response = json;

    // CJ rate limit: sometimes returns 429 with code/message in body
    const isRateLimited = res.status === 429 || json?.code === 1600200 || /Too Many Requests|QPS limit/i.test(json?.message || '');
    if (isRateLimited && attempt < maxAttempts) {
      // wait a bit longer each retry
      await sleep(CJ_MIN_INTERVAL_MS * attempt);
      continue;
    }
    throw err;
  }
}

// Refresh CJ access token using refreshToken
async function refreshAccessToken() {
  if (!cjTokenCache.refreshToken) throw new Error('No CJ refresh token available');
  const url = CJ_BASE_URL + '/authentication/refreshAccessToken';
  const resp = await http('POST', url, {
    body: { refreshToken: cjTokenCache.refreshToken },
  });
  if (!resp.result || !resp.data?.accessToken) {
    throw new Error('CJ refreshAccessToken failed: ' + (resp.message || 'Unknown error'));
  }
  cjTokenCache.accessToken = resp.data.accessToken;
  cjTokenCache.refreshToken = resp.data.refreshToken || cjTokenCache.refreshToken;
  cjTokenCache.accessTokenExpiry = new Date(resp.data.accessTokenExpiryDate).getTime();
  cjTokenCache.refreshTokenExpiry = new Date(resp.data.refreshTokenExpiryDate).getTime();
  console.log('♻️  CJ access token refreshed, expires:', new Date(cjTokenCache.accessTokenExpiry).toISOString());
  return cjTokenCache.accessToken;
}

// Get and cache CJ access token (or refresh it if near expiry)
async function getAccessToken(force = false) {
  const now = Date.now();
  // Use cached token if valid (check with 10 minute buffer instead of 1 minute)
  if (!force && cjTokenCache.accessToken && cjTokenCache.accessTokenExpiry > now + 600000) {
    console.log('✅ Using cached CJ access token');
    return cjTokenCache.accessToken;
  }
  if (!CJ_EMAIL || !CJ_API_KEY) {
    throw new Error('CJ_EMAIL and CJ_API_KEY must be set in environment');
  }
  
  // Try refresh first if we have a (not expired) refresh token.
  if (!force && cjTokenCache.refreshToken && cjTokenCache.refreshTokenExpiry > now + 600000) {
    try {
      return await refreshAccessToken();
    } catch (e) {
      console.warn('⚠️  CJ refresh failed, will request new token:', e?.message || e);
    }
  }

  console.log('🔄 Requesting new CJ access token...');
  const url = CJ_BASE_URL + '/authentication/getAccessToken';
  
  try {
    const resp = await http('POST', url, {
      body: {
        email: CJ_EMAIL,
        apiKey: CJ_API_KEY,
      },
    });
    if (!resp.result || !resp.data?.accessToken) {
      throw new Error('CJ getAccessToken failed: ' + (resp.message || 'Unknown error'));
    }
    cjTokenCache.accessToken = resp.data.accessToken;
    cjTokenCache.refreshToken = resp.data.refreshToken;
    cjTokenCache.accessTokenExpiry = new Date(resp.data.accessTokenExpiryDate).getTime();
    cjTokenCache.refreshTokenExpiry = new Date(resp.data.refreshTokenExpiryDate).getTime();
    console.log('✅ CJ access token obtained, expires:', new Date(cjTokenCache.accessTokenExpiry).toISOString());
    return cjTokenCache.accessToken;
  } catch (err) {
    // If we hit rate limit but have an old token, use it anyway
    if (err.status === 429 && cjTokenCache.accessToken) {
      console.warn('⚠️ CJ token rate limit hit, using cached token (may be expired)');
      return cjTokenCache.accessToken;
    }
    throw err;
  }
}


// Placeholder signing (for webhook verification)
function hmacSHA256(content, secret) {
  return crypto.createHmac('sha256', secret).update(content).digest('hex');
}

export const cjClient = {
  getStatus() {
    return {
      baseUrl: CJ_BASE_URL,
      hasEmail: Boolean(CJ_EMAIL),
      hasApiKey: Boolean(CJ_API_KEY),
      webhookVerification: Boolean(CJ_WEBHOOK_SECRET),
      tokenExpiry: cjTokenCache.accessTokenExpiry,
    };
  },

  // 1. Search CJ products (GET /product/list)
  async searchProducts({ productNameEn, pageNum = 1, pageSize = 20, categoryId, minPrice, maxPrice } = {}) {
    const normalizeUrl = (u) => {
      if (!u) return '';
      let s = String(u).trim();
      if (s.startsWith('//')) s = 'https:' + s;
      if (s.startsWith('http://')) s = s.replace(/^http:/, 'https:');
      return s;
    };
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/product/list';
    const query = { 
      productNameEn: productNameEn || '',
      pageNum,
      pageSize,
      categoryId,
      minPrice,
      maxPrice,
    };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });
    
    if (!json.result || !json.data) {
      console.error('CJ searchProducts error:', JSON.stringify(json));
      throw new Error('CJ searchProducts failed: ' + (json.message || 'Unknown error'));
    }

    const items = (json.data.list || []).map((p) => ({
      pid: p.pid,
      name: p.productNameEn,
      sku: p.productSku,
      price: p.sellPrice,
      image: normalizeUrl(p.productImage),
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      weight: p.productWeight,
      isFreeShipping: p.isFreeShipping,
      listedNum: p.listedNum,
    }));

    return {
      source: 'cj',
      items,
      pageNum: json.data.pageNum,
      pageSize: json.data.pageSize,
      total: json.data.total,
    };
  },

  // 2. Get product details with variants (GET /product/query)
  async getProductDetails(pid) {
    const normalizeUrl = (u) => {
      if (!u) return '';
      let s = String(u).trim();
      if (s.startsWith('//')) s = 'https:' + s;
      if (s.startsWith('http://')) s = s.replace(/^http:/, 'https:');
      return s;
    };
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/product/query';
    const query = { pid };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.result || !json.data) {
      throw new Error('CJ getProductDetails failed: ' + (json.message || 'Unknown error'));
    }

    const product = json.data;
    return {
      pid: product.pid,
      name: product.productNameEn,
      sku: product.productSku,
      price: product.sellPrice,
      image: normalizeUrl(product.productImage),
      description: product.description,
      weight: product.productWeight,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      variants: (product.variants || []).map((v) => ({
        vid: v.vid,
        pid: v.pid,
        name: v.variantNameEn,
        sku: v.variantSku,
        price: v.variantSellPrice,
        image: normalizeUrl(v.variantImage),
        weight: v.variantWeight,
        key: v.variantKey,
      })),
    };
  },

  // 3. Check inventory for a variant (GET /product/stock/queryByVid)
  async getInventory(vid) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/product/stock/queryByVid';
    const query = { vid };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.result || !json.data) {
      throw new Error('CJ getInventory failed: ' + (json.message || 'Unknown error'));
    }

    return (json.data || []).map((stock) => ({
      vid: stock.vid,
      warehouseId: stock.areaId,
      warehouseName: stock.areaEn,
      countryCode: stock.countryCode,
      totalInventory: stock.totalInventoryNum,
      cjInventory: stock.cjInventoryNum,
      factoryInventory: stock.factoryInventoryNum,
    }));
  },

  // 4. Create order (POST /shopping/order/createOrderV2)
  async createOrder(orderData) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/shopping/order/createOrderV2';
    
    // Validate required fields
    if (!orderData.orderNumber) throw new Error('orderNumber is required');
    if (!orderData.shippingCountryCode) throw new Error('shippingCountryCode is required');
    if (!orderData.shippingCustomerName) throw new Error('shippingCustomerName is required');
    if (!orderData.shippingAddress) throw new Error('shippingAddress is required');
    if (!orderData.logisticName) throw new Error('logisticName is required');
    if (!orderData.fromCountryCode) throw new Error('fromCountryCode is required');
    if (!orderData.products || orderData.products.length === 0) {
      throw new Error('products array is required');
    }

    const json = await http('POST', url, {
      body: orderData,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.result || !json.data) {
      throw new Error('CJ createOrder failed: ' + (json.message || 'Unknown error'));
    }

    return {
      orderId: json.data.orderId,
      orderNumber: json.data.orderNumber,
      shipmentOrderId: json.data.shipmentOrderId,
      orderAmount: json.data.orderAmount,
      productAmount: json.data.productAmount,
      postageAmount: json.data.postageAmount,
      orderStatus: json.data.orderStatus,
      productInfoList: json.data.productInfoList,
    };
  },

  // 5. Get order status (GET /shopping/order/getOrderDetail)
  async getOrderStatus(orderId) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/shopping/order/getOrderDetail';
    const query = { orderId };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.result || !json.data) {
      throw new Error('CJ getOrderStatus failed: ' + (json.message || 'Unknown error'));
    }

    const order = json.data;
    return {
      orderId: order.orderId,
      orderNum: order.orderNum,
      cjOrderId: order.cjOrderId,
      orderStatus: order.orderStatus,
      trackNumber: order.trackNumber,
      trackingUrl: order.trackingUrl,
      logisticName: order.logisticName,
      orderAmount: order.orderAmount,
      createDate: order.createDate,
      paymentDate: order.paymentDate,
      productList: order.productList,
    };
  },

  // 6. Get tracking info (GET /logistic/trackInfo)
  async getTracking(trackNumber) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/logistic/trackInfo';
    const query = { trackNumber };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.result || !json.data) {
      throw new Error('CJ getTracking failed: ' + (json.message || 'Unknown error'));
    }

    return (json.data || []).map((track) => ({
      trackingNumber: track.trackingNumber,
      logisticName: track.logisticName,
      trackingFrom: track.trackingFrom,
      trackingTo: track.trackingTo,
      deliveryDay: track.deliveryDay,
      deliveryTime: track.deliveryTime,
      trackingStatus: track.trackingStatus,
      lastMileCarrier: track.lastMileCarrier,
      lastTrackNumber: track.lastTrackNumber,
    }));
  },

  // 7. Get freight/shipping quotes (POST /logistic/freightCalculate)
  // docs vary; we send minimal required fields and let CJ compute postage
  // payload example:
  // {
  //   shippingCountryCode: 'ZA',
  //   fromCountryCode: 'CN',
  //   postalCode: '2196', // optional
  //   products: [{ vid: 'V123', quantity: 2 }]
  // }
  async getFreightQuote({ shippingCountryCode, fromCountryCode = 'CN', postalCode, products }) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/logistic/freightCalculate';

    if (!shippingCountryCode) throw new Error('shippingCountryCode is required');
    if (!products || products.length === 0) throw new Error('products array is required');

    const body = {
      shippingCountryCode,
      fromCountryCode,
      products,
    };
    if (postalCode) body.postCode = postalCode; // CJ sometimes uses postCode

    const json = await http('POST', url, {
      body,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.result || !json.data) {
      throw new Error('CJ getFreightQuote failed: ' + (json.message || 'Unknown error'));
    }

    // Normalize into a friendly array
    const list = Array.isArray(json.data) ? json.data : (json.data.list || []);
    return list.map((m) => ({
      logisticName: m.logisticName || m.name,
      totalPostage: Number(m.totalPostage || m.postage || 0),
      deliveryDay: m.deliveryDay || m.aging || null,
      currency: m.currency || 'USD',
      tracking: m.tracking || m.trackingType || undefined,
    }));
  },

  // Webhook verification
  verifyWebhook(headers, body) {
    if (!CJ_WEBHOOK_SECRET) return true;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = hmacSHA256(payload + (headers.timestamp || headers['x-cj-timestamp'] || ''), CJ_WEBHOOK_SECRET);
    const provided = (headers.signature || headers['x-cj-signature'] || '').toString();
    return expected === provided;
  }
};

// Provide both named and default exports to satisfy different import styles
export default cjClient;
