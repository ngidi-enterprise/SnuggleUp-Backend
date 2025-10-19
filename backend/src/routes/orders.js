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
    const { orderNumber, items, subtotal, shipping, discount, total, email } = orderData;
    const result = await db.query(
      `INSERT INTO orders (user_id, order_number, items, subtotal, shipping, discount, total, customer_email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING id`,
      [
        userId,
        orderNumber,
        JSON.stringify(items),
        subtotal,
        shipping,
        discount || 0,
        total,
        email
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
