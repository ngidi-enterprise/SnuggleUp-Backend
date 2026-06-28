import fetch from 'node-fetch';
import { trackingStatusText } from './emailService.js';
import { buildTrackingPageUrl } from './trackingLinks.js';

const DEFAULT_SMS_STATUSES = [
  'collected',
  'out-for-delivery',
  'delivered',
  'exception',
  'failed',
  'failed-will-retry',
];

const envFlagIsFalse = (value) => ['false', '0', 'no', 'off'].includes(String(value || '').trim().toLowerCase());

const winsmsEnabled = () => {
  const apiKey = process.env.WINSMS_API_KEY;
  return Boolean(apiKey) && !envFlagIsFalse(process.env.WINSMS_ENABLED);
};

const winsmsBaseUrl = () => (
  process.env.WINSMS_API_BASE ||
  'https://api.winsms.co.za/api/rest/v1'
).replace(/\/+$/g, '');

const configuredSmsStatuses = () => {
  const raw = process.env.WINSMS_SEND_STATUSES;
  if (!raw) return new Set(DEFAULT_SMS_STATUSES);

  return new Set(
    raw
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  );
};

const smsMaxSegments = () => {
  const parsed = Number.parseInt(process.env.WINSMS_MAX_SEGMENTS || '1', 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 6);
};

export const normalizeSaPhoneForWinSms = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('27') && digits.length === 11) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `27${digits.slice(1)}`;
  if (digits.length === 9) return `27${digits}`;

  return digits;
};

export const shouldSendTrackingSms = ({ order, currentStep }) => {
  if (!winsmsEnabled()) {
    return { send: false, reason: 'WinSMS not configured' };
  }

  if (!order?.sms_tracking_opt_in) {
    return { send: false, reason: 'customer did not opt in to SMS tracking' };
  }

  const statusKey = String(currentStep || '').toLowerCase();
  if (!configuredSmsStatuses().has(statusKey)) {
    return { send: false, reason: `SMS disabled for ${statusKey || 'unknown'} status` };
  }

  const mobileNumber = normalizeSaPhoneForWinSms(order.sms_tracking_phone || order.shipping_phone);
  if (!mobileNumber) {
    return { send: false, reason: 'missing SMS phone number' };
  }

  return { send: true, mobileNumber };
};

const smsFitsOneSegment = (message) => message.length <= 160;

const firstNameFromOrder = (order) => {
  const firstName = String(order?.customer_name || '')
    .trim()
    .split(/\s+/)[0] || '';

  return firstName
    .replace(/[^a-zA-Z'-]/g, '')
    .slice(0, 18);
};

const buildTrackingSmsMessage = ({ order, currentStep }) => {
  const statusText = trackingStatusText(currentStep).toLowerCase();
  const trackingLink = buildTrackingPageUrl({
    orderNumber: order?.order_number,
    email: order?.customer_email,
  });
  const firstName = firstNameFromOrder(order);
  const trackingRef = order?.bob_tracking_reference || order?.cj_tracking_number || '';
  const refText = trackingRef ? ` (Ref: ${trackingRef})` : '';
  const namedMessage = firstName
    ? `Hi ${firstName}, your SnuggleUp order is ${statusText}${refText}. Track at ${trackingLink}`
    : '';
  const noNameMessage = `Your SnuggleUp order is ${statusText}${refText}. Track at ${trackingLink}`;
  const noRefMessage = firstName
    ? `Hi ${firstName}, your SnuggleUp order is ${statusText}. Track at ${trackingLink}`
    : `Your SnuggleUp order is ${statusText}. Track at ${trackingLink}`;

  if (namedMessage && smsFitsOneSegment(namedMessage)) return namedMessage;
  if (smsFitsOneSegment(noNameMessage)) return noNameMessage;
  if (smsFitsOneSegment(noRefMessage)) return noRefMessage;

  return `SnuggleUp update: ${statusText}. Track at ${trackingLink}`;
};

export const sendTrackingSms = async ({ order, currentStep }) => {
  const decision = shouldSendTrackingSms({ order, currentStep });
  if (!decision.send) {
    return { success: false, skipped: true, reason: decision.reason };
  }

  const message = buildTrackingSmsMessage({ order, currentStep });
  const clientMessageId = `snug-${order?.id || Date.now()}-${String(currentStep || 'update').slice(0, 12)}`;

  try {
    const response = await fetch(`${winsmsBaseUrl()}/sms/outgoing/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AUTHORIZATION: process.env.WINSMS_API_KEY,
      },
      body: JSON.stringify({
        message,
        recipients: [
          {
            mobileNumber: decision.mobileNumber,
            clientMessageId,
          },
        ],
        maxSegments: smsMaxSegments(),
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = body?.message || body?.error || `WinSMS HTTP ${response.status}`;
      return { success: false, error };
    }

    const recipient = Array.isArray(body?.recipients) ? body.recipients[0] : null;
    if (recipient && recipient.accepted === false) {
      return {
        success: false,
        error: recipient.acceptError || 'WinSMS rejected recipient',
        response: body,
      };
    }

    return {
      success: true,
      messageId: recipient?.apiMessageId || body?.apiMessageId || clientMessageId,
      creditCost: recipient?.creditCost,
      newCreditBalance: body?.newCreditBalance,
      mobileNumber: decision.mobileNumber,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
