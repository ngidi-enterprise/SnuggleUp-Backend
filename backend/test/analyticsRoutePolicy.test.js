import test from 'node:test';
import assert from 'node:assert/strict';
import { isManagementAnalyticsPath } from '../src/services/analyticsRoutePolicy.js';

test('protected management and superuser routes are excluded', () => {
  [
    '/admin',
    '/admin/products',
    '/superuser',
    '/superuser/settings',
    '/login/admin',
    '/admin-login',
    '/management/orders',
  ].forEach((path) => assert.equal(isManagementAnalyticsPath(path), true, path));
});

test('public storefront and normal customer login routes remain trackable', () => {
  [
    '/',
    '/products/66',
    '/local-products/66',
    '/login',
    '/products/admin-chair',
  ].forEach((path) => assert.equal(isManagementAnalyticsPath(path), false, path));
});
