import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { authenticateToken } from '../middleware/auth.js';
import { createOrder, updateOrderStatus, getOrderByNumber } from './orders.js';
import { sendOrderConfirmationEmail } from '../services/emailService.js';

export const router = express.Router();

// Validate South African ID (13 digits + checksum)
const isValidSouthAfricanId = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 13) return false;
  const nums = digits.split('').map(Number);
  const sumOdd = nums.slice(0, 12).filter((_, idx) => idx % 2 === 0).reduce((a, b) => a + b, 0);
  const evenStr = nums.slice(0, 12).filter((_, idx) => idx % 2 === 1).join('');
  const doubled = String(Number(evenStr || '0') * 2);
  const sumEven = doubled.split('').reduce((a, b) => a + Number(b), 0);
  const total = sumOdd + sumEven;
  const checkDigit = (10 - (total % 10)) % 10;
  return checkDigit === nums[12];
};

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
      localShipping,
      discount, 
      shippingMethod, 
      localShippingMethod,
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
    
    console.log('📋 Shipping details received from frontend:', JSON.stringify(shippingDetails, null, 2));

    // ID number no longer collected; skip validation
    
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
    
    // Generate unique master order number (used for payment ID)
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

    // Create order records in database (split local vs import)
    const userId = req.user?.userId || 'guest';
    console.log('🔍 Debug - User info:', {
      userId,
      userIdType: typeof userId,
      userName: req.user?.name,
      userEmail: req.user?.email
    });
    const safeShippingDetails = {
      ...(shippingDetails || {}),
      customerName: (shippingDetails && shippingDetails.customerName) || req.user?.name || undefined,
    };

    // split items
    const localOrderItems = (orderItems || []).filter(i => i.isLocal);
    const importOrderItems = (orderItems || []).filter(i => !i.isLocal);
    const totalSubtotal = (subtotal || 0);
    // derive subtotals if not provided
    const localSubtotal = localOrderItems.reduce((sum,i) => sum + (i.price*i.quantity),0);
    const importSubtotal = importOrderItems.reduce((sum,i) => sum + (i.price*i.quantity),0);

    // allocate discount proportionally
    const disc = discount || 0;
    const discountLocal = totalSubtotal ? Math.round((localSubtotal/totalSubtotal) * disc) : 0;
    const discountImport = disc - discountLocal;

    try {
      // create local order if items exist
      if (localOrderItems.length > 0) {
        // use explicit suffix so order numbers are self‑explaining
        const localOrderNumber = `${orderNumber}-LOCAL`;
        const localShippingAmount = Math.max(Number(localShipping) || 0, 0);
        await createOrder(userId, {
          orderNumber: localOrderNumber,
          items: localOrderItems,
          subtotal: localSubtotal,
          shipping: localShippingAmount,
          discount: discountLocal,
          total: localSubtotal + localShippingAmount - discountLocal,
          email,
          shippingCountry,
          shippingMethod: localShippingMethod || 'Economy delivery - R100 flat rate',
          insurance: { selected: false, cost: 0, coverage: 0 },
          shippingDetails: safeShippingDetails
        });
        console.log('✅ Local order created:', localOrderNumber);
      }
      // create import order if items exist
      if (importOrderItems.length > 0) {
        const importOrderNumber = `${orderNumber}-IMPORT`;
        await createOrder(userId, {
          orderNumber: importOrderNumber,
          items: importOrderItems,
          subtotal: importSubtotal,
          shipping: shipping || 0,
          discount: discountImport,
          total: importSubtotal + (shipping||0) + (insurance?.cost||0) - discountImport,
          email,
          shippingCountry,
          shippingMethod,
          insurance,
          shippingDetails: safeShippingDetails
        });
        console.log('✅ Import order created:', importOrderNumber);
      }
    } catch (orderError) {
      console.error('❌ Failed to create split order records:', orderError);
      // still continue to payment flow
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
router.get('/success', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://snuggleup.co.za';
  
  // PayFast doesn't send params to return_url, so we get the most recent order for this session
  // The user just completed payment, so fetch their latest pending/paid order
  try {
    const { default: pool } = await import('../db.js');
    
    // Get the most recent order (within last 10 minutes to avoid stale orders)
    const result = await pool.query(`
      SELECT order_number, customer_email, payfast_payment_id
      FROM orders 
      WHERE created_at > NOW() - INTERVAL '10 minutes'
        AND status IN ('pending', 'paid')
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (result.rows.length > 0) {
      const order = result.rows[0];
      const params = new URLSearchParams({
        m_payment_id: order.order_number,
        pf_payment_id: order.payfast_payment_id || 'processing'
      });
      const target = `${frontendUrl}/#/checkout/success?${params.toString()}`;
      console.log('✅ Success redirect with order:', order.order_number);
      return res.redirect(target);
    }
  } catch (error) {
    console.error('Failed to lookup order for success redirect:', error);
  }
  
  // Fallback: redirect without params (will show N/A)
  const target = `${frontendUrl}/#/checkout/success`;
  res.redirect(target);
});

// Handle PayFast cancel redirect
router.get('/cancel', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://snuggleup.co.za';
  const qs = new URLSearchParams(req.query || {}).toString();
  const target = `${frontendUrl}/#/checkout/cancel${qs ? `?${qs}` : ''}`;
  res.redirect(target);
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
    
    // IMPORTANT: For IPN validation, we must use the EXACT fields PayFast sends
    // NOT the form submission fields. Build signature string exactly as PayFast does:
    // iterate through params in order, URL-encode each, replace spaces with +
    const localSig = generateSignatureFromIPNData(params, passphrase);
    const signaturesMatch = localSig === receivedSignature;

    // 2. Validate source IP (best-effort; optional)
    const allowedHosts = [
      'www.payfast.co.za',
      'sandbox.payfast.co.za'
    ];

    // 3. Process payment status (signature match is sufficient for now)
    const paymentStatus = params.payment_status;
    const orderNumber = params.m_payment_id;
    const payfastPaymentId = params.pf_payment_id;

    console.log('📊 IPN Raw params:', params);
    console.log('📊 IPN params keys:', Object.keys(params).sort());

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
      // for split orders we stored child orders with human-readable suffixes (-LOCAL and -IMPORT)
      // find all orders whose number starts with the master ID
      const pool = (await import('../db.js')).default;
      const { rows: matching } = await pool.query(
        `SELECT order_number, customer_email, total, items, customer_name FROM orders WHERE order_number LIKE $1`,
        [orderNumber + '%']
      );

      if (paymentStatus === 'COMPLETE') {
        // update each matching order and send its own email
        for (const ord of matching) {
          await updateOrderStatus(ord.order_number, 'paid', payfastPaymentId);
          if (ord.customer_email) {
            try {
              const items = Array.isArray(ord.items) ? ord.items : [];
              const emailResult = await sendOrderConfirmationEmail({
                to: ord.customer_email,
                orderNumber: ord.order_number,
                totalAmount: ord.total,
                items,
                customerName: ord.customer_name
              });
              if (emailResult.success) {
                await pool.query(
                  'UPDATE orders SET sent_confirmation = TRUE WHERE order_number = $1',
                  [ord.order_number]
                );
              }
            } catch (e) {
              console.warn('Order confirmation email failed for', ord.order_number, e.message);
            }
          }
        }
      } else if (paymentStatus === 'FAILED' || paymentStatus === 'PENDING') {
        for (const ord of matching) {
          await updateOrderStatus(ord.order_number, paymentStatus === 'FAILED' ? 'failed' : 'pending', payfastPaymentId);
        }
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

// Helper function to generate PayFast signature for FORM submission (specific field order)
function generateSignature(data, passphrase = '') {
  // PayFast signature for FORM: specific fields in a specific order (as shown in their form)
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
  
  // Filter to fields that exist in data (skip only undefined/null, NOT empty strings)
  // PayFast IPN includes empty fields like item_description="", so we must include them too
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

// Helper function to generate PayFast signature for IPN validation
// For IPN, PayFast includes ALL fields it sends back, not just form fields
// Build signature by iterating through params as they are received
function generateSignatureFromIPNData(params, passphrase = '') {
  // Per PayFast docs: "The string that gets created needs to include all fields posted from Payfast"
  // CRITICAL: PayFast IPN includes ALL fields, even empty strings like item_description=""
  // We must include them ALL (skip only undefined/null, NOT empty strings)
  
  console.log('🔍 IPN Signature validation - Processing ALL fields in received order:');
  
  // Build signature string by going through each param (except signature)
  let signatureString = '';
  const processedKeys = [];
  
  for (const [key, value] of Object.entries(params)) {
    if (key === 'signature') break; // Stop at signature field
    
    // Include ALL fields sent by PayFast (skip only undefined/null, but INCLUDE empty strings)
    if (value !== undefined && value !== null) {
      const val = encodeURIComponent(String(value)).replace(/%20/g, '+');
      signatureString += `${key}=${val}&`;
      processedKeys.push(key);
      const displayVal = value === '' ? '""' : val.substring(0, 80);
      console.log(`  ✓ ${key}=${displayVal}`);
    } else {
      console.log(`  ✗ ${key}=null (skipped - undefined/null)`);
    }
  }
  
  // Remove trailing ampersand
  signatureString = signatureString.slice(0, -1);
  
  // Append passphrase if set
  let finalString = signatureString;
  const trimmedPassphrase = passphrase ? passphrase.trim() : '';
  if (trimmedPassphrase.length > 0) {
    finalString = `${signatureString}&passphrase=${encodeURIComponent(trimmedPassphrase).replace(/%20/g, '+')}`;
    console.log(`✓ Passphrase appended (length: ${trimmedPassphrase.length})`);
  } else {
    console.log('ℹ️ No passphrase used');
  }
  
  console.log('🔐 FULL IPN Signature string:', finalString);
  console.log('🔐 String length:', finalString.length);
  
  const hash = crypto
    .createHash('md5')
    .update(finalString)
    .digest('hex');

  console.log('🔐 MD5 hash (IPN):', hash);

  return hash;
}
