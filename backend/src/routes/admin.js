import express from 'express';
import { requireAdmin } from '../middleware/admin.js';
import pool from '../db.js';
import { cjClient } from '../services/cjClient.js';
import { getRuntimeConfig, setShippingFallbackEnabled, isShippingFallbackEnabled } from '../services/configService.js';
import { generateSEOTitles } from '../services/seoTitleGenerator.js';
import { getOrderById, buildCJOrderData, updateOrderCJInfo } from './orders.js';
import { getSchedulerHealth, generateSchedulerReport, getExecutionHistory } from '../services/schedulerMonitor.js';

export const router = express.Router();

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

    res.js
