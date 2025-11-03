import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { cjClient } from '../services/cjClient.js';

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
