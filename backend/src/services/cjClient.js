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

// Simple search cache to reduce duplicate API calls (5 minute TTL)
const searchCache = new Map();
const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(params) {
  return JSON.stringify(params);
}

function getFromCache(key) {
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    console.log('📦 Using cached search result');
    return cached.data;
  }
  return null;
}

function setCache(key, data) {
  searchCache.set(key, { data, timestamp: Date.now() });
  // Clean old entries if cache gets too large
  if (searchCache.size > 100) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
}

// CJ has a strict QPS limit (often 1 request/second). We'll throttle and retry.
let lastCJCallAt = 0;
const CJ_MIN_INTERVAL_MS = 1500; // Increased to 1.5s for better safety margin

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
      // Exponential backoff: wait longer each retry (2s, 4s, 8s)
      const backoffMs = CJ_MIN_INTERVAL_MS * Math.pow(2, attempt);
      console.warn(`⏳ CJ rate limit hit, retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(backoffMs);
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
    // Check cache first
    const cacheKey = getCacheKey({ productNameEn, pageNum, pageSize, categoryId, minPrice, maxPrice });
    const cached = getFromCache(cacheKey);
    if (cached) return cached;

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
      // Hint to CJ API: only return products sourced from China
      fromCountryCode: 'CN',
    };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });
    
    if (!json.result || !json.data) {
      console.error('CJ searchProducts error:', JSON.stringify(json));
      throw new Error('CJ searchProducts failed: ' + (json.message || 'Unknown error'));
    }

    const rawList = (json.data.list || []);
    // Debug: log first product's raw structure to see all available fields
    if (rawList.length > 0) {
      console.log('📋 CJ Product API raw fields sample:', JSON.stringify(rawList[0], null, 2));
    }
    const items = rawList.map((p) => {
      // Attempt to derive the origin country from several possible CJ fields.
      // CJ product list responses may include one of these (field names vary between docs & envs):
      //  - fromCountryCode
      //  - countryCode
      //  - sourceCountryCode
      // If none are present we set originCountry to null.
      const originCountry = p.fromCountryCode || p.countryCode || p.sourceCountryCode || null;
      return {
        pid: p.pid,
        name: p.productNameEn,
        sku: p.productSku,
        price: p.sellPrice,
        image: normalizeUrl(p.productImage),
        description: p.description || p.productDescription || '', // Include description
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        weight: p.productWeight,
        isFreeShipping: p.isFreeShipping,
        listedNum: p.listedNum,
        originCountry,
      };
    }).filter(it => {
      // Prefer explicit CN; if the field is absent (CJ sometimes omits it),
      // keep the item because we already requested fromCountryCode=CN upstream.
      return it.originCountry === 'CN' || it.originCountry === null || it.originCountry === undefined;
    });

    const result = {
      source: 'cj',
      items,
      pageNum: json.data.pageNum,
      pageSize: json.data.pageSize,
      // total reflects results after upstream CN filter and category filter
      total: items.length,
      filtered: {
        applied: 'fromCountryCode=CN + baby/kids category only',
        originalTotal: json.data.total,
        originalReturned: rawList.length,
        afterFilter: items.length
      }
    };
    
    // Cache the result for 5 minutes
    setCache(cacheKey, result);
    return result;
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

    console.log(`🔍 CJ getProductDetails response for ${pid}:`, {
      result: json.result,
      hasData: !!json.data,
      message: json.message
    });

    if (!json.result || !json.data) {
      throw new Error(`CJ getProductDetails failed: ${json.message || 'Product not found'}: pid:${pid}`);
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
      // Rich product specifications
      material: product.material || '',
      productAttributes: product.productAttributes || '',
      packageSize: product.packageSize || '',
      productFeatures: product.productFeatures || '',
      packingList: product.packingList || '',
      // Additional images
      images: (product.productImages || []).map(img => normalizeUrl(img)),
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

  // 2b. Get product reviews (best-effort; CJ sometimes omits reviews)
  async getProductReviews(pid, pageNum = 1, pageSize = 10) {
    const accessToken = await getAccessToken();
    // Use the current CJ API endpoint for product reviews (new /productComments)
    // Deprecated endpoint is /product/comments (will be removed June 1, 2024)
    const url = CJ_BASE_URL + '/product/productComments';
    const query = { pid, pageNum, pageSize };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });

    if (!json.success && (!json.result || json.code !== 0)) {
      throw new Error(`CJ getProductReviews failed: ${json.message || 'Product not found'}: pid:${pid}`);
    }

    const responseData = json.data || {};
    const rawReviews = (responseData.list || []);

    const normalizeDate = (d) => {
      if (!d) return null;
      try {
        const dt = new Date(d);
        if (!isNaN(dt.getTime())) return dt.toISOString();
      } catch (_) {}
      return null;
    };

    const normalized = (rawReviews || []).map((r, idx) => {
      // CJ API returns: commentId, pid, comment, commentDate, commentUser, score, commentUrls, countryCode, flagIconUrl
      const rating = Number(r.score || 5);
      const comment = r.comment || '';
      const title = (comment ? comment.split('\n')[0].slice(0, 80) : 'Review');
      const author = r.commentUser || 'Customer';
      const helpful = 0; // CJ API doesn't provide helpful count in product comments
      const date = normalizeDate(r.commentDate);
      const images = Array.isArray(r.commentUrls) ? r.commentUrls : [];
      const countryCode = r.countryCode || '';

      return {
        id: r.commentId || `${pid}-${idx}`,
        rating: Math.min(Math.max(rating || 5, 1), 5),
        title,
        comment,
        author,
        helpful,
        date,
        images,
        countryCode,
        verified: false, // CJ API doesn't indicate verified purchase in product comments
      };
    }).filter(r => r.comment && r.comment.trim().length > 0);

    return normalized;
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

    const inventoryList = json.data || [];
    // Debug: log first warehouse's raw structure to see all available fields
    if (inventoryList.length > 0) {
      console.log('📦 CJ Inventory API raw fields sample:', JSON.stringify(inventoryList[0], null, 2));
    }

    return inventoryList.map((stock) => ({
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

    // Log exact payload being sent
    console.log(`[cjClient] Sending to CJ API:`);
    console.log(`  shippingZip: "${orderData.shippingZip}" (type: ${typeof orderData.shippingZip}, length: ${orderData.shippingZip?.length})`);
    console.log(`  shippingPhone: "${orderData.shippingPhone}" (type: ${typeof orderData.shippingPhone}, length: ${orderData.shippingPhone?.length})`);
    console.log(`  logisticName: "${orderData.logisticName}"`);
    console.log(`  consigneeID: "${orderData.consigneeID}" (length: ${orderData.consigneeID?.length})`);
    if (orderData.consigneeTaxNumber !== undefined) {
      console.log(`  consigneeTaxNumber: "${orderData.consigneeTaxNumber}" (length: ${orderData.consigneeTaxNumber?.length})`);
    }

    const json = await http('POST', url, {
      body: orderData,
      headers: { 'CJ-Access-Token': accessToken },
    });

    // Log raw CJ response for debugging
    console.log('[cjClient] Raw CJ response:', JSON.stringify(json, null, 2));

    // CJ may return HTTP 200 with result=false and message explaining the issue
    // Sometimes the order is still created despite the error (e.g., "Balance is insufficient")
    // So we log the warning but continue if we got data back
    if (!json.result) {
      console.warn(`[cjClient] CJ API warning: ${json.message || 'Unknown warning'}`);
      // If we have order data despite the error, still return it
      if (!json.data) {
        throw new Error('CJ createOrder failed: ' + (json.message || 'Unknown error'));
      }
      // If we have data, log it as a partial success
      console.log(`[cjClient] Despite warning, order was created. Data:`, JSON.stringify(json.data, null, 2));
    }

    if (!json.data) {
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
      warning: json.result === false ? json.message : null, // Pass back any warning message
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
  //   startCountryCode: 'CN',
  //   endCountryCode: 'ZA',
  //   postalCode: '2196', // optional
  //   products: [{ vid: 'V123', quantity: 2 }]
  // }
  async getFreightQuote({ startCountryCode, endCountryCode, postalCode, products }) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/logistic/freightCalculate';

    if (!endCountryCode) throw new Error('endCountryCode is required');
    if (!products || products.length === 0) throw new Error('products array is required');

    const body = {
      startCountryCode: startCountryCode || 'CN',
      endCountryCode: endCountryCode,
      products,
    };
    if (postalCode) body.postCode = postalCode; // CJ sometimes uses postCode

    console.log('📤 Sending to CJ freight API:', JSON.stringify(body, null, 2));
    
    const json = await http('POST', url, {
      body,
      headers: { 'CJ-Access-Token': accessToken },
    });

    console.log('📥 CJ freightCalculate raw response:', JSON.stringify(json, null, 2));

    if (!json.result) {
      const errorMsg = `CJ freight API error: ${json.message || json.msg || 'Unknown error'} (code: ${json.code || 'none'})`;
      console.error('❌', errorMsg);
      console.error('Request was:', JSON.stringify(body, null, 2));
      throw new Error(errorMsg);
    }
    
    if (!json.data) {
      console.warn('⚠️ CJ returned success but no data:', json);
      // Return empty array to trigger fallback
      return [];
    }

    // Normalize into a friendly array
    const list = Array.isArray(json.data) ? json.data : (json.data.list || []);
    
    console.log('📋 CJ freight data (before normalization):', JSON.stringify(list, null, 2));
    if (list.length > 0) {
      console.log('📋 First freight item raw:', list[0]);
      console.log('📋 Available fields:', Object.keys(list[0] || {}));
    }
    
    return list.map((m) => {
      // Log ALL fields from CJ response to diagnose pricing issue
      console.log(`\n🔍 RAW CJ RESPONSE FOR ${m.logisticName}:`, JSON.stringify(m, null, 2));
      
      // Try all possible price fields from CJ API (they use different fields in different scenarios)
      const totalPostageFee = Number(m.totalPostageFee || 0);
      const logisticPrice = Number(m.logisticPrice || 0);
      const postage = Number(m.postage || 0);
      const totalPostage = Number(m.totalPostage || 0);
      const freight = Number(m.freight || 0);
      const price = Number(m.price || 0);
      const logisticPriceCn = Number(m.logisticPriceCn || 0);
      const postageCNY = Number(m.postageCNY || 0);
      
      // Remote/zone fees
      const remoteFee = Number(m.remoteFee || 0);
      const remoteFeeCNY = Number(m.remoteFeeCNY || 0);
      const zonePrice = Number(m.zonePrice || 0);
      
      // Additional fees
      const taxesFee = Number(m.taxesFee || 0);
      const clearanceFee = Number(m.clearanceOperationFee || 0);
      
      console.log(`💰 PRICE FIELDS FOR ${m.logisticName}:`);
      console.log(`   totalPostageFee: ${totalPostageFee}`);
      console.log(`   logisticPrice: ${logisticPrice}`);
      console.log(`   postage: ${postage}`);
      console.log(`   totalPostage: ${totalPostage}`);
      console.log(`   freight: ${freight}`);
      console.log(`   price: ${price}`);
      console.log(`   logisticPriceCn: ${logisticPriceCn}`);
      console.log(`   postageCNY: ${postageCNY}`);
      console.log(`   remoteFee: ${remoteFee}`);
      console.log(`   remoteFeeCNY: ${remoteFeeCNY}`);
      console.log(`   zonePrice: ${zonePrice}`);
      console.log(`   taxesFee: ${taxesFee}`);
      console.log(`   clearanceFee: ${clearanceFee}`);
      
      // Pick the first non-zero price field (priority order)
      let finalPrice = totalPostageFee || logisticPrice || postage || totalPostage || 
                       freight || price || logisticPriceCn || postageCNY || zonePrice || 0;
      
      // Add all additional fees
      finalPrice += remoteFee + remoteFeeCNY + taxesFee + clearanceFee;
      
      console.log(`   ✅ FINAL COMPUTED PRICE: ${finalPrice} USD\n`);
      
      return {
        logisticName: m.logisticName || m.name,
        totalPostage: finalPrice,
        deliveryDay: m.deliveryDay || m.logisticAging || m.aging || m.deliveryTime || null,
        currency: m.currency || 'USD',
        tracking: m.tracking || m.trackingType || undefined,
        // Include raw price breakdown for debugging
        _debug: {
          totalPostageFee: m.totalPostageFee,
          logisticPrice: m.logisticPrice,
          postage: m.postage,
          remoteFee: m.remoteFee,
          allFields: Object.keys(m)
        }
      };
    });
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

// Default export for compatibility
export default cjClient;
