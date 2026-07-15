import express from 'express';
import pool from '../db.js';
import {
  supplierPickupPayload,
  supplierPickupSummary,
} from '../services/supplierPickup.js';

export const router = express.Router();

const VALID_STATUSES = new Set(['waiting', 'picked_up', 'problem']);

const publicSelect = `
  id,
  order_number,
  items,
  customer_name,
  shipping_city,
  shipping_province,
  shipping_postal_code,
  shipping_method,
  bob_tracking_reference,
  bob_tracking_url,
  bob_courier_name,
  cj_tracking_number,
  supplier_pickup_status,
  supplier_pickup_confirmed_at,
  supplier_pickup_updated_at,
  supplier_pickup_notes,
  supplier_waybill_url
`;

async function findOrderByToken(token) {
  const result = await pool.query(
    `SELECT ${publicSelect}
     FROM orders
     WHERE supplier_pickup_token = $1
     LIMIT 1`,
    [token]
  );
  return result.rows[0] || null;
}

router.get('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 20) {
      return res.status(404).json({ error: 'This supplier link is not valid' });
    }

    const order = await findOrderByToken(token);
    if (!order) {
      return res.status(404).json({ error: 'This supplier link is not valid' });
    }

    res.json(supplierPickupPayload(order, await supplierPickupSummary()));
  } catch (error) {
    console.error('[supplier-pickup] lookup error:', error);
    res.status(500).json({ error: 'Failed to load supplier handoff' });
  }
});

router.post('/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    const status = String(req.body?.status || '').trim();
    const notes = String(req.body?.notes || '').trim().slice(0, 500);

    if (!token || token.length < 20) {
      return res.status(404).json({ error: 'This supplier link is not valid' });
    }

    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid supplier status' });
    }

    const bobStatus = status === 'picked_up'
      ? 'collected'
      : status === 'waiting'
        ? 'pending-collection'
        : 'exception';

    const result = await pool.query(
      `UPDATE orders
       SET supplier_pickup_status = $1,
           supplier_pickup_notes = NULLIF($2, ''),
           supplier_pickup_confirmed_at = CASE
             WHEN $1 = 'picked_up' THEN CURRENT_TIMESTAMP
             ELSE supplier_pickup_confirmed_at
           END,
           supplier_pickup_updated_at = CURRENT_TIMESTAMP,
           bob_tracking_status = CASE
             WHEN COALESCE(bob_tracking_status, '') IN ('', 'pending-collection', 'collected', 'exception') THEN $3
             ELSE bob_tracking_status
           END,
           bob_tracking_updated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE supplier_pickup_token = $4
       RETURNING ${publicSelect}`,
      [status, notes, bobStatus, token]
    );

    const order = result.rows[0];
    if (!order) {
      return res.status(404).json({ error: 'This supplier link is not valid' });
    }

    res.json({
      success: true,
      ...supplierPickupPayload(order, await supplierPickupSummary()),
    });
  } catch (error) {
    console.error('[supplier-pickup] update error:', error);
    res.status(500).json({ error: 'Failed to save supplier handoff' });
  }
});

export default router;
