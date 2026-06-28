import fetch from 'node-fetch';
import { trackingStatusText } from './emailService.js';

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

const buildTrackingSmsMessage = ({ order, currentStep }) => {
  const statusText = trackingStatusText(currentStep);
  const orderNumber = order?.order_number || 'your order';
  const siteName = (process.env.SMS_TRACKING_SITE_NAME || 'snuggleup.co.za').replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
  const message = `SnuggleUp: Order ${orderNumber} is now ${statusText}. Track at ${siteName}`;

  // Keep the SMS to one segment so each update consumes one SMS credit.
  return message.length <= 160
    ? message
    : `SnuggleUp: Your order is now ${statusText}. Track at ${siteName}`;
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
        maxSegments: 1,
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
