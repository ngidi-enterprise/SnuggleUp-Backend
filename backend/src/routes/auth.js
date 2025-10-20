import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { generateToken } from '../middleware/auth.js';

export const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows && existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const insert = await db.query(
      'INSERT INTO users (email, password, name, phone) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, hashedPassword, name, phone || null]
    );

    const userId = insert.rows[0].id;
    // Generate token
    const token = generateToken(userId, email);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        email,
        name,
        phone
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const found = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!found.rows || found.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = found.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

  // Generate token
  const token = generateToken(user.id, user.email);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Forgot Password - request reset token
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    // Find user
    const found = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!found.rows || found.rows.length === 0) {
      return res.status(404).json({ error: 'No user found with that email' });
    }
    // Generate token and expiry (1 hour)
    const token = Math.random().toString(36).substr(2) + Date.now().toString(36);
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    // Store token in DB
    await db.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3', [token, expires, email]);
    // Simulate sending email (log to console)
    console.log(`Password reset link for ${email}: https://your-frontend-url/#/reset-password?token=${token}`);
    res.json({ message: 'Password reset link sent (simulated)', token });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process forgot password' });
  }
});

// Reset Password - use token to set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    // Find user by token
    const found = await db.query('SELECT id, reset_token_expires FROM users WHERE reset_token = $1', [token]);
    if (!found.rows || found.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const user = found.rows[0];
    // Check expiry
    if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Token has expired' });
    }
    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Update password and clear token
    await db.query('UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2', [hashedPassword, user.id]);
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get current user profile
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // This would use the authenticateToken middleware in production
    // For now, just return a success response
    res.json({ authenticated: true });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
});
