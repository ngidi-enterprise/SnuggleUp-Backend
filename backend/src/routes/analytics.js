import express from 'express';
import pool from '../db.js';

export const router = express.Router();

const ALLOWED_EVENTS = new Set(['session_start', 'page_view', 'page_exit', 'category_view', 'product_view', 'product_click', 'add_to_cart', 'begin_checkout', 'payment_started', 'search']);
const cleanText = (value, maxLength = 160) => String(value || '').trim().slice(0, maxLength);
const cleanPath = (value) => {
  const path = cleanText(value, 240);
  return path.startsWith('/') ? path.split('?')[0] : '/';
};
const requestCountryCode = (req) => {
  const value = String(
    req.get('cf-ipcountry')
    || req.get('cloudfront-viewer-country')
    || req.get('x-vercel-ip-country')
    || ''
  ).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) && !['XX', 'T1'].includes(value) ? value : null;
};

// This endpoint is deliberately anonymous. It accepts only the small allowlist
// below and never records customer accounts, contact details, IP addresses, or URLs with query strings.
router.post('/events', async (req, res) => {
  try {
    const body = req.body || {};
    const eventName = cleanText(body.eventName, 48);
    const sessionId = cleanText(body.sessionId, 96);
    const visitorId = cleanText(body.visitorId, 96);

    if (!ALLOWED_EVENTS.has(eventName) || !sessionId || !visitorId) {
      return res.status(400).json({ error: 'Invalid analytics event' });
    }

    const duration = Number.parseInt(body.durationSeconds, 10);
    await pool.query(
      `INSERT INTO storefront_analytics_events
       (event_name, session_id, visitor_id, page_path, page_title, product_id, product_name, product_category, source, medium, campaign, referrer_host, country_code, timezone_name, browser_locale, duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        eventName,
        sessionId,
        visitorId,
        cleanPath(body.pagePath),
        cleanText(body.pageTitle, 160),
        cleanText(body.productId, 120) || null,
        cleanText(body.productName, 240) || null,
        cleanText(body.productCategory, 120) || null,
        cleanText(body.source, 120) || null,
        cleanText(body.medium, 120) || null,
        cleanText(body.campaign, 180) || null,
        cleanText(body.referrerHost, 180) || null,
        requestCountryCode(req),
        cleanText(body.timezoneName, 80) || null,
        cleanText(body.browserLocale, 32) || null,
        Number.isFinite(duration) && duration >= 0 ? Math.min(duration, 86400) : null,
      ]
    );
    return res.status(202).json({ ok: true });
  } catch (error) {
    console.error('[storefront-analytics] event rejected:', error.message);
    return res.status(202).json({ ok: false });
  }
});
