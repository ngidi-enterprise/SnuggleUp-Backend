import express from 'express';
import { requireAdmin } from '../middleware/admin.js';
import pool from '../db.js';
import { cjClient } from '../services/cjClient.js';
import { generateSEOTitles } from '../services/seoTitleGenerator.js';

export const router = express.Router();

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
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders
      FROM orders
    `);

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
      summary: ordersResult.rows[0],
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
      SELECT * FROM curated_products 
      ORDER BY created_at DESC
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
      product_image, 
      cj_cost_price, 
      category 
    } = req.body;

    if (!cj_pid || !product_name || !cj_cost_price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate price is a valid number
    const costPrice = Number(cj_cost_price);
    if (isNaN(costPrice) || costPrice <= 0) {
      return res.status(400).json({ error: 'Invalid price: must be a positive number' });
    }

    // Calculate suggested price (2x markup)
    const suggested_price = costPrice * 2;

    // Fetch initial stock from CJ if we have a variant ID
    let stockQuantity = 0;
    let resolvedVid = cj_vid;

    if (!resolvedVid && cj_pid) {
      // Try to fetch product details and pick first variant
      try {
        const details = await cjClient.getProductDetails(cj_pid);
        resolvedVid = details?.variants?.[0]?.vid || null;
      } catch (e) {
        console.warn('Failed to fetch CJ details for pid', cj_pid, e.message);
      }
    }

    if (resolvedVid) {
      try {
        const inventory = await cjClient.getInventory(resolvedVid);
        stockQuantity = inventory.reduce((sum, w) => sum + (Number(w.totalInventory) || 0), 0);
        console.log(`📦 Fetched initial stock for ${cj_pid}: ${stockQuantity}`);
        
        // Insert product first to get the ID
        const result = await pool.query(`
          INSERT INTO curated_products 
          (cj_pid, cj_vid, product_name, original_cj_title, seo_title, product_description, product_image, cj_cost_price, suggested_price, custom_price, category, stock_quantity)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `, [cj_pid, resolvedVid, product_name, original_cj_title || product_name, seo_title, product_description, product_image, costPrice, suggested_price, suggested_price, category, stockQuantity]);

        const curatedProductId = result.rows[0].id;

        // Insert warehouse details
        for (const wh of inventory) {
          await pool.query(`
            INSERT INTO curated_product_inventories 
            (curated_product_id, cj_pid, cj_vid, warehouse_id, warehouse_name, country_code, total_inventory, cj_inventory, factory_inventory, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          `, [
            curatedProductId,
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

        return res.status(201).json({ product: result.rows[0] });
      } catch (e) {
        console.warn('Failed to fetch initial inventory for vid', resolvedVid, e.message);
      }
    }

    // Fallback: insert without inventory if we couldn't fetch it
    const result = await pool.query(`
      INSERT INTO curated_products 
      (cj_pid, cj_vid, product_name, original_cj_title, seo_title, product_description, product_image, cj_cost_price, suggested_price, custom_price, category, stock_quantity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [cj_pid, resolvedVid, product_name, original_cj_title || product_name, seo_title, product_description, product_image, costPrice, suggested_price, suggested_price, category, stockQuantity]);

    res.status(201).json({ product: result.rows[0] });
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
      suggestions: [originalTitle], // Fallback to original
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
      // Name-based search
      console.log(`🔍 CJ name search: ${q}`);
      const result = await cjClient.searchProducts({
        productNameEn: q,
        pageNum: pageNum ? Number(pageNum) : 1,
        pageSize: pageSize ? Number(pageSize) : 20,
      });
      res.json(result);
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

// Search curated products (by name, SKU/PID, or database ID)
router.get('/products/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.json({ products: [] });
    }
    
    const searchTerm = `%${q}%`;
    const numericId = isNaN(q) ? null : parseInt(q);
    
    // Search by: database ID, CJ PID, or product name
    const result = await pool.query(`
      SELECT * FROM curated_products 
      WHERE id = $1 
         OR cj_pid ILIKE $2 
         OR product_name ILIKE $2
      ORDER BY 
        CASE 
          WHEN id = $1 THEN 1
          WHEN cj_pid ILIKE $2 THEN 2
          ELSE 3
        END,
        created_at DESC
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
