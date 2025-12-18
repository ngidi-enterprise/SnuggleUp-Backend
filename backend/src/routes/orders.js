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
        status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
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
  // Helper: Sanitize and validate phone for CJ
  // CJ requires shippingPhone to be EXACTLY 13 digits (pad with leading zeros if needed)
  const sanitizePhone = (phone) => {
    if (!phone) return '2782123456789'; // Default fallback: 13 digits
    
    // Remove all non-digits
    let digitsOnly = String(phone).replace(/\D/g, '');
    
    // If less than 9 digits, use default
    if (digitsOnly.length < 9) return '2782123456789';
    
    // If 10 digits and starts with 0 (SA format), convert to 27 format (becomes 11 digits)
    if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) {
      digitsOnly = '27' + digitsOnly.substring(1);
    }
    
    // If 11 digits starting with 0, convert to 27 format (becomes 11 digits)
    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
      digitsOnly = '27' + digitsOnly.substring(1);
    }
    
    // Pad with leading zeros to exactly 13 digits (CJ requirement)
    // Example: "27817359605" (11 digits) → "0027817359605" (13 digits)
    const padded = ('0000000000000' + digitsOnly).slice(-13);
    
    return padded;
  };

  // Helper: Sanitize postal code for CJ
  // CJ requires consignee ID to be EXACTLY 13 digits (no special characters)
  const sanitizePostalCode = (postalCode) => {
    if (!postalCode) return '1234567890123'; // Default 13 digits
    
    // Remove all non-digits, keep only numeric
    const digitsOnly = String(postalCode).replace(/\D/g, '');
    
    if (digitsOnly.length === 0) return '1234567890123';
    
    // Pad with leading zeros to exactly 13 digits
    // Example: "2196" → "0000000002196"
    const padded = ('0000000000000' + digitsOnly).slice(-13);
    
    return padded;
  };

  // Extract shipping info from order
  const shippingInfo = {
    customerName: order.customer_name || 'Customer',
    address: order.shipping_address || 'No Address',
    city: order.shipping_city || 'Johannesburg',
    province: order.shipping_province || 'Gauteng',
    postalCode: order.shipping_postal_code || '2196',
    phone: order.shipping_phone || '0821234567',
  };

  // Sanitize phone and postal code for CJ API
  const sanitizedPhone = sanitizePhone(shippingInfo.phone);
  const sanitizedPostalCode = sanitizePostalCode(shippingInfo.postalCode);

  console.log(`[buildCJOrderData] Order #${order.order_number}:`);
  console.log(`  Phone: "${shippingInfo.phone}" → "${sanitizedPhone}"`);
  console.log(`  Postal Code: "${shippingInfo.postalCode}" → "${sanitizedPostalCode}"`);
  console.log(`  Full shipping info:`, JSON.stringify(shippingInfo, null, 2));

  return {
    orderNumber: order.order_number,
    shippingCountryCode: order.shipping_country || 'ZA',
    shippingCountry: 'South Africa',
    shippingProvince: shippingInfo.province,
    shippingCity: shippingInfo.city,
    shippingCustomerName: shippingInfo.customerName,
    shippingAddress: shippingInfo.address,
    shippingPhone: sanitizedPhone,
    shippingZip: sanitizedPostalCode,
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

