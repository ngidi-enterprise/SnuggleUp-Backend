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

test('existing server-classified staff audience remains internal', () => {
  assert.deepEqual(classifyAnalyticsTraffic({
    existingAudienceType: 'staff',
  }), {
    trafficType: TRAFFIC_TYPES.SUPERUSER,
    isInternalTraffic: true,
    userRole: 'product_assistant',
  });
});
