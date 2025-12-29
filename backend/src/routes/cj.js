import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { cjClient } from '../services/cjClient.js';
import { requireAdmin } from '../middleware/admin.js';
import { syncCuratedInventory, getCuratedInventorySnapshot } from '../services/inventorySync.js';
import { updateOrderTracking } from './orders.js';
import { sendTrackingEmail } from '../services/emailService.js';
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

// 1b. Get product reviews (public)
// GET /api/cj/products/:pid/reviews
router.get('/products/:pid/reviews', optionalAuth, async (req, res) => {
  try {
    const { pid } = req.params;
    const reviews = await cjClient.getProductReviews(pid);
    res.json({ pid, source: 'cj', count: reviews.length, reviews });
  } catch (err) {
    console.error('CJ product reviews error:', err);
    res.status(502).json({ error: 'CJ product reviews failed', details: err.message });
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
// 3b. Curated products inventory snapshot (aggregated + per warehouse)
// NOTE: Place BEFORE /inventory/:vid to prevent Express from capturing "curated" as :vid
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
    const result = await syncCuratedInventory({ 
      limit: limit ? Number(limit) : undefined,
      syncType: 'manual'
    });
    res.json(result);
  } catch (err) {
    console.error('Curated inventory sync error:', err);
    res.status(500).json({ error: 'Inventory sync failed', details: err.message });
  }
});

// 3d. Get sync history (admin only)
// GET /api/cj/inventory/sync-history?limit=10
router.get('/inventory/sync-history', requireAdmin, async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = await pool.query(
      `SELECT id, started_at, completed_at, products_updated, products_failed, 
              status, error_message, sync_type,
              EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds
       FROM inventory_sync_history 
       ORDER BY started_at DESC 
       LIMIT $1`,
      [limit]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('Sync history fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch sync history', details: err.message });
  }
});

// 3e. Get current sync status (admin only)
// GET /api/cj/inventory/sync-status
router.get('/inventory/sync-status', requireAdmin, async (req, res) => {
  try {
    // Get last completed sync
    const lastSync = await pool.query(
      `SELECT started_at, completed_at, products_updated, products_failed, status, sync_type
       FROM inventory_sync_history 
       WHERE status = 'completed'
       ORDER BY started_at DESC 
       LIMIT 1`
    );
    
    // Check if a sync is currently running
    const runningSync = await pool.query(
      `SELECT id, started_at, sync_type
       FROM inventory_sync_history 
       WHERE status = 'running'
       ORDER BY started_at DESC 
       LIMIT 1`
    );

    const intervalMs = Number(process.env.CJ_INVENTORY_SYNC_INTERVAL_MS || 15 * 60 * 1000);
    const lastSyncData = lastSync.rows[0];
    const nextScheduledSync = lastSyncData?.started_at 
      ? new Date(new Date(lastSyncData.started_at).getTime() + intervalMs)
      : null;

    res.json({
      lastSync: lastSyncData || null,
      isRunning: runningSync.rows.length > 0,
      currentSync: runningSync.rows[0] || null,
      nextScheduledSync,
      syncInterval: intervalMs,
    });
  } catch (err) {
    console.error('Sync status fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch sync status', details: err.message });
  }
});


// 3. Check inventory for a variant
// Keep AFTER the curated/sync routes so dynamic param does not match them
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
      console.warn('⚠️ Invalid CJ webhook signature');
      return res.status(401).json({ error: 'Invalid CJ webhook signature' });
    }

    // Log webhook for debugging
    console.log('📦 CJ Webhook received:', JSON.stringify(req.body, null, 2));

    // Process webhook data based on event type
    const { eventType, data } = req.body;

    if (eventType === 'logistics' || eventType === 'order_shipped') {
      // Extract tracking information
      const cjOrderId = data?.orderId || data?.orderNumber;
      const trackingNumber = data?.trackingNumber || data?.logisticsNumber;
      const trackingUrl = data?.trackingUrl || data?.trackingLink;

      if (cjOrderId && trackingNumber) {
        console.log(`📬 Updating tracking for CJ order ${cjOrderId}: ${trackingNumber}`);
        
        // Update order in database
        await updateOrderTracking(cjOrderId, trackingNumber, trackingUrl || '');
        
        // Send customer email notification with tracking info
        const orderResult = await pool.query(
          'SELECT customer_email, order_number FROM orders WHERE cj_order_id = $1',
          [cjOrderId]
        );
        
        if (orderResult.rows.length > 0) {
          const order = orderResult.rows[0];
          const emailResult = await sendTrackingEmail({
            to: order.customer_email,
            orderNumber: order.order_number,
            trackingNumber,
            trackingUrl
          });
          
          if (emailResult.success) {
            console.log(`📧 Tracking email sent to ${order.customer_email}`);
          } else {
            console.warn(`⚠️ Failed to send tracking email: ${emailResult.error}`);
          }
        }
        
        console.log(`✅ Tracking updated for CJ order ${cjOrderId}`);
      } else {
        console.warn('⚠️ Webhook missing tracking information:', { cjOrderId, trackingNumber });
      }
    } else if (eventType === 'order_status') {
      // Handle order status updates
      const cjOrderId = data?.orderId;
      const status = data?.status;
      
      if (cjOrderId && status) {
        console.log(`📋 Updating status for CJ order ${cjOrderId}: ${status}`);
        await pool.query(
          'UPDATE orders SET cj_status = $1, updated_at = CURRENT_TIMESTAMP WHERE cj_order_id = $2',
          [status, cjOrderId]
        );
        console.log(`✅ Status updated for CJ order ${cjOrderId}`);
      }
    } else {
      console.log(`ℹ️ Unhandled webhook type: ${eventType}`);
    }

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
