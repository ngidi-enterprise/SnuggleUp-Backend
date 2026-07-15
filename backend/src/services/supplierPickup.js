import crypto from 'crypto';
import pool from '../db.js';

const STATUS_LABELS = {
  waiting: 'Not collected yet',
  picked_up: 'Collected',
  problem: 'Problem',
};

export function generateSupplierPickupToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function normalizeWhatsAppPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('27')) return digits;
  if (digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

export function supplierPickupFrontendUrl(token) {
  const frontendBase = (
    process.env.FRONTEND_URL ||
    process.env.SITE_URL ||
    'https://snuggleup.co.za'
  ).replace(/\/+$/g, '');
  return `${frontendBase}/#/supplier-pickup?token=${encodeURIComponent(token)}`;
}

function normalizeItems(items) {
  if (Array.isArray(items)) return items;
  try {
    const parsed = JSON.parse(items || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function itemSummary(order = {}) {
  const items = normalizeItems(order.items);
  if (items.length === 0) return 'Items listed on waybill';
  return items
    .slice(0, 4)
    .map(item => `${Number(item.quantity || 1)} x ${item.name || 'item'}`)
    .join(', ');
}

export function buildSupplierPickupMessage(order = {}, token = order.supplier_pickup_token) {
  const pickupUrl = supplierPickupFrontendUrl(token);
  const trackingRef = order.bob_tracking_reference || order.cj_tracking_number || '';
  const courier = order.bob_courier_name || order.shipping_method || 'Courier';
  const waybillUrl = order.supplier_waybill_url || order.bob_tracking_url || '';

  return [
    `SnuggleUp order ${order.order_number || ''}`,
    itemSummary(order),
    trackingRef ? `Ref: ${trackingRef}` : '',
    courier ? `Courier: ${courier}` : '',
    waybillUrl ? `Waybill/tracking: ${waybillUrl}` : '',
    '',
    'Tap this link when the parcel leaves you:',
    pickupUrl,
  ].filter(line => line !== '').join('\n');
}

export function buildSupplierWhatsappUrl(order = {}, token = order.supplier_pickup_token) {
  const phone = normalizeWhatsAppPhone(
    process.env.SUPPLIER_WHATSAPP_PHONE ||
    process.env.LOCAL_SUPPLIER_WHATSAPP_PHONE ||
    ''
  );
  const message = buildSupplierPickupMessage(order, token);
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}

export async function ensureSupplierPickupToken(orderId) {
  const existing = await pool.query(
    `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
    [orderId]
  );
  const order = existing.rows[0];
  if (!order) return null;
  if (order.supplier_pickup_token) return order;

  const token = generateSupplierPickupToken();
  const updated = await pool.query(
    `UPDATE orders
     SET supplier_pickup_token = $1,
         supplier_pickup_status = COALESCE(supplier_pickup_status, 'waiting'),
         supplier_pickup_updated_at = COALESCE(supplier_pickup_updated_at, CURRENT_TIMESTAMP)
     WHERE id = $2
     RETURNING *`,
    [token, orderId]
  );

  return updated.rows[0] || null;
}

export async function supplierPickupSummary() {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE supplier_pickup_status = 'picked_up'
          AND supplier_pickup_confirmed_at >= CURRENT_DATE
      ) AS picked_up_today,
      COUNT(*) FILTER (
        WHERE supplier_pickup_status = 'picked_up'
          AND supplier_pickup_confirmed_at >= date_trunc('week', CURRENT_DATE)
      ) AS picked_up_this_week
    FROM orders
  `);
  const row = result.rows[0] || {};
  return {
    pickedUpToday: Number(row.picked_up_today || 0),
    pickedUpThisWeek: Number(row.picked_up_this_week || 0),
  };
}

export function supplierPickupPayload(order = {}, summary = {}) {
  const items = normalizeItems(order.items).map(item => ({
    name: item.name || 'Item',
    quantity: Number(item.quantity || 1),
  }));

  return {
    order: {
      orderNumber: order.order_number,
      status: order.supplier_pickup_status || 'waiting',
      statusLabel: STATUS_LABELS[order.supplier_pickup_status || 'waiting'] || 'Not collected yet',
      confirmedAt: order.supplier_pickup_confirmed_at,
      updatedAt: order.supplier_pickup_updated_at,
      notes: order.supplier_pickup_notes || '',
      items,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      customerName: order.customer_name || '',
      deliveryArea: [
        order.shipping_city,
        order.shipping_province,
        order.shipping_postal_code,
      ].filter(Boolean).join(', '),
      courier: order.bob_courier_name || order.shipping_method || '',
      trackingReference: order.bob_tracking_reference || order.cj_tracking_number || '',
      waybillUrl: order.supplier_waybill_url || order.bob_tracking_url || '',
    },
    summary,
  };
}
