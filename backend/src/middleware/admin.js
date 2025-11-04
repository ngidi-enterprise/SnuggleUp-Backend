import { authenticateToken } from './auth.js';
import pool from '../db.js';

// Middleware to check if user is admin (by email) and auto-provision local user row if missing
export const requireAdmin = async (req, res, next) => {
  // First authenticate the token (supports Supabase + app JWTs)
  authenticateToken(req, res, async (err) => {
    if (err) return; // authenticateToken already sent error response

    try {
      const email = req.user?.email;

      if (!email) {
        return res.status(401).json({ error: 'Authenticated user missing email' });
      }

      // Look up by email in local users table
      let userRow = null;
      try {
        const result = await pool.query('SELECT id, is_admin, name FROM users WHERE email = $1', [email]);
        userRow = result.rows[0] || null;
      } catch (e) {
        console.error('Admin lookup error:', e);
        return res.status(500).json({ error: 'Failed to verify admin status' });
      }

      // Auto-provision a local row if missing (for Supabase users). Password is a placeholder; not used for login.
      if (!userRow) {
        const derivedName = (email.split('@')[0] || 'User').replace(/[^a-zA-Z0-9 _.-]/g, '');
        try {
          const insert = await pool.query(
            'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, is_admin, name',
            [email, 'external-auth', derivedName || 'User']
          );
          userRow = insert.rows[0];
        } catch (e) {
          console.error('Admin auto-provision error:', e);
          return res.status(500).json({ error: 'Failed to provision user for admin check' });
        }
      }

      if (!userRow?.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      // Attach local user id for downstream handlers if needed
      req.localUserId = userRow.id;
      next();
    } catch (error) {
      console.error('Admin check error:', error);
      res.status(500).json({ error: 'Failed to verify admin status' });
    }
  });
};
