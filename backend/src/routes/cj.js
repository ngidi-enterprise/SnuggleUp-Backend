import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { cjClient } from '../services/cjClient.js';
import { requireAdmin } from '../middleware/admin.js';
import { syncCuratedInventory, getCuratedInventorySnapshot } from '../services/inventorySync.js';
import pool from '../db.js';

export const router = express.Router();

// Optional auth middleware - validate if present
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return next();
  authenticateToken(req, res, next);
};

// Health check for CJ integration
router.get('/health', (_req, res) => {
  const status = cjClient.getStatus();
  res.json({ ok: true, status });
});

// 1. Search CJ products
// GET /api/cj/products?productNameEn=baby&pageNum=1&pageSize=20&minPrice=5&maxPrice=50
router.get('/products', optionalAuth, async (req, res) => {
  try {
    const { productNameEn, pageNum, pageSize, categoryId, minPrice, maxPrice } = req.query;
    const result = await cjClient.searchProducts({
      productNameEn,
      pageNum: pageNum ? Number(pageNum) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      categoryId,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('CJ products search error:', err);
    res.status(502).json({ error: 'CJ search failed', details: err.message });
  }
});

// 2. Get product details with variants
// GET /api/cj/products/:pid
router.get('/products/:pid', optionalAuth, async (req, res) => {
  try {
    const { pid } = req.params;
    const result = await cjClient.getProductDetails(pid);
    res.json(result);
  } catch (err) {
    console.error('CJ product details error:', err);
    res.status(502).json({ error: 'CJ product details failed', details: err.message });
  }
});

// 3. Check inventory for a variant
// GET /api/cj/inventory/:vid
router.get('/inventory/:vid', optionalAuth, async (req, res) => {
  try {
    const { vid } = req.params;
    const result = await cjClient.getInventory(vid);
    res.json({ vid, inventory: result });
  } catch (err) {
    console.error('CJ inventory check error:', err);
    res.status(502).json({ error: 'CJ inventory check failed', details: err.message });
  }
});

// 3b. Curated products inventory snapshot (aggregated + per warehouse)
// GET /api/cj/inventory/curated
router.get('/inventory/curated', optionalAuth, async (_req, res) => {
  try {
    const snapshot = await getCuratedInventorySnapshot();
    // Prevent any intermediate cache from serving stale data after sync
    res.set('Cache-Control', 'no-store');
    res.json({ source: 'curated', products: snapshot });
  } catch (err) {
    console.error('Curated inventory snapshot error:', err);
    res.status(500).json({ error: 'Failed to load curated inventory', details: err.message });
  }
});

// 3c. Manual sync of curated product inventory (admin only)
// POST /api/cj/inventory/sync { limit?: number }
router.post('/inventory/sync', requireAdmin, async (req, res) => {
  try {
    const { limit } = req.body || {};
    const result = await syncCuratedInventory({ limit: limit ? Number(limit) : undefined });
    res.json(result);
  } catch (err) {
    console.error('Curated inventory sync error:', err);
    res.status(500).json({ error: 'Inventory sync failed', details: err.message });
  }
});

// 4. Create order in CJ
// POST /api/cj/orders
// Body: { orderNumber, shippingCountryCode, shippingCustomerName, shippingAddress, logisticName, fromCountryCode, products: [{vid, quantity}] }
router.post('/orders', optionalAuth, async (req, res) => {
  try {
    const orderData = req.body;
    const result = await cjClient.createOrder(orderData);
    res.status(201).json(result);
  } catch (err) {
    console.error('CJ create order error:', err);
    res.status(502).json({ error: 'CJ order creation failed', details: err.message });
  }
});

// 5. Get order status
// GET /api/cj/orders/:orderId
router.get('/orders/:orderId', optionalAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await cjClient.getOrderStatus(orderId);
    res.json(result);
  } catch (err) {
    console.error('CJ order status error:', err);
    res.status(502).json({ error: 'CJ order status check failed', details: err.message });
  }
});

// 6. Get tracking info
// GET /api/cj/tracking/:trackNumber
router.get('/tracking/:trackNumber', optionalAuth, async (req, res) => {
  try {
    const { trackNumber } = req.params;
    const result = await cjClient.getTracking(trackNumber);
    res.json({ trackNumber, tracking: result });
  } catch (err) {
    console.error('CJ tracking error:', err);
    res.status(502).json({ error: 'CJ tracking check failed', details: err.message });
  }
});

// 7. Webhook endpoint for CJ order/tracking updates
// POST /api/cj/webhook
router.post('/webhook', express.json({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-cj-signature'] || req.headers['x-signature'];
    const timestamp = req.headers['x-cj-timestamp'];

    const valid = cjClient.verifyWebhook({ signature, timestamp }, req.body);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid CJ webhook signature' });
    }

    // Log webhook for debugging
    console.log('📦 CJ Webhook received:', JSON.stringify(req.body, null, 2));

    // TODO: Process webhook data (update order status, tracking in your database)
    // Webhook types: order, logistics, stock, product
    // Example: Update order tracking number when CJ ships the order

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('CJ webhook error:', err);
    res.status(400).json({ error: 'Webhook processing failed', details: err.message });
  }
});

// 8. Shipping quote endpoint (real-time CJ freight)
// POST /api/cj/shipping/quote
// Body: { items: [{ id: curatedId, quantity }], countryCode: 'ZA', postalCode?: '2196', fromCountryCode?: 'CN' }
router.post('/shipping/quote', optionalAuth, async (req, res) => {
  try {
    const { items, countryCode = 'ZA', postalCode, fromCountryCode = 'CN' } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    // Load cj_vid (and cj_pid as fallback) for each curated product id
    const vids = [];
    for (const it of items) {
      const curatedId = String(it.id || '').replace('curated-', '');
      const qty = Math.max(1, Number(it.quantity || 1));

      const result = await pool.query('SELECT cj_vid, cj_pid FROM curated_products WHERE id = $1', [curatedId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: `Curated product ${curatedId} not found` });
      }
      let { cj_vid, cj_pid } = result.rows[0];

      // Fallback: fetch product details and pick first variant if cj_vid is missing
      if (!cj_vid && cj_pid) {
        try {
          const details = await cjClient.getProductDetails(cj_pid);
          cj_vid = details?.variants?.[0]?.vid;
        } catch (e) {
          console.warn('Failed to fetch CJ details for pid', cj_pid, e.message);
        }
      }

      if (!cj_vid) {
        return res.status(400).json({ error: `Missing cj_vid for curated product ${curatedId}` });
      }
      vids.push({ vid: cj_vid, quantity: qty });
    }

    const quotes = await cjClient.getFreightQuote({
      shippingCountryCode: countryCode,
      fromCountryCode,
      postalCode,
      products: vids,
    });

    // Convert to ZAR if CJ returns USD (heuristic)
    const rate = Number(process.env.USD_TO_ZAR || 19.0);
    const normalized = quotes.map(q => ({
      logisticName: q.logisticName,
      costZAR: q.currency && q.currency.toUpperCase() !== 'ZAR' ? Number((q.totalPostage * rate).toFixed(2)) : Number(q.totalPostage.toFixed(2)),
      currency: q.currency || 'USD',
      rawCost: Number(q.totalPostage.toFixed(2)),
      deliveryDay: q.deliveryDay,
    }));

    res.json({ countryCode, postalCode, fromCountryCode, options: normalized });
  } catch (err) {
    console.error('CJ shipping quote error:', err);
    res.status(502).json({ error: 'CJ shipping quote failed', details: err.message });
  }
});
