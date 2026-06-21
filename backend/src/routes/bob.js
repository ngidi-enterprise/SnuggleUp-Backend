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

const getWarehouseAddress = () => ({
  company: process.env.BOB_COLLECTION_COMPANY || 'SnuggleUp',
  street_address: process.env.BOB_COLLECTION_STREET || 'Warehouse',
  local_area: process.env.BOB_COLLECTION_SUBURB || '',
  city: process.env.BOB_COLLECTION_CITY || 'Johannesburg',
  zone: process.env.BOB_COLLECTION_PROVINCE || 'Gauteng',
  country: process.env.BOB_COLLECTION_COUNTRY || 'ZA',
  code: process.env.BOB_COLLECTION_POSTAL_CODE || '2196',
});

const normalizeProvince = (province = '') => {
  const text = String(province || '').trim();
  if (!text) return 'Gauteng';
  return text;
};

const parcelFromItems = (items = []) => {
  const totalWeight = items.reduce((sum, item) => {
    const weight = numberFrom(item.weight_kg, item.weight, item.raw?.weight_kg);
    return sum + Math.max(weight, 0.2) * Math.max(Number(item.quantity || 1), 1);
  }, 0);

  return {
    submitted_length_cm: 30,
    submitted_width_cm: 25,
    submitted_height_cm: 15,
    submitted_weight_kg: Math.max(Math.ceil(totalWeight * 10) / 10, 0.5),
  };
};

const buildCheckoutRatesPayload = ({ items, destination, orderValue }) => {
  const deliveryAddress = {
    company: destination?.company || '',
    street_address: destination?.address || 'Customer address',
    local_area: destination?.suburb || '',
    city: destination?.city || 'Johannesburg',
    zone: normalizeProvince(destination?.province),
    country: 'ZA',
    code: destination?.postalCode,
  };

  const parcels = [parcelFromItems(items)];

  return {
    collection_address: getWarehouseAddress(),
    delivery_address: deliveryAddress,
    parcels,
    declared_value: Math.max(numberFrom(orderValue), 1),
  };
};

const collectRates = (data) => {
  const candidates = [
    data,
    data?.data,
    data?.rates,
    data?.quotes,
    data?.data?.rates,
    data?.data?.quotes,
    data?.result,
    data?.result?.rates,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
};

const detectRateType = (rate) => {
  const haystack = [
    rate.name,
    rate.service_name,
    rate.serviceName,
    rate.service_level?.name,
    rate.serviceLevel?.name,
    rate.courier,
    rate.courier_name,
    rate.courierName,
    rate.provider,
    rate.provider_name,
    rate.type,
    rate.service_type,
    rate.description,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(pudo|locker|pickup|pick-up|pick up|collection|counter|dropbox|drop box|drop-off|drop off|point)/.test(haystack)) {
    return 'pickup';
  }

  if (/(express|overnight|next day|next-day|same day|same-day|priority|fast)/.test(haystack)) {
    return 'express';
  }

  return 'standard';
};

const normalizeRate = (rate, index) => {
  const courier = stringFrom(
    rate.courier_name,
    rate.courierName,
    rate.courier,
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
    rate.serviceLevel?.name,
    rate.service_type,
    rate.type
  );

  const priceZAR = numberFrom(
    rate.total_price,
    rate.totalPrice,
    rate.total,
    rate.price,
    rate.rate,
    rate.amount,
    rate.charge,
    rate.cost,
    rate.value,
    rate.grand_total,
    rate.total_cost
  );

  return {
    id: stringFrom(rate.id, rate.rate_id, rate.service_code, rate.code, `${index}`),
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

const blockBobOperationalEndpointsUnlessEnabled = (req, res, next) => {
  if (bobMutationsEnabled()) return next();
  return res.status(403).json({
    error: 'Bob Go order and shipment operations are disabled',
    details: 'This store is configured to fetch Bob Go rates only. Set BOB_ENABLE_MUTATIONS=true when you are ready to enable Bob Go order, shipment, or tracking operations.',
  });
};

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'bob-api',
    baseUrl: getBobBaseUrl(),
    tokenConfigured: Boolean(getBobAuthToken()),
    mutationsEnabled: bobMutationsEnabled(),
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

    const payload = buildCheckoutRatesPayload({
      items,
      destination: { ...destination, postalCode },
      orderValue,
    });

    const result = await proxyToBob({
      method: 'POST',
      path: process.env.BOB_RATES_PATH || 'rates',
      body: payload,
    });

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
      .filter(rate => rate.priceZAR > 0);

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
router.post('/rates', async (req, res) => {
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
