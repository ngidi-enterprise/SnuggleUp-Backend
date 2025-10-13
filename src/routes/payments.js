import express from 'express';
import crypto from 'crypto';

export const router = express.Router();

// Create a payment
router.post('/create', async (req, res) => {
  try {
    const { amount, email, orderItems } = req.body;
    
    // Generate unique order ID
    const orderId = `ORDER_${Date.now()}`;
    
    // PayFast payment data
    const data = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID,
      merchant_key: process.env.PAYFAST_MERCHANT_KEY,
      amount: parseFloat(amount).toFixed(2),
      item_name: `SnuggleUp Order ${orderId}`,
      item_description: `Baby essentials order with ${orderItems.length} items`,
      email_address: email,
      m_payment_id: orderId,
      return_url: 'http://localhost:5173/checkout/success',
      cancel_url: 'http://localhost:5173/checkout/cancel',
      notify_url: 'https://snuggleup-backend.onrender.com/api/payments/notify',
    };

    // Generate signature
    const signature = generateSignature(data, process.env.PAYFAST_PASSPHRASE);
    data.signature = signature;

    // In test mode, use sandbox URL
    const payfastUrl = process.env.PAYFAST_TEST_MODE === 'true' 
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';

    // Create form data for redirect
    const formData = new URLSearchParams(data).toString();

    res.json({ 
      paymentUrl: `${payfastUrl}?${formData}`,
      orderId: orderId
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: 'Payment creation failed' });
  }
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
