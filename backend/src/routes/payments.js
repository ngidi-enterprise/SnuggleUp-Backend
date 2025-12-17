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
    
    // Validate PayFast configuration
    const testMode = process.env.PAYFAST_TEST_MODE === 'true';
    const merchantId = process.env.PAYFAST_MERCHANT_ID;
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
    // Important: Only use passphrase if it's actually set and non-empty
    // Check for undefined, null, empty string, or whitespace-only
    const rawPassphrase = process.env.PAYFAST_PASSPHRASE;
    // Debug: allow forcing no passphrase via env for testing
    const forceNoPassphrase = process.env.PAYFAST_NO_PASSPHRASE === 'true';
    const passphrase = (forceNoPassphrase) 
      ? '' 
      : (rawPassphrase && typeof rawPassphrase === 'string' && rawPassphrase.trim().length > 0) 
        ? rawPassphrase.trim() 
        : '';
    
    console.log('⚙️ PayFast Configuration Check:');
    console.log(`  Test Mode: ${testMode ? '✓ SANDBOX' : '✗ LIVE'}`);
    console.log(`  Merchant ID: ${merchantId ? '✓ Set' : '✗ MISSING'}`);
    console.log(`  Merchant Key: ${merchantKey ? '✓ Set' : '✗ MISSING'}`);
    console.log(`  Passphrase raw: "${rawPassphrase}" (type: ${typeof rawPassphrase})`);
    console.log(`  Passphrase trimmed: "${passphrase}" (length: ${passphrase.length})`);
    console.log(`  Passphrase will be used: ${passphrase.length > 0 ? 'YES' : 'NO'}`);
    
    if (!merchantId || !merchantKey) {
      console.error('❌ PayFast credentials not configured!');
      return res.status(500).json({
        error: 'Payment gateway not configured',
        details: 'Missing PAYFAST_MERCHANT_ID or PAYFAST_MERCHANT_KEY'
      });
    }
    
    // Get frontend URL from environment or request origin
    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'https://vitejsviteeadmfezy-esxh--5173--1db57326.local-credentialless.webcontainer.io';
    // For PayFast callbacks, use the actual Render backend URL (not the custom domain)
    // PayFast needs to reach the backend directly, not through a proxy/CDN
    const backendUrl = process.env.PAYFAST_BACKEND_URL || process.env.BACKEND_URL || 'https://snuggleup-backend.onrender.com';
    
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
    
    console.log('🔍 Debug - User info:', {
      userId,
      userIdType: typeof userId,
      userName: req.user?.name,
      userEmail: req.user?.email
    });
    
    // Merge/derive shipping details: allow frontend-provided values, fallback to user name when available
    const safeShippingDetails = {
      ...(shippingDetails || {}),
      customerName: (shippingDetails && shippingDetails.customerName) || req.user?.name || undefined,
    };

    console.log('🔍 Debug - Order items:', orderItems?.map(item => ({
      id: item.id,
      idType: typeof item.id,
      name: item.name,
      quantity: item.quantity
    })));

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
      console.error('❌ Failed to create order record:', orderError);
      console.error('❌ Order creation failed with userId:', userId, 'type:', typeof userId);
      // Continue with payment even if order creation fails - webhook will update it
    }
    
    // PayFast payment data - order matters for signature!
    // Use shorter URLs to avoid PayFast URL length/validation issues
    const data = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${backendUrl}/api/payments/success`,
      cancel_url: `${backendUrl}/api/payments/cancel`,
      notify_url: `${backendUrl}/api/payments/notify`,
      name_first: (req.user?.name || req.user?.email?.split('@')[0] || 'Customer').toString().slice(0, 60),
      email_address: email,
      m_payment_id: orderNumber,
      amount: parseFloat(amount).toFixed(2),
      item_name: `Order ${orderItems?.length || 0} items`,
    };

    // REMOVED: item_description causes PayFast 400 errors in sandbox
    // PayFast's working example had NO item_description field
    // Uncomment if needed for production after testing:
    // const itemDesc = orderItems?.map(i => i.name).join(', ').substring(0, 100);
    // if (itemDesc && itemDesc.trim().length > 0) {
    //   data.item_description = itemDesc;
    // }

    // Generate signature according to PayFast specs (test flag NOT included in signature)
    const signature = generateSignature(data, passphrase);
    data.signature = signature;

    // Add test flag AFTER signature generation - it's not part of the signature
    if (testMode) {
      data.test = 1;
    }

    // In test mode, use sandbox URL
    const payfastUrl = testMode
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';

    console.log('✅ PayFast URL generated:', payfastUrl);
    console.log('📝 Payment data (posting):', { ...data, signature: signature.substring(0, 10) + '...' });
    console.log('ℹ️ PayFast debug:', {
      testMode: testMode,
      passphraseUsed: passphrase.length > 0,
      passphraseLength: passphrase.length,
      allDataKeys: Object.keys(data)
    });

    // Build form inputs - DO NOT HTML-escape values; PayFast expects raw values in form
    const formFields = Object.entries(data)
      .filter(([key, value]) => value !== undefined && value !== null && `${value}`.length > 0)
      .map(([key, value]) => {
        // Only escape double quotes for the HTML attribute value
        const quotedValue = String(value).replace(/"/g, '&quot;');
        return `<input type="hidden" name="${key}" value="${quotedValue}">`;
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

    // Debug: log full signature string and raw form HTML
    // The signature string is only available inside generateSignature, so log it there
    // Here, just log the signature value
    console.log('🔑 PayFast signature (MD5 hash) sent:', signature);
    console.log('📝 PayFast raw HTML form sent:', html);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (error) {
    console.error('❌ Payment creation error:', error);
    res.status(500).json({ error: 'Payment creation failed', details: error.message });
  }
});

// Debug: Test signature against PayFast validation endpoint
router.post('/test-signature', async (req, res) => {
  try {
    const { formData } = req.body;
    
    console.log('🧪 TESTING SIGNATURE AGAINST PAYFAST');
    console.log('📊 Form data received:', formData);
    
    // Generate signature using our method
    const passphrase = ''; // No passphrase for sandbox
    const signature = generateSignature(formData, passphrase);
    console.log('✅ Our generated signature:', signature);
    
    // Test with PayFast validation endpoint - DO NOT add test=1 here
    // The signature was already generated with the exact fields from formData
    // Adding test=1 after would invalidate it
    const testData = { ...formData, signature };
    
    // Build form body using PayFast encoding rules (URL-encode and replace spaces with '+')
    const formBody = Object.entries(testData)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`)
      .join('&');
    
    console.log('📤 Sending to PayFast validation endpoint');
    console.log('📊 Form body:', formBody);
    
    const vRes = await fetch('https://sandbox.payfast.co.za/eng/query/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody
    });
    
    const validationResult = await vRes.text();
    console.log('📥 PayFast validation response:', validationResult);
    
    res.json({
      success: /VALID/i.test(validationResult),
      generatedSignature: signature,
      payfastResponse: validationResult,
      formDataKeys: Object.keys(formData),
      sentToPayFast: formBody
    });
  } catch (error) {
    console.error('❌ Test signature error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle PayFast success redirect
router.get('/success', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://snuggleup.co.za';
  res.redirect(`${frontendUrl}/checkout/success`);
});

// Handle PayFast cancel redirect
router.get('/cancel', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://snuggleup.co.za';
  res.redirect(`${frontendUrl}/checkout/cancel`);
});

// Handle PayFast notification
router.post('/notify', async (req, res) => {
  try {
    // PayFast posts form-encoded fields
    const params = { ...req.body };
    const receivedSignature = params.signature;
    delete params.signature; // Exclude from signing

    // 1. Recreate signature locally using same passphrase logic
    const rawPassphrase = process.env.PAYFAST_PASSPHRASE;
    const forceNoPassphrase = process.env.PAYFAST_NO_PASSPHRASE === 'true';
    const passphrase = (forceNoPassphrase) 
      ? '' 
      : (rawPassphrase && typeof rawPassphrase === 'string' && rawPassphrase.trim().length > 0) 
        ? rawPassphrase.trim() 
        : '';
    const localSig = generateSignature(params, passphrase);
    const signaturesMatch = localSig === receivedSignature;

    // 2. Validate source IP (best-effort; optional)
    const allowedHosts = [
      'www.payfast.co.za',
      'sandbox.payfast.co.za'
    ];

    // 3. Process payment status (signature match is sufficient for now)
    const paymentStatus = params.payment_status;
    const orderNumber = params.m_payment_id; // we used m_payment_id as orderNumber earlier
    const payfastPaymentId = params.pf_payment_id;

    console.log('📊 IPN Notification:', { 
      paymentStatus, 
      orderNumber, 
      payfastPaymentId, 
      signaturesMatch,
      receivedSignature: receivedSignature?.substring(0, 10) + '...',
      localSignature: localSig?.substring(0, 10) + '...'
    });

    // Update order status if signature matches
    if (signaturesMatch) {
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
      console.warn('⚠️ PayFast IPN rejected - signature mismatch:', { 
        paymentStatus, 
        orderNumber,
        expected: localSig?.substring(0, 10) + '...',
        received: receivedSignature?.substring(0, 10) + '...'
      });
    }

    res.status(200).json({
      status: 'ok',
      processed: signaturesMatch,
      paymentStatus,
      orderNumber,
      signaturesMatch
    });
  } catch (error) {
    console.error('PayFast notify error:', error);
    res.status(500).json({ error: 'Notification processing failed' });
  }
});

// Helper function to generate PayFast signature according to their specs
function generateSignature(data, passphrase = '') {
  // PayFast signature: specific fields in a specific order (as shown in their form)
  // The order matters! Based on their integration test page, the order is:
  // merchant_id, merchant_key, return_url, cancel_url, notify_url, name_first,
  // email_address, m_payment_id, amount, item_name, item_description
  // NOTE: test flag is NOT included in signature
  
  const signatureData = { ...data };
  delete signatureData.signature; // Remove signature from data before signing
  delete signatureData.test; // Remove test flag - it's not part of signature
  
  // Exact field order from PayFast documentation
  const fieldOrder = [
    'merchant_id',
    'merchant_key',
    'return_url',
    'cancel_url',
    'notify_url',
    'name_first',
    'email_address',
    'm_payment_id',
    'amount',
    'item_name',
    'item_description'
  ];
  
  // Filter to fields that exist in data (skip undefined/null)
  const signingKeys = fieldOrder.filter(
    k => signatureData[k] !== undefined && 
         signatureData[k] !== null
  );

  console.log('🔍 Fields being signed (PayFast form order - URL encoded with + for spaces):');
  signingKeys.forEach(key => {
    const encodedValue = encodeURIComponent(String(signatureData[key])).replace(/%20/g, '+');
    const displayValue = encodedValue.substring(0, 80) + (encodedValue.length > 80 ? '...' : '');
    console.log(`  ${key}=${displayValue}`);
  });

  // Build signature string WITH URL ENCODING and replace spaces with '+' per PayFast docs
  const signatureString = signingKeys
    .map(key => {
      const val = encodeURIComponent(String(signatureData[key])).replace(/%20/g, '+');
      return `${key}=${val}`;
    })
    .join('&');

  // Append passphrase ONLY if it's actually set and non-empty
  let finalString = signatureString;
  const trimmedPassphrase = passphrase ? passphrase.trim() : '';
  if (trimmedPassphrase.length > 0) {
    finalString = `${signatureString}&passphrase=${trimmedPassphrase}`;
    console.log(`✓ Passphrase appended to signature string (length: ${trimmedPassphrase.length})`);
  } else {
    console.log('ℹ️ No passphrase - signature string without passphrase');
  }

  console.log('🔐 FULL Signature string:');
  console.log(finalString);
  console.log('🔐 String length:', finalString.length);

  const hash = crypto
    .createHash('md5')
    .update(finalString)
    .digest('hex');

  console.log('🔐 MD5 hash:', hash);

  return hash;
}
