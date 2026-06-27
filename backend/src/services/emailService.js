import nodemailer from 'nodemailer';
import { buildTrackingPageUrl } from './trackingLinks.js';

// Email service using GoDaddy SMTP
// Add these to your .env file:
// EMAIL_HOST=smtpout.secureserver.net
// EMAIL_PORT=465
// EMAIL_USER=your-email@yourdomain.com
// EMAIL_PASS=your-email-password
// EMAIL_FROM=SnuggleUp <support@snuggleup.co.za>

const createTransporter = () => {
  const host = process.env.EMAIL_HOST || 'smtpout.secureserver.net';
  const port = parseInt(process.env.EMAIL_PORT || '465');
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    console.warn('⚠️ Email credentials not configured. Set EMAIL_USER and EMAIL_PASS in .env');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
    // GoDaddy specific settings
    tls: {
      rejectUnauthorized: false // GoDaddy sometimes needs this
    }
  });
};

const getFromAddress = () => (
  process.env.EMAIL_FROM ||
  'SnuggleUp <support@snuggleup.co.za>'
);

const getLogoUrl = () => {
  const explicit = process.env.SNUGGLEUP_LOGO_URL;
  if (explicit) return explicit;
  const frontendBase = (
    process.env.FRONTEND_URL ||
    process.env.SITE_URL ||
    'https://snuggleup.co.za'
  ).replace(/\/+$/g, '');
  return `${frontendBase}/images/SnuggleUp%20Logo%20-%20Smaller.png`;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const trackingStatusText = (status) => {
  switch (String(status || '').toLowerCase()) {
    case 'created': return 'Created';
    case 'pending-collection': return 'Waiting for collection';
    case 'collected': return 'Collected';
    case 'in-transit': return 'In transit';
    case 'out-for-delivery': return 'Out for delivery';
    case 'delivered': return 'Delivered';
    case 'exception':
    case 'failed':
    case 'failed-will-retry': return 'Needs attention';
    default: return status ? String(status).replace(/-/g, ' ') : 'Shipment update';
  }
};

export const trackingStepKey = (status, orderStatus) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'delivered' || orderStatus === 'completed') return 'delivered';
  if (normalized === 'out-for-delivery') return 'out-for-delivery';
  if (normalized === 'in-transit') return 'in-transit';
  if (normalized === 'collected') return 'collected';
  if (normalized === 'created') return 'created';
  if (normalized === 'pending-collection') return 'created';
  if (orderStatus === 'paid') return 'payment-confirmed';
  return 'order-placed';
};

const latestTrackingEvent = (events) => {
  const safeEvents = Array.isArray(events) ? events : [];
  return safeEvents
    .filter(event => event && typeof event === 'object')
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.time || '');
      const bTime = Date.parse(b.time || '');
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) return bTime - aTime;
      if (Number.isFinite(aTime)) return -1;
      if (Number.isFinite(bTime)) return 1;
      return 0;
    })[0] || null;
};

export const sendTrackingUpdateEmail = async ({ to, order }) => {
  const transporter = createTransporter();

  if (!transporter) {
    console.warn('Email not sent - transporter not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const orderNumber = order?.order_number;
  const email = to || order?.customer_email;
  const trackingRef = order?.bob_tracking_reference || order?.cj_tracking_number || '';
  const trackingStatus = order?.bob_tracking_status || order?.cj_status || '';
  const statusText = trackingStatusText(trackingStatus);
  const trackingLink = buildTrackingPageUrl({ orderNumber, email });
  const logoUrl = getLogoUrl();
  const event = latestTrackingEvent(order?.bob_tracking_events);
  const eventDescription = event?.description || event?.location || statusText;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #f7fbfa; font-family: Arial, sans-serif; color: #1f2933; }
    .container { max-width: 640px; margin: 0 auto; padding: 28px 16px; }
    .card { background: #ffffff; border: 1px solid #dbe8e4; border-radius: 10px; overflow: hidden; }
    .header { text-align: center; padding: 28px 28px 18px; }
    .logo { max-width: 230px; width: 70%; height: auto; }
    .content { padding: 0 32px 32px; }
    h1 { color: #126f71; font-size: 24px; margin: 10px 0 8px; text-align: center; }
    p { line-height: 1.55; font-size: 15px; }
    .status-box { background: #f7fbfa; border: 1px solid #dbe8e4; border-radius: 8px; padding: 18px; margin: 22px 0; }
    .label { color: #5f6f73; font-size: 13px; margin: 0 0 4px; }
    .value { color: #126f71; font-size: 20px; font-weight: 700; margin: 0; }
    .meta { margin: 12px 0 0; color: #42575b; font-size: 14px; }
    .button-wrap { text-align: center; margin: 26px 0 10px; }
    .button { display: inline-block; background: #126f71; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 999px; font-weight: 700; }
    .footer { color: #6b777a; font-size: 12px; text-align: center; padding: 18px 22px 26px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <img class="logo" src="${escapeHtml(logoUrl)}" alt="SnuggleUp Baby Store">
      </div>
      <div class="content">
        <h1>Your delivery update</h1>
        <p>Hi there,</p>
        <p>Your SnuggleUp order has a new delivery update.</p>
        <div class="status-box">
          <p class="label">Order number</p>
          <p class="value">${escapeHtml(orderNumber)}</p>
          <p class="label" style="margin-top: 16px;">Current status</p>
          <p class="value">${escapeHtml(statusText)}</p>
          ${trackingRef ? `<p class="meta">Tracking ref: ${escapeHtml(trackingRef)}</p>` : ''}
          ${eventDescription ? `<p class="meta">${escapeHtml(eventDescription)}</p>` : ''}
        </div>
        <p>You can follow the full delivery journey on SnuggleUp using the button below.</p>
        <div class="button-wrap">
          <a class="button" href="${escapeHtml(trackingLink)}">Track my parcel</a>
        </div>
      </div>
      <div class="footer">
        <p>Sent by SnuggleUp Baby Store. Need help? Email support@snuggleup.co.za.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const textContent = `
Your SnuggleUp delivery update

Order number: ${orderNumber}
Current status: ${statusText}
${trackingRef ? `Tracking ref: ${trackingRef}\n` : ''}
Track your parcel here: ${trackingLink}

Need help? Email support@snuggleup.co.za.
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      replyTo: 'support@snuggleup.co.za',
      to: email,
      subject: `Delivery update for SnuggleUp order ${orderNumber}`,
      text: textContent,
      html: htmlContent,
    });

    console.log(`Tracking update email sent to ${email}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send tracking update email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send tracking notification email to customer
 * @param {Object} options - Email options
 * @param {string} options.to - Customer email address
 * @param {string} options.orderNumber - Order number (e.g., ORDER-1234567890)
 * @param {string} options.trackingNumber - CJ tracking number
 * @param {string} [options.trackingUrl] - Optional tracking URL
 */
export const sendTrackingEmail = async ({ to, orderNumber, trackingNumber, trackingUrl }) => {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.warn('⚠️ Email not sent - transporter not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const fromAddress = getFromAddress();

  const trackingLink = trackingUrl || `https://www.google.com/search?q=${encodeURIComponent(trackingNumber)}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .info-box { background: white; padding: 20px; margin: 20px 0; border-radius: 6px; border-left: 4px solid #667eea; }
    .info-box strong { color: #667eea; }
    .tracking-button { display: inline-block; background: #667eea; color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
    .tracking-button:hover { background: #5568d3; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .highlight { background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📦 Your Order Has Shipped!</h1>
    </div>
    <div class="content">
      <p>Hi there,</p>
      <p>Great news! Your SnuggleUp order is on its way to you.</p>
      
      <div class="info-box">
        <p><strong>Order Number:</strong> <span class="highlight">${orderNumber}</span></p>
        <p><strong>Tracking Number:</strong> <span class="highlight">${trackingNumber}</span></p>
      </div>

      <p>You can track your shipment using the button below:</p>
      
      <div style="text-align: center;">
        <a href="${trackingLink}" class="tracking-button">Track Your Shipment</a>
      </div>

      <p><strong>What happens next?</strong></p>
      <ul>
        <li>Your package is now in transit</li>
        <li>Delivery typically takes 7-21 business days</li>
        <li>You'll receive your items soon!</li>
      </ul>

      <p>If you have any questions about your order, please don't hesitate to reach out to our support team.</p>
      
      <p>Thank you for shopping with SnuggleUp! 🍼</p>
    </div>
    <div class="footer">
      <p>SnuggleUp - Premium Baby Products</p>
      <p>This is an automated message, please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const textContent = `
Your Order Has Shipped!

Hi there,

Great news! Your SnuggleUp order is on its way to you.

Order Number: ${orderNumber}
Tracking Number: ${trackingNumber}

Track your shipment here: ${trackingLink}

What happens next?
- Your package is now in transit
- Delivery typically takes 7-21 business days
- You'll receive your items soon!

Thank you for shopping with SnuggleUp!

---
SnuggleUp - Premium Baby Products
This is an automated message, please do not reply to this email.
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      replyTo: 'support@snuggleup.co.za',
      to,
      subject: `📦 Your SnuggleUp Order ${orderNumber} Has Shipped!`,
      text: textContent,
      html: htmlContent,
    });

    console.log(`✅ Tracking email sent to ${to}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send tracking email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send order confirmation email
 * @param {Object} options - Email options
 * @param {string} options.to - Customer email address
 * @param {string} options.orderNumber - Order number
 * @param {number} options.totalAmount - Total order amount in ZAR
 * @param {Array} options.items - Order items
 * @param {string} [options.customerName] - Customer name for personalized greeting
 */
export const sendOrderConfirmationEmail = async ({ to, orderNumber, totalAmount, items, customerName }) => {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.warn('⚠️ Email not sent - transporter not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const fromAddress = getFromAddress();

  const itemsList = items.map(item => 
    `<li>${item.name} - R ${Number(item.price).toFixed(2)} x ${item.quantity}</li>`
  ).join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .info-box { background: white; padding: 20px; margin: 20px 0; border-radius: 6px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Order Confirmed!</h1>
    </div>
    <div class="content">
      <p>Hi ${customerName ? customerName + ',' : 'there,'}</p>
      <p>Thank you for your order! We've received your payment and are processing your order.</p>
      
      <div class="info-box">
        <p><strong>Order Number:</strong> ${orderNumber}</p>
        <p><strong>Total:</strong> R ${Number(totalAmount).toFixed(2)}</p>
        
        <p><strong>Items Ordered:</strong></p>
        <ul>${itemsList}</ul>
      </div>

      <p>We'll send you another email with tracking information once your order ships.</p>
      
      <p>Thank you for choosing SnuggleUp! 🍼</p>
    </div>
    <div class="footer">
      <p>SnuggleUp - Premium Baby Products</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      replyTo: 'support@snuggleup.co.za',
      to,
      subject: `Order Confirmation - ${orderNumber}`,
      html: htmlContent,
    });

    console.log(`✅ Order confirmation sent to ${to}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send order confirmation:', error);
    return { success: false, error: error.message };
  }
};
