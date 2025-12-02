import express from 'express';
import { cjClient } from '../services/cjClient.js';
import pool from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { isShippingFallbackEnabled } from '../services/configService.js';

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

    console.log('📦 Raw cart items received:', items.map(i => ({
      cj_vid: i.cj_vid,
      quantity: i.quantity,
      has_vid: !!i.cj_vid
    })));

    // Validate all items have cj_vid
    const missingVid = cjProducts.find(p => !p.vid);
    if (missingVid) {
      console.error('❌ Missing cj_vid in cart items!');
      console.error('Items received:', JSON.stringify(items, null, 2));
      return res.status(400).json({ 
        error: 'Cart items missing shipping data. Products need to be re-added from store.',
        details: 'Missing CJ variant ID (cj_vid) - products may have been added before being linked to supplier'
      });
    }

    // Determine origin country by checking warehouse inventory for the first product
    // (CJ requires all products in a single quote request to ship from same country)
    let originCountry = 'CN'; // Default to China
    
    try {
      const firstVid = cjProducts[0].vid;
      const warehouseCheck = await pool.query(`
        SELECT country_code, cj_inventory 
        FROM curated_product_inventories 
        WHERE cj_vid = $1 AND cj_inventory > 0
        ORDER BY cj_inventory DESC 
        LIMIT 1
      `, [firstVid]);
      
      if (warehouseCheck.rows.length > 0) {
        originCountry = warehouseCheck.rows[0].country_code;
        console.log(`🌍 Detected origin country: ${originCountry} for vid ${firstVid}`);
      } else {
        console.warn(`⚠️ No warehouse inventory found for vid ${firstVid}, defaulting to CN`);
      }
    } catch (err) {
      console.error('Error detecting origin country:', err.message);
      // Continue with CN default
    }

    // Call CJ freight calculator
    console.log('🚢 Calling CJ freight API with:', {
      startCountryCode: originCountry,
      endCountryCode: shippingCountry,
      postalCode,
      products: cjProducts
    });
    
    const quotes = await cjClient.getFreightQuote({
      startCountryCode: originCountry,
      endCountryCode: shippingCountry,
      postalCode,
      products: cjProducts
    });
    
    console.log('📦 CJ freight API raw response:', JSON.stringify(quotes, null, 2));
    console.log('📦 First quote details:', quotes[0] || 'NO QUOTES');
    console.log(`📊 Quotes count: ${quotes?.length || 0}`);

    // Convert USD to ZAR (approximate rate, update periodically)
    const USD_TO_ZAR = 19.0; // Updated exchange rate

    // Convert CJ quotes to ZAR without any fallback manipulation
    const quotesWithZAR = quotes.map(q => {
      const priceUSD = Number(q.totalPostage || 0);
      const priceZAR = Math.ceil(priceUSD * USD_TO_ZAR * 100) / 100;
      
      if (priceZAR === 0 || priceUSD === 0) {
        console.warn(`⚠️ ${q.logisticName} has ZERO cost from CJ API - this is CJ data issue, not a code bug`);
        console.warn(`   Raw CJ response for this method:`, JSON.stringify(q, null, 2));
      }
      
      return { ...q, priceZAR, priceUSD };
    });

    // If CJ returned no shipping methods at all, return empty quotes with explanation
    if (!quotesWithZAR || quotesWithZAR.length === 0) {
      console.error(`❌ CJ returned ZERO shipping methods for route ${originCountry} → ${shippingCountry}`);
      console.error(`   This means CJ does not support shipping from this warehouse to destination`);
      return res.status(400).json({
        error: 'No shipping methods available',
        quotes: [],
        reason: `Supplier does not ship from ${originCountry} to ${shippingCountry}`,
        suggestion: 'Product may need to be sourced from a different warehouse'
      });
    }

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
      fromCountry: originCountry,
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
