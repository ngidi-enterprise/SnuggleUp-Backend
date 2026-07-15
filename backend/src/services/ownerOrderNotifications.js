import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import { normalizeSaPhoneForWinSms } from './winsmsService.js';

const envFlagIsFalse = (value) => ['false', '0', 'no', 'off'].includes(String(value || '').trim().toLowerCase());

const ownerEmailAddress = () => (
  process.env.OWNER_ORDER_EMAIL ||
  process.env.SNUGGLEUP_OWNER_EMAIL ||
  'support@snuggleup.co.za'
).trim();

const ownerSmsPhone = () => (
  process.env.OWNER_ORDER_SMS_PHONE ||
  process.env.SNUGGLEUP_OWNER_PHONE ||
  '0817359605'
).trim();

const ownerEmailEnabled = () => !envFlagIsFalse(process.env.OWNER_ORDER_EMAIL_ENABLED);
const ownerSmsEnabled = () => !envFlagIsFalse(process.env.OWNER_ORDER_SMS_ENABLED);

const winsmsBaseUrl = () => (
  process.env.WINSMS_API_BASE ||
  'https://api.winsms.co.za/api/rest/v1'
).replace(/\/+$/g, '');

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

const money = (value) => `R${Number(value || 0).toFixed(2)}`;

const orderAdminUrl = () => {
  const frontendBase = (
    process.env.FRONTEND_URL ||
    process.env.SITE_URL ||
    'https://snuggleup.co.za'
  ).replace(/\/+$/g, '');
  return `${frontendBase}/#/admin`;
};

const buildAddressText = (order = {}) => [
  order.shipping_address,
  order.shipping_city,
  order.shipping_province,
  order.shipping_postal_code,
].filter(Boolean).join(', ');

const buildOwnerSmsMessage = (order = {}) => {
  const orderNumber = String(order.order_number || 'new order');
  const total = money(order.total);
  const customerName = String(order.customer_name || '').trim().split(/\s+/).slice(0, 2).join(' ');
  const customerPhone = String(order.shipping_phone || '').trim();

  const withName = customerName
    ? `New SnuggleUp paid order ${orderNumber}. ${customerName}, ${total}. Check admin.`
    : '';
  const withPhone = customerPhone
    ? `New SnuggleUp paid order ${orderNumber}. ${total}. Tel ${customerPhone}.`
    : '';
  const shortMessage = `New SnuggleUp paid order ${orderNumber}. Total ${total}. Check admin.`;

  if (withName && withName.length <= 160) return withName;
  if (withPhone && withPhone.length <= 160) return withPhone;
  if (shortMessage.length <= 160) return shortMessage;

  return `New SnuggleUp paid order ${orderNumber}. ${total}.`;
};

export const sendOwnerNewOrderEmail = async ({ order }) => {
  if (!ownerEmailEnabled()) {
    return { success: false, skipped: true, reason: 'owner order email disabled' };
  }

  const to = ownerEmailAddress();
  if (!to) {
    return { success: false, skipped: true, reason: 'owner order email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured' };
  }

  const items = normalizeItems(order?.items);
  const logoUrl = getLogoUrl();
  const address = buildAddressText(order);
  const adminUrl = orderAdminUrl();
  const itemRows = items.length > 0
    ? items.map(item => {
      const qty = Number(item.quantity || 1);
      const lineTotal = Number(item.price || 0) * qty;
      return `
        <tr>
          <td>${escapeHtml(item.name || 'SnuggleUp item')}</td>
          <td style="text-align:center;">${qty}</td>
          <td style="text-align:right;">${escapeHtml(money(lineTotal))}</td>
        </tr>
      `.trim();
    }).join('')
    : '<tr><td colspan="3">No item details available.</td></tr>';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #f7fbfa; font-family: Arial, sans-serif; color: #1f2933; }
    .container { max-width: 680px; margin: 0 auto; padding: 28px 16px; }
    .card { background: #ffffff; border: 1px solid #dbe8e4; border-radius: 10px; overflow: hidden; }
    .header { text-align: center; padding: 26px 28px 10px; }
    .logo { max-width: 220px; width: 68%; height: auto; }
    .content { padding: 0 32px 32px; }
    h1 { color: #126f71; font-size: 24px; margin: 12px 0 8px; text-align: center; }
    p { line-height: 1.55; font-size: 15px; }
    .summary { background: #f7fbfa; border: 1px solid #dbe8e4; border-radius: 8px; padding: 18px; margin: 22px 0; }
    .label { color: #5f6f73; font-size: 13px; margin: 0 0 4px; }
    .value { color: #126f71; font-size: 20px; font-weight: 700; margin: 0 0 14px; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { color: #5f6f73; font-size: 12px; text-align: left; padding: 10px 0; border-bottom: 1px solid #dbe8e4; }
    td { padding: 12px 0; border-bottom: 1px solid #edf3f1; font-size: 14px; vertical-align: top; }
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
        <h1>New paid order received</h1>
        <p>A customer has completed payment. Please review the order in your admin panel before fulfilment.</p>

        <div class="summary">
          <p class="label">Order number</p>
          <p class="value">${escapeHtml(order?.order_number)}</p>
          <p class="label">Total paid</p>
          <p class="value">${escapeHtml(money(order?.total))}</p>
          <p class="label">Customer</p>
          <p class="value">${escapeHtml(order?.customer_name || 'Customer')}</p>
          <p>Email: ${escapeHtml(order?.customer_email || 'Not provided')}</p>
          ${order?.shipping_phone ? `<p>Phone: ${escapeHtml(order.shipping_phone)}</p>` : ''}
          ${address ? `<p>Delivery address: ${escapeHtml(address)}</p>` : ''}
          ${order?.shipping_method ? `<p>Delivery method: ${escapeHtml(order.shipping_method)}</p>` : ''}
        </div>

        <h2 style="font-size:16px; margin: 22px 0 8px;">Items ordered</h2>
        <table role="presentation">
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <div class="button-wrap">
          <a class="button" href="${escapeHtml(adminUrl)}">Open admin panel</a>
        </div>
      </div>
      <div class="footer">
        <p>Owner alert sent by SnuggleUp Baby Store.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
New paid SnuggleUp order

Order: ${order?.order_number}
Total: ${money(order?.total)}
Customer: ${order?.customer_name || 'Customer'}
Email: ${order?.customer_email || 'Not provided'}
${order?.shipping_phone ? `Phone: ${order.shipping_phone}\n` : ''}${address ? `Address: ${address}\n` : ''}${order?.shipping_method ? `Delivery method: ${order.shipping_method}\n` : ''}
Open admin: ${adminUrl}
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      replyTo: 'support@snuggleup.co.za',
      to,
      subject: `New paid SnuggleUp order - ${order?.order_number}`,
      text,
      html,
    });

    return { success: true, messageId: info.messageId, to };
  } catch (error) {
    return { success: false, error: error.message, to };
  }
};

export const sendOwnerLateOrderFlagEmail = async ({ order }) => {
  if (!ownerEmailEnabled()) {
    return { success: false, skipped: true, reason: 'owner order email disabled' };
  }

  const to = ownerEmailAddress();
  if (!to) {
    return { success: false, skipped: true, reason: 'owner order email missing' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    return { success: false, error: 'Email service not configured' };
  }

  const adminUrl = orderAdminUrl();
  const address = buildAddressText(order);
  const logoUrl = getLogoUrl();
  const trackingRef = order?.bob_tracking_reference || order?.cj_tracking_number || '';
  const trackingStatus = order?.bob_tracking_status || order?.cj_status || order?.status || 'Not available';
  const flaggedAt = order?.late_order_flagged_at
    ? new Date(order.late_order_flagged_at).toLocaleString('en-ZA')
    : new Date().toLocaleString('en-ZA');
  const flagCount = Number(order?.late_order_flag_count || 1);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #fff8ed; font-family: Arial, sans-serif; color: #1f2933; }
    .container { max-width: 680px; margin: 0 auto; padding: 28px 16px; }
    .card { background: #ffffff; border: 1px solid #f1d7aa; border-radius: 10px; overflow: hidden; }
    .header { text-align: center; padding: 26px 28px 8px; }
    .logo { max-width: 220px; width: 68%; height: auto; }
    .content { padding: 0 32px 32px; }
    h1 { color: #b45309; font-size: 24px; margin: 12px 0 8px; text-align: center; }
    p { line-height: 1.55; font-size: 15px; }
    .alert { background: #fff8ed; border: 1px solid #f1d7aa; border-radius: 8px; padding: 18px; margin: 22px 0; }
    .label { color: #6b5b42; font-size: 13px; margin: 0 0 4px; }
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
        <h1>Customer flagged a late order</h1>
        <p>A customer used the tracking page to report a late delivery or pickup. Please investigate and email them promptly.</p>

        <div class="alert">
          <p class="label">Order number</p>
          <p class="value">${escapeHtml(order?.order_number)}</p>
          <p class="label">Flagged at</p>
          <p class="value">${escapeHtml(flaggedAt)}</p>
          <p>Report count: ${escapeHtml(flagCount)}</p>
          <p>Customer: ${escapeHtml(order?.customer_name || 'Customer')}</p>
          <p>Email: ${escapeHtml(order?.customer_email || 'Not provided')}</p>
          ${order?.shipping_phone ? `<p>Phone: ${escapeHtml(order.shipping_phone)}</p>` : ''}
          ${address ? `<p>Delivery address: ${escapeHtml(address)}</p>` : ''}
          ${order?.shipping_method ? `<p>Delivery method: ${escapeHtml(order.shipping_method)}</p>` : ''}
          <p>Tracking status: ${escapeHtml(trackingStatus)}</p>
          ${trackingRef ? `<p>Tracking reference: ${escapeHtml(trackingRef)}</p>` : ''}
        </div>

        <div class="button-wrap">
          <a class="button" href="${escapeHtml(adminUrl)}">Open admin panel</a>
        </div>
      </div>
      <div class="footer">
        <p>Late-order alert sent by SnuggleUp Baby Store.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Customer flagged a late SnuggleUp order

Order: ${order?.order_number}
Flagged at: ${flaggedAt}
Report count: ${flagCount}
Customer: ${order?.customer_name || 'Customer'}
Email: ${order?.customer_email || 'Not provided'}
${order?.shipping_phone ? `Phone: ${order.shipping_phone}\n` : ''}${address ? `Address: ${address}\n` : ''}${order?.shipping_method ? `Delivery method: ${order.shipping_method}\n` : ''}Tracking status: ${trackingStatus}
${trackingRef ? `Tracking reference: ${trackingRef}\n` : ''}Open admin: ${adminUrl}
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      replyTo: order?.customer_email || 'support@snuggleup.co.za',
      to,
      subject: `Late order flagged - ${order?.order_number}`,
      text,
      html,
    });

    return { success: true, messageId: info.messageId, to };
  } catch (error) {
    return { success: false, error: error.message, to };
  }
};

export const sendOwnerNewOrderSms = async ({ order }) => {
  if (!ownerSmsEnabled()) {
    return { success: false, skipped: true, reason: 'owner order SMS disabled' };
  }

  if (!process.env.WINSMS_API_KEY || envFlagIsFalse(process.env.WINSMS_ENABLED)) {
    return { success: false, skipped: true, reason: 'WinSMS not configured' };
  }

  const mobileNumber = normalizeSaPhoneForWinSms(ownerSmsPhone());
  if (!mobileNumber) {
    return { success: false, skipped: true, reason: 'owner SMS phone missing' };
  }

  const message = buildOwnerSmsMessage(order);
  const clientMessageId = `owner-order-${order?.id || Date.now()}`;

  try {
    const response = await fetch(`${winsmsBaseUrl()}/sms/outgoing/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AUTHORIZATION: process.env.WINSMS_API_KEY,
      },
      body: JSON.stringify({
        message,
        recipients: [{ mobileNumber, clientMessageId }],
        maxSegments: 1,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: body?.message || body?.error || `WinSMS HTTP ${response.status}` };
    }

    const recipient = Array.isArray(body?.recipients) ? body.recipients[0] : null;
    if (recipient && recipient.accepted === false) {
      return { success: false, error: recipient.acceptError || 'WinSMS rejected recipient', response: body };
    }

    return {
      success: true,
      messageId: recipient?.apiMessageId || body?.apiMessageId || clientMessageId,
      creditCost: recipient?.creditCost,
      mobileNumber,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const notifyOwnerOfNewOrder = async ({ order, sendEmail = true, sendSms = true }) => {
  const results = {};

  if (sendEmail) {
    results.email = await sendOwnerNewOrderEmail({ order });
  } else {
    results.email = { success: false, skipped: true, reason: 'owner email already sent' };
  }

  if (sendSms) {
    results.sms = await sendOwnerNewOrderSms({ order });
  } else {
    results.sms = { success: false, skipped: true, reason: 'owner SMS already sent' };
  }

  return results;
};
