import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_DEVICE_COOKIE,
  adminDeviceCookieHeader,
  createAdminDeviceToken,
  hashAdminDeviceToken,
  readCookie,
} from '../src/services/analyticsAdminDevice.js';
import { classifyAnalyticsTraffic, TRAFFIC_TYPES } from '../src/services/analyticsTrafficClassifier.js';

test('admin device tokens are random and only stable after hashing', () => {
  const first = createAdminDeviceToken();
  const second = createAdminDeviceToken();
  assert.notEqual(first, second);
  assert.equal(hashAdminDeviceToken(first), hashAdminDeviceToken(first));
  assert.notEqual(hashAdminDeviceToken(first), first);
});

test('production device cookie is secure, HttpOnly and cross-site compatible', () => {
  const header = adminDeviceCookieHeader('token-value', { production: true });
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=None/);
  assert.match(header, /Max-Age=31536000/);
  assert.equal(readCookie(`${ADMIN_DEVICE_COOKIE}=token-value; another=value`, ADMIN_DEVICE_COOKIE), 'token-value');
});

test('clearing the cookie expires it immediately', () => {
  const header = adminDeviceCookieHeader('', { production: true, clear: true });
  assert.match(header, /Max-Age=0/);
});

test('registered logged-out owner browser remains superuser traffic without exposing token', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    adminDevice: { id: 42 },
  }), {
    trafficType: TRAFFIC_TYPES.SUPERUSER,
    isInternalTraffic: true,
    userRole: 'superuser',
    deviceId: 'admin-device-42',
  });
});
