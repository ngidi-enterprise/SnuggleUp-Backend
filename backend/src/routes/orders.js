import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { verifyTrackingToken } from '../services/trackingLinks.js';
import { sendOwnerLateOrderFlagEmail } from '../services/ownerOrderNotifications.js';
import { generateSupplierPickupToken } from '../services/supplierPickup.js';

export const router = express.Router();

const publicTrackingSelect = `
        id,
        order_number,
        total,
        status,
        created_at,
        updated_at,
        items,
        subtotal,
        shipping,
        discount,
        shipping_method,
        bob_shipment_id,
        bob_tracking_reference,
        bob_tracking_url,
        bob_courier_name,
        bob_provider_slug,
        bob_service_level,
        bob_tracking_status,
        bob_health_status,
        bob_health_status_reason,
        bob_tracking_events,
        bob_tracking_last_event_time,
        bob_tracking_updated_at,
        cj_tracking_number,
        cj_tracking_url,
        cj_status,
        late_order_flagged_at,
        late_order_flag_count,
        late_order_flag_status`;

const parseOrderForResponse = (order) => {
  if (!order) return null;
  const parsed = { ...order };
  try { parsed.items = JSON.parse(parsed.items); } catch { parsed.items = []; }
  parsed.bob_tracking_events = Array.isArray(parsed.bob_tracking_events) ? parsed.bob_tracking_events : [];
  return parsed;
};

// Get all orders for logged-in user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { rows } = await db.query(
      `SELECT
        ${publicTrackingSelect}
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    // Parse items JSON for each order
    const ordersWithItems = rows.map(parseOrderForResponse);

    res.json({ orders: ordersWithItems });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});

// Public tracking lookup for guest customers.
// Requires both order number and checkout email to avoid exposing order details.
router.post('/track', async (req, res) => {
  try {
    const orderNumber = String(req.body?.orderNumber || '').replace(/^#/, '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!orderNumber || !email) {
      return res.status(400).json({ error: 'Order number and email are required' });
    }

    const result = await db.query(
      `SELECT
        ${publicTrackingSelect}
       FROM orders
       WHERE LOWER(order_number) = LOWER($1)
         AND LOWER(COALESCE(customer_email, '')) = $2
       LIMIT 1`,
      [orderNumber, email]
    );

    const order = result.rows[0];
    if (!order) {
      return res.status(404).json({ error: 'We could not find an order with those details' });
    }

    res.json({ order: parseOrderForResponse(order) });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({ error: 'Failed to retrieve tracking' });
  }
});

// Public tracking lookup from email links.
// The link token is signed server-side so the customer can open tracking directly.
router.post('/track-link', async (req, res) => {
  try {
    const orderNumber = String(req.body?.orderNumber || '').replace(/^#/, '').trim();
    const token = String(req.body?.token || '').trim();

    if (!orderNumber || !token) {
      return res.status(400).json({ error: 'Tracking link is missing order details' });
    }

    const result = await db.query(
      `SELECT
        customer_email,
        ${publicTrackingSelect}
       FROM orders
       WHERE LOWER(order_number) = LOWER($1)
       LIMIT 1`,
      [orderNumber]
    );

    const order = result.rows[0];
    if (!order || !verifyTrackingToken({ orderNumber: order.order_number, email: order.customer_email, token })) {
      return res.status(404).json({ error: 'This tracking link is no longer valid' });
    }

    const parsed = parseOrderForResponse(order);
    delete parsed.customer_email;
    res.json({ order: parsed });
  } catch (error) {
    console.error('Track order link error:', error);
    res.status(500).json({ error: 'Failed to retrieve tracking' });
  }
});

router.post('/flag-late', async (req, res) => {
  try {
    const orderNumber = String(req.body?.orderNumber || '').replace(/^#/, '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || '').trim();

    if (!orderNumber || (!email && !token)) {
      return res.status(400).json({ error: 'Order number and tracking verification are required' });
    }

    const result = await db.query(
      token
        ? `SELECT * FROM orders WHERE LOWER(order_number) = LOWER($1) LIMIT 1`
        : `SELECT * FROM orders
           WHERE LOWER(order_number) = LOWER($1)
             AND LOWER(COALESCE(customer_email, '')) = $2
           LIMIT 1`,
      token ? [orderNumber] : [orderNumber, email]
    );

    const order = result.rows[0];
    if (!order || (token && !verifyTrackingToken({ orderNumber: order.order_number, email: order.customer_email, token }))) {
      return res.status(404).json({ error: 'We could not verify that order for late-order reporting' });
    }

    const updateResult = await db.query(
      `UPDATE orders
       SET late_order_flagged_at = CURRENT_TIMESTAMP,
           late_order_flag_count = COALESCE(late_order_flag_count, 0) + 1,
           late_order_flag_status = 'open',
           late_order_flag_email_last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [order.id]
    );

    let updatedOrder = updateResult.rows[0];
    const emailResult = await sendOwnerLateOrderFlagEmail({ order: updatedOrder });

    if (emailResult.success) {
      const notifiedResult = await db.query(
        `UPDATE orders
         SET late_order_flag_notified_at = CURRENT_TIMESTAMP,
             late_order_flag_email_last_error = NULL
         WHERE id = $1
         RETURNING *`,
        [updatedOrder.id]
      );
      updatedOrder = notifiedResult.rows[0] || updatedOrder;
    } else if (!emailResult.skipped) {
      const errorResult = await db.query(
        `UPDATE orders
         SET late_order_flag_email_last_error = $2
         WHERE id = $1
         RETURNING *`,
        [updatedOrder.id, emailResult.error || 'Late-order email failed']
      );
      updatedOrder = errorResult.rows[0] || updatedOrder;
    }

    const publicResult = await db.query(
      `SELECT ${publicTrackingSelect} FROM orders WHERE id = $1 LIMIT 1`,
      [updatedOrder.id]
    );

    res.json({
      success: true,
      message: 'Thanks, our team will investigate and email you promptly.',
      order: parseOrderForResponse(publicResult.rows[0]),
    });
  } catch (error) {
    console.error('Flag late order error:', error);
    res.status(500).json({ error: 'Failed to flag late order' });
  }
});

// Get single order details
router.get('/:orderId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orderId = req.params.orderId;

    const result = await db.query(
      `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, userId]
    );
    const order = result.rows[0];

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Parse items JSON
    order.items = JSON.parse(order.items);

    res.json({ order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to retrieve order' });
  }
});

// Create new order (called from payment flow)
export const createOrder = async (userId, orderData) => {
  try {
    const { 
      orderNumber, 
      items, 
      subtotal, 
      shipping, 
      discount, 
      total, 
      email,
      shippingCountry,
      shippingMethod,
      insurance,
      shippingDetails
    } = orderData;
    
    console.log('🔍 createOrder called with:', {
      userId,
      userIdType: typeof userId,
      orderNumber,
      itemCount: items?.length,
      items: items?.map(i => ({ id: i.id, idType: typeof i.id, name: i.name }))
    });
    
    // Ensure numeric values are actual numbers, not strings
    const numSubtotal = parseFloat(subtotal) || 0;
    const numShipping = parseFloat(shipping) || 0;
    const numDiscount = parseFloat(discount) || 0;
    const numTotal = parseFloat(total) || 0;
    const numInsuranceCost = parseFloat(insurance?.cost) || 0;
    const numInsuranceCoverage = parseFloat(insurance?.coverage) || 0;
    
    // Ensure userId is a string (not undefined or null)
    const safeUserId = String(userId || 'guest');
    const smsTrackingOptIn = Boolean(
      shippingDetails?.smsTrackingOptIn ||
      shippingDetails?.smsTrackingConsent
    );
    const smsTrackingPhone = smsTrackingOptIn
      ? (shippingDetails?.smsTrackingPhone || shippingDetails?.phone || null)
      : null;
    const supplierPickupToken = generateSupplierPickupToken();
    
    console.log('🔍 About to insert order with userId:', safeUserId, 'type:', typeof safeUserId);
    
    const result = await db.query(
      `INSERT INTO orders (
        user_id, order_number, items, subtotal, shipping, discount, total, customer_email, 
        shipping_country, shipping_method, insurance_selected, insurance_cost, insurance_coverage, 
        customer_name, shipping_address, shipping_city, shipping_province, shipping_postal_code, shipping_phone,
        shipping_id_number, sms_tracking_opt_in, sms_tracking_phone, supplier_pickup_token, supplier_pickup_status, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING id`,
      [
        safeUserId,
        orderNumber,
        JSON.stringify(items),
        numSubtotal,
        numShipping,
        numDiscount,
        numTotal,
        email,
        shippingCountry || 'ZA',
        shippingMethod || 'STANDARD',
        insurance?.selected || false,
        numInsuranceCost,
        numInsuranceCoverage,
        shippingDetails?.customerName || null,
        shippingDetails?.address || null,
        shippingDetails?.city || null,
        shippingDetails?.province || null,
        shippingDetails?.postalCode || null,
        shippingDetails?.phone || null,
        shippingDetails?.idNumber || null,
        smsTrackingOptIn,
        smsTrackingPhone,
        supplierPickupToken,
        'waiting',
        'pending'
      ]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error('Create order error:', error);
    throw error;
  }
};

// Update order status (called from PayFast webhook)
export const updateOrderStatus = async (orderNumber, status, payfastPaymentId) => {
  try {
    await db.query(
      `UPDATE orders SET status = $1, payfast_payment_id = $2, updated_at = CURRENT_TIMESTAMP WHERE order_number = $3`,
      [status, payfastPaymentId, orderNumber]
    );
    return true;
  } catch (error) {
    console.error('Update order status error:', error);
    throw error;
  }
};

// Get order by ID (for CJ submission)
export const getOrderById = async (orderId) => {
  try {
    const result = await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    if (result.rows.length === 0) {
      return null;
    }
    const order = result.rows[0];
    order.items = JSON.parse(order.items);
    return order;
  } catch (error) {
    console.error('Get order by ID error:', error);
    throw error;
  }
};

// Get order by order_number
export const getOrderByNumber = async (orderNumber) => {
  try {
    const result = await db.query(`SELECT * FROM orders WHERE order_number = $1`, [orderNumber]);
    if (result.rows.length === 0) return null;
    const order = result.rows[0];
    try { order.items = JSON.parse(order.items); } catch {}
    return order;
  } catch (error) {
    console.error('Get order by number error:', error);
    throw error;
  }
};

// Update order with CJ info after submission
export const updateOrderCJInfo = async (orderId, cjOrderId, cjOrderNumber, cjStatus) => {
  try {
    await db.query(
      `UPDATE orders SET cj_order_id = $1, cj_order_number = $2, cj_status = $3, cj_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [cjOrderId, cjOrderNumber, cjStatus || 'SUBMITTED', orderId]
    );
    return true;
  } catch (error) {
    console.error('Update order CJ info error:', error);
    throw error;
  }
};

// Update order tracking info from CJ webhook
export const updateOrderTracking = async (cjOrderId, trackingNumber, trackingUrl) => {
  try {
    await db.query(
      `UPDATE orders SET cj_tracking_number = $1, cj_tracking_url = $2, cj_status = 'SHIPPED', updated_at = CURRENT_TIMESTAMP WHERE cj_order_id = $3`,
      [trackingNumber, trackingUrl, cjOrderId]
    );
    return true;
  } catch (error) {
    console.error('Update order tracking error:', error);
    throw error;
  }
};

export const updateOrderBobTracking = async (orderId, trackingData = {}) => {
  try {
    const {
      bobShipmentId = null,
      bobTrackingReference = null,
      bobTrackingUrl = null,
      bobCourierName = null,
      bobProviderSlug = null,
      bobServiceLevel = null,
      bobTrackingStatus = null,
      bobHealthStatus = null,
      bobHealthStatusReason = null,
      bobTrackingEvents,
      bobTrackingLastEventTime = null,
      bobLastWebhookTopic = null,
    } = trackingData;

    const result = await db.query(
      `UPDATE orders
       SET
        bob_shipment_id = COALESCE($1, bob_shipment_id),
        bob_tracking_reference = COALESCE($2, bob_tracking_reference),
        bob_tracking_url = COALESCE($3, bob_tracking_url),
        bob_courier_name = COALESCE($4, bob_courier_name),
        bob_provider_slug = COALESCE($5, bob_provider_slug),
        bob_service_level = COALESCE($6, bob_service_level),
        bob_tracking_status = COALESCE($7, bob_tracking_status),
        bob_health_status = COALESCE($8, bob_health_status),
        bob_health_status_reason = COALESCE($9, bob_health_status_reason),
        bob_tracking_events = CASE
          WHEN $10::jsonb IS NULL THEN bob_tracking_events
          ELSE $10::jsonb
        END,
        bob_tracking_last_event_time = COALESCE($11::timestamp, bob_tracking_last_event_time),
        bob_last_webhook_topic = COALESCE($12, bob_last_webhook_topic),
        bob_tracking_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [
        bobShipmentId,
        bobTrackingReference,
        bobTrackingUrl,
        bobCourierName,
        bobProviderSlug,
        bobServiceLevel,
        bobTrackingStatus,
        bobHealthStatus,
        bobHealthStatusReason,
        bobTrackingEvents === undefined ? null : JSON.stringify(bobTrackingEvents),
        bobTrackingLastEventTime,
        bobLastWebhookTopic,
        orderId,
      ]
    );

    if (result.rows.length === 0) return null;
    const order = result.rows[0];
    try { order.items = JSON.parse(order.items); } catch {}
    return order;
  } catch (error) {
    console.error('Update Bob Go tracking error:', error);
    throw error;
  }
};

// Helper: Build CJ order data from local order
export const buildCJOrderData = (order) => {
  // Extract shipping info from order
  const shippingInfo = {
    customerName: order.customer_name || 'Customer',
    address: order.shipping_address || 'No Address',
    city: order.shipping_city || 'Johannesburg',
    province: order.shipping_province || 'Gauteng',
    postalCode: order.shipping_postal_code || '2196',
    phone: order.shipping_phone || '0821234567',
  };

  // ========== CONSIGNEE ID VALIDATION ==========
  // CJ requires: exactly 13 digits, no special characters
  const rawConsigneeId = order.shipping_id_number || '';
  const consigneeDigits = (rawConsigneeId.match(/\d/g) || []).join('');
  
  let consigneeId;
  if (consigneeDigits && consigneeDigits.length >= 13) {
    // Truncate to 13 if longer
    consigneeId = consigneeDigits.slice(0, 13);
  } else if (consigneeDigits && consigneeDigits.length > 0) {
    // Pad with zeros if shorter than 13
    consigneeId = consigneeDigits.padEnd(13, '0');
  } else {
    // Fallback: all zeros (will likely fail, but at least 13 digits)
    consigneeId = '0000000000000';
  }

  // ========== PHONE VALIDATION ==========
  // CJ requires: 9 digits OR 11 digits starting with 27
  // SA numbers are typically 0821234567 (10 digits)
  // Need to convert to either:
  //   - 9 digits (remove leading 0): 821234567
  //   - 11 digits (add 27 prefix): 27821234567
  const rawPhone = shippingInfo.phone || '';
  const phoneDigits = (rawPhone.match(/\d/g) || []).join('');
  
  let cjPhone;
  if (phoneDigits.length === 10 && phoneDigits.startsWith('0')) {
    // Standard SA format: 0821234567 -> remove leading 0 -> 821234567 (9 digits)
    cjPhone = phoneDigits.slice(1);
  } else if (phoneDigits.length === 10) {
    // 10 digits not starting with 0 -> add 27 -> 27xxxxxxxxx (11 digits)
    cjPhone = '27' + phoneDigits;
  } else if (phoneDigits.length === 11 && phoneDigits.startsWith('27')) {
    // Already in intl format: 27821234567 (11 digits)
    cjPhone = phoneDigits;
  } else if (phoneDigits.length === 9) {
    // Already 9 digits
    cjPhone = phoneDigits;
  } else {
    // Fallback: use whatever digits we have, or a placeholder
    cjPhone = phoneDigits.length > 0 ? phoneDigits : '0000000000';
  }

  console.log(`[buildCJOrderData] Order #${order.order_number}:`);
  console.log(`  === CONSIGNEE ID ===`);
  console.log(`  Raw shipping_id_number from DB: "${order.shipping_id_number}"`);
  console.log(`  Extracted digits: "${consigneeDigits}" (length: ${consigneeDigits.length})`);
  console.log(`  Final consigneeId (13-digit): "${consigneeId}"`);
  console.log(`  === PHONE ===`);
  console.log(`  Raw phone from DB: "${order.shipping_phone}"`);
  console.log(`  Extracted digits: "${phoneDigits}" (length: ${phoneDigits.length})`);
  console.log(`  Final CJ phone (9 or 11 digit): "${cjPhone}"`);
  console.log(`  === SHIPPING INFO ===`);
  console.log(`  Full shipping info:`, JSON.stringify(shippingInfo, null, 2));

  return {
    orderNumber: order.order_number,
    shippingCountryCode: order.shipping_country || 'ZA',
    shippingCountry: 'South Africa',
    shippingProvince: shippingInfo.province,
    shippingCity: shippingInfo.city,
    shippingCustomerName: shippingInfo.customerName,
    shippingAddress: shippingInfo.address,
    shippingPhone: cjPhone,
    shippingZip: shippingInfo.postalCode,
    consigneeID: consigneeId,
    // Do NOT send consigneeTaxNumber for South Africa; CJ flags ID conflicts
    // consigneeTaxNumber: '',
    email: order.customer_email,
    logisticName: order.shipping_method || 'USPS+',
    fromCountryCode: 'CN',
    payType: 2, // Balance payment
    products: order.items
      .filter(item => item.cj_vid) // Only include CJ products
      .map(item => ({
        vid: item.cj_vid,
        quantity: item.quantity
      })),
    remark: `SnuggleUp Order ${order.order_number}`
  };
};

