import nodemailer from 'nodemailer';

const createTransporter = () => {
  const host = process.env.EMAIL_HOST || 'smtpout.secureserver.net';
  const port = parseInt(process.env.EMAIL_PORT || '465', 10);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    console.warn('Email credentials not configured. Set EMAIL_USER and EMAIL_PASS.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
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

const normalizeItems = (items) => {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const sendBrandedOrderConfirmationEmail = async ({
  to,
  orderNumber,
  totalAmount,
  items,
  customerName,
}) => {
  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured' };
  }

  const safeItems = normalizeItems(items);
  const greetingName = String(customerName || '').trim();
  const logoUrl = getLogoUrl();
  const totalText = `R${Number(totalAmount || 0).toFixed(2)}`;

  const itemsHtml = safeItems.length > 0
    ? safeItems.map(item => {
      const qty = Number(item.quantity || 1);
      const price = Number(item.price || 0);
      const lineTotal = price * qty;
      return `
        <tr>
          <td class="item-name">
            ${escapeHtml(item.name || 'SnuggleUp item')}
            ${item.variantName ? `<span>${escapeHtml(item.variantName)}</span>` : ''}
          </td>
          <td class="item-qty">${qty}</td>
          <td class="item-price">R${lineTotal.toFixed(2)}</td>
        </tr>
      `.trim();
    }).join('')
    : `
      <tr>
        <td class="item-name" colspan="3">Your order items are being prepared.</td>
      </tr>
    `.trim();

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
    .header { text-align: center; padding: 28px 28px 12px; }
    .logo { max-width: 230px; width: 70%; height: auto; }
    .content { padding: 0 32px 32px; }
    h1 { color: #126f71; font-size: 24px; margin: 12px 0 8px; text-align: center; }
    p { line-height: 1.55; font-size: 15px; }
    .summary-box { background: #f7fbfa; border: 1px solid #dbe8e4; border-radius: 8px; padding: 18px; margin: 22px 0; }
    .label { color: #5f6f73; font-size: 13px; margin: 0 0 4px; }
    .value { color: #126f71; font-size: 20px; font-weight: 700; margin: 0; word-break: break-word; }
    .items-title { color: #1f2933; font-size: 16px; font-weight: 700; margin: 22px 0 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { color: #5f6f73; font-size: 12px; text-align: left; padding: 10px 0; border-bottom: 1px solid #dbe8e4; }
    td { padding: 12px 0; border-bottom: 1px solid #edf3f1; vertical-align: top; font-size: 14px; }
    .item-name { color: #1f2933; font-weight: 700; }
    .item-name span { display: block; color: #6b777a; font-size: 12px; font-weight: 400; margin-top: 3px; }
    .item-qty { text-align: center; color: #42575b; width: 58px; }
    .item-price { text-align: right; color: #126f71; font-weight: 700; width: 96px; }
    .next-box { background: #fffdf3; border-left: 4px solid #ffd91f; border-radius: 8px; padding: 14px 16px; margin: 22px 0; }
    .next-box p { margin: 0; color: #42575b; }
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
        <h1>Your order is confirmed</h1>
        <p>Hi ${escapeHtml(greetingName || 'there')},</p>
        <p>Thank you for your order. We have received your payment and your SnuggleUp order is now being prepared.</p>

        <div class="summary-box">
          <p class="label">Order number</p>
          <p class="value">${escapeHtml(orderNumber)}</p>
          <p class="label" style="margin-top: 16px;">Order total</p>
          <p class="value">${escapeHtml(totalText)}</p>
        </div>

        <p class="items-title">Items ordered</p>
        <table role="presentation">
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="next-box">
          <p>We will send tracking updates as soon as your delivery starts moving.</p>
        </div>

        <p>If you need help with this order, reply to this email or contact support@snuggleup.co.za.</p>
      </div>
      <div class="footer">
        <p>Sent by SnuggleUp Baby Store.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const itemsText = safeItems.length > 0
    ? safeItems.map(item => {
      const qty = Number(item.quantity || 1);
      const lineTotal = Number(item.price || 0) * qty;
      return `- ${item.name || 'SnuggleUp item'} x ${qty}: R${lineTotal.toFixed(2)}`;
    }).join('\n')
    : '- Your order items are being prepared.';

  const textContent = `
Your SnuggleUp order is confirmed

Hi ${greetingName || 'there'},

Thank you for your order. We have received your payment and your SnuggleUp order is now being prepared.

Order number: ${orderNumber}
Order total: ${totalText}

Items ordered:
${itemsText}

We will send tracking updates as soon as your delivery starts moving.

Need help? Email support@snuggleup.co.za.
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      replyTo: 'support@snuggleup.co.za',
      to,
      subject: `Your SnuggleUp order is confirmed - ${orderNumber}`,
      text: textContent,
      html: htmlContent,
    });

    console.log(`Order confirmation sent to ${to}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send order confirmation:', error);
    return { success: false, error: error.message };
  }
};
