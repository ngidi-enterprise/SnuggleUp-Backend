import express from 'express';
import { cjClient } from '../services/cjClient.js';
import pool from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

export const router = express.Router();

// Optional auth middleware - allows both authenticated and anonymous users
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return next();
  authenticateToken(req, res, next);
};

/**
 * POST /api/shipping/quote
 * Get real-time shipping quotes from CJ for cart items
 * 
 * Body:
 * {
 *   items: [{ cj_vid: 'V123', quantity: 2 }],
 *   shippingCountry: 'ZA',
 *   postalCode: '2196', // optional
 *   orderValue: 1500.00 // total order value for insurance calculation
 * }
 * 
 * Returns:
 * {
 *   quotes: [...],
 *   insurance: {
 *     available: true,
 *     costZAR: 45.00,
 *     coverage: 1500.00
 *   }
 * }
 */
router.post('/quote', optionalAuth, async (req, res) => {
  try {
    const { items, shippingCountry, postalCode, orderValue } = req.body;

    // Validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }
    if (!shippingCountry) {
      return res.status(400).json({ error: 'shippingCountry is required' });
    }

    // Map cart items to CJ format: { vid, quantity }
    const cjProducts = items.map(item => ({
      vid: item.cj_vid,
      quantity: Number(item.quantity || 1)
    }));

    // Validate all items have cj_vid
    const missingVid = cjProducts.find(p => !p.vid);
    if (missingVid) {
      return res.status(400).json({ 
        error: 'All items must have cj_vid (variant ID)' 
      });
    }

    // Debug logging to investigate quote failures in production
    console.log('🚚 Shipping quote request:', {
      shippingCountry,
      postalCode: postalCode || null,
      itemsCount: items.length,
      products: cjProducts
    });

    // Call CJ freight calculator (try CN first, fallback to US warehouse if needed)
    let quotes = [];
    try {
      quotes = await cjClient.getFreightQuote({
        shippingCountryCode: shippingCountry,
        fromCountryCode: 'CN',
        postalCode,
        products: cjProducts
      });
      if (!quotes || quotes.length === 0) {
        console.warn('⚠️ No quotes from CN. Retrying with US origin…');
        quotes = await cjClient.getFreightQuote({
          shippingCountryCode: shippingCountry,
          fromCountryCode: 'US',
          postalCode,
          products: cjProducts
        });
      }
    } catch (firstErr) {
      console.warn('⚠️ CN quote failed, retrying with US:', firstErr?.message);
      quotes = await cjClient.getFreightQuote({
        shippingCountryCode: shippingCountry,
        fromCountryCode: 'US',
        postalCode,
        products: cjProducts
      });
    }

    // Convert USD to ZAR (approximate rate, update periodically)
    const USD_TO_ZAR = 19.0; // Updated exchange rate
    const quotesWithZAR = quotes.map(q => ({
      ...q,
      priceZAR: Math.ceil(q.totalPostage * USD_TO_ZAR * 100) / 100, // Round to 2 decimals
      priceUSD: q.totalPostage
    }));

    // Calculate insurance cost (3% of order value, min R25, max R500)
    const insuranceData = orderValue ? {
      available: true,
      costZAR: Math.min(Math.max(Math.ceil(orderValue * 0.03), 25), 500),
      coverage: orderValue,
      percentage: 3
    } : {
      available: false,
      costZAR: 0,
      coverage: 0
    };

    res.json({
      quotes: quotesWithZAR,
      shippingCountry,
      fromCountry: 'CN',
      insurance: insuranceData
    });

  } catch (err) {
    // Bubble up the most helpful diagnostics
    console.error('❌ Shipping quote error:', {
      message: err?.message,
      status: err?.status,
      response: err?.response || undefined
    });
    res.status(500).json({ 
      error: 'Failed to get shipping quotes', 
      details: err?.message || 'Unknown error',
      upstream: err?.response || null
    });
  }
});

/**
 * GET /api/shipping/countries
 * Get list of supported shipping countries
 * (For now, return common countries; can expand later)
 */
router.get('/countries', (_req, res) => {
  res.json({
    countries: [
      { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
      { code: 'US', name: 'United States', flag: '🇺🇸' },
      { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
      { code: 'AU', name: 'Australia', flag: '🇦🇺' },
      { code: 'CA', name: 'Canada', flag: '🇨🇦' },
      { code: 'DE', name: 'Germany', flag: '🇩🇪' },
      { code: 'FR', name: 'France', flag: '🇫🇷' },
      { code: 'IT', name: 'Italy', flag: '🇮🇹' },
      { code: 'ES', name: 'Spain', flag: '🇪🇸' },
      { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
    ]
  });
});
