import express from 'express';
import fetch from 'node-fetch';

export const router = express.Router();

const ECONOMY_FLAT_RATE_ZAR = 100;

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

  // The checkout only offers a flat Economy option or a Bob Go live door quote.
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
    label: [courier, service].filter(Boolean).join(' - ') || `Bob Go rate ${index + 1}`,
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
    error: 'Bob Go order and shipment operations are disabled',
    details: 'This store is configured to fetch Bob Go rates only. Set BOB_ENABLE_MUTATIONS=true when you are ready to enable Bob Go order, shipment, or tracking operations.',
  });
};

const blockRawBobRateProxyUnlessEnabled = (req, res, next) => {
  if (rawBobRateProxyEnabled()) return next();
  return res.status(403).json({
    error: 'Raw Bob Go rate proxy is disabled',
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
    collectionAddressConfigured: missingCollectionAddressConfig().length === 0,
    missingCollectionVariables: missingCollectionAddressConfig(),
  });
});

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
      return res.status(400).json({ error: 'A valid South African postal code is required for Bob Go live rates' });
    }

    const missingCollectionVariables = missingCollectionAddressConfig();
    if (missingCollectionVariables.length > 0) {
      return res.status(503).json({
        error: 'Bob Go collection address is incomplete',
        details: 'Add the missing Bob Go collection address variables to the backend service before requesting rates.',
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
        'Bob Go did not return a rate for this address'
      );
      return res.status(result.status).json({
        error: 'Bob Go rate request failed',
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
        label: 'Economy delivery',
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
      error: 'Bob Go rates failed',
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
