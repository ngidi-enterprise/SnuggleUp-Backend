import express from 'express';
import { requireAdmin } from '../middleware/admin.js';
import pool from '../db.js';
import { cjClient } from '../services/cjClient.js';

export const router = express.Router();

// All admin routes require admin authentication
router.use(requireAdmin);

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
    const { cj_pid, cj_vid, product_name, product_description, product_image, cj_cost_price, category } = req.body;

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

    const result = await pool.query(`
      INSERT INTO curated_products 
      (cj_pid, cj_vid, product_name, product_description, product_image, cj_cost_price, suggested_price, custom_price, category)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [cj_pid, cj_vid, product_name, product_description, product_image, costPrice, suggested_price, suggested_price, category]);

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
    const { custom_price, is_active, product_name, product_description, category, stock_quantity } = req.body;

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
router.get('/cj-products/search', async (req, res) => {
  try {
    const { q, pageNum, pageSize } = req.query;
    const result = await cjClient.searchProducts({
      productNameEn: q,
      pageNum: pageNum ? Number(pageNum) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
    res.json(result);
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
