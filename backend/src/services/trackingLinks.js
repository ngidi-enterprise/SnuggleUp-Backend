import crypto from 'crypto';

const base64Url = (value) => Buffer.from(value)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const getTrackingSecret = () => (
  process.env.TRACKING_LINK_SECRET ||
  process.env.JWT_SECRET ||
  process.env.SUPABASE_JWT_SECRET ||
  'snuggleup-dev-tracking-link-secret'
);

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

export const createTrackingToken = ({ orderNumber, email, bytes = 32 }) => {
  const payload = `${String(orderNumber || '').trim()}|${normaliseEmail(email)}`;
  const digest = crypto
    .createHmac('sha256', getTrackingSecret())
    .update(payload)
    .digest();
  return base64Url(digest.subarray(0, bytes));
};

const safeTokenCompare = (expected, received) => {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const verifyTrackingToken = ({ orderNumber, email, token }) => {
  const received = String(token || '').trim();
  const expectedFull = createTrackingToken({ orderNumber, email });
  const expectedShort = createTrackingToken({ orderNumber, email, bytes: 16 });

  return safeTokenCompare(expectedFull, received) || safeTokenCompare(expectedShort, received);
};

export const buildTrackingPageUrl = ({ orderNumber, email }) => {
  const frontendBase = (
    process.env.FRONTEND_URL ||
    process.env.SITE_URL ||
    'https://snuggleup.co.za'
  ).replace(/\/+$/g, '');
  const token = createTrackingToken({ orderNumber, email, bytes: 16 });
  return `${frontendBase}/#/t?o=${encodeURIComponent(orderNumber || '')}&t=${encodeURIComponent(token)}`;
};
