import crypto from 'crypto';

export const ADMIN_DEVICE_COOKIE = 'snuggleup_admin_device';
export const ADMIN_DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const createAdminDeviceToken = () => crypto.randomBytes(32).toString('base64url');

export const hashAdminDeviceToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''), 'utf8')
  .digest('hex');

export const readCookie = (cookieHeader, name) => {
  const target = `${name}=`;
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(target))
    ?.slice(target.length) || '';
};

export const adminDeviceCookieHeader = (token, { production = false, clear = false } = {}) => {
  const value = clear ? '' : encodeURIComponent(token);
  const maxAge = clear ? 0 : ADMIN_DEVICE_MAX_AGE_SECONDS;
  const sameSite = production ? 'None' : 'Lax';
  return [
    `${ADMIN_DEVICE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`,
    production ? 'Secure' : '',
  ].filter(Boolean).join('; ');
};

