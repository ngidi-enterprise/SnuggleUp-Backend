import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAnalyticsTraffic,
  TRAFFIC_TYPES,
} from '../src/services/analyticsTrafficClassifier.js';

test('anonymous analytics traffic is classified as customer traffic', () => {
  assert.deepEqual(classifyAnalyticsTraffic(), {
    trafficType: TRAFFIC_TYPES.CUSTOMER,
    isInternalTraffic: false,
    userRole: null,
  });
});

test('authenticated superuser traffic is classified as internal superuser traffic', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    access: { role: 'superuser', isSuperuser: true },
  }), {
    trafficType: TRAFFIC_TYPES.SUPERUSER,
    isInternalTraffic: true,
    userRole: 'superuser',
  });
});

test('normal authenticated customer remains customer traffic', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    access: { role: 'customer', isSuperuser: false },
  }), {
    trafficType: TRAFFIC_TYPES.CUSTOMER,
    isInternalTraffic: false,
    userRole: 'customer',
  });
});

test('authenticated product assistant traffic remains internal', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    access: { role: 'product_assistant', isProductAssistant: true },
  }), {
    trafficType: TRAFFIC_TYPES.SUPERUSER,
    isInternalTraffic: true,
    userRole: 'product_assistant',
  });
});

test('logged-out traffic from a verified superuser browser remains internal', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    existingAudienceType: 'superuser',
  }), {
    trafficType: TRAFFIC_TYPES.SUPERUSER,
    isInternalTraffic: true,
    userRole: 'superuser',
  });
});

test('an unrecognised logged-out browser remains customer traffic', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    existingAudienceType: null,
  }), {
    trafficType: TRAFFIC_TYPES.CUSTOMER,
    isInternalTraffic: false,
    userRole: null,
  });
});
