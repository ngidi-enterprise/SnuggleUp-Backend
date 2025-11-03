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

  async searchProducts(keyword, page = 1, pageSize = 20) {
    const accessToken = await getAccessToken();
    const url = CJ_BASE_URL + '/product/list';
    const query = { keyword: keyword || '', page, pageSize };
    const json = await http('GET', url, {
      query,
      headers: { 'CJ-Access-Token': accessToken },
    });
    const items = (json?.data?.list || json?.result || json?.data || []).map((p) => ({
      id: p.id || p.productId || p.sku || String(p.id || ''),
      name: p.name || p.productName || p.title,
      sku: p.sku || p.productSku || p.code,
      price: p.price || p.sellPrice || p.wholesalePrice || 0,
      images: p.images || p.imageUrls || (p.image ? [p.image] : []),
      variants: p.variants || p.varients || [],
      raw: p,
    }));
    return { source: 'cj', items, page, pageSize, raw: json };
  },

  async createOrder(orderPayload) {
    const accessToken = await getAccessToken();
    if (!orderPayload || !orderPayload.items || !Array.isArray(orderPayload.items)) {
      throw new Error('Invalid order payload: items[] required');
    }
    const url = CJ_BASE_URL + '/order/create';
    const json = await http('POST', url, {
      body: orderPayload,
      headers: { 'CJ-Access-Token': accessToken },
    });
    return { ok: true, raw: json };
  },

  verifyWebhook(headers, body) {
    if (!CJ_WEBHOOK_SECRET) return true;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = hmacSHA256(payload + (headers.timestamp || headers['x-cj-timestamp'] || ''), CJ_WEBHOOK_SECRET);
    const provided = (headers.signature || headers['x-cj-signature'] || '').toString();
    return expected === provided;
  }
};
