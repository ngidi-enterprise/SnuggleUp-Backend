import { authenticateToken } from './auth.js';
import pool from '../db.js';

// Middleware to check if user is admin
export const requireAdmin = async (req, res, next) => {
  // First authenticate the token
  authenticateToken(req, res, async (err) => {
    if (err) return; // authenticateToken already sent error response

    try {
      // Check if user is admin in database
      const result = await pool.query(
        'SELECT is_admin FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (!result.rows.length || !result.rows[0].is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      next();
    } catch (error) {
      console.error('Admin check error:', error);
      res.status(500).json({ error: 'Failed to verify admin status' });
    }
  });
};
