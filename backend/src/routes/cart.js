import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import pool from '../db.js';

export const router = express.Router();

// All cart routes require authentication
router.use(authenticateToken);

// GET /api/cart - Get user's cart
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user.sub;
    
    if (!userId) {
      console.error('❌ No userId found in req.user:', req.user);
      return res.status(400).json({ error: 'User ID not found' });
    }
    
    const result = await pool.query(
      'SELECT items, updated_at FROM carts WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ items: [] });
    }

    res.json({
      items: result.rows[0].items,
      updatedAt: result.rows[0].updated_at,
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Failed to retrieve cart' });
  }
});

// POST /api/cart - Save/update user's cart
router.post('/', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user.sub;
    const { items } = req.body;
    
    if (!userId) {
      console.error('❌ No userId found in req.user:', req.user);
      return res.status(400).json({ error: 'User ID not found' });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    // Validate stock availability for all items - require CJ stock >= 20
    if (items.length > 0) {
      const productIds = items.map(item => {
        const id = String(item.id || '').replace('curated-', '');
        return parseInt(id);
      }).filter(id => !isNaN(id));
      
      if (productIds.length > 0) {
        // Get CJ stock for all products in cart
        const stockResult = await pool.query(`
          SELECT 
            cp.id,
            cp.product_name,
            COALESCE(SUM(cpi.cj_inventory), 0) as total_cj_stock
          FROM curated_products cp
          LEFT JOIN curated_product_inventories cpi ON cp.id = cpi.curated_product_id
          WHERE cp.id = ANY($1::int[])
          GROUP BY cp.id, cp.product_name
        `, [productIds]);
        
        const soldOutItems = [];
        const stockMap = {};
        for (const row of stockResult.rows) {
          const cjStock = Number(row.total_cj_stock) || 0;
          stockMap[row.id] = cjStock;
          // Products with CJ stock = 0 are sold out (factory stock doesn't count)
          if (cjStock === 0) {
            soldOutItems.push(row.product_name);
          }
        }
        
        if (soldOutItems.length > 0) {
          return res.status(400).json({
            error: 'Some items in your cart are sold out',
            soldOutItems,
            message: `The following items are currently sold out (not available at supplier warehouse) and cannot be purchased: ${soldOutItems.join(', ')}`
          });
        }
      }
    }

    // Upsert cart (insert or update if exists)
    const result = await pool.query(
      `INSERT INTO carts (user_id, items, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET items = $2, updated_at = NOW()
       RETURNING items, updated_at`,
      [userId, JSON.stringify(items)]
    );

    res.json({
      items: result.rows[0].items,
      updatedAt: result.rows[0].updated_at,
    });
  } catch (error) {
    console.error('Save cart error:', error);
    res.status(500).json({ error: 'Failed to save cart' });
  }
});

// DELETE /api/cart - Clear user's cart
router.delete('/', async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user.sub;
    
    if (!userId) {
      console.error('❌ No userId found in req.user:', req.user);
      return res.status(400).json({ error: 'User ID not found' });
    }
    
    await pool.query('DELETE FROM carts WHERE user_id = $1', [userId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

export default router;
