import express from 'express';
import pool from '../db.js';

export const router = express.Router();

// PUBLIC endpoint - Get all active curated products for storefront
router.get('/', async (req, res) => {
  try {
    const { category, minPrice, maxPrice, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;

    // Join curated_products with curated_product_inventories to get warehouse/country info
    let query = `
      SELECT cp.*, cpi.warehouse_name, cpi.country_code
      FROM curated_products cp
      LEFT JOIN curated_product_inventories cpi ON cp.id = cpi.curated_product_id
      WHERE cp.is_active = TRUE
    `;
    const params = [];
    let paramCount = 1;

    // Filter by category
    if (category && category !== 'all') {
      query += ` AND cp.category = $${paramCount++}`;
      params.push(category);
    }

    // Filter by price range (uses custom_price as the display price)
    if (minPrice) {
      query += ` AND cp.custom_price >= $${paramCount++}`;
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      query += ` AND cp.custom_price <= $${paramCount++}`;
      params.push(parseFloat(maxPrice));
    }

    // Sort options
    const allowedSortFields = ['created_at', 'custom_price', 'product_name'];
    const allowedOrders = ['ASC', 'DESC'];
    const finalSort = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const finalOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
    query += ` ORDER BY cp.${finalSort} ${finalOrder}`;

    const result = await pool.query(query, params);

    // Group by product id to merge multiple warehouses (if any)
    const productsMap = {};
    for (const row of result.rows) {
      if (!productsMap[row.id]) {
        productsMap[row.id] = { ...row, warehouses: [] };
      }
      if (row.warehouse_name && row.country_code) {
        productsMap[row.id].warehouses.push({
          warehouse_name: row.warehouse_name,
          country_code: row.country_code
        });
      }
    }
    const products = Object.values(productsMap);

    res.json({
      products,
      total: products.length,
      source: 'curated'
    });
  } catch (error) {
    console.error('Get public products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// PUBLIC endpoint - Get single product details
// Only supports lookup by database ID (not CJ PID for security/privacy)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = isNaN(id) ? null : parseInt(id);
    
    // If not a valid numeric ID, return 404 (friendly "not found" instead of 400 error)
    if (!numericId) {
      console.log(`⚠️ Non-numeric product lookup attempted: ${id} (possibly CJ PID)`);
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Only lookup by database ID for customer-facing routes
    const result = await pool.query(`
      SELECT * FROM curated_products 
      WHERE id = $1 AND is_active = TRUE
    `, [numericId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = result.rows[0];
    console.log(`📦 Product ${id} fetched:`, {
      id: product.id,
      name: product.product_name?.substring(0, 30),
      cj_pid: product.cj_pid,
      cj_vid: product.cj_vid,
      has_cj_vid: !!product.cj_vid
    });

    res.json({ product: product });
  } catch (error) {
    console.error('Get product detail error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

export default router;
