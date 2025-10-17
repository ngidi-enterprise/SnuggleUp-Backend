import express from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

export const router = express.Router();

// Get all orders for logged-in user
router.get('/history', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;

    const orders = db.prepare(`
      SELECT 
        id, order_number, total, status, 
        created_at, updated_at, items, 
        subtotal, shipping, discount
      FROM orders 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).all(userId);

    // Parse items JSON for each order
    const ordersWithItems = orders.map(order => ({
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
router.get('/:orderId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const orderId = req.params.orderId;

    const order = db.prepare(`
      SELECT * FROM orders 
      WHERE id = ? AND user_id = ?
    `).get(orderId, userId);

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
export const createOrder = (userId, orderData) => {
  try {
    const { orderNumber, items, subtotal, shipping, discount, total, email } = orderData;

    const result = db.prepare(`
      INSERT INTO orders (
        user_id, order_number, items, subtotal, 
        shipping, discount, total, customer_email, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      userId,
      orderNumber,
      JSON.stringify(items),
      subtotal,
      shipping,
      discount || 0,
      total,
      email
    );

    return result.lastInsertRowid;
  } catch (error) {
    console.error('Create order error:', error);
    throw error;
  }
};

// Update order status (called from PayFast webhook)
export const updateOrderStatus = (orderNumber, status, payfastPaymentId) => {
  try {
    db.prepare(`
      UPDATE orders 
      SET status = ?, payfast_payment_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE order_number = ?
    `).run(status, payfastPaymentId, orderNumber);

    return true;
  } catch (error) {
    console.error('Update order status error:', error);
    throw error;
  }
};
