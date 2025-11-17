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
      quantity: item.quantity || 1
    }));

    // Validate all items have cj_vid
    const missingVid = cjProducts.find(p => !p.vid);
    if (missingVid) {
      return res.status(400).json({ 
        error: 'All items must have cj_vid (variant ID)' 
      });
    }

    // Call CJ freight calculator
    const quotes = await cjClient.getFreightQuote({
      startCountryCode: 'CN', // All products ship from China
      endCountryCode: shippingCountry,
      postalCode,
      products: cjProducts
    });

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
    console.error('Shipping quote error:', err);
    res.status(500).json({ 
      error: 'Failed to get shipping quotes', 
      details: err.message 
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
