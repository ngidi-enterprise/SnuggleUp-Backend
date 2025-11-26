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
      insurance
    } = orderData;
    
    const result = await db.query(
      `INSERT INTO orders (
        user_id, order_number, items, subtotal, shipping, discount, total, customer_email, 
        shipping_country, shipping_method, insurance_selected, insurance_cost, insurance_coverage, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending') RETURNING id`,
      [
        userId,
        orderNumber,
        JSON.stringify(items),
        subtotal,
        shipping,
        discount || 0,
        total,
        email,
        shippingCountry || 'ZA',
        shippingMethod || 'STANDARD',
        insurance?.selected || false,
        insurance?.cost || 0,
        insurance?.coverage || 0
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
  // Extract shipping info from order (you may need to add these fields to your orders table)
  // For now, using placeholder data - you'll need to collect this during checkout
  const shippingInfo = {
    customerName: order.customer_name || 'Customer Name', // Add to checkout form
    address: order.shipping_address || 'Address Line 1', // Add to checkout form
    city: order.shipping_city || 'Johannesburg', // Add to checkout form
    province: order.shipping_province || 'Gauteng', // Add to checkout form
    postalCode: order.shipping_postal_code || '2196', // Add to checkout form
    phone: order.shipping_phone || '0821234567', // Add to checkout form
  };

  return {
    orderNumber: order.order_number,
    shippingCountryCode: order.shipping_country || 'ZA',
    shippingCountry: 'South Africa',
    shippingProvince: shippingInfo.province,
    shippingCity: shippingInfo.city,
    shippingCustomerName: shippingInfo.customerName,
    shippingAddress: shippingInfo.address,
    shippingPhone: shippingInfo.phone,
    shippingZip: shippingInfo.postalCode,
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

