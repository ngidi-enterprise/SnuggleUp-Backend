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

    // Group by product id to merge multiple warehouses and calculate CJ stock
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
    
    // Get CJ stock totals from inventory table and mark as sold out if < 20
    const productIds = Object.keys(productsMap);
    if (productIds.length > 0) {
      const inventoryResult = await pool.query(`
        SELECT curated_product_id, SUM(cj_inventory) as total_cj_stock
        FROM curated_product_inventories
        WHERE curated_product_id = ANY($1::int[])
        GROUP BY curated_product_id
      `, [productIds]);
      
      const stockMap = {};
      for (const inv of inventoryResult.rows) {
        stockMap[inv.curated_product_id] = Number(inv.total_cj_stock) || 0;
      }
      
      // Apply stock rules: CJ stock ≤20 means sold out (ignore factory stock)
      for (const [id, product] of Object.entries(productsMap)) {
        const cjStock = stockMap[id] || 0;
        // If CJ warehouse has ≤20 stock, mark as sold out (low stock threshold)
        if (cjStock <= 20) {
          product.stock_quantity = 0; // Mark as sold out
        }
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

// DEBUG endpoint - Check VID status (temporary, no auth required)
router.get('/debug/check-vids', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        product_name,
        cj_pid,
        cj_vid,
        is_active,
        CASE 
          WHEN cj_vid IS NULL OR cj_vid = '' THEN false
          ELSE true
        END as has_vid
      FROM curated_products 
      WHERE is_active = TRUE
      ORDER BY id
      LIMIT 20
    `);

    const withVid = result.rows.filter(p => p.has_vid).length;
    const missingVid = result.rows.filter(p => !p.has_vid).length;

    res.json({
      total: result.rows.length,
      with_vid: withVid,
      missing_vid: missingVid,
      products: result.rows.map(p => ({
        id: p.id,
        name: p.product_name?.substring(0, 50),
        cj_pid: p.cj_pid,
        cj_vid: p.cj_vid,  // Show full VID
        has_vid: p.has_vid
      }))
    });
  } catch (error) {
    console.error('Check VIDs error:', error);
    res.status(500).json({ error: 'Failed to check VIDs' });
  }
});

// DEBUG endpoint - Test shipping quote for ONE product
router.get('/debug/test-shipping/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { cjClient } = await import('../services/cjClient.js');
    
    // Get product
    const result = await pool.query(`
      SELECT id, product_name, cj_pid, cj_vid
      FROM curated_products 
      WHERE id = $1 AND is_active = TRUE
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = result.rows[0];

    if (!product.cj_vid) {
      return res.status(400).json({ error: 'Product missing cj_vid' });
    }

    // Test CJ freight quote
    console.log(`🧪 Testing shipping for product ${id}: ${product.product_name}`);
    console.log(`📦 Using VID: ${product.cj_vid}`);

    // Detect origin country from warehouse inventory
    let originCountry = 'CN';
    const warehouseCheck = await pool.query(`
      SELECT country_code, cj_inventory 
      FROM curated_product_inventories 
      WHERE cj_vid = $1 AND cj_inventory > 0
      ORDER BY cj_inventory DESC 
      LIMIT 1
    `, [product.cj_vid]);
    
    if (warehouseCheck.rows.length > 0) {
      originCountry = warehouseCheck.rows[0].country_code;
      console.log(`🌍 Detected origin: ${originCountry}`);
    }

    const quotes = await cjClient.getFreightQuote({
      startCountryCode: originCountry,
      endCountryCode: 'ZA',
      products: [{ vid: product.cj_vid, quantity: 1 }]
    });

    res.json({
      product: {
        id: product.id,
        name: product.product_name,
        cj_pid: product.cj_pid,
        cj_vid: product.cj_vid
      },
      cj_response: quotes,
      quote_count: quotes?.length || 0,
      has_quotes: quotes && quotes.length > 0
    });
  } catch (error) {
    console.error('Test shipping error:', error);
    res.status(500).json({ 
      error: 'Failed to test shipping',
      details: error.message
    });
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
    
    // Fetch all variants: prefer shared group_code, else cj_pid
    let variants = [];
    if (product.group_code) {
      const variantsResult = await pool.query(`
        SELECT * FROM curated_products 
        WHERE group_code = $1 AND is_active = TRUE
        ORDER BY id
      `, [product.group_code]);
      variants = variantsResult.rows;
    } else if (product.cj_pid) {
      const variantsResult = await pool.query(`
        SELECT * FROM curated_products 
        WHERE cj_pid = $1 AND is_active = TRUE
        ORDER BY id
      `, [product.cj_pid]);
      variants = variantsResult.rows;
    }
    
    console.log(`📦 Product ${id} fetched:`, {
      id: product.id,
      name: product.product_name?.substring(0, 30),
      cj_pid: product.cj_pid,
      cj_vid: product.cj_vid,
      has_cj_vid: !!product.cj_vid,
      variantCount: variants.length,
      group_code: product.group_code || null
    });

    res.json({ product, variants });
  } catch (error) {
    console.error('Get product detail error:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

export default router;
