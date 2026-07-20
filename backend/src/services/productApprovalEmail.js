import nodemailer from 'nodemailer';

const SUPERUSER_EMAIL = 'support@snuggleup.co.za';

const createTransporter = () => {
  const host = process.env.EMAIL_HOST || 'smtpout.secureserver.net';
  const port = parseInt(process.env.EMAIL_PORT || '465', 10);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
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

const adminUrl = () => {
  const frontendBase = (
    process.env.FRONTEND_URL ||
    process.env.SITE_URL ||
    'https://snuggleup.co.za'
  ).replace(/\/+$/g, '');
  return `${frontendBase}/#/admin`;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const sendProductUploadReviewEmail = async ({ product, submittedBy }) => {
  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, skipped: true, reason: 'Email service not configured' };
  }

  const to = (process.env.PRODUCT_REVIEW_EMAIL || SUPERUSER_EMAIL).trim();
  const logoUrl = getLogoUrl();
  const reviewUrl = adminUrl();
  const productName = product?.name || 'New product';
  const submittedByEmail = submittedBy || product?.submitted_by_email || 'Product assistant';

  const html = `
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
    .summary { background: #f7fbfa; border: 1px solid #dbe8e4; border-radius: 8px; padding: 18px; margin: 22px 0; }
    .label { color: #5f6f73; font-size: 13px; margin: 0 0 4px; }
    .value { color: #126f71; font-size: 20px; font-weight: 700; margin: 0 0 14px; word-break: break-word; }
    .button-wrap { text-align: center; margin: 26px 0 8px; }
    .button { display: inline-block; background: #126f71; color: #ffffff !important; text-decoration: none; padding: 13px 28px; border-radius: 999px; font-weight: 700; }
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
        <h1>Product waiting for approval</h1>
        <p>A lower-access product admin has uploaded a product for your review. It is not live yet.</p>

        <div class="summary">
          <p class="label">Product name</p>
          <p class="value">${escapeHtml(productName)}</p>
          <p class="label">Submitted by</p>
          <p class="value">${escapeHtml(submittedByEmail)}</p>
          <p>Open Local Warehouse in your superuser dashboard, add pricing, then approve and publish when you are happy.</p>
        </div>

        <div class="button-wrap">
          <a class="button" href="${escapeHtml(reviewUrl)}">Review product</a>
        </div>
      </div>
      <div class="footer">
        <p>Product review alert sent by SnuggleUp Baby Store.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Product waiting for approval

Product: ${productName}
Submitted by: ${submittedByEmail}

Open your SnuggleUp superuser dashboard, add pricing, then approve and publish:
${reviewUrl}
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      replyTo: 'support@snuggleup.co.za',
      to,
      subject: `Product waiting for approval - ${productName}`,
      text,
      html,
    });

    return { success: true, messageId: info.messageId, to };
  } catch (error) {
    return { success: false, error: error.message, to };
  }
};
