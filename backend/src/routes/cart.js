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
