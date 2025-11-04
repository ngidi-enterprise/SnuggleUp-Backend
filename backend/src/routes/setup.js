import express from 'express';
import pool from '../db.js';

export const router = express.Router();

// Temporary endpoint to make specific user admin
// TODO: Remove this endpoint once initial admin is set up
router.post('/make-admin', async (req, res) => {
  try {
    const { email, secret } = req.body;

    // Simple secret key protection - change this to something secure
    const ADMIN_SETUP_SECRET = process.env.ADMIN_SETUP_SECRET || 'snuggleup-admin-setup-2025';

    if (secret !== ADMIN_SETUP_SECRET) {
      return res.status(403).json({ error: 'Invalid secret key' });
    }

    // Make the user admin
    const result = await pool.query(
      'UPDATE users SET is_admin = TRUE WHERE email = $1 RETURNING id, email, name, is_admin',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found. Please register first.' });
    }

    res.json({
      success: true,
      message: 'User is now an admin!',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Make admin error:', error);
    res.status(500).json({ error: 'Failed to make user admin' });
  }
});

// Endpoint to check if user is admin
router.get('/check-admin/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const result = await pool.query(
      'SELECT email, name, is_admin FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: result.rows[0],
      isAdmin: result.rows[0].is_admin || false,
    });
  } catch (error) {
    console.error('Check admin error:', error);
    res.status(500).json({ error: 'Failed to check admin status' });
  }
});
