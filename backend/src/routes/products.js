import express from 'express';
import pool from '../db.js';

export const router = express.Router();

// PUBLIC endpoint - Get all active curated products for storefront
router.get('/', async (req, res) => {
  try {
    const { category, minPrice, maxPrice, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;

    let query = 'SELECT * FROM curated_products WHERE is_active = TRUE';
    const params = [];
    let paramCount = 1;

    // Filter by category
    if (category && category !== 'all') {
      query += ` AND category = $${paramCount++}`;
      params.push(category);
    }

    // Filter by price range (uses custom_price as the display price)
    if (minPrice) {
      query += ` AND custom_price >= $${paramCount++}`;
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      query += ` AND custom_price <= $${paramCount++}`;
      params.push(parseFloat(maxPrice));
    }

    // Sort options
    const allowedSortFields = ['created_at', 'custom_price', 'product_name'];
    const allowedOrders = ['ASC', 'DESC'];
    const finalSort = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const finalOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
    
    query += ` ORDER BY ${finalSort} ${finalOrder}`;

    const result = await pool.query(query, params);

    res.json({
      products: result.rows,
      total: result.rows.length,
      source: 'curated'
    });
  } catch (error) {
    console.error('Get public products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// PUBLIC endpoint - Get single product details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Support lookup by database ID or CJ PID
    const result = await pool.query(`
      SELECT * FROM curated_products 
      WHERE (id = $1 OR cj_pid = $2) AND is_active = TRUE
    `, [isNaN(id) ? null : parseInt(id), id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product: result.rows[0] });
  } catch (error) {
    console.error('Get product detail error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

export default router;
