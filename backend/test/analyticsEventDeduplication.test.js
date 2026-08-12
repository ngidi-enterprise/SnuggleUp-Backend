import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsEventDedupeKey } from '../src/services/analyticsEventDeduplication.js';

const event = {
  sessionId: 'session-1',
  eventName: 'product_view',
  pagePath: '/local-products/66',
  productId: '66',
  pageLoadId: 'load-1',
};

test('same product event in the same page load has the same dedupe key', () => {
  assert.equal(
    createAnalyticsEventDedupeKey(event),
    createAnalyticsEventDedupeKey(event)
  );
});

test('page views collapse within one load but remain countable after reload', () => {
  const pageView = {
    sessionId: 'session-1',
    eventName: 'page_view',
    pagePath: '/local-products/66',
    pageLoadId: 'load-1',
  };
  assert.equal(
    createAnalyticsEventDedupeKey(pageView),
    createAnalyticsEventDedupeKey(pageView)
  );
  assert.notEqual(
    createAnalyticsEventDedupeKey(pageView),
    createAnalyticsEventDedupeKey({ ...pageView, pageLoadId: 'reload-1' })
  );
});

test('a genuine reload receives a different product-view dedupe key', () => {
  assert.notEqual(
    createAnalyticsEventDedupeKey(event),
    createAnalyticsEventDedupeKey({ ...event, pageLoadId: 'load-2' })
  );
});

test('different scroll thresholds are retained', () => {
  assert.notEqual(
    createAnalyticsEventDedupeKey({ ...event, eventName: 'scroll_depth', eventValue: 25 }),
    createAnalyticsEventDedupeKey({ ...event, eventName: 'scroll_depth', eventValue: 50 })
  );
});

test('the same scroll threshold in one page load is deduplicated', () => {
  const scroll = { ...event, eventName: 'scroll_depth', eventValue: 75 };
  assert.equal(
    createAnalyticsEventDedupeKey(scroll),
    createAnalyticsEventDedupeKey(scroll)
  );
});

test('rapid duplicate actions share a key but later actions do not', () => {
  const action = { ...event, eventName: 'add_to_cart' };
  assert.equal(
    createAnalyticsEventDedupeKey({ ...action, nowMs: 1000 }),
    createAnalyticsEventDedupeKey({ ...action, nowMs: 1500 })
  );
  assert.notEqual(
    createAnalyticsEventDedupeKey({ ...action, nowMs: 1000 }),
    createAnalyticsEventDedupeKey({ ...action, nowMs: 4000 })
  );
});

test('one checkout interaction is deduplicated even when retried later', () => {
  const checkout = {
    ...event,
    eventName: 'checkout_clicked',
    interactionId: 'checkout-click-1',
  };
  assert.equal(
    createAnalyticsEventDedupeKey({ ...checkout, nowMs: 1000 }),
    createAnalyticsEventDedupeKey({ ...checkout, nowMs: 9000 })
  );
});

test('separate rapid quantity changes remain countable', () => {
  const quantity = { ...event, eventName: 'quantity_changed' };
  assert.notEqual(
    createAnalyticsEventDedupeKey({ ...quantity, interactionId: 'plus-1', nowMs: 1000 }),
    createAnalyticsEventDedupeKey({ ...quantity, interactionId: 'plus-2', nowMs: 1001 })
  );
});
