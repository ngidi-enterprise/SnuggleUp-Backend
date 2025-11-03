import crypto from 'crypto';

// CJ Dropshipping API client (lightweight, pluggable for your credentials)
// This implementation supports two modes:
// 1) Token mode: Provide CJ_ACCESS_TOKEN (recommended quick start)
// 2) App mode (scaffold): Provide CJ_APP_KEY/CJ_APP_SECRET and implement token/sign per CJ docs

const CJ_BASE_URL = process.env.CJ_BASE_URL || 'https://open-api-placeholder.cjdropshipping.com';
const CJ_ACCESS_TOKEN = process.env.CJ_ACCESS_TOKEN || '';
const CJ_APP_KEY = process.env.CJ_APP_KEY || '';
const CJ_APP_SECRET = process.env.CJ_APP_SECRET || '';
const CJ_WEBHOOK_SECRET = process.env.CJ_WEBHOOK_SECRET || '';

// Helper: simple fetch wrapper (uses global fetch in Node >=18)
async function http(method, path, { query, body, headers } = {}) {
  const url = new URL(path, CJ_BASE_URL);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(url, {
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

function requireToken() {
  if (!CJ_ACCESS_TOKEN) {
    throw new Error('CJ_ACCESS_TOKEN is not set. Set it in your environment to enable CJ API calls.');
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
      hasAccessToken: Boolean(CJ_ACCESS_TOKEN),
      hasAppKey: Boolean(CJ_APP_KEY),
      hasAppSecret: Boolean(CJ_APP_SECRET),
      webhookVerification: Boolean(CJ_WEBHOOK_SECRET),
    };
  },

  // Quick start: search products by keyword
  async searchProducts(keyword, page = 1, pageSize = 20) {
    if (!CJ_ACCESS_TOKEN) {
      // Mock mode for UI dev
      return {
        source: 'mock',
        items: [
          {
            id: 'CJDEMO123',
            name: `Demo ${keyword || 'Product'}`,
            sku: 'DEMO-SKU',
            price: 9.99,
            images: ['https://picsum.photos/seed/cj1/600/600'],
            variants: [{ sku: 'DEMO-SKU-1', price: 9.99 }],
          },
        ],
        page,
        pageSize,
        total: 1,
      };
    }

    // NOTE: Replace the path/params with official CJ product search once you have docs.
    // Below is a conservative placeholder that many CJ integrations use.
    const path = '/api/product/list';
    const query = { keyword: keyword || '', page: page, pageSize };

    const json = await http('GET', path, {
      query,
      headers: { Authorization: `Bearer ${CJ_ACCESS_TOKEN}` },
    });

    // Map to frontend-friendly shape (adjust as per actual CJ response)
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

  // Create an order in CJ (scaffold)
  async createOrder(orderPayload) {
    requireToken();
    // Validate minimal payload (you can expand this based on your order model)
    if (!orderPayload || !orderPayload.items || !Array.isArray(orderPayload.items)) {
      throw new Error('Invalid order payload: items[] required');
    }

    // Placeholder path; update to CJ order creation endpoint
    const path = '/api/order/create';
    const json = await http('POST', path, {
      body: orderPayload,
      headers: { Authorization: `Bearer ${CJ_ACCESS_TOKEN}` },
    });

    return { ok: true, raw: json };
  },

  // Verify CJ webhook signature (scaffold)
  verifyWebhook(headers, body) {
    if (!CJ_WEBHOOK_SECRET) return true; // If no secret configured, accept for development
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = hmacSHA256(payload + (headers.timestamp || headers['x-cj-timestamp'] || ''), CJ_WEBHOOK_SECRET);
    const provided = (headers.signature || headers['x-cj-signature'] || '').toString();
    return expected === provided;
  },
};
