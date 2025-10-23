import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';

export const router = express.Router();

// Optional auth middleware - passes through if no token, but validates if present
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return next(); // No token, continue without user context
  }
  authenticateToken(req, res, next); // Token present, validate it
};

// Create a payment
router.post('/create', optionalAuth, async (req, res) => {
  try {
    const { amount, email, orderItems } = req.body;
    
    // Example payment data - you'll need to add your PayFast details
    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      amount: amount.toFixed(2),
      item_name: `Order ${Date.now()}`,
      email_address: email,
      return_url: 'https://your-frontend-url/checkout/success',
      cancel_url: 'https://your-frontend-url/checkout/cancel',
      notify_url: 'https://your-backend-url/api/payments/notify',
    };

    // Generate signature (implement PayFast signature generation)
    const signature = generateSignature(data);
    data.signature = signature;

    // In test mode, use sandbox URL
    const payfastUrl = process.env.PAYFAST_TEST_MODE === 'true' 
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';

    res.json({ 
      paymentUrl: `${payfastUrl}?${new URLSearchParams(data).toString()}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Payment creation failed' });
  }
});

// Handle PayFast notification
router.post('/notify', async (req, res) => {
  try {
    const { payment_status, m_payment_id, pf_payment_id, signature } = req.body;
    
    // Verify PayFast signature
    // Update order status
    // Send confirmation email
    
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).json({ error: 'Notification processing failed' });
  }
});

// Helper function to generate PayFast signature
function generateSignature(data) {
  const signatureString = Object.entries(data)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([_, value]) => value)
    .join('');

  return crypto
    .createHash('md5')
    .update(signatureString)
    .digest('hex');
}
