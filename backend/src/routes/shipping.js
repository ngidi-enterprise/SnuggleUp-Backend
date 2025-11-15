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
 *   postalCode: '2196' // optional
 * }
 * 
 * Returns:
 * {
 *   quotes: [
 *     {
 *       logisticName: 'CJ Packet-Registered',
 *       totalPostage: 45.50,
 *       deliveryDay: '15-25',
 *       currency: 'USD',
 *       tracking: true,
 *       priceZAR: 850.00 // converted to ZAR
 *     }
 *   ]
 * }
 */
router.post('/quote', optionalAuth, async (req, res) => {
  try {
    const { items, shippingCountry, postalCode } = req.body;

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
      shippingCountryCode: shippingCountry,
      fromCountryCode: 'CN', // All products ship from China
      postalCode,
      products: cjProducts
    });

    // Convert USD to ZAR (approximate rate, update periodically)
    const USD_TO_ZAR = 18.5; // Update this regularly or use a currency API
    const quotesWithZAR = quotes.map(q => ({
      ...q,
      priceZAR: Math.ceil(q.totalPostage * USD_TO_ZAR * 100) / 100, // Round to 2 decimals
      priceUSD: q.totalPostage
    }));

    res.json({
      quotes: quotesWithZAR,
      shippingCountry,
      fromCountry: 'CN'
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
