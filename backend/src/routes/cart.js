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

    // Validate stock availability. Local warehouse products and import products
    // use separate stock tables, so they must not be checked against each other.
    if (items.length > 0) {
      const localItems = items.filter(item => item?.isLocal);
      const importItems = items.filter(item => !item?.isLocal);

      const productIds = importItems.map(item => {
        const id = String(item.id || '').replace('curated-', '');
        return parseInt(id);
      }).filter(id => !isNaN(id));
      
      if (productIds.length > 0) {
        // Get total stock (CJ + factory) for all products in cart
        const stockResult = await pool.query(`
          SELECT 
            cp.id,
            cp.product_name,
            COALESCE(SUM(cpi.total_inventory), 0) as total_stock
          FROM curated_products cp
          LEFT JOIN curated_product_inventories cpi ON cp.id = cpi.curated_product_id
          WHERE cp.id = ANY($1::int[])
          GROUP BY cp.id, cp.product_name
        `, [productIds]);
        
        const soldOutItems = [];
        const stockMap = {};
        for (const row of stockResult.rows) {
          const totalStock = Number(row.total_stock) || 0;
          stockMap[row.id] = totalStock;
          // Products with total stock <100 are sold out (low stock threshold)
          if (totalStock < 100) {
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

      const localProductIds = localItems.map(item => parseInt(item.id)).filter(id => !isNaN(id));
      if (localProductIds.length > 0) {
        const stockResult = await pool.query(`
          SELECT id, name, stock_quantity, is_active, approval_status
          FROM local_products
          WHERE id = ANY($1::int[])
        `, [localProductIds]);
        const stockById = new Map(stockResult.rows.map(row => [Number(row.id), row]));
        const soldOutItems = [];

        for (const item of localItems) {
          const productId = parseInt(item.id);
          if (Number.isNaN(productId)) continue;

          const row = stockById.get(productId);
          const requestedQty = Math.max(1, Number(item.quantity || 1));
          const availableQty = Number(row?.stock_quantity || 0);

          if (!row || row.is_active === false || row.approval_status !== 'approved' || availableQty < requestedQty) {
            soldOutItems.push(item.name || row?.name || `Product ${productId}`);
          }
        }

        if (soldOutItems.length > 0) {
          return res.status(400).json({
            error: 'Some local items in your cart are sold out',
            soldOutItems,
            message: `The following local items are no longer available in the requested quantity: ${soldOutItems.join(', ')}`
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
