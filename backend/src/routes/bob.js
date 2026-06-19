import express from 'express';
import fetch from 'node-fetch';

export const router = express.Router();

const getBobBaseUrl = () => {
  const base = process.env.BOB_API_BASE_URL || 'https://api.sandbox.bobgo.co.za/v2/';
  return base.endsWith('/') ? base : `${base}/`;
};

const getBobAuthToken = () => process.env.BOB_API_TOKEN || '';

const buildBobUrl = (path) => {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return new URL(cleanPath, getBobBaseUrl()).toString();
};

const proxyToBob = async ({ method = 'GET', path, body, headers = {} }) => {
  const token = getBobAuthToken();
  if (!token) {
    throw new Error('Missing BOB_API_TOKEN environment variable');
  }

  const requestOptions = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body !== undefined && body !== null) {
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(buildBobUrl(path), requestOptions);
  const text = await response.text();

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

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'bob-api',
    baseUrl: getBobBaseUrl(),
    tokenConfigured: Boolean(getBobAuthToken()),
  });
});

// Generic proxy for Bob endpoints.
// Body example:
// {
//   "path": "rates",
//   "method": "POST",
//   "body": { ...your payload... }
// }
router.post('/proxy', async (req, res) => {
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

router.post('/orders', async (req, res) => {
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

router.get('/orders/:id', async (req, res) => {
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

router.post('/shipments', async (req, res) => {
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

router.get('/shipments/:id/tracking', async (req, res) => {
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
