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
    
    console.log('💰 Creating PayFast payment:', { amount, email });
    
    // Get frontend URL from environment or request origin
    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'https://vitejsviteeadmfezy-esxh--5173--1db57326.local-credentialless.webcontainer.io';
    const backendUrl = process.env.BACKEND_URL || 'https://snuggleup-backend.onrender.com';
    
    // PayFast payment data - order matters for signature!
    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID || '10000100',
      merchant_key: process.env.PAYFAST_MERCHANT_KEY || '46f0cd694581a',
      return_url: `${frontendUrl}/checkout-success`,
      cancel_url: `${frontendUrl}/checkout-cancel`,
      notify_url: `${backendUrl}/api/payments/notify`,
      name_first: req.user?.email?.split('@')[0] || 'Customer',
      email_address: email,
      m_payment_id: `ORDER-${Date.now()}`,
      amount: parseFloat(amount).toFixed(2),
      item_name: `Order ${orderItems?.length || 0} items`,
      item_description: orderItems?.map(i => i.name).join(', ').substring(0, 100) || 'SnuggleUp order',
    };

    // Generate signature according to PayFast specs
    const signature = generateSignature(data);
    data.signature = signature;

    // In test mode, use sandbox URL
    const payfastUrl = process.env.PAYFAST_TEST_MODE === 'true' 
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';

    console.log('✅ PayFast URL generated:', payfastUrl);
    console.log('📝 Payment data:', { ...data, signature: signature.substring(0, 10) + '...' });

    res.json({ 
      paymentUrl: `${payfastUrl}?${new URLSearchParams(data).toString()}`
    });
  } catch (error) {
    console.error('❌ Payment creation error:', error);
    res.status(500).json({ error: 'Payment creation failed', details: error.message });
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

// Helper function to generate PayFast signature according to their specs
function generateSignature(data) {
  // PayFast requires: key=value&key=value format (URL encoded)
  // Sorted alphabetically, excluding signature field
  const params = Object.entries(data)
    .filter(([key]) => key !== 'signature') // Don't include signature in signature calculation
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  console.log('🔐 Signature string:', params.substring(0, 100) + '...');

  return crypto
    .createHash('md5')
    .update(params)
    .digest('hex');
}
