import pool from '../db.js';
import { createAnalyticsEventDedupeKey } from './analyticsEventDeduplication.js';

const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const money = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

const cartSnapshot = (orders) => orders.flatMap((order) => parseItems(order.items).map((item) => {
  const quantity = Math.max(1, Number.parseInt(item?.quantity, 10) || 1);
  const unitPrice = money(item?.price);
  return {
    productId: String(item?.id || '').slice(0, 120) || null,
    productName: String(item?.name || '').slice(0, 240) || null,
    productCategory: String(item?.category || '').slice(0, 120) || null,
    quantity,
    unitPrice,
    lineTotal: money(unitPrice * quantity),
  };
}));

export const recordCheckoutOutcome = async ({
  eventName,
  orders = [],
  orderReference,
  failureReason = null,
}) => {
  const firstOrder = orders[0];
  const visitorId = String(firstOrder?.analytics_visitor_id || '').trim();
  const sessionId = String(firstOrder?.analytics_session_id || '').trim();
  if (!visitorId || !sessionId || !['payment_success', 'payment_failed', 'purchase_complete'].includes(eventName)) {
    return { recorded: false, reason: 'missing_identity' };
  }

  const audience = await pool.query(
    `SELECT audience_type FROM storefront_analytics_audiences WHERE visitor_id = $1 LIMIT 1`,
    [visitorId]
  );
  if (audience.rows[0]) return { recorded: false, reason: 'internal_audience' };

  const latest = await pool.query(
    `SELECT source, medium, campaign, referrer_host, country_code, timezone_name,
            browser_locale, device_id, utm_source, utm_medium, utm_campaign,
            utm_term, utm_content, gclid, campaign_source, campaign_medium,
            campaign_name, browser_name, device_type, os_name, city_name,
            region_name, province_name, municipality_name, ad_group
     FROM storefront_analytics_events
     WHERE visitor_id = $1 AND session_id = $2
       AND traffic_type = 'customer' AND is_internal_traffic = FALSE
       AND COALESCE(device_type, '') <> 'Bot'
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [visitorId, sessionId]
  );
  const context = latest.rows[0];
  if (!context || context.device_type === 'Bot') return { recorded: false, reason: 'bot_or_missing_session' };

  const pagePath = eventName === 'payment_failed' ? '/checkout/cancel' : '/checkout/success';
  const interactionId = `payfast:${orderReference}:${eventName}`;
  const dedupeKey = createAnalyticsEventDedupeKey({
    sessionId,
    eventName,
    pagePath,
    interactionId,
  });
  const items = cartSnapshot(orders);
  const cartValue = money(orders.reduce((sum, order) => sum + money(order.subtotal), 0));
  const deliveryCost = money(orders.reduce((sum, order) => sum + money(order.shipping), 0));
  const deliveryOption = [...new Set(orders.map((order) => order.shipping_method).filter(Boolean))].join(' + ').slice(0, 160) || null;

  const result = await pool.query(
    `INSERT INTO storefront_analytics_events
     (event_name, session_id, visitor_id, page_path, page_title,
      source, medium, campaign, referrer_host, country_code, timezone_name,
      browser_locale, audience_type, traffic_type, is_internal_traffic,
      device_id, page_url, referrer, utm_source, utm_medium, utm_campaign,
      utm_term, utm_content, gclid, campaign_source, campaign_medium,
      campaign_name, page_load_id, event_dedupe_key, browser_name,
      device_type, os_name, city_name, region_name, province_name,
      municipality_name, ad_group,
      cart_items, cart_value, delivery_cost, delivery_option, interaction_id,
      order_reference, failure_reason)
     VALUES
     ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'customer','customer',FALSE,
      $13,$4,$9,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39)
     ON CONFLICT (event_dedupe_key)
     WHERE event_dedupe_key IS NOT NULL
     DO NOTHING`,
    [
      eventName, sessionId, visitorId, pagePath,
      eventName === 'payment_failed' ? 'Payment failed' : 'Payment confirmed',
      context.source, context.medium, context.campaign, context.referrer_host,
      context.country_code, context.timezone_name, context.browser_locale,
      context.device_id, context.utm_source, context.utm_medium,
      context.utm_campaign, context.utm_term, context.utm_content, context.gclid,
      context.campaign_source, context.campaign_medium, context.campaign_name,
      interactionId, dedupeKey, context.browser_name, context.device_type,
      context.os_name, context.city_name, context.region_name,
      context.province_name, context.municipality_name, context.ad_group,
      JSON.stringify(items), cartValue, deliveryCost, deliveryOption,
      interactionId, String(orderReference || '').slice(0, 160) || null,
      failureReason ? String(failureReason).slice(0, 160) : null,
    ]
  );
  return { recorded: result.rowCount > 0 };
};
