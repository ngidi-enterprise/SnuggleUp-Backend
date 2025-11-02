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
      merchant_id: process.env.PAYFAST_MERCHANT_ID || '10042854',
      merchant_key: process.env.PAYFAST_MERCHANT_KEY || 'bmvnyjivavg1a',
      return_url: `${frontendUrl}/checkout/success`,
      cancel_url: `${frontendUrl}/checkout/cancel`,
      notify_url: `${backendUrl}/api/payments/notify`,
      name_first: req.user?.email?.split('@')[0] || 'Customer',
      email_address: email,
      m_payment_id: `ORDER-${Date.now()}`,
      amount: parseFloat(amount).toFixed(2),
      item_name: `Order ${orderItems?.length || 0} items`,
      item_description: orderItems?.map(i => i.name).join(', ').substring(0, 100) || 'SnuggleUp order',
    };

    // Add test flag BEFORE signature so it's included in the hash (PayFast requirement)
    if (process.env.PAYFAST_TEST_MODE === 'true') {
      data.test = '1';
    }

  // Generate signature according to PayFast specs
  const passphrase = process.env.PAYFAST_PASSPHRASE || ''; // Optional but recommended
  const signature = generateSignature(data, passphrase);
    data.signature = signature;

    // In test mode, use sandbox URL
    const payfastUrl = process.env.PAYFAST_TEST_MODE === 'true' 
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';

    // Note: test flag already included above (prior to signature)

    console.log('✅ PayFast URL generated:', payfastUrl);
    console.log('📝 Payment data (posting):', { ...data, signature: signature.substring(0, 10) + '...' });
    console.log('ℹ️ PayFast debug:', {
      includeTest: data.test === '1',
      passphraseIncluded: Boolean(passphrase),
    });

    // Build query string exactly as used for signing to avoid any encoding drift
    const formEncode = (v) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const paramString = Object.entries(data)
      .filter(([key, value]) => key !== 'signature' && value !== undefined && value !== null && `${value}`.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${formEncode(value)}`)
      .join('&');
    const fullUrl = `${payfastUrl}?${paramString}&signature=${signature}`;

    // If client expects JSON (our frontend does), return the URL; otherwise serve a tiny redirect page
    if ((req.headers['accept'] || '').includes('application/json')) {
      return res.json({ paymentUrl: fullUrl });
    }
    const html = `<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"0;url='${fullUrl}'\"><title>Redirecting…</title></head><body>If you are not redirected, <a href=\"${fullUrl}\">click here</a>.</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
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
function generateSignature(data, passphrase = '') {
  // PayFast signature: key=value&key=value with RAW unencoded values
  // Sorted alphabetically, exclude signature and empty/undefined values
  const params = Object.entries(data)
    .filter(([key, value]) => key !== 'signature' && value !== undefined && value !== null && `${value}`.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  // Append passphrase if present (must be included in signature string)
  const signatureString = passphrase ? `${params}&passphrase=${passphrase}` : params;

  console.log('🔐 Signature string (RAW):', signatureString.substring(0, 150) + '...');
  console.log('🔐 Full signature string length:', signatureString.length);

  return crypto
    .createHash('md5')
    .update(signatureString)
    .digest('hex');
}
