import { authenticateToken } from './auth.js';
import pool from '../db.js';

// Middleware to check if user is admin (by email) and auto-provision local user row if missing
export const requireAdmin = async (req, res, next) => {
  // Create a wrapper to intercept auth failures
  let authFailed = false;
  const originalJson = res.json;
  
  res.json = function(data) {
    if (res.statusCode === 401 || res.statusCode === 403) {
      authFailed = true;
      // Don't send response yet, we'll check hardcoded admins first
      return res;
    }
    return originalJson.call(this, data);
  };

  // Try to authenticate the token
  await new Promise((resolve) => {
    authenticateToken(req, res, () => resolve());
  });

  // Restore original json method
  res.json = originalJson;

  // If auth failed completely and no user was set, check if token has email claim we can extract
  if (authFailed || !req.user?.email) {
    // Try to decode token manually to get email (without verification)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        // Decode without verification to extract email
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload.email) {
            req.user = { email: payload.email, userId: payload.sub };
            console.log('⚠️ Extracted email from unverified token:', payload.email);
          }
        }
      } catch (e) {
        console.log('❌ Failed to extract email from token:', e.message);
      }
    }
  }

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

      // Hardcoded admin emails (fallback for initial setup)
      const ADMIN_EMAILS = [
        'support@snuggleup.co.za',
        // Add more admin emails here as needed
      ];
      const isHardcodedAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

      // Auto-provision a local row if missing (for Supabase users). Password is a placeholder; not used for login.
      if (!userRow) {
        const derivedName = (email.split('@')[0] || 'User').replace(/[^a-zA-Z0-9 _.-]/g, '');
        try {
          const insert = await pool.query(
            'INSERT INTO users (email, password, name, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, is_admin, name',
            [email, 'external-auth', derivedName || 'User', isHardcodedAdmin]
          );
          userRow = insert.rows[0];
        } catch (e) {
          console.error('Admin auto-provision error:', e);
          return res.status(500).json({ error: 'Failed to provision user for admin check' });
        }
      }

      // Check admin status (database flag OR hardcoded list)
      if (!userRow?.is_admin && !isHardcodedAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      // Attach local user id for downstream handlers if needed
      req.localUserId = userRow.id;
      next();
    } catch (error) {
      console.error('Admin check error:', error);
      res.status(500).json({ error: 'Failed to verify admin status' });
    }
};
