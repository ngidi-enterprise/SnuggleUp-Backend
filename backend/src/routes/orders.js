import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

export const router = express.Router();

// Get all orders for logged-in user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { rows } = await db.query(
      `SELECT id, order_number, total, status, created_at, updated_at, items, subtotal, shipping, discount
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    // Parse items JSON for each order
    const ordersWithItems = rows.map(order => ({
      ...order,
      items: JSON.parse(order.items)
    }));

    res.json({ orders: ordersWithItems });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to retrieve orders' });
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
    
    console.log('🔍 About to insert order with userId:', safeUserId, 'type:', typeof safeUserId);
    
    const result = await db.query(
      `INSERT INTO orders (
        user_id, order_number, items, subtotal, shipping, discount, total, customer_email, 
        shipping_country, shipping_method, insurance_selected, insurance_cost, insurance_coverage, 
        customer_name, shipping_address, shipping_city, shipping_province, shipping_postal_code, shipping_phone,
        shipping_id_number, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`,
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
    consigneeIdNum: consigneeId,
    consigneeTaxNumber: consigneeId,
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

