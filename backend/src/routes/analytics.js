import express from 'express';
import pool from '../db.js';
import { optionalAuth } from '../middleware/auth.js';
import { getUserAccess, requireProductAssistantOrAdmin } from '../middleware/admin.js';
import { classifyAnalyticsTraffic } from '../services/analyticsTrafficClassifier.js';

export const router = express.Router();

const ALLOWED_EVENTS = new Set([
  'session_start', 'page_view', 'page_exit', 'category_view', 'product_view',
  'product_click', 'add_to_cart', 'remove_from_cart', 'begin_checkout',
  'checkout_step', 'payment_started', 'payment_attempt', 'purchase',
  'form_submission', 'button_click', 'outbound_click', 'error',
  'scroll_depth', 'search',
]);
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

router.post('/session-role', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const sessionId = cleanText(req.body?.sessionId, 96);
    const visitorId = cleanText(req.body?.visitorId, 96);
    if (!sessionId || !visitorId) return res.status(400).json({ error: 'Analytics session is required' });

    const audienceType = req.access?.isSuperuser ? 'superuser' : 'staff';
    await pool.query(
      `INSERT INTO storefront_analytics_audiences (visitor_id, audience_type, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (visitor_id) DO UPDATE
       SET audience_type = EXCLUDED.audience_type, updated_at = CURRENT_TIMESTAMP`,
      [visitorId, audienceType]
    );
    const result = await pool.query(
      `UPDATE storefront_analytics_events
       SET audience_type = $1,
           traffic_type = 'superuser',
           is_internal_traffic = TRUE,
           user_role = $4
       WHERE visitor_id = $2 OR session_id = $3`,
      [audienceType, visitorId, sessionId, req.access?.role || null]
    );
    return res.json({ ok: true, audienceType, updated: result.rowCount });
  } catch (error) {
    console.error('[storefront-analytics] session classification failed:', error.message);
    return res.status(500).json({ error: 'Unable to classify analytics session' });
  }
});

// Anonymous shoppers may use this endpoint, but a valid bearer token is resolved
// server-side when present. It never accepts a browser-supplied traffic classification
// and does not record customer contact, payment, address, IP, or URL query-string data.
router.post('/events', optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const eventName = cleanText(body.eventName, 48);
    const sessionId = cleanText(body.sessionId, 96);
    const visitorId = cleanText(body.visitorId, 96);

    if (!ALLOWED_EVENTS.has(eventName) || !sessionId || !visitorId) {
      return res.status(400).json({ error: 'Invalid analytics event' });
    }

    const duration = Number.parseInt(body.durationSeconds, 10);
    const eventValue = Number.parseInt(body.eventValue, 10);
    let access = null;
    if (req.user) {
      access = await getUserAccess(req);
    }
    const audienceResult = await pool.query(
      `SELECT audience_type
       FROM storefront_analytics_audiences
       WHERE visitor_id = $1
       LIMIT 1`,
      [visitorId]
    );
    const existingAudienceType = audienceResult.rows[0]?.audience_type || null;
    const classification = classifyAnalyticsTraffic({ access, existingAudienceType });
    const audienceType = classification.trafficType === 'superuser'
      ? (classification.userRole === 'product_assistant' ? 'staff' : 'superuser')
      : 'customer';
    const pagePath = cleanPath(body.pagePath);
    const source = cleanText(body.source, 120) || null;
    const medium = cleanText(body.medium, 120) || null;
    const campaign = cleanText(body.campaign, 180) || null;
    const referrerHost = cleanText(body.referrerHost, 180) || null;
    await pool.query(
      `INSERT INTO storefront_analytics_events
       (event_name, session_id, visitor_id, page_path, page_title, product_id,
        product_name, product_category, source, medium, campaign, referrer_host,
        country_code, timezone_name, browser_locale, event_value, duration_seconds,
        audience_type, traffic_type, is_internal_traffic, user_role, device_id,
        page_url, referrer, utm_source, utm_medium, utm_campaign, utm_term,
        utm_content, gclid, campaign_source, campaign_medium, campaign_name)
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
       )`,
      [
        eventName,
        sessionId,
        visitorId,
        pagePath,
        cleanText(body.pageTitle, 160),
        cleanText(body.productId, 120) || null,
        cleanText(body.productName, 240) || null,
        cleanText(body.productCategory, 120) || null,
        source,
        medium,
        campaign,
        referrerHost,
        requestCountryCode(req),
        cleanText(body.timezoneName, 80) || null,
        cleanText(body.browserLocale, 32) || null,
        Number.isFinite(eventValue) ? Math.max(0, Math.min(eventValue, 100)) : null,
        Number.isFinite(duration) && duration >= 0 ? Math.min(duration, 86400) : null,
        audienceType,
        classification.trafficType,
        classification.isInternalTraffic,
        classification.userRole,
        null,
        pagePath,
        referrerHost,
        source,
        medium,
        campaign,
        cleanText(body.utmTerm, 180) || null,
        cleanText(body.utmContent, 180) || null,
        cleanText(body.gclid, 240) || null,
        source,
        medium,
        campaign,
      ]
    );
    return res.status(202).json({ ok: true });
  } catch (error) {
    console.error('[storefront-analytics] event rejected:', error.message);
    return res.status(202).json({ ok: false });
  }
});
