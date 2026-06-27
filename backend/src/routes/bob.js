import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import pool from '../db.js';
import { updateOrderBobTracking } from './orders.js';
import { notifyTrackingUpdateIfNeeded } from '../services/trackingNotifications.js';

export const router = express.Router();

const ECONOMY_FLAT_RATE_ZAR = 99;

const getBobBaseUrl = () => {
  const base = process.env.BOB_API_BASE_URL || 'https://api.sandbox.bobgo.co.za/v2/';
  return base.endsWith('/') ? base : `${base}/`;
};

const getBobAuthToken = () => process.env.BOB_API_TOKEN || '';
const bobMutationsEnabled = () => process.env.BOB_ENABLE_MUTATIONS === 'true';
const rawBobRateProxyEnabled = () => process.env.BOB_ENABLE_RAW_RATE_PROXY === 'true';
const getCourierRatesPath = () => process.env.BOB_COURIER_RATES_PATH || 'rates';
const getCourierRateRequestTimeoutMs = () => Math.min(
  Math.max(Number(process.env.BOB_RATE_REQUEST_TIMEOUT_MS || 10000), 1000),
  15000
);

const buildBobUrl = (path) => {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return new URL(cleanPath, getBobBaseUrl()).toString();
};

const proxyToBob = async ({ method = 'GET', path, body, headers = {} }) => {
  const token = getBobAuthToken();
  if (!token) {
    throw new Error('Missing BOB_API_TOKEN environment variable');
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.BOB_API_TIMEOUT_MS || 20000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestOptions = {
    method,
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined && body !== null) {
    requestOptions.body = JSON.stringify(body);
  }

  let response;
  let text;
  try {
    response = await fetch(buildBobUrl(path), requestOptions);
    text = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
};

const numberFrom = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^\d.-]/g, '');
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof value === 'object') {
      const parsed = numberFrom(value.amount, value.value, value.total, value.price);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const stringFrom = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const getBobWebhookSecret = () => process.env.BOB_WEBHOOK_SECRET || '';

const safeSecretEquals = (expected, received) => {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const receivedBuffer = Buffer.from(String(received));
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const verifyBobWebhookSecret = (req) => {
  const expected = getBobWebhookSecret();
  if (!expected) return true;

  const received = stringFrom(
    req.get('x-snuggleup-webhook-secret'),
    req.get('x-webhook-secret'),
    req.get('x-bob-webhook-secret'),
    req.query?.secret,
    req.body?.secret
  );

  return safeSecretEquals(expected, received);
};

const valueAtPath = (value, path) => String(path || '').split('.').reduce((current, key) => {
  if (current === undefined || current === null) return undefined;
  if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
  return current[key];
}, value);

const firstStringAt = (value, paths = []) => stringFrom(...paths.map(path => valueAtPath(value, path)));

const uniqueStrings = (...values) => {
  const seen = new Set();
  return values
    .flat()
    .map(value => stringFrom(value).replace(/^#/, '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const parseBobWebhookPayload = (body = {}) => {
  const payload = body.payload || body.data || body.shipment || body;
  const topic = stringFrom(
    body.topic,
    body.event,
    body.type,
    body.webhook_topic,
    body.webhookTopic,
    body.webhook_subscription?.topic
  );
  return { payload, topic };
};

const normalizeTrackingEvent = (event = {}, fallback = {}) => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;

  const time = stringFrom(
    event.time,
    event.timestamp,
    event.event_time,
    event.eventTime,
    event.tracking_time,
    event.created_at,
    event.date,
    fallback.time
  );
  const status = stringFrom(
    event.status,
    event.tracking_status,
    event.shipment_status,
    event.code,
    event.event_code,
    fallback.status
  );
  const description = stringFrom(
    event.description,
    event.message,
    event.event,
    event.event_description,
    event.status_description,
    fallback.description
  );
  const location = stringFrom(
    event.location?.name,
    event.location?.city,
    event.location_name,
    event.city,
    event.hub,
    event.facility
  );

  if (!time && !status && !description && !location) return null;

  return { time, status, description, location };
};

const trackingEventsFromPayload = (payload = {}) => {
  const rawEvents = [
    payload.tracking_events,
    payload.trackingEvents,
    payload.events,
    payload.tracking?.events,
    payload.tracking_history,
    payload.trackingHistory,
    payload.history,
  ].find(Array.isArray);

  const trackingStatus = firstStringAt(payload, [
    'tracking_status',
    'shipment_status',
    'status',
    'health_status',
  ]);
  const fallbackTime = firstStringAt(payload, [
    'tracking_last_event_time',
    'time_modified',
    'updated_at',
    'delivered_date',
    'collected_date',
  ]);

  const normalized = Array.isArray(rawEvents)
    ? rawEvents.map(event => normalizeTrackingEvent(event, { status: trackingStatus })).filter(Boolean)
    : [];

  if (normalized.length > 0) return normalized;
  if (!trackingStatus) return [];

  return [{
    time: fallbackTime || new Date().toISOString(),
    status: trackingStatus,
    description: trackingStatus,
    location: '',
  }];
};

const mergeTrackingEvents = (existing = [], incoming = []) => {
  const merged = [];
  const seen = new Set();

  [...existing, ...incoming].forEach((event) => {
    const normalized = normalizeTrackingEvent(event);
    if (!normalized) return;
    const key = [
      normalized.time,
      normalized.status,
      normalized.description,
      normalized.location,
    ].join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });

  return merged.sort((a, b) => {
    const aTime = Date.parse(a.time || '');
    const bTime = Date.parse(b.time || '');
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
    if (Number.isFinite(aTime)) return -1;
    if (Number.isFinite(bTime)) return 1;
    return 0;
  });
};

const findOrderForBobWebhook = async (payload = {}) => {
  const orderCandidates = uniqueStrings(
    firstStringAt(payload, [
      'channel_order_number',
      'channelOrderNumber',
      'order_number',
      'orderNumber',
      'merchant_order_number',
      'merchantOrderNumber',
      'external_reference',
      'externalReference',
      'custom_tracking_reference',
      'customTrackingReference',
      'reference',
    ])
  );

  const trackingCandidates = uniqueStrings(
    firstStringAt(payload, [
      'tracking_reference',
      'trackingReference',
      'provider_shipment_id',
      'providerShipmentId',
      'shipment_id',
      'shipmentId',
      'id',
      'parcels.0.tracking_reference',
    ]),
    ...(Array.isArray(payload.parcels) ? payload.parcels.map(parcel => parcel?.tracking_reference) : [])
  );

  for (const candidate of orderCandidates) {
    const result = await pool.query(
      `SELECT * FROM orders WHERE LOWER(order_number) = LOWER($1) LIMIT 1`,
      [candidate]
    );
    if (result.rows[0]) return { order: result.rows[0], matchedBy: 'order_number', candidate };
  }

  for (const candidate of trackingCandidates) {
    const result = await pool.query(
      `SELECT * FROM orders
       WHERE LOWER(COALESCE(bob_tracking_reference, '')) = LOWER($1)
          OR LOWER(COALESCE(bob_shipment_id, '')) = LOWER($1)
          OR LOWER(COALESCE(cj_tracking_number, '')) = LOWER($1)
       LIMIT 1`,
      [candidate]
    );
    if (result.rows[0]) return { order: result.rows[0], matchedBy: 'tracking_reference', candidate };
  }

  return {
    order: null,
    matchedBy: null,
    candidate: null,
    orderCandidates,
    trackingCandidates,
  };
};

const bobTrackingDataFromPayload = (payload = {}, topic = '', trackingEvents = []) => {
  const trackingReference = firstStringAt(payload, [
    'tracking_reference',
    'trackingReference',
    'parcels.0.tracking_reference',
  ]);

  return {
    bobShipmentId: firstStringAt(payload, ['id', 'shipment_id', 'shipmentId', 'provider_shipment_id', 'providerShipmentId']),
    bobTrackingReference: trackingReference,
    bobTrackingUrl: firstStringAt(payload, ['tracking_url', 'trackingUrl', 'tracking_link', 'trackingLink', 'tracking.url']),
    bobCourierName: firstStringAt(payload, ['courier_name', 'courierName', 'courier.name', 'provider_name', 'providerName', 'provider_slug']),
    bobProviderSlug: firstStringAt(payload, ['provider_slug', 'providerSlug', 'provider.slug']),
    bobServiceLevel: firstStringAt(payload, [
      'service_level.name',
      'service_level.code',
      'service_level_code',
      'serviceLevel.name',
      'serviceLevel.code',
    ]),
    bobTrackingStatus: firstStringAt(payload, ['tracking_status', 'shipment_status', 'status']),
    bobHealthStatus: firstStringAt(payload, ['health_status', 'healthStatus']),
    bobHealthStatusReason: firstStringAt(payload, ['health_status_reason', 'healthStatusReason', 'failed_reason']),
    bobTrackingEvents: trackingEvents,
    bobTrackingLastEventTime: firstStringAt(payload, [
      'tracking_last_event_time',
      'time_modified',
      'updated_at',
      'delivered_date',
      'collected_date',
    ]) || trackingEvents[trackingEvents.length - 1]?.time || null,
    bobLastWebhookTopic: topic || null,
  };
};

const collectionAddressConfig = () => [
  ['BOB_COLLECTION_STREET', process.env.BOB_COLLECTION_STREET],
  ['BOB_COLLECTION_SUBURB', process.env.BOB_COLLECTION_SUBURB],
  ['BOB_COLLECTION_CITY', process.env.BOB_COLLECTION_CITY],
  ['BOB_COLLECTION_PROVINCE', process.env.BOB_COLLECTION_PROVINCE],
  ['BOB_COLLECTION_POSTAL_CODE', process.env.BOB_COLLECTION_POSTAL_CODE],
];

const missingCollectionAddressConfig = () => collectionAddressConfig()
  .filter(([, value]) => !String(value || '').trim())
  .map(([name]) => name);

const getWarehouseAddress = () => ({
  company: process.env.BOB_COLLECTION_COMPANY || 'SnuggleUp',
  street_address: process.env.BOB_COLLECTION_STREET || '',
  local_area: process.env.BOB_COLLECTION_SUBURB || '',
  city: process.env.BOB_COLLECTION_CITY || '',
  zone: process.env.BOB_COLLECTION_PROVINCE || '',
  country: process.env.BOB_COLLECTION_COUNTRY || 'ZA',
  code: process.env.BOB_COLLECTION_POSTAL_CODE || '',
});

const normalizeProvince = (province = '') => {
  const text = String(province || '').trim();
  if (!text) return 'Gauteng';
  return text;
};

const dimensionsFromItem = (item = {}) => {
  const rawDimensions = item.dimensions || item.raw?.dimensions || {};
  if (typeof rawDimensions === 'object' && !Array.isArray(rawDimensions)) return rawDimensions;

  try {
    const parsed = JSON.parse(rawDimensions);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parcelsFromCart = (items = []) => items.flatMap((item) => {
  const quantity = Math.max(Math.floor(Number(item.quantity || 1)), 1);
  const dimensions = dimensionsFromItem(item);
  const parcel = {
    description: stringFrom(item.name, item.description, 'Parcel'),
    submitted_length_cm: Math.max(numberFrom(item.length_cm, item.length, dimensions.length_cm, dimensions.length, dimensions.l), 30),
    submitted_width_cm: Math.max(numberFrom(item.width_cm, item.width, dimensions.width_cm, dimensions.width, dimensions.w), 25),
    submitted_height_cm: Math.max(numberFrom(item.height_cm, item.height, dimensions.height_cm, dimensions.height, dimensions.h), 15),
    submitted_weight_kg: Math.max(numberFrom(item.weight_kg, item.weight, item.product_weight, item.raw?.weight_kg), 0.2),
  };

  return Array.from({ length: quantity }, () => ({ ...parcel }));
});

const buildCheckoutRatesPayload = ({ items, destination, orderValue }) => {
  const deliveryAddress = {
    company: destination?.company || '',
    street_address: destination?.address || 'Customer address',
    local_area: destination?.suburb || destination?.city || 'Johannesburg',
    city: destination?.city || 'Johannesburg',
    zone: normalizeProvince(destination?.province),
    country: 'ZA',
    code: destination?.postalCode,
  };

  return {
    collection_address: getWarehouseAddress(),
    delivery_address: deliveryAddress,
    parcels: parcelsFromCart(items),
    declared_value: Math.max(numberFrom(orderValue), 1),
    timeout: getCourierRateRequestTimeoutMs(),
  };
};

const ratePrice = (rate = {}) => numberFrom(
  rate.total_price,
  rate.totalPrice,
  rate.total,
  rate.price,
  rate.rate,
  rate.rate_amount,
  rate.rate_amount_excl_vat,
  rate.amount,
  rate.charge,
  rate.cost,
  rate.value,
  rate.grand_total,
  rate.total_cost,
  rate.total_incl_vat,
  rate.total_including_vat,
  rate.total_price_including_vat,
  rate.price_incl_vat,
  rate.price_including_vat,
  rate.amount_incl_vat,
  rate.total_amount,
  rate.quoted_rate,
  rate.charged_amount,
  rate.pricing,
  rate.costs,
  rate.fees
);

const looksLikeRate = (value) => (
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  ratePrice(value) > 0
);

const collectRates = (data) => {
  const candidateLists = [];
  const visited = new Set();

  const visit = (value, depth = 0) => {
    if (!value || depth > 6 || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      const rateEntries = value.filter(looksLikeRate);
      if (rateEntries.length > 0) candidateLists.push(rateEntries);
      value.forEach(entry => visit(entry, depth + 1));
      return;
    }

    if (looksLikeRate(value)) candidateLists.push([value]);
    Object.values(value).forEach(entry => visit(entry, depth + 1));
  };

  visit(data);
  return candidateLists.sort((a, b) => b.length - a.length)[0] || [];
};

const describeResponseShape = (value, depth = 0) => {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      itemKeys: [...new Set(value.slice(0, 3).flatMap(item => (
        item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : []
      )))].slice(0, 20),
    };
  }

  if (!value || typeof value !== 'object') return { type: typeof value };

  const keys = Object.keys(value).slice(0, 30);
  const children = depth < 2
    ? Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child && typeof child === 'object')
      .slice(0, 12)
      .map(([key, child]) => [key, describeResponseShape(child, depth + 1)]))
    : undefined;

  return { type: 'object', keys, children };
};

const getRateDiagnostics = (data) => ({ responseShape: describeResponseShape(data) });

const rateRequestCandidates = (data) => [
  ...(Array.isArray(data?.rate_requests) ? data.rate_requests : []),
  ...(Array.isArray(data?.data?.rate_requests) ? data.data.rate_requests : []),
  data,
].filter((request) => request && typeof request === 'object' && !Array.isArray(request));

const providerRateRequests = (data) => rateRequestCandidates(data)
  .flatMap((request) => (
    Array.isArray(request.provider_rate_requests) ? request.provider_rate_requests : []
  ));

const rateRequestStatusSummary = (data) => rateRequestCandidates(data)
  .map((request) => ({
    id: stringFrom(request.id, request.rate_request_id),
    providers: Array.isArray(request.provider_rate_requests)
      ? request.provider_rate_requests.map((provider) => ({
        provider: stringFrom(provider.provider_slug, provider.provider_name),
        status: stringFrom(provider.status),
        responseCount: Array.isArray(provider.responses) ? provider.responses.length : 0,
      }))
      : [],
  }))
  .filter((request) => request.id || request.providers.length > 0);

const rateResponseShapeSummary = (data) => providerRateRequests(data)
  .map((provider) => ({
    provider: stringFrom(provider.provider_slug, provider.provider_name),
    responses: Array.isArray(provider.responses)
      ? provider.responses.map((response) => describeResponseShape(response))
      : [],
  }));

const hasPendingCourierRates = (data) => providerRateRequests(data)
  .some((provider) => (
    ['pending', 'processing', 'queued'].includes(String(provider?.status || '').toLowerCase())
  ));

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

const waitForCourierRates = async (initialResult) => {
  const rateRequestId = stringFrom(
    ...rateRequestCandidates(initialResult.data)
      .flatMap((request) => [request.id, request.rate_request_id])
  );
  const maxAttempts = Math.min(Math.max(Number(process.env.BOB_RATE_POLL_ATTEMPTS || 8), 1), 12);
  const intervalMs = Math.min(Math.max(Number(process.env.BOB_RATE_POLL_INTERVAL_MS || 750), 250), 5000);
  let result = initialResult;

  // Bob Go documents rate-result retrieval as GET /rates?id=<rate request id>.
  for (let attempt = 0; rateRequestId && hasPendingCourierRates(result.data) && attempt < maxAttempts; attempt += 1) {
    await wait(intervalMs);
    result = await proxyToBob({
      method: 'GET',
      path: `rates?id=${encodeURIComponent(rateRequestId)}`,
    });

    if (!result.ok) break;
  }

  return result;
};

const hasPickupPointLocation = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return Boolean(normalized) && !['0', 'null', 'undefined', 'false'].includes(normalized);
};

const detectRateType = (rate) => {
  if (hasPickupPointLocation(rate.pickup_point_location_id)) {
    return 'pickup';
  }

  const haystack = [
    rate.name,
    rate.service_name,
    rate.serviceName,
    rate.service_level?.name,
    rate.service_level?.code,
    rate.service_level?.type,
    rate.service_level?.delivery_type,
    rate.service_level_code,
    rate.serviceLevel?.name,
    rate.service?.name,
    rate.service?.code,
    rate.service_code,
    rate.product?.name,
    rate.product?.code,
    rate.courier?.name,
    rate.courier?.display_name,
    rate.courier,
    rate.courier_name,
    rate.courierName,
    rate.provider,
    rate.provider_name,
    rate.type,
    rate.service_type,
    rate.description,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(pudo|paxi|locker|pickup|pick-up|pick up|collection|counter|dropbox|drop box|drop-off|drop off|point)/.test(haystack)) {
    return 'pickup';
  }

  if (/(express|overnight|next day|next-day|same day|same-day|priority|fast|\blsx\b)/.test(haystack)) {
    return 'express';
  }

  // The checkout only offers a flat standard option or a Bob Go live door quote.
  // Any completed non-pickup courier service belongs in the live door-delivery list.
  return 'express';
};

const normalizeRate = (rate, index) => {
  const courier = stringFrom(
    rate.courier_name,
    rate.courierName,
    rate.courier?.name,
    rate.courier?.display_name,
    rate.courier,
    rate.provider_slug,
    rate.provider_name,
    rate.provider,
    rate.company,
    rate.service_provider
  );

  const service = stringFrom(
    rate.service_name,
    rate.serviceName,
    rate.name,
    rate.service_level?.name,
    rate.service_level?.code,
    rate.service_level_name,
    rate.service_level_code,
    rate.serviceLevel?.name,
    rate.service?.name,
    rate.service?.code,
    rate.product?.name,
    rate.product?.code,
    rate.service_type,
    rate.type
  );

  const priceZAR = ratePrice(rate);

  return {
    id: stringFrom(rate.id, rate.rate_id, rate.rate_response_id, rate.service_code, rate.code, `${index}`),
    courier,
    service,
    label: [courier, service].filter(Boolean).join(' - ') || `Live courier rate ${index + 1}`,
    priceZAR: Math.round(priceZAR * 100) / 100,
    deliveryEstimate: stringFrom(
      rate.delivery_estimate,
      rate.deliveryEstimate,
      rate.delivery_time,
      rate.deliveryTime,
      rate.estimated_delivery,
      rate.estimatedDelivery,
      rate.lead_time,
      rate.leadTime,
      rate.transit_time,
      rate.transitTime
    ),
    type: detectRateType(rate),
    raw: rate,
  };
};

const isCustomerFacingLiveRate = (rate) => {
  const service = String(rate.service || '').trim().toLowerCase();

  // These are service names, not prices. Bob Go supplies the live price per request.
  return [
    'local overnight flyer',
    'local same day economy',
  ].includes(service);
};

const blockBobOperationalEndpointsUnlessEnabled = (req, res, next) => {
  if (bobMutationsEnabled()) return next();
  return res.status(403).json({
    error: 'Courier order and shipment operations are disabled',
    details: 'This store is configured to fetch courier rates only.',
  });
};

const blockRawBobRateProxyUnlessEnabled = (req, res, next) => {
  if (rawBobRateProxyEnabled()) return next();
  return res.status(403).json({
    error: 'Raw courier rate proxy is disabled',
    details: 'Use /api/bob/checkout-rates for customer-facing rate requests.',
  });
};

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'bob-api',
    baseUrl: getBobBaseUrl(),
    tokenConfigured: Boolean(getBobAuthToken()),
    mutationsEnabled: bobMutationsEnabled(),
    webhookSecretConfigured: Boolean(getBobWebhookSecret()),
    collectionAddressConfigured: missingCollectionAddressConfig().length === 0,
    missingCollectionVariables: missingCollectionAddressConfig(),
  });
});

const handleBobTrackingWebhook = async (req, res) => {
  try {
    if (!verifyBobWebhookSecret(req)) {
      console.warn('[bob] rejected webhook with invalid secret');
      return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
    }

    const parsed = parseBobWebhookPayload(req.body || {});
    const payload = parsed.payload;
    const topic = parsed.topic || stringFrom(
      req.get('x-bobgo-topic'),
      req.get('x-webhook-topic'),
      req.get('x-event-topic')
    );
    const match = await findOrderForBobWebhook(payload);

    if (!match.order) {
      console.warn('[bob] tracking webhook received but no matching order was found', {
        topic,
        orderCandidates: match.orderCandidates,
        trackingCandidates: match.trackingCandidates,
      });
      return res.status(200).json({
        ok: true,
        matched: false,
        message: 'Webhook received, but no matching SnuggleUp order was found.',
      });
    }

    let existingEvents = [];
    try {
      existingEvents = Array.isArray(match.order.bob_tracking_events)
        ? match.order.bob_tracking_events
        : JSON.parse(match.order.bob_tracking_events || '[]');
    } catch {
      existingEvents = [];
    }

    const incomingEvents = trackingEventsFromPayload(payload);
    const mergedEvents = mergeTrackingEvents(existingEvents, incomingEvents);
    const updatedOrder = await updateOrderBobTracking(
      match.order.id,
      bobTrackingDataFromPayload(payload, topic, mergedEvents)
    );

    notifyTrackingUpdateIfNeeded({
      previousOrder: match.order,
      updatedOrder,
      source: 'webhook',
    }).catch((emailError) => {
      console.warn('[tracking-email] webhook notification error:', emailError.message);
    });

    console.log('[bob] tracking webhook matched order', {
      orderNumber: updatedOrder?.order_number || match.order.order_number,
      matchedBy: match.matchedBy,
      candidate: match.candidate,
      status: updatedOrder?.bob_tracking_status,
      events: mergedEvents.length,
    });

    return res.status(200).json({
      ok: true,
      matched: true,
      orderNumber: updatedOrder?.order_number || match.order.order_number,
    });
  } catch (error) {
    console.error('[bob] tracking webhook error:', error);
    return res.status(500).json({ ok: false, error: 'Failed to process Bob Go webhook' });
  }
};

router.post('/webhooks', handleBobTrackingWebhook);
router.post('/webhooks/tracking', handleBobTrackingWebhook);

// Checkout-safe rate endpoint. This only asks Bob Go for test/live rates and never
// creates Bob Go orders, shipments, waybills, bookings, or tracking records.
router.post('/checkout-rates', async (req, res) => {
  try {
    const { items = [], destination = {}, orderValue = 0 } = req.body || {};
    const postalCode = String(destination.postalCode || '').trim();

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    if (!/^\d{4}$/.test(postalCode)) {
      return res.status(400).json({ error: 'A valid South African postal code is required for live courier rates' });
    }

    const missingCollectionVariables = missingCollectionAddressConfig();
    if (missingCollectionVariables.length > 0) {
      return res.status(503).json({
        error: 'Collection address is incomplete',
        details: 'Add the missing collection address variables to the backend service before requesting rates.',
        missingCollectionVariables,
      });
    }

    const payload = buildCheckoutRatesPayload({
      items,
      destination: { ...destination, postalCode },
      orderValue,
    });

    let result = await proxyToBob({
      method: 'POST',
      path: getCourierRatesPath(),
      body: payload,
    });

    if (result.ok && hasPendingCourierRates(result.data)) {
      result = await waitForCourierRates(result);
    }

    console.log('[bob] checkout rate result', JSON.stringify({
      status: result.status,
      rateRequests: rateRequestStatusSummary(result.data),
    }));

    if (!result.ok) {
      const details = stringFrom(
        result.data?.message,
        result.data?.error,
        result.data?.detail,
        result.data?.errors?.[0]?.message,
        'No live courier rate was returned for this address'
      );
      return res.status(result.status).json({
        error: 'Live courier rate request failed',
        details,
      });
    }

    const normalized = collectRates(result.data)
      .map(normalizeRate)
      .filter(rate => rate.priceZAR > 0)
      .filter(isCustomerFacingLiveRate);

    console.log('[bob] normalized checkout rates', JSON.stringify(
      normalized.map(({ id, courier, service, priceZAR, type }) => ({ id, courier, service, priceZAR, type }))
    ));

    if (normalized.length === 0) {
      console.log('[bob] unparsed rate response shape', JSON.stringify(rateResponseShapeSummary(result.data)));
    }

    return res.status(result.status).json({
      ok: result.ok,
      economy: {
        type: 'economy',
        label: 'Standard delivery',
        priceZAR: ECONOMY_FLAT_RATE_ZAR,
        isFlatRate: true,
      },
      rates: normalized,
      expressRates: normalized.filter(rate => rate.type === 'express'),
      pickupRates: normalized.filter(rate => rate.type === 'pickup'),
      request: {
        destinationPostalCode: postalCode,
        parcelCount: payload.parcels.length,
      },
      message: normalized.length === 0
        ? stringFrom(result.data?.message, result.data?.detail) || undefined
        : undefined,
      diagnostics: normalized.length === 0 ? getRateDiagnostics(result.data) : undefined,
      bobStatus: result.status,
      raw: process.env.BOB_INCLUDE_RAW_RATES === 'true' ? result.data : undefined,
    });
  } catch (error) {
    console.error('Bob checkout rates error:', error.message);
    return res.status(error.message.includes('BOB_API_TOKEN') ? 503 : 500).json({
      error: 'Live courier rates failed',
      details: error.message,
    });
  }
});

// Generic proxy for Bob endpoints.
// Body example:
// {
//   "path": "rates",
//   "method": "POST",
//   "body": { ...your payload... }
// }
router.post('/proxy', blockBobOperationalEndpointsUnlessEnabled, async (req, res) => {
  try {
    const {
      path,
      method = 'POST',
      body,
      headers,
    } = req.body || {};

    if (!path) {
      return res.status(400).json({ error: 'path is required' });
    }

    const result = await proxyToBob({
      method,
      path,
      body,
      headers,
    });

    return res.status(result.status).json(result);
  } catch (error) {
    console.error('❌ Bob proxy error:', error.message);
    return res.status(500).json({
      error: 'Bob API proxy failed',
      details: error.message,
    });
  }
});

// Convenience routes that accept a payload directly.
// These are useful for quick testing and frontend wiring.
router.post('/rates', blockRawBobRateProxyUnlessEnabled, async (req, res) => {
  try {
    const result = await proxyToBob({
      method: 'POST',
      path: 'rates',
      body: req.body,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('❌ Bob rates error:', error.message);
    return res.status(500).json({
      error: 'Bob rates failed',
      details: error.message,
    });
  }
});

router.post('/orders', blockBobOperationalEndpointsUnlessEnabled, async (req, res) => {
  try {
    const result = await proxyToBob({
      method: 'POST',
      path: 'orders',
      body: req.body,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('❌ Bob orders error:', error.message);
    return res.status(500).json({
      error: 'Bob orders failed',
      details: error.message,
    });
  }
});

router.get('/orders/:id', blockBobOperationalEndpointsUnlessEnabled, async (req, res) => {
  try {
    const result = await proxyToBob({
      method: 'GET',
      path: `orders/${req.params.id}`,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('❌ Bob order lookup error:', error.message);
    return res.status(500).json({
      error: 'Bob order lookup failed',
      details: error.message,
    });
  }
});

router.post('/shipments', blockBobOperationalEndpointsUnlessEnabled, async (req, res) => {
  try {
    const result = await proxyToBob({
      method: 'POST',
      path: 'shipments',
      body: req.body,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('❌ Bob shipment creation error:', error.message);
    return res.status(500).json({
      error: 'Bob shipment creation failed',
      details: error.message,
    });
  }
});

router.get('/shipments/:id/tracking', blockBobOperationalEndpointsUnlessEnabled, async (req, res) => {
  try {
    const result = await proxyToBob({
      method: 'GET',
      path: `shipments/${req.params.id}/tracking`,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    console.error('❌ Bob tracking lookup error:', error.message);
    return res.status(500).json({
      error: 'Bob tracking lookup failed',
      details: error.message,
    });
  }
});
