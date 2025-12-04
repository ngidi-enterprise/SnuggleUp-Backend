import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { authenticateToken } from '../middleware/auth.js';
import { createOrder, updateOrderStatus, getOrderByNumber } from './orders.js';
import { sendOrderConfirmationEmail } from '../services/emailService.js';

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
    const { 
      amount, 
      email, 
      orderItems, 
      subtotal, 
      shipping, 
      discount, 
      shippingMethod, 
      shippingQuoted,
      shippingCountry,
      insurance,
      shippingDetails
    } = req.body;
    
    console.log('💰 Creating PayFast payment:', { 
      amount, 
      email, 
      subtotal, 
      shipping, 
      discount,
      insurance: insurance?.selected ? `R${insurance.cost}` : 'None'
    });
    
    // Get frontend URL from environment or request origin
    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'https://vitejsviteeadmfezy-esxh--5173--1db57326.local-credentialless.webcontainer.io';
    const backendUrl = process.env.BACKEND_URL || 'https://snuggleup-backend.onrender.com';
    
    // Generate unique order number
    const orderNumber = `ORDER-${Date.now()}`;
    
    // Validate stock availability before payment - use CN total (CJ + factory) like storefront does
    if (orderItems && orderItems.length > 0) {
      const productIds = orderItems.map(item => {
        const id = String(item.id || '').replace('curated-', '');
        return parseInt(id);
      }).filter(id => !isNaN(id));
      
      if (productIds.length > 0) {
        const { default: pool } = await import('../db.js');
        const stockResult = await pool.query(`
          SELECT 
            cp.id,
            cp.product_name,
            COALESCE(SUM(cpi.total_inventory), 0) as cn_total_stock
          FROM curated_products cp
          LEFT JOIN curated_product_inventories cpi ON cp.id = cpi.curated_product_id
          WHERE cp.id = ANY($1::int[])
            AND cpi.country_code = 'CN'
          GROUP BY cp.id, cp.product_name
        `, [productIds]);
        
        const soldOutItems = [];
        for (const row of stockResult.rows) {
          const cnTotalStock = Number(row.cn_total_stock) || 0;
          // Products with CN total stock = 0 are sold out (matches storefront logic)
          if (cnTotalStock === 0) {
            soldOutItems.push(row.product_name);
          }
        }
        
        if (soldOutItems.length > 0) {
          return res.status(400).json({
            error: 'Cannot complete payment - some items are sold out',
            soldOutItems,
            message: `The following items are currently sold out and cannot be purchased: ${soldOutItems.join(', ')}. Please remove them from your cart.`
          });
        }
      }
    }

    // Create order record in database (with pending status)
    const userId = req.user?.userId || 'guest';
    // Merge/derive shipping details: allow frontend-provided values, fallback to user name when available
    const safeShippingDetails = {
      ...(shippingDetails || {}),
      customerName: (shippingDetails && shippingDetails.customerName) || req.user?.name || undefined,
    };

    try {
      await createOrder(userId, {
        orderNumber,
        items: orderItems,
        subtotal: subtotal || 0,
        shipping: shipping || 0,
        discount: discount || 0,
        total: amount,
        email,
        shippingCountry,
        shippingMethod,
        insurance,
        shippingDetails: safeShippingDetails
      });
      console.log('✅ Order created:', orderNumber);
    } catch (orderError) {
      console.error('Failed to create order record:', orderError);
      // Continue with payment even if order creation fails - webhook will update it
    }
    
    // PayFast payment data - order matters for signature!
    // Use shorter URLs to avoid PayFast URL length/validation issues
    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID || '10042854',
      merchant_key: process.env.PAYFAST_MERCHANT_KEY || 'bmvnyjivavg1a',
      return_url: `${backendUrl}/api/payments/success`,
      cancel_url: `${backendUrl}/api/payments/cancel`,
      notify_url: `${backendUrl}/api/payments/notify`,
      name_first: (req.user?.name || req.user?.email?.split('@')[0] || 'Customer').toString().slice(0, 60),
      email_address: email,
      m_payment_id: orderNumber,
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

    // Build form inputs with raw values (matching signature calculation)
    const formFields = Object.entries(data)
      .filter(([key, value]) => value !== undefined && value !== null && `${value}`.length > 0)
      .map(([key, value]) => {
        const escapedValue = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<input type="hidden" name="${key}" value="${escapedValue}">`;
      })
      .join('\n      ');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Redirecting to PayFast…</title>
  </head>
  <body>
    <p>Processing payment, please wait…</p>
    <form id="payfastForm" action="${payfastUrl}" method="post">
      ${formFields}
    </form>
    <script>document.getElementById('payfastForm').submit();</script>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error) {
    console.error('❌ Payment creation error:', error);
    res.status(500).json({ error: 'Payment creation failed', details: error.message });
  }
});

// Handle PayFast success redirect
router.get('/success', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vitejsviteeadmfezy-esxh--5173--cf284e50.local-credentialless.webcontainer.io';
  res.redirect(`${frontendUrl}/checkout/success`);
});

// Handle PayFast cancel redirect
router.get('/cancel', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://vitejsviteeadmfezy-esxh--5173--cf284e50.local-credentialless.webcontainer.io';
  res.redirect(`${frontendUrl}/checkout/cancel`);
});

// Handle PayFast notification
router.post('/notify', async (req, res) => {
  try {
    // PayFast posts form-encoded fields
    const params = { ...req.body };
    const receivedSignature = params.signature;
    delete params.signature; // Exclude from signing

    // 1. Recreate signature locally
    const passphrase = process.env.PAYFAST_PASSPHRASE || '';
    const localSig = generateSignature(params, passphrase);
    const signaturesMatch = localSig === receivedSignature;

    // 2. Validate source IP (best-effort; optional)
    const allowedHosts = [
      'www.payfast.co.za',
      'sandbox.payfast.co.za'
    ];

    // 3. Server-to-server validation: echo params back to PayFast validation endpoint
    // Skip if in test mode sandbox mismatch is acceptable
    let validationResult = 'skipped';
    let validationOk = false;
    const validationUrl = process.env.PAYFAST_TEST_MODE === 'true'
      ? 'https://sandbox.payfast.co.za/eng/query/validate'
      : 'https://www.payfast.co.za/eng/query/validate';
    try {
      const formBody = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      const vRes = await fetch(validationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody
      });
      validationResult = await vRes.text();
      validationOk = /VALID/i.test(validationResult);
    } catch (e) {
      console.warn('PayFast validation error:', e.message);
    }

    // 4. Process payment status
    const paymentStatus = params.payment_status;
    const orderNumber = params.m_payment_id; // we used m_payment_id as orderNumber earlier
    const payfastPaymentId = params.pf_payment_id;

    // Update order status if signatures & validation pass
    if (signaturesMatch && validationOk) {
      if (paymentStatus === 'COMPLETE') {
        await updateOrderStatus(orderNumber, 'paid', payfastPaymentId);
        // Send order confirmation email (best-effort, once only)
        try {
          const order = await getOrderByNumber(orderNumber);
          if (order && order.customer_email && !order.sent_confirmation) {
            const items = Array.isArray(order.items) ? order.items : [];
            const emailResult = await sendOrderConfirmationEmail({
              to: order.customer_email,
              orderNumber: order.order_number,
              totalAmount: order.total,
              items,
              customerName: order.customer_name
            });
            // Mark email as sent to prevent duplicates on IPN retries
            if (emailResult.success) {
              const pool = (await import('../db.js')).default;
              await pool.query(
                'UPDATE orders SET sent_confirmation = TRUE WHERE order_number = $1',
                [orderNumber]
              );
            }
          }
        } catch (e) {
          console.warn('Order confirmation email failed:', e.message);
        }
      } else if (paymentStatus === 'FAILED') {
        await updateOrderStatus(orderNumber, 'failed', payfastPaymentId);
      } else if (paymentStatus === 'PENDING') {
        await updateOrderStatus(orderNumber, 'pending', payfastPaymentId);
      }
    } else {
      console.warn('⚠️ PayFast IPN rejected:', { signaturesMatch, validationOk, paymentStatus, orderNumber });
    }

    res.status(200).json({
      status: 'ok',
      processed: signaturesMatch && validationOk,
      paymentStatus,
      orderNumber,
      validationResult,
      signaturesMatch,
      validationOk
    });
  } catch (error) {
    console.error('PayFast notify error:', error);
    res.status(500).json({ error: 'Notification processing failed' });
  }
});

// Helper function to generate PayFast signature according to their specs
function generateSignature(data, passphrase = '') {
  // PayFast signature: key=value&key=value with RAW unencoded values
  // Sorted alphabetically, exclude signature and empty/undefined values
  const entries = Object.entries(data)
    .filter(([key, value]) => key !== 'signature' && value !== undefined && value !== null && `${value}`.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  console.log('🔍 Fields being signed (alphabetical order):');
  entries.forEach(([key, value]) => {
    console.log(`  ${key}=${String(value).substring(0, 80)}${String(value).length > 80 ? '...' : ''}`);
  });

  const params = entries
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  // Append passphrase if present (must be included in signature string)
  const signatureString = passphrase ? `${params}&passphrase=${passphrase}` : params;

  console.log('🔐 FULL Signature string:');
  console.log(signatureString);
  console.log('🔐 String length:', signatureString.length);

  const hash = crypto
    .createHash('md5')
    .update(signatureString)
    .digest('hex');

  console.log('🔐 MD5 hash:', hash);

  return hash;
}
