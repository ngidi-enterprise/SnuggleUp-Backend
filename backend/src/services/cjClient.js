import crypto from 'crypto';

// CJ Dropshipping API client (lightweight, pluggable for your credentials)
// This implementation supports two modes:
// 1) Token mode: Provide CJ_ACCESS_TOKEN (recommended quick start)
// 2) App mode (scaffold): Provide CJ_APP_KEY/CJ_APP_SECRET and implement token/sign per CJ docs


const CJ_BASE_URL = process.env.CJ_BASE_URL || 'https://developers.cjdropshipping.com/api2.0/v1';
const CJ_EMAIL = process.env.CJ_EMAIL || '';
const CJ_API_KEY = process.env.CJ_API_KEY || '';
const CJ_WEBHOOK_SECRET = process.env.CJ_WEBHOOK_SECRET || '';

let cjTokenCache = {
  accessToken: '',
  refreshToken: '',
  accessTokenExpiry: 0,
  refreshTokenExpiry: 0,
};


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
  if (!res.ok) {
    const err = new Error(`CJ HTTP ${res.status}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

// Get and cache CJ access token
async function getAccessToken(force = false) {
  const now = Date.now();
  if (!force && cjTokenCache.accessToken && cjTokenCache.accessTokenExpiry > now + 60000) {
    return cjTokenCache.accessToken;
  }
  if (!CJ_EMAIL || !CJ_API_KEY) {
    throw new Error('CJ_EMAIL and CJ_API_KEY must be set in environment');
  }
  const url = 'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken';
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
  return cjTokenCache.accessToken;
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
      throw new Error('CJ searchProducts failed: ' + (json.message || 'Unknown error'));
    }

    const items = (json.data.list || []).map((p) => ({
      pid: p.pid,
      name: p.productNameEn,
      sku: p.productSku,
      price: p.sellPrice,
      image: p.productImage,
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
      image: product.productImage,
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
        image: v.variantImage,
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

  // Webhook verification
  verifyWebhook(headers, body) {
    if (!CJ_WEBHOOK_SECRET) return true;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = hmacSHA256(payload + (headers.timestamp || headers['x-cj-timestamp'] || ''), CJ_WEBHOOK_SECRET);
    const provided = (headers.signature || headers['x-cj-signature'] || '').toString();
    return expected === provided;
  }
};
