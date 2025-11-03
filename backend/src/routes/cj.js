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

// Basic health for CJ integration
router.get('/health', (_req, res) => {
  const status = cjClient.getStatus();
  res.json({ ok: true, status });
});

// Search CJ products (minimal pass-through)
// Query params: q (keyword), page=1, pageSize=20
router.get('/products', optionalAuth, async (req, res) => {
  try {
    const { q = '', page = 1, pageSize = 20 } = req.query;
    const result = await cjClient.searchProducts(String(q), Number(page), Number(pageSize));
    res.json(result);
  } catch (err) {
    console.error('CJ products search error:', err);
    res.status(502).json({ error: 'CJ search failed', details: err.message });
  }
});

// Create order in CJ from our local order payload
router.post('/orders', optionalAuth, async (req, res) => {
  try {
    const orderPayload = req.body;
    const result = await cjClient.createOrder(orderPayload);
    res.status(201).json(result);
  } catch (err) {
    console.error('CJ create order error:', err);
    res.status(502).json({ error: 'CJ order creation failed', details: err.message });
  }
});

// Webhook endpoint for CJ fulfillment/tracking updates
// NOTE: Configure CJ webhook to POST JSON to /api/cj/webhook
router.post('/webhook', express.json({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-cj-signature'] || req.headers['x-signature'];
    const timestamp = req.headers['x-cj-timestamp'];

    const valid = cjClient.verifyWebhook({ signature, timestamp }, req.body);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid CJ webhook signature' });
    }

    // TODO: Map payload to local order updates (tracking/status)
    console.log('📦 CJ Webhook received:', JSON.stringify(req.body, null, 2));

    // Respond quickly to acknowledge
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('CJ webhook error:', err);
    res.status(400).json({ error: 'Webhook processing failed', details: err.message });
  }
});
