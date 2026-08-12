const AUTOMATIC_EVENTS = new Set([
  'session_start',
  'page_view',
  'page_exit',
  'product_view',
  'scroll_depth',
  'image_view',
]);

const SHORT_WINDOW_EVENTS = new Set([
  'category_view',
  'product_click',
  'search',
  'add_to_cart',
  'cart_opened',
  'cart_item_removed',
  'quantity_changed',
  'checkout_clicked',
  'checkout_loaded',
  'delivery_location_entered',
  'delivery_quote_shown',
  'delivery_option_selected',
  'customer_details_started',
  'customer_details_completed',
  'payment_clicked',
  'payfast_redirected',
  'payment_success',
  'payment_failed',
  'purchase_complete',
  'remove_from_cart',
  'begin_checkout',
  'checkout_step',
  'payment_started',
  'payment_attempt',
  'purchase',
  'section_open',
]);

const safePart = (value) => String(value ?? '').trim().slice(0, 240);

export const createAnalyticsEventDedupeKey = ({
  sessionId,
  eventName,
  pagePath,
  productId,
  eventValue,
  pageLoadId,
  interactionId,
  nowMs = Date.now(),
} = {}) => {
  const base = [
    safePart(sessionId),
    safePart(eventName),
    safePart(pagePath),
    safePart(productId),
    safePart(eventValue),
  ];

  if (interactionId) {
    // The browser creates one interaction ID for one click/change. Retries with
    // that ID collapse, while two intentional rapid clicks remain countable.
    return [...base, 'interaction', safePart(interactionId)].join('|');
  }

  if (eventName === 'session_start') {
    return [...base, 'session'].join('|');
  }

  if (AUTOMATIC_EVENTS.has(eventName)) {
    // A real reload/navigation creates a new pageLoadId, while StrictMode and
    // duplicate effects reuse the same value and therefore collapse safely.
    const load = safePart(pageLoadId) || `legacy-${Math.floor(nowMs / 10000)}`;
    return [...base, load].join('|');
  }

  if (SHORT_WINDOW_EVENTS.has(eventName)) {
    // Suppress only near-simultaneous duplicate actions. A later intentional
    // repeat receives a different two-second bucket.
    return [...base, safePart(pageLoadId), Math.floor(nowMs / 2000)].join('|');
  }

  return null;
};
