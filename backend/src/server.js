import express from 'express';
import crypto from 'crypto';

export const router = express.Router();

// Create a payment
router.post('/create', async (req, res) => {
  try {
    const { amount, email, orderItems } = req.body;
    // Generate unique order ID
    const orderId = `ORDER_${Date.now()}`;
    // Minimal PayFast payment data - testing with only required fields
    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      amount: parseFloat(amount).toFixed(2),
      item_name: `SnuggleUp Order ${orderId}`,
      // m_payment_id: orderId, // Uncomment if you want to add this field
      // return_url: 'https://snuggleup-backend.onrender.com/api/payments/success',
      // cancel_url: 'https://snuggleup-backend.onrender.com/api/payments/cancel',
      // notify_url: 'https://snuggleup-backend.onrender.com/api/payments/notify',
    };
    // Generate signature (PayFast: include ALL posted fields except 'signature')
    const signatureData = { ...data };
    const usePassphrase = process.env.PAYFAST_MERCHANT_ID !== '10000100' && process.env.PAYFAST_PASSPHRASE;
    const signingKeys = Object.keys(signatureData)
      .filter(k => k !== 'merchant_key' && k !== 'signature' && k !== 'signature_method')
      .sort();
    const signatureString = signingKeys
      .map(key => `${key}=${encodeURIComponent(signatureData[key]).replace(/%20/g, '+')}`)
      .join('&');
    const finalString = (usePassphrase && process.env.PAYFAST_PASSPHRASE)
      ? `${signatureString}&passphrase=${encodeURIComponent(process.env.PAYFAST_PASSPHRASE)}`
      : signatureString;
    const signature = crypto.createHash('md5').update(finalString).digest('hex');
    data.signature = signature;
    // Remove merchant_key from form fields sent to PayFast
    delete data.merchant_key;
    // Extra debug
    console.log('Signing Keys:', signingKeys);
    console.log('Signature Base String:', signatureString);
    console.log('Final String Hashed:', finalString);
    // In test mode, use sandbox URL
    const payfastUrl = process.env.PAYFAST_TEST_MODE === 'true' 
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
    // Debug logging
    console.log('PayFast Data:', data);
    console.log('Signature String:', finalString);
    console.log('Generated Signature:', signature);
    // Build HTML form with hidden fields and auto-submit
    let formInputs = Object.entries(data).map(
      ([key, value]) => `<input type="hidden" name="${key}" value="${value}" />`
    ).join('\n      ');
    const html = `
      <html>
        <head><title>Redirecting to PayFast...</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>Redirecting to PayFast for payment...</h2>
          <form id="payfastForm" action="${payfastUrl}" method="POST">
            ${formInputs}
            <noscript>
              <p>Please click the button below to proceed to PayFast:</p>
              <button type="submit">Pay Now</button>
            </noscript>
          </form>
          <script>document.getElementById('payfastForm').submit();</script>
        </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).send('Payment creation failed');
  }
});

// Temporary success page endpoint
router.get('/success', (req, res) => {
  res.send(`
    <html>
      <head><title>Payment Success - SnuggleUp</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1 style="color: green;">✅ Payment Successful!</h1>
        <h2>SnuggleUp - Thank you for your order!</h2>
        <p>Your payment has been processed successfully.</p>
        <p><strong>Order ID:</strong> ${req.query.m_payment_id || 'N/A'}</p>
        <p><strong>Payment ID:</strong> ${req.query.pf_payment_id || 'N/A'}</p>
        <p>You'll receive a confirmation email shortly.</p>
        <hr>
        <p><em>This is a temporary page for testing. Frontend coming soon!</em></p>
      </body>
    </html>
  `);
});

// Temporary cancel page endpoint
router.get('/cancel', (req, res) => {
  res.send(`
    <html>
      <head><title>Payment Cancelled - SnuggleUp</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1 style="color: red;">❌ Payment Cancelled</h1>
        <h2>SnuggleUp</h2>
        <p>Your payment was cancelled or could not be processed.</p>
        <p><strong>Order ID:</strong> ${req.query.m_payment_id || 'N/A'}</p>
        <p>No charges were made to your account.</p>
        <p>Feel free to try again when you're ready!</p>
        <hr>
        <p><em>This is a temporary page for testing. Frontend coming soon!</em></p>
      </body>
    </html>
  `);
});

// Handle PayFast notification
router.post('/notify', async (req, res) => {
  try {
    console.log('PayFast notification received:', req.body);
    
    const notificationData = req.body;
    const { payment_status, m_payment_id, pf_payment_id, amount_gross } = notificationData;
    
    // Verify PayFast signature
    const receivedSignature = notificationData.signature;
    delete notificationData.signature; // Remove signature for verification
    
    const expectedSignature = generateSignature(notificationData, process.env.PAYFAST_PASSPHRASE);
    
    if (receivedSignature !== expectedSignature) {
      console.error('Invalid PayFast signature');
      return res.status(400).send('Invalid signature');
    }
    
    // Process payment based on status
    if (payment_status === 'COMPLETE') {
      console.log(`Payment completed for order ${m_payment_id}, PayFast ID: ${pf_payment_id}, Amount: R${amount_gross}`);
      
      // TODO: Update order status in database
      // TODO: Send confirmation email
      // TODO: Update inventory
      
      // For now, just log success
      console.log('Payment successfully processed');
    } else {
      console.log(`Payment failed or cancelled for order ${m_payment_id}, Status: ${payment_status}`);
    }
    
    // Always respond with OK to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Notification processing error:', error);
    res.status(500).send('Error processing notification');
  }
});

// Helper function to generate PayFast signature
function generateSignature(data, passphrase = '') {
  // Remove signature and signature_method from data for signing
  const signatureData = { ...data };
  delete signatureData.signature;
  delete signatureData.signature_method;

  // Create parameter string
  const signatureString = Object.entries(signatureData)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`)
    .join('&');

  // Add passphrase if provided
  const finalString = passphrase ? `${signatureString}&passphrase=${encodeURIComponent(passphrase)}` : signatureString;

  return crypto
    .createHash('md5')
    .update(finalString)
    .digest('hex');
}
