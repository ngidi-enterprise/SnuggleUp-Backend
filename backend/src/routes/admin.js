import express from 'express';
import { requireAdmin } from '../middleware/admin.js';
import pool from '../db.js';
import { cjClient } from '../services/cjClient.js';
import { getRuntimeConfig, setShippingFallbackEnabled, isShippingFallbackEnabled } from '../services/configService.js';
import { generateSEOTitles } from '../services/seoTitleGenerator.js';
import { getOrderById, buildCJOrderData, updateOrderCJInfo } from './orders.js';
import { getSchedulerHealth, generateSchedulerReport, getExecutionHistory } from '../services/schedulerMonitor.js';

export const router = express.Router();

// In-memory store for recent CJ submissions (for debugging)
const recentCJSubmissions = [];
const MAX_STORED_SUBMISSIONS = 20;

function storeCJSubmission(orderNumber, request, response, error = null) {
  recentCJSubmissions.unshift({
    timestamp: new Date().toISOString(),
    orderNumber,
    request,
    response,
    error,
    url: 'https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrderV2'
  });
  if (recentCJSubmissions.length > MAX_STORED_SUBMISSIONS) {
    recentCJSubmissions.pop();
  }
}

// Dynamic pricing config (loaded from DB site_config; falls back to ENV/defaults)
let USD_TO_ZAR = 18.0;
let PRICE_MARKUP = 1.4;

async function loadPricingConfig() {
  try {
    const result = await pool.query(`SELECT key, value FROM site_config WHERE key IN ('usd_to_zar','price_markup')`);
    const map = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    const envUsd = parseFloat(process.env.USD_TO_ZAR);
    const envMarkup = parseFloat(process.env.PRICE_MARKUP);
    // DB overrides env if valid
    const usdCandidate = parseFloat(map.usd_to_zar || (Number.isFinite(envUsd) ? envUsd : ''));
    if (Number.isFinite(usdCandidate) && usdCandidate >= 5) {
      USD_TO_ZAR = usdCandidate;
    }
    const markupCandidate = parseFloat(map.price_markup || (Number.isFinite(envMarkup) ? envMarkup : ''));
    if (Number.isFinite(markupCandidate) && markupCandidate > 0.2 && markupCandidate <= 10) {
      PRICE_MARKUP = markupCandidate;
    }
    console.log(`[pricing] Loaded config USD_TO_ZAR=${USD_TO_ZAR} PRICE_MARKUP=${PRICE_MARKUP}`);
  } catch (e) {
    console.warn('[pricing] Failed loading site_config, using defaults', e.message);
  }
}
loadPricingConfig();

async function updatePricingConfig({ usdToZar, priceMarkup }) {
  const updates = [];
  if (usdToZar !== undefined) {
    const num = parseFloat(usdToZar);
    if (!Number.isFinite(num) || num < 5) throw new Error('usdToZar must be >=5');
    await pool.query(`INSERT INTO site_config (key,value) VALUES ('usd_to_zar',$1) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, [num.toString()]);
    USD_TO_ZAR = num;
    updates.push('usd_to_zar');
  }
  if (priceMarkup !== undefined) {
    const num = parseFloat(priceMarkup);
    if (!Number.isFinite(num) || num <= 0.2 || num > 10) throw new Error('priceMarkup must be >0.2 and <=10');
    await pool.query(`INSERT INTO site_config (key,value) VALUES ('price_markup',$1) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, [num.toString()]);
    PRICE_MARKUP = num;
    updates.push('price_markup');
  }
  return updates;
}


// Lightweight request logger to aid production debugging
router.use((req, _res, next) => {
  try {
    const auth = req.headers?.authorization || '';
    const snippet = auth ? auth.slice(0, 25) + '…' : 'none';
    console.log(`[admin] ${req.method} ${req.originalUrl} auth:${snippet}`);
  } catch {}
  next();
});

// All admin routes require admin authentication
router.use(requireAdmin);

// Simple debug endpoint (verifies admin gate & token decoding)
router.get('/debug', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    email: req.user?.email || null,
    localUserId: req.localUserId || null,
    supabaseUser: !!req.user?.supabaseUser,
  });
});

// Scheduler health status (JSON for frontend integration)
router.get('/scheduler-health', (req, res) => {
  res.json(getSchedulerHealth());
});

// Scheduler execution history (for charts)
router.get('/scheduler-history', (req, res) => {
  const { type = 'inventory', limit = 50 } = req.query;
  if (!['inventory', 'price'].includes(type)) {
    return res.status(400).json({ error: 'type must be "inventory" or "price"' });
  }
  res.json(getExecutionHistory(type, Number(limit)));
});

// Scheduler text report (downloadable)
router.get('/scheduler-report', (req, res) => {
  const report = generateSchedulerReport();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="scheduler-report.txt"');
  res.send(report);
});

// Pricing config introspection (helps debug env issues in deployment)
router.get('/pricing-config', async (req, res) => {
  // Always reload to reflect external changes (cheap query)
  await loadPricingConfig();
  res.json({
    usdToZar: USD_TO_ZAR,
    priceMarkup: PRICE_MARKUP,
    source: 'db',
  });
});

// Runtime config: read current flags
router.get('/config/runtime', (req, res) => {
  res.json(getRuntimeConfig());
});

// Toggle shipping fallback feature flag
router.post('/config/shipping-fallback', (req, res) => {
  const enabled = !!(req.body?.enabled);
  const current = setShippingFallbackEnabled(enabled);
  res.json({ shippingFallbackEnabled: current });
});

// Update pricing config and optionally recalc/sync prices
router.put('/pricing-config', async (req, res) => {
  try {
    const { usdToZar, priceMarkup, recalcSuggested, syncRetail } = req.body || {};
    if (usdToZar === undefined && priceMarkup === undefined) {
      return res.status(400).json({ error: 'Provide usdToZar and/or priceMarkup' });
    }
    const changed = await updatePricingConfig({ usdToZar, priceMarkup });
    let recalcCount = 0;
    if (recalcSuggested) {
      const update = await pool.query(`UPDATE curated_products SET suggested_price = ROUND((cj_cost_price * $1 * $2) * 100) / 100, updated_at = NOW() RETURNING id`, [USD_TO_ZAR, PRICE_MARKUP]);
      recalcCount = update.rowCount;
    }
    let syncCount = 0;
    if (syncRetail) {
      const sync = await pool.query(`UPDATE curated_products SET custom_price = suggested_price, updated_at = NOW() RETURNING id`);
      syncCount = sync.rowCount;
    }
    res.json({
      success: true,
      changed,
      usdToZar: USD_TO_ZAR,
      priceMarkup: PRICE_MARKUP,
      recalcSuggested: !!recalcSuggested,
      recalcCount,
      syncRetail: !!syncRetail,
      syncCount,
      formula: `USD cost × ${USD_TO_ZAR} × ${PRICE_MARKUP}`
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get CJ access token (shows currently cached/valid token; will refresh if needed)
router.get('/get-cj-token', async (req, res) => {
  try {
    const token = await cjClient.getAccessToken(false); // Respect 5-min limit
    const status = cjClient.getStatus();
    res.json({
      success: true,
      accessToken: token,
      expiresAt: new Date(status.tokenExpiry).toISOString(),
      instructions: 'Copy this token and add it to Render backend environment as CJ_ACCESS_TOKEN'
    });
  } catch (err) {
    console.error('Failed to get CJ token:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ============ ANALYTICS ============

// Get dashboard analytics
router.get('/analytics', async (req, res) => {
  try {
    // Total orders and revenue
    const ordersResult = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(total) as total_revenue,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN cj_order_id IS NOT NULL THEN total ELSE 0 END) as completed_revenue,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders
      FROM orders
    `);

    // Profit-based actual revenue for CJ-submitted orders
    const profitCJResult = await pool.query(
      `
        WITH cj_orders AS (
          SELECT id, items
          FROM orders
          WHERE cj_order_id IS NOT NULL
        ),
        order_items AS (
          SELECT 
            regexp_replace(item->>'id', '\\D', '', 'g') AS numeric_id_str,
            COALESCE((item->>'quantity')::numeric, 0) AS qty,
            COALESCE((item->>'price')::numeric, 0) AS sale_price
          FROM cj_orders, LATERAL jsonb_array_elements(items::jsonb) AS item
        )
        SELECT 
          COALESCE(SUM(
            CASE 
              WHEN cp.id IS NOT NULL THEN (COALESCE(cp.custom_price, oi.sale_price, 0) - (COALESCE(cp.cj_cost_price, 0) * $1)) * oi.qty
              WHEN ($2::numeric) > 1 THEN (oi.sale_price - (oi.sale_price / ($2::numeric))) * oi.qty -- fallback: derive cost from flat markup factor
              ELSE 0
            END
          ), 0) AS actual_revenue
        FROM order_items oi
        LEFT JOIN curated_products cp ON cp.id::text = oi.numeric_id_str
      `,
      [USD_TO_ZAR, PRICE_MARKUP]
    );

    // Profit-based actual revenue for all paid/completed orders
    const profitAllResult = await pool.query(
      `
        WITH paid_orders AS (
          SELECT id, items
          FROM orders
          WHERE status IN ('paid','completed')
        ),
        order_items AS (
          SELECT 
            regexp_replace(item->>'id', '\\D', '', 'g') AS numeric_id_str,
            COALESCE((item->>'quantity')::numeric, 0) AS qty,
            COALESCE((item->>'price')::numeric, 0) AS sale_price
          FROM paid_orders, LATERAL jsonb_array_elements(items::jsonb) AS item
        )
        SELECT 
          COALESCE(SUM(
            CASE 
              WHEN cp.id IS NOT NULL THEN (oi.sale_price - (COALESCE(cp.cj_cost_price, 0) * $1)) * oi.qty
              WHEN ($2::numeric) > 1 THEN (oi.sale_price - (oi.sale_price / ($2::numeric))) * oi.qty
              ELSE 0
            END
          ), 0) AS actual_revenue_all
        FROM order_items oi
        LEFT JOIN curated_products cp ON cp.id::text = oi.numeric_id_str
      `,
      [USD_TO_ZAR, PRICE_MARKUP]
    );

    // Orders by day (last 30 days)
    const dailyOrdersResult = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as order_count,
        SUM(total) as revenue
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Top selling products (from order items)
    const topProductsResult = await pool.query(`
      SELECT 
        item->>'name' as product_name,
        item->>'id' as product_id,
        COUNT(*) as times_ordered,
        SUM((item->>'price')::numeric * (item->>'quantity')::numeric) as total_revenue
      FROM orders, jsonb_array_elements(items::jsonb) as item
      WHERE status = 'completed'
      GROUP BY item->>'name', item->>'id'
      ORDER BY times_ordered DESC
      LIMIT 10
    `);

    res.json({
      summary: {
        ...ordersResult.rows[0],
        actual_revenue: profitAllResult.rows[0]?.actual_revenue_all || 0,
        actual_revenue_cj: profitCJResult.rows[0]?.actual_revenue || 0
      },
      dailyOrders: dailyOrdersResult.rows,
      topProducts: topProductsResult.rows,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ============ PRODUCT CURATION ============

// Get all curated products
router.get('/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        cp.*, 
        COALESCE(array_remove(array_agg(DISTINCT cpi.country_code), NULL), '{}') AS warehouse_countries
      FROM curated_products cp
      LEFT JOIN curated_product_inventories cpi ON cpi.curated_product_id = cp.id
      GROUP BY cp.id
      ORDER BY cp.created_at DESC
    `);
    res.json({ products: result.rows });
  } catch (error) {
    console.error('Get curated products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Add product to curated list
router.post('/products', async (req, res) => {
  try {
    const { 
      cj_pid, 
      cj_vid, 
      product_name, 
      original_cj_title,
      seo_title,
      product_description,
      product_material,
      product_features,
      package_size,
      packing_list,
      product_weight,
      product_image, 
      cj_cost_price,
      custom_suggested_price, // Optional: custom retail price from frontend markup slider
      category 
    } = req.body;

    // Detailed validation with specific error messages
    const missingFields = [];
    if (!cj_pid) missingFields.push('cj_pid');
    if (!product_name || product_name.trim() === '') missingFields.push('product_name');
    if (!cj_cost_price) missingFields.push('cj_cost_price');
    
    if (missingFields.length > 0) {
      console.error('[admin] Missing required fields:', missingFields, 'Request body:', req.body);
      return res.status(400).json({ 
        error: `Missing required fields: ${missingFields.join(', ')}`,
        details: { missing: missingFields, received: Object.keys(req.body) }
      });
    }

    // Cost price is in USD from CJ, convert to ZAR
    const costUSD = Number(cj_cost_price);
    if (isNaN(costUSD) || costUSD <= 0) {
      return res.status(400).json({ error: 'Invalid price: must be a positive number' });
    }
    
    const costZAR = Math.round(costUSD * USD_TO_ZAR * 100) / 100;

    // Use custom suggested price if provided, otherwise apply markup to ZAR cost
    const suggested_price = custom_suggested_price 
      ? Math.round(Number(custom_suggested_price) * 100) / 100
      : Math.round(costZAR * PRICE_MARKUP * 100) / 100;

    console.log(`💰 Cost: $${costUSD} USD → R${costZAR} ZAR, ${custom_suggested_price ? 'custom' : 'default'} retail: R${suggested_price} (${(suggested_price / costZAR).toFixed(2)}x markup)`);

    // Fast-path add: do not call CJ in-request to avoid 429 delays
    // Insert immediately; background job will try to link VID and inventory
    const stockQuantity = 0;
    const result = await pool.query(`
      INSERT INTO curated_products 
      (cj_pid, cj_vid, product_name, original_cj_title, seo_title, product_description, product_material, product_features, package_size, packing_list, product_weight, product_image, cj_cost_price, suggested_price, custom_price, category, stock_quantity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [cj_pid, cj_vid || null, product_name, original_cj_title || product_name, seo_title, product_description, product_material, product_features, package_size, packing_list, product_weight, product_image, costUSD, suggested_price, suggested_price, category, stockQuantity]);

    const created = result.rows[0];

    // Fire-and-forget: try to resolve VID and inventory without blocking the response
    ;(async () => {
      try {
        let resolvedVid = created.cj_vid;
        if (!resolvedVid && cj_pid) {
          const details = await cjClient.getProductDetails(cj_pid);
          resolvedVid = details?.variants?.[0]?.vid || null;
          if (resolvedVid) {
            await pool.query(`UPDATE curated_products SET cj_vid = $1, updated_at = NOW() WHERE id = $2`, [resolvedVid, created.id]);
          }
        }

        if (resolvedVid) {
          const inventory = await cjClient.getInventory(resolvedVid);
          // Use total inventory (CJ + factory) for CN warehouses
          const cnWarehouses = inventory.filter(w => w.countryCode === 'CN');
          const totalStock = cnWarehouses.reduce((sum, w) => sum + (Number(w.totalInventory) || 0), 0);
          await pool.query(`UPDATE curated_products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2`, [totalStock, created.id]);

          for (const wh of inventory) {
            await pool.query(`
              INSERT INTO curated_product_inventories 
              (curated_product_id, cj_pid, cj_vid, warehouse_id, warehouse_name, country_code, total_inventory, cj_inventory, factory_inventory, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            `, [
              created.id,
              cj_pid,
              resolvedVid,
              wh.warehouseId,
              wh.warehouseName,
              wh.countryCode,
              wh.totalInventory,
              wh.cjInventory,
              wh.factoryInventory
            ]);
          }
        }
      } catch (e) {
        // Swallow background errors to avoid user-facing failures
        console.warn('[admin] Background CJ link/inventory fetch failed:', e.message);
      }
    })();

    return res.status(201).json({ product: created });
  } catch (error) {
    console.error('Add curated product error:', error);
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'Product already curated' });
    } else {
      res.status(500).json({ error: 'Failed to add product' });
    }
  }
});

// Update curated product (pricing, SEO fields, status)
router.put('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      custom_price, 
      is_active, 
      product_name, 
      original_cj_title,
      seo_title,
      product_description, 
      category, 
      stock_quantity, 
      cj_vid, 
      cj_pid 
    } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (custom_price !== undefined) {
      updates.push(`custom_price = $${paramCount++}`);
      values.push(custom_price);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (product_name !== undefined) {
      updates.push(`product_name = $${paramCount++}`);
      values.push(product_name);
    }

    if (original_cj_title !== undefined) {
      updates.push(`original_cj_title = $${paramCount++}`);
      values.push(original_cj_title);
    }

    if (seo_title !== undefined) {
      updates.push(`seo_title = $${paramCount++}`);
      values.push(seo_title);
    }

    if (product_description !== undefined) {
      updates.push(`product_description = $${paramCount++}`);
      values.push(product_description);
    }

    if (category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(category);
    }

    if (stock_quantity !== undefined) {
      updates.push(`stock_quantity = $${paramCount++}`);
      values.push(stock_quantity);
    }

    // Allow correction of cost and suggested prices if explicitly passed
    if (req.body.cj_cost_price !== undefined) {
      updates.push(`cj_cost_price = $${paramCount++}`);
      values.push(req.body.cj_cost_price);
    }
    if (req.body.suggested_price !== undefined) {
      updates.push(`suggested_price = $${paramCount++}`);
      values.push(req.body.suggested_price);
    }

    if (cj_vid !== undefined) {
      updates.push(`cj_vid = $${paramCount++}`);
      values.push(cj_vid);
    }

    if (cj_pid !== undefined) {
      updates.push(`cj_pid = $${paramCount++}`);
      values.push(cj_pid);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(`
      UPDATE curated_products 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product: result.rows[0] });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Generate SEO-optimized title suggestions using AI
router.post('/products/generate-seo-title', async (req, res) => {
  try {
    const { originalTitle, category, price, pid } = req.body;

    if (!originalTitle) {
      return res.status(400).json({ error: 'originalTitle is required' });
    }

    const result = await generateSEOTitles(
      originalTitle,
      category || '',
      Number(price) || 0,
      pid || ''
    );

    res.json(result);
  } catch (error) {
    console.error('SEO title generation error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate SEO titles',
      suggestions: [req.body?.originalTitle || ''],
      reasoning: 'Error occurred - using original title'
    });
  }
});

// Delete curated product
router.delete('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM curated_products WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Preview potentially inflated prices (admin-only)
// GET /api/admin/products/inspect-inflated?threshold=500&rate=18.9
router.get('/products/inspect-inflated', async (req, res) => {
  try {
    const threshold = Number(req.query.threshold || 500);
    const rate = Number(req.query.rate || process.env.USD_TO_ZAR || 18.9);
    if (!Number.isFinite(threshold) || !Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'Invalid threshold or rate' });
    }
    const result = await pool.query(
      `SELECT id, product_name, cj_pid, cj_cost_price AS current_cost,
              ROUND(cj_cost_price / $1, 2) AS corrected_cost,
              suggested_price AS current_retail,
              ROUND(suggested_price / $1, 2) AS corrected_retail,
              custom_price AS current_custom,
              ROUND(custom_price / $1, 2) AS corrected_custom
       FROM curated_products
       WHERE cj_cost_price > $2
       ORDER BY id`,
      [rate, threshold]
    );
    res.json({ rate, threshold, count: result.rows.length, items: result.rows });
  } catch (error) {
    console.error('Inspect inflated prices error:', error);
    res.status(500).json({ error: 'Failed to inspect inflated prices' });
  }
});

// Fix inflated prices (admin-only)
// POST /api/admin/products/fix-inflated { threshold?: number, rate?: number }
router.post('/products/fix-inflated', async (req, res) => {
  const client = await pool.connect();
  try {
    const threshold = Number(req.body?.threshold || 500);
    const rate = Number(req.body?.rate || process.env.USD_TO_ZAR || 18.9);
    if (!Number.isFinite(threshold) || !Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'Invalid threshold or rate' });
    }

    await client.query('BEGIN');
    const preview = await client.query(
      `SELECT id, product_name, cj_pid, cj_cost_price, suggested_price, custom_price
       FROM curated_products WHERE cj_cost_price > $1 ORDER BY id`,
      [threshold]
    );

    const update = await client.query(
      `UPDATE curated_products
         SET cj_cost_price = ROUND(cj_cost_price / $1, 2),
             suggested_price = ROUND(suggested_price / $1, 2),
             custom_price = ROUND(custom_price / $1, 2),
             updated_at = NOW()
       WHERE cj_cost_price > $2
       RETURNING id, product_name, cj_pid, cj_cost_price, suggested_price, custom_price`,
      [rate, threshold]
    );
    await client.query('COMMIT');

    res.json({ rate, threshold, fixed: update.rows.length, beforeSample: preview.rows.slice(0, 5), afterSample: update.rows.slice(0, 5) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Fix inflated prices error:', error);
    res.status(500).json({ error: 'Failed to fix inflated prices' });
  } finally {
    client.release();
  }
});

// Recalculate suggested prices for all products
// POST /api/admin/products/recalculate-suggested-prices
router.post('/products/recalculate-suggested-prices', async (req, res) => {
  const client = await pool.connect();
  try {
    // Ensure latest pricing config
    await loadPricingConfig();
    await client.query('BEGIN');
    
    // Get current state before update
    const before = await client.query(
      `SELECT id, product_name, cj_cost_price, suggested_price FROM curated_products ORDER BY id LIMIT 5`
    );

    // Recalculate: suggested_price = cj_cost_price (USD) × USD_TO_ZAR × PRICE_MARKUP
    const update = await client.query(
      `UPDATE curated_products
       SET suggested_price = ROUND((cj_cost_price * $1 * $2) * 100) / 100,
           updated_at = NOW()
       WHERE TRUE
       RETURNING id, product_name, cj_cost_price, suggested_price`,
      [USD_TO_ZAR, PRICE_MARKUP]
    );
    
    await client.query('COMMIT');

    console.log(`✓ Recalculated suggested prices for ${update.rows.length} products (USD × ${USD_TO_ZAR} × ${PRICE_MARKUP})`);
    
    res.json({ 
      success: true,
      updated: update.rows.length,
      formula: `USD cost × ${USD_TO_ZAR} × ${PRICE_MARKUP}`,
      beforeSample: before.rows,
      afterSample: update.rows.slice(0, 5)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Recalculate suggested prices error:', error);
    res.status(500).json({ error: 'Failed to recalculate suggested prices' });
  } finally {
    client.release();
  }
});

// Sync all retail prices to corrected suggested prices
// POST /api/admin/products/sync-retail-to-suggested
router.post('/products/sync-retail-to-suggested', async (req, res) => {
  const client = await pool.connect();
  try {
    await loadPricingConfig();
    await client.query('BEGIN');
    
    // Get current state before update
    const before = await client.query(
      `SELECT id, product_name, custom_price, suggested_price FROM curated_products ORDER BY id LIMIT 5`
    );

    // First recalculate suggested_price from ZAR cost
    const recalc = await client.query(
      `UPDATE curated_products
       SET suggested_price = ROUND((cj_cost_price * $1 * $2) * 100) / 100
       WHERE TRUE`,
      [USD_TO_ZAR, PRICE_MARKUP]
    );

    // Then sync custom_price to match the corrected suggested_price
    const update = await client.query(
      `UPDATE curated_products
       SET custom_price = suggested_price,
           updated_at = NOW()
       WHERE TRUE
       RETURNING id, product_name, suggested_price, custom_price`,
      []
    );
    
    await client.query('COMMIT');

    console.log(`✓ Synced ${update.rows.length} products: custom_price → suggested_price (USD × ${USD_TO_ZAR} × ${PRICE_MARKUP})`);
    
    res.json({ 
      success: true,
      updated: update.rows.length,
      message: `All retail prices synced to corrected suggested prices (${USD_TO_ZAR} ZAR × ${PRICE_MARKUP} markup)`,
      beforeSample: before.rows,
      afterSample: update.rows.slice(0, 5)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Sync retail to suggested error:', error);
    res.status(500).json({ error: 'Failed to sync retail prices' });
  } finally {
    client.release();
  }
});

// Search supplier products (for adding to curated list)
// Supports both name search and direct PID lookup
router.get('/cj-products/search', async (req, res) => {
  try {
    const { q, pageNum, pageSize } = req.query;
    
    // Check if query looks like a CJ PID/SKU (starts with uppercase letters)
    // CJ PIDs typically start with letters like "CJYE", "CJ", etc.
    const isPidQuery = q && /^[A-Z]{2,}[0-9]/.test(q.trim());
    
    if (isPidQuery) {
      // Direct PID lookup with error handling
      console.log(`🔍 CJ PID lookup: ${q}`);
      try {
        const result = await cjClient.getProductDetails(q.trim());
        
        // Format as search results array for consistency
        if (result && result.pid) {
          res.json({
            items: [{
              pid: result.pid,
              name: result.name,
              price: result.price,
              image: result.image,
              category: result.categoryName,
              originCountry: 'CN',
              suggestedRetailZAR: Math.round((Number(result.price) * USD_TO_ZAR * PRICE_MARKUP) * 100) / 100,
              variants: result.variants
            }],
            total: 1,
            pageNum: 1,
            pageSize: 1
          });
        } else {
          // Product details returned but no data
          res.json({ items: [], total: 0, pageNum: 1, pageSize: 20 });
        }
      } catch (pidError) {
        // PID lookup failed - try searching by the SKU as a product name
        console.log(`⚠️ CJ PID not found: ${q}, trying name search...`);
        try {
          const searchResult = await cjClient.searchProducts({
            productNameEn: q,
            pageNum: 1,
            pageSize: 10,
          });
          
          // Return search results (might find product by SKU in description/name)
          res.json(searchResult);
        } catch (searchError) {
          // Both methods failed
          console.log(`❌ CJ search also failed for: ${q}`);
          res.json({ items: [], total: 0, pageNum: 1, pageSize: 20 });
        }
      }
    } else {
      // Name-based search - filter to China origin only
      console.log(`🔍 CJ name search: ${q}`);
      const result = await cjClient.searchProducts({
        productNameEn: q,
        pageNum: pageNum ? Number(pageNum) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      });
      
      // Filter to China products only (check shippingCountryCodes array)
      if (result?.items) {
        console.log(`🔍 First item shipping codes:`, result.items[0]?.shippingCountryCodes);
        const cnItems = result.items.filter(item => {
          const codes = item.shippingCountryCodes || [];
          const hasCN = codes.includes('CN') || codes.includes('China');
          if (!hasCN) {
            console.log(`❌ Non-CN item: ${item.pid}, codes:`, codes);
          }
          return hasCN;
        });
        console.log(`🇨🇳 Filtered ${result.items.length} results → ${cnItems.length} China products`);
        
        // If filtering resulted in 0 items but original had items, log warning and return all
        if (cnItems.length === 0 && result.items.length > 0) {
          console.warn(`⚠️ CN filter removed all items - returning unfiltered results`);
          res.json({
            ...result,
            filtered: false,
            filterFailed: true
          });
        } else {
          res.json({
            ...result,
            items: cnItems,
            total: cnItems.length,
            filtered: true,
            originalTotal: result.total
          });
        }
      } else {
        res.json(result || { items: [], total: 0, pageNum: 1, pageSize: 20 });
      }
    }
  } catch (error) {
    console.error('Supplier product search error:', error);
    res.status(502).json({ error: 'Supplier search failed', details: error.message });
  }
});

// Get supplier product details
router.get('/cj-products/:pid', async (req, res) => {
  try {
    const { pid } = req.params;
    const result = await cjClient.getProductDetails(pid);
    res.json(result);
  } catch (error) {
    console.error('Supplier product details error:', error);
    res.status(502).json({ error: 'Supplier product details failed', details: error.message });
  }
});

// Diagnostics: Compare supplier logistics availability for given PIDs
// POST /api/admin/cj/diagnose-products { pids: string[], postalCode?: string }
router.post('/cj/diagnose-products', async (req, res) => {
  try {
    const { pids = [], postalCode = '2196' } = req.body || {};
    if (!Array.isArray(pids) || pids.length === 0) {
      return res.status(400).json({ error: 'Provide an array of CJ product IDs (pids)' });
    }

    const results = [];
    for (const pid of pids) {
      try {
        const details = await cjClient.getProductDetails(pid);
        const variants = details.variants || [];
        const firstVid = variants[0]?.vid;

        let freightOptions = [];
        if (firstVid) {
          try {
            freightOptions = await cjClient.getFreightQuote({
              startCountryCode: 'CN',
              endCountryCode: 'ZA',
              postalCode,
              products: [{ vid: firstVid, quantity: 1 }]
            });
          } catch (fqErr) {
            console.warn(`[diagnostics] Freight quote failed for pid ${pid}:`, fqErr.message);
            freightOptions = [];
          }
        }

        results.push({
          pid,
          name: details.name,
          categoryId: details.categoryId,
          categoryName: details.categoryName,
          weight: details.weight,
          variants: variants.map(v => ({ vid: v.vid, name: v.name, price: v.price, weight: v.weight })),
          firstVid,
          freightOptions: freightOptions.map(f => ({
            logisticName: f.logisticName,
            totalPostage: f.totalPostage,
            deliveryDay: f.deliveryDay,
            currency: f.currency
          })),
          hasFreight: freightOptions.length > 0
        });
      } catch (err) {
        results.push({ pid, error: err.message });
      }
    }

    const summary = {
      total: results.length,
      withFreight: results.filter(r => r.hasFreight).length,
      withoutFreight: results.filter(r => r.hasFreight === false).length,
      logisticsPerPid: Object.fromEntries(results.map(r => [r.pid, (r.freightOptions || []).map(o => o.logisticName)]))
    };

    res.json({ success: true, postalCode, results, summary });
  } catch (error) {
    console.error('[admin] CJ diagnostics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search curated products (by name, SKU/PID, or database ID)
router.get('/products/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ products: [] });
    const searchTerm = `%${q}%`;
    const numericId = isNaN(q) ? null : parseInt(q);
    const result = await pool.query(`
      SELECT 
        cp.*, 
        COALESCE(array_remove(array_agg(DISTINCT cpi.country_code), NULL), '{}') AS warehouse_countries
      FROM curated_products cp
      LEFT JOIN curated_product_inventories cpi ON cpi.curated_product_id = cp.id
      WHERE cp.id = $1 
         OR cp.cj_pid ILIKE $2 
         OR cp.product_name ILIKE $2
      GROUP BY cp.id
      ORDER BY 
        CASE 
          WHEN cp.id = $1 THEN 1
          WHEN cp.cj_pid ILIKE $2 THEN 2
          ELSE 3
        END,
        cp.created_at DESC
      LIMIT 20
    `, [numericId, searchTerm]);
    res.json({ products: result.rows });
  } catch (error) {
    console.error('Curated product search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// ============ ORDER MANAGEMENT ============

// Get all orders with filters
router.get('/orders', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM orders';
    const values = [];
    
    if (status) {
      query += ' WHERE status = $1';
      values.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(Number(limit), Number(offset));

    const result = await pool.query(query, values);

    // Get total count
    const countResult = await pool.query(
      status ? 'SELECT COUNT(*) FROM orders WHERE status = $1' : 'SELECT COUNT(*) FROM orders',
      status ? [status] : []
    );

    res.json({
      orders: result.rows,
      total: Number(countResult.rows[0].count),
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Update order status
router.put('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'completed', 'failed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(`
      UPDATE orders 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ order: result.rows[0] });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// ============ USER MANAGEMENT ============

// Get all users
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, name, phone, is_admin, created_at 
      FROM users 
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Toggle admin status
router.put('/users/:id/admin', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_admin } = req.body;

    const result = await pool.query(`
      UPDATE users 
      SET is_admin = $1
      WHERE id = $2
      RETURNING id, email, name, is_admin
    `, [is_admin, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update user admin status error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ============ BULK PRODUCT ADMIN ============

// Soft-disable all curated products (reversible)
router.post('/products/bulk-deactivate', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE curated_products
      SET is_active = false, updated_at = NOW()
      WHERE is_active = true
      RETURNING id
    `);
    await client.query('COMMIT');
    res.json({ success: true, deactivated: result.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Bulk deactivate products error:', error);
    res.status(500).json({ error: 'Failed to deactivate products' });
  } finally {
    client.release();
  }
});

// Hard-delete ALL curated products and their inventory records (irreversible)
// Requires explicit confirmation: DELETE /api/admin/products?confirm=wipe
router.delete('/products', async (req, res) => {
  const confirm = (req.query.confirm || req.body?.confirm || '').toString().toLowerCase();
  if (confirm !== 'wipe') {
    return res.status(400).json({
      error: "Refused: add query `confirm=wipe` to proceed",
      note: 'This deletes all curated products and related inventory records. Use bulk-deactivate for a reversible option.'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete inventory rows first to avoid FK issues in some schemas
    const invDel = await client.query(`
      DELETE FROM curated_product_inventories
    `);

    const prodDel = await client.query(`
      DELETE FROM curated_products
      RETURNING id
    `);


    await client.query('COMMIT');
    res.json({ success: true, deletedInventories: invDel.rowCount, deletedProducts: prodDel.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Bulk delete curated products error:', error);
    res.status(500).json({ error: 'Failed to delete curated products' });
  } finally {
    client.release();
  }
});

// ============ CJ ORDER AUTOMATION ============

// Validate South African ID (13 digits + checksum)
const isValidSouthAfricanId = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 13) return false;
  const nums = digits.split('').map(Number);
  const sumOdd = nums.slice(0, 12).filter((_, idx) => idx % 2 === 0).reduce((a, b) => a + b, 0);
  const evenStr = nums.slice(0, 12).filter((_, idx) => idx % 2 === 1).join('');
  const doubled = String(Number(evenStr || '0') * 2);
  const sumEven = doubled.split('').reduce((a, b) => a + Number(b), 0);
  const total = sumOdd + sumEven;
  const checkDigit = (10 - (total % 10)) % 10;
  return checkDigit === nums[12];
};

// Debug endpoint: Get full order details (including shipping_id_number)
router.get('/orders/:orderId/debug', async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Validate SA ID before sending to CJ
    const idDigits = (order.shipping_id_number || '').replace(/\D/g, '');
    if (!isValidSouthAfricanId(idDigits)) {
      return res.status(400).json({
        error: 'Invalid South African ID number (checksum failed). Please update the order with a valid ID before submitting to CJ.'
      });
    }
    
    // Return full order with all fields for debugging
    res.json({
      success: true,
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      shipping_phone: order.shipping_phone,
      shipping_id_number: order.shipping_id_number,
      shipping_address: order.shipping_address,
      shipping_city: order.shipping_city,
      shipping_province: order.shipping_province,
      shipping_postal_code: order.shipping_postal_code,
      shipping_country: order.shipping_country,
      items: order.items,
      total: order.total
    });
  } catch (error) {
    console.error('[admin] Order debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent CJ submissions for debugging
router.get('/cj/recent-submissions', async (req, res) => {
  try {
    res.json({
      submissions: recentCJSubmissions,
      count: recentCJSubmissions.length,
      note: 'Recent CJ order submissions with full request/response data'
    });
  } catch (error) {
    console.error('[admin] Error retrieving CJ submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit paid order to CJ Dropshipping
router.post('/orders/:orderId/submit-to-cj', async (req, res) => {
  try {
    const { orderId } = req.params;

    // 1. Fetch order from database
    const order = await getOrderById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 2. Validate order status
    if (order.status !== 'paid') {
      return res.status(400).json({ error: `Order status is ${order.status}, must be paid to submit to CJ` });
    }

    // 3. Check if already submitted
    if (order.cj_order_id) {
      return res.status(400).json({ 
        error: 'Order already submitted to CJ',
        cjOrderId: order.cj_order_id,
        cjOrderNumber: order.cj_order_number
      });
    }

    // 4. Build CJ order payload
    const cjOrderData = buildCJOrderData(order);

    // 5. Validate we have CJ products
    if (!cjOrderData.products || cjOrderData.products.length === 0) {
      return res.status(400).json({ 
        error: 'No CJ products found in order. Cart items must have cj_vid.' 
      });
    }

    // 5.1 Validate/adjust logistic line based on CJ freight availability to ZA
    try {
      const postalCode = order.shipping_postal_code || '2196';
      const perProductOptions = [];
      for (const p of cjOrderData.products) {
        try {
          const opts = await cjClient.getFreightQuote({
            startCountryCode: 'CN',
            endCountryCode: 'ZA',
            postalCode,
            products: [{ vid: p.vid, quantity: p.quantity || 1 }]
          });
          perProductOptions.push(new Set((opts || []).map(o => o.logisticName)));
        } catch (fqErr) {
          perProductOptions.push(new Set());
          console.warn(`[admin] Freight options lookup failed for vid ${p.vid}:`, fqErr.message);
        }
      }
      // Compute intersection of logistic names across all products
      let intersection = null;
      for (const s of perProductOptions) {
        if (intersection === null) {
          intersection = new Set(s);
        } else {
          intersection = new Set([...intersection].filter(x => s.has(x)));
        }
      }
      const commonOptions = intersection ? [...intersection] : [];
      if (commonOptions.length === 0) {
        console.warn('[admin] No common logistic line across products to ZA. CJ may reject order.');
      } else if (!commonOptions.includes(cjOrderData.logisticName)) {
        const fallback = commonOptions[0];
        console.log(`[admin] Adjusting logisticName from ${cjOrderData.logisticName} to ${fallback} based on CJ availability`);
        cjOrderData.logisticName = fallback;
      }
    } catch (adjustErr) {
      console.warn('[admin] Logistic line adjustment skipped due to error:', adjustErr.message);
    }

    // 6. Submit order to CJ API
    console.log(`[admin] Submitting order ${order.order_number} to CJ with data:`, JSON.stringify(cjOrderData, null, 2));
    
    let cjResponse;
    let cjOrderId;
    let cjOrderNumber;
    
    try {
      cjResponse = await cjClient.createOrder(cjOrderData);
      cjOrderId = cjResponse?.orderId;
      cjOrderNumber = cjResponse?.orderNumber || cjResponse?.orderNum;
      
      // Store successful submission
      storeCJSubmission(order.order_number, cjOrderData, cjResponse);
    } catch (cjError) {
      // Store failed submission
      storeCJSubmission(order.order_number, cjOrderData, cjError.response || null, cjError.message);
      
      // IMPORTANT: CJ API may create the order even if returns an error
      // (e.g., "Balance is insufficient" after order is created)
      // Try to recover by checking if order was created by searching CJ by order number
      console.warn(`[admin] CJ order creation threw error: ${cjError.message}`);
      console.log(`[admin] Attempting recovery: checking if order was created on CJ despite error...`);
      
      try {
        // Try to find the order in CJ by its order number
        // We'll use a search/list approach - for now, we don't have a direct lookup, so re-throw
        throw cjError;
      } catch (recoveryError) {
        throw cjError; // Re-throw the original CJ error if recovery fails
      }
    }

    if (!cjOrderId) {
      console.error('[admin] CJ order creation returned no orderId:', cjResponse);
      return res.status(502).json({ 
        error: 'CJ order creation failed',
        details: 'Missing orderId from CJ',
        cjResponse
      });
    }

    // 7. Update local order with CJ info
    await updateOrderCJInfo(orderId, cjOrderId, cjOrderNumber, 'SUBMITTED');

    console.log(`[admin] ✓ Order ${order.order_number} submitted to CJ. CJ Order ID: ${cjOrderId}, CJ Order #: ${cjOrderNumber}`);

    res.json({
      success: true,
      message: 'Order submitted to CJ successfully',
      cjOrderId,
      cjOrderNumber,
      orderNumber: order.order_number
    });

  } catch (error) {
    console.error('[admin] Submit to CJ error:', error);
    
    // IMPORTANT: CJ API may create order even if returns an error (e.g., "Balance is insufficient")
    // Try to detect if order was created despite the error by checking if our order now has CJ info
    try {
      const updatedOrder = await getOrderById(orderId);
      if (updatedOrder?.cj_order_id) {
        // Order was actually created! Return success
        console.log(`[admin] ✓ Despite error, order ${updatedOrder.order_number} was created on CJ. CJ Order ID: ${updatedOrder.cj_order_id}`);
        return res.json({
          success: true,
          message: 'Order submitted to CJ successfully',
          cjOrderId: updatedOrder.cj_order_id,
          cjOrderNumber: updatedOrder.cj_order_number,
          orderNumber: updatedOrder.order_number,
          note: 'Order was created despite initial error response'
        });
      }
    } catch (checkError) {
      console.error('[admin] Error checking if order was created:', checkError);
    }
    
    res.status(500).json({ 
      error: 'Failed to submit order to CJ',
      details: error.message 
    });
  }
});

// Get all orders for admin dashboard
router.get('/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        order_number,
        user_id,
        items,
        total_amount,
        status,
        cj_order_id,
        cj_order_number,
        cj_tracking_number,
        cj_tracking_url,
        cj_status,
        cj_submitted_at,
        created_at,
        updated_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 100
    `);

    // Parse items JSON for each order
    const orders = result.rows.map(order => ({
      ...order,
      items: JSON.parse(order.items)
    }));

    res.json({ orders });
  } catch (error) {
    console.error('[admin] Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Auto-fix missing cj_vid by fetching from CJ API
// POST /api/admin/products/fix-missing-vids
router.post('/products/fix-missing-vids', async (req, res) => {
  try {
    // Find all products with cj_pid but no cj_vid
    const result = await pool.query(`
      SELECT id, cj_pid, product_name 
      FROM curated_products 
      WHERE cj_pid IS NOT NULL AND (cj_vid IS NULL OR cj_vid = '')
      AND is_active = TRUE
      LIMIT 50
    `);

    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        message: 'All active products already have cj_vid',
        fixed: 0,
        failed: 0
      });
    }

    console.log(`[admin] Found ${result.rows.length} products missing cj_vid, fetching from CJ...`);

    const fixed = [];
    const failed = [];
    let rateLimitHit = false;

    for (const product of result.rows) {
      try {
        // Fetch product details from CJ
        const cjProduct = await cjClient.getProductDetails(product.cj_pid);
        
        if (!cjProduct || !cjProduct.variants || cjProduct.variants.length === 0) {
          failed.push({ 
            id: product.id, 
            name: product.product_name, 
            reason: 'No variants found in CJ' 
          });
          continue
        }

        // Use first variant (default)
        const defaultVariant = cjProduct.variants[0];
        
        if (!defaultVariant.vid) {
          failed.push({ 
            id: product.id, 
            name: product.product_name, 
            reason: 'Variant missing VID' 
          });
          continue;
        }

        // Update product with cj_vid and fetch inventory to update stock
        await pool.query(`
          UPDATE curated_products 
          SET cj_vid = $1, updated_at = NOW() 
          WHERE id = $2
        `, [defaultVariant.vid, product.id]);

        // Try to fetch inventory and update stock (CN warehouses only)
        try {
          const inventory = await cjClient.getInventory(defaultVariant.vid);
          const cnWarehouses = inventory.filter(w => w.countryCode === 'CN');
          const totalStock = cnWarehouses.reduce((sum, w) => sum + (Number(w.totalInventory) || 0), 0);
          
          await pool.query(`
            UPDATE curated_products 
            SET stock_quantity = $1, updated_at = NOW() 
            WHERE id = $2
          `, [totalStock, product.id]);

          // Update inventory table
          await pool.query(`DELETE FROM curated_product_inventories WHERE curated_product_id = $1`, [product.id]);
          for (const wh of inventory) {
            await pool.query(`
              INSERT INTO curated_product_inventories 
              (curated_product_id, cj_pid, cj_vid, warehouse_id, warehouse_name, country_code, total_inventory, cj_inventory, factory_inventory, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            `, [
              product.id,
              product.cj_pid,
              defaultVariant.vid,
              wh.warehouseId,
              wh.warehouseName,
              wh.countryCode,
              wh.totalInventory,
              wh.cjInventory,
              wh.factoryInventory
            ]);
          }

          fixed.push({ 
            id: product.id, 
            name: product.product_name, 
            cj_vid: defaultVariant.vid,
            stock: totalStock
          });

          console.log(`[admin] ✓ Fixed product ${product.id}: ${product.product_name} -> cj_vid: ${defaultVariant.vid}, stock: ${totalStock}`);
        } catch (invError) {
          // If inventory fetch fails, still mark VID as fixed
          fixed.push({ 
            id: product.id, 
            name: product.product_name, 
            cj_vid: defaultVariant.vid,
            stock: 'inventory_fetch_failed',
            inventoryError: invError.message
          });
          console.warn(`[admin] ⚠️ Fixed VID for product ${product.id} but inventory fetch failed:`, invError.message);
        }

      } catch (error) {
        // Check if it's a rate limit error
        if (error.message && (error.message.includes('429') || error.message.includes('rate limit'))) {
          rateLimitHit = true;
        }
        failed.push({ 
          id: product.id, 
          name: product.product_name, 
          reason: error.message 
        });
        console.error(`[admin] Failed to fix product ${product.id}:`, error.message);
      }
    }

    res.json({
      success: true,
      message: `Fixed ${fixed.length} products, ${failed.length} failed${rateLimitHit ? ' (rate limit hit)' : ''}`,
      fixed,
      failed,
      rateLimitHit,
      note: rateLimitHit ? 'CJ API rate limit reached. Wait until 6pm (CJ midnight) for quota reset, then re-run.' : null
    });

  } catch (error) {
    console.error('[admin] Fix missing VIDs error:', error);
    // Ensure we always send valid JSON
    res.status(500).json({ 
      success: false,
      error: 'Failed to fix missing VIDs',
      details: error.message 
    });
  }
});

// Create test order for development/testing
router.post('/orders/create-test', requireAdmin, async (req, res) => {
  try {
    // Get a real product with valid cj_vid from curated_products
    const productResult = await pool.query(`
      SELECT id, cj_pid, cj_vid, product_name, custom_price 
      FROM curated_products 
      WHERE cj_vid IS NOT NULL AND cj_vid != '' AND is_active = TRUE
      ORDER BY id DESC
      LIMIT 1
    `);

    if (productResult.rows.length === 0) {
      return res.status(400).json({ 
        error: 'No products with valid cj_vid found. Please add a product with a valid CJ variant ID first.' 
      });
    }

    const product = productResult.rows[0];
    const orderNumber = 'TEST-' + Date.now();
    const items = JSON.stringify([{
      id: product.id.toString(),
      cj_pid: product.cj_pid,
      cj_vid: product.cj_vid,
      name: product.product_name,
      price: product.custom_price || 100,
      quantity: 1
    }]);

    const subtotal = product.custom_price || 100;
    const shipping = 50.00;
    const total = subtotal + shipping;

    await pool.query(
      `INSERT INTO orders 
       (user_id, order_number, items, subtotal, shipping, discount, total, status, 
        customer_email, customer_name, shipping_country, shipping_province, shipping_city, 
        shipping_address, shipping_postal_code, shipping_phone, shipping_id_number, shipping_method, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())`,
      [
        1, orderNumber, items, subtotal, shipping, 0, total, 'paid', 
        'test@example.com', 'Test Customer', 'ZA', 'Gauteng', 'Johannesburg',
        '123 Test Street', '2196', '0821234567', '0000000000000', 'USPS+'
      ]
    );

    res.json({
      success: true,
      message: 'Test order created with real product',
      orderNumber,
      product: {
        name: product.product_name,
        cj_pid: product.cj_pid,
        cj_vid: product.cj_vid
      },
      status: 'paid',
      total
    });
  } catch (err) {
    console.error('[admin] Create test order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sync all product prices with current CJ prices
// POST /api/admin/products/sync-cj-prices
router.post('/products/sync-cj-prices', async (req, res) => {
  try {
    const { limit = 50 } = req.body;

    // Get active products with CJ PIDs
    const result = await pool.query(`
      SELECT id, cj_pid, product_name, cj_cost_price, custom_price 
      FROM curated_products 
      WHERE cj_pid IS NOT NULL AND is_active = TRUE
      ORDER BY updated_at ASC
      LIMIT $1
    `, [limit]);

    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No products to sync',
        synced: 0,
        priceChanges: []
      });
    }

    console.log(`[admin] Syncing prices for ${result.rows.length} products from CJ...`);

    const priceChanges = [];
    const errors = [];
    let syncedCount = 0;

    for (const product of result.rows) {
      try {
        // Fetch current CJ price
        const cjProduct = await cjClient.getProductDetails(product.cj_pid);
        const currentCJPrice = parseFloat(cjProduct.price || 0);

        if (currentCJPrice <= 0) {
          errors.push({ id: product.id, name: product.product_name, reason: 'Invalid CJ price' });
          continue;
        }

        const storedCJPrice = parseFloat(product.cj_cost_price || 0);
        const priceDiff = Math.abs(currentCJPrice - storedCJPrice);
        const percentChange = storedCJPrice > 0 ? (priceDiff / storedCJPrice) * 100 : 0;

        // Always update if price is different (even by 0.01%)
        if (currentCJPrice !== storedCJPrice) {
          await loadPricingConfig(); // Ensure latest markup config
          const costZAR = Math.round(currentCJPrice * USD_TO_ZAR * 100) / 100;
          const newRetailPrice = Math.round(costZAR * PRICE_MARKUP * 100) / 100;

          await pool.query(`
            UPDATE curated_products 
            SET cj_cost_price = $1, 
                suggested_price = $2,
                custom_price = $3,
                updated_at = NOW()
            WHERE id = $4
          `, [currentCJPrice, newRetailPrice, newRetailPrice, product.id]);

          if (percentChange > 0.5) { // Only log significant changes (>0.5%)
            priceChanges.push({
              id: product.id,
              name: product.product_name,
              oldCostUSD: storedCJPrice,
              newCostUSD: currentCJPrice,
              oldPriceZAR: product.custom_price,
              newPriceZAR: newRetailPrice,
              percentChange: Math.round(percentChange * 10) / 10,
              increased: currentCJPrice > storedCJPrice
            });
          }

          syncedCount++;
        }
      } catch (err) {
        errors.push({ id: product.id, name: product.product_name, reason: err.message });
        console.error(`[admin] Price sync failed for ${product.cj_pid}:`, err.message);
      }
    }

    res.json({
      success: true,
      message: `Synced ${syncedCount} products, ${priceChanges.length} prices changed significantly`,
      synced: syncedCount,
      priceChanges,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[admin] Sync CJ prices error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync CJ prices',
      details: error.message 
    });
  }
});

