import { authenticateToken } from './auth.js';
import pool from '../db.js';

// Middleware to check if user is admin (by email) and auto-provision local user row if missing
export const requireAdmin = async (req, res, next) => {
  try {
    // First, authenticate the token
    await new Promise((resolve) => {
      authenticateToken(req, res, (err) => {
        if (err) {
          console.error('❌ Auth failed:', err);
        }
        resolve();
      });
    });

    const email = req.user?.email;
    console.log('✅ Admin check for:', email);

    if (!email) {
      return res.status(401).json({ error: 'No email in token' });
    }

    // Hardcoded admin emails (fallback for initial setup)
    const ADMIN_EMAILS = ['support@snuggleup.co.za'];
    const isHardcodedAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

    console.log('🔐 Hardcoded admin?', isHardcodedAdmin, 'for', email);

    if (isHardcodedAdmin) {
      console.log('✅ Admin access granted (hardcoded)');
      req.localUserId = email; // Use email as temp ID
      return next();
    }

    // If not hardcoded, check database
    try {
      const result = await pool.query('SELECT id, is_admin FROM users WHERE email = $1', [email]);
      const userRow = result.rows[0];

      if (userRow?.is_admin) {
        console.log('✅ Admin access granted (database)');
        req.localUserId = userRow.id;
        return next();
      }
    } catch (dbError) {
      console.error('⚠️ Database check failed (continuing with hardcoded check):', dbError.message);
    }

    console.log('❌ Admin access denied');
    return res.status(403).json({ error: 'Admin access required' });
  } catch (error) {
    console.error('❌ Admin middleware error:', error);
    res.status(500).json({ error: 'Authorization check failed', details: error.message });
  }
};
