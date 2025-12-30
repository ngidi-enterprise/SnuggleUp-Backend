import express from 'express';
import { pool } from '../db.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';

export const router = express.Router();

// Check if user has purchased a specific product
router.get('/can-review/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const productId = req.params.productId;

    // Check if user has purchased this product in a completed/paid order
    const result = await pool.query(
      `SELECT DISTINCT o.id as order_id, o.order_number, o.created_at
       FROM orders o
       WHERE o.user_id = $1 
         AND o.status IN ('completed', 'paid')
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(o.items::jsonb) AS item
           WHERE item->>'id' = $2
         )
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [userId, productId]
    );

    if (result.rows.length === 0) {
      return res.json({ canReview: false, reason: 'Product not purchased' });
    }

    // Check if user has already reviewed this product
    const existingReview = await pool.query(
      `SELECT id FROM customer_reviews 
       WHERE user_id = $1 AND product_id = $2`,
      [userId, productId]
    );

    if (existingReview.rows.length > 0) {
      return res.json({ 
        canReview: false, 
        reason: 'Already reviewed',
        reviewId: existingReview.rows[0].id 
      });
    }

    res.json({ 
      canReview: true, 
      orderId: result.rows[0].order_id,
      orderNumber: result.rows[0].order_number 
    });
  } catch (error) {
    console.error('Can review check error:', error);
    res.status(500).json({ error: 'Failed to check review eligibility' });
  }
});

// Submit a new review
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { productId, orderId, rating, title, comment } = req.body;

    // Validate input
    if (!productId || !orderId || !rating || !comment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    if (comment.trim().length < 10) {
      return res.status(400).json({ error: 'Review must be at least 10 characters' });
    }

    // Verify user purchased this product in this order
    const orderCheck = await pool.query(
      `SELECT id FROM orders 
       WHERE id = $1 
         AND user_id = $2 
         AND status IN ('completed', 'paid')
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(items::jsonb) AS item
           WHERE item->>'id' = $3
         )`,
      [orderId, userId, productId]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You cannot review this product (not purchased or order not completed)' });
    }

    // Check for duplicate review
    const duplicateCheck = await pool.query(
      `SELECT id FROM customer_reviews 
       WHERE user_id = $1 AND product_id = $2`,
      [userId, productId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: 'You have already reviewed this product' });
    }

    // Insert review
    const result = await pool.query(
      `INSERT INTO customer_reviews (
        user_id, product_id, order_id, rating, title, comment, verified_purchase
      ) VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING id, rating, title, comment, verified_purchase, created_at`,
      [userId, productId, orderId, rating, title || null, comment.trim()]
    );

    const review = result.rows[0];
    res.json({ 
      success: true, 
      message: 'Review submitted successfully',
      review 
    });
  } catch (error) {
    console.error('Submit review error:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// Get customer reviews for a product (combines CJ reviews + customer reviews)
router.get('/product/:productId', optionalAuth, async (req, res) => {
  try {
    const productId = req.params.productId;
    const userId = req.user?.userId;

    // Fetch customer reviews from our database
    const result = await pool.query(
      `SELECT 
        cr.id,
        cr.rating,
        cr.title,
        cr.comment,
        cr.verified_purchase,
        cr.helpful_count,
        cr.created_at,
        u.name as author_name,
        u.email as author_email
       FROM customer_reviews cr
       LEFT JOIN users u ON cr.user_id = u.id::text
       WHERE cr.product_id = $1
       ORDER BY cr.created_at DESC`,
      [productId]
    );

    const customerReviews = result.rows.map(row => ({
      id: `customer-${row.id}`,
      rating: row.rating,
      title: row.title || row.comment.slice(0, 50),
      comment: row.comment,
      author: row.author_name || 'Customer',
      verified: row.verified_purchase,
      helpful: row.helpful_count || 0,
      date: row.created_at,
      source: 'customer',
      isOwnReview: userId && row.user_id === userId
    }));

    res.json({ reviews: customerReviews });
  } catch (error) {
    console.error('Get customer reviews error:', error);
    res.status(500).json({ error: 'Failed to retrieve reviews' });
  }
});

// Delete own review (optional - for users to remove their review)
router.delete('/:reviewId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const reviewId = req.params.reviewId;

    const result = await pool.query(
      `DELETE FROM customer_reviews 
       WHERE id = $1 AND user_id = $2 
       RETURNING id`,
      [reviewId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found or not authorized' });
    }

    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

export default router;
