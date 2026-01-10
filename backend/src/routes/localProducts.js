import express from 'express';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

export const router = express.Router();

// Get all local products (public)
router.get('/', async (req, res) => {
  try {
    const { category, search, inStock, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        id, name, description, price, compare_at_price, 
        stock_quantity, sku, category, tags, 
        images, weight_kg, dimensions,
        is_featured, is_active, created_at, updated_at
      FROM local_products
      WHERE is_active = true
    `;
    const params = [];
    let paramCount = 0;

    if (category) {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(category);
    }

    if (search) {
      paramCount++;
      query += ` AND (name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (inStock === 'true') {
      query += ` AND stock_quantity > 0`;
    }

    query += ` ORDER BY is_featured DESC, created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ products: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching local products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get single local product (public)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM local_products WHERE id = $1 AND is_active = true',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching local product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Create local product (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      name, description, price, compare_at_price,
      stock_quantity, sku, category, tags,
      images, weight_kg, dimensions,
      is_featured, is_active
    } = req.body;

    if (!name || !price || stock_quantity === undefined) {
      return res.status(400).json({ error: 'Name, price, and stock_quantity are required' });
    }

    const result = await pool.query(
      `INSERT INTO local_products 
        (name, description, price, compare_at_price, stock_quantity, sku, 
         category, tags, images, weight_kg, dimensions, is_featured, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        name, description, price, compare_at_price || null,
        stock_quantity, sku || null, category || 'General',
        tags || [], images || [], weight_kg || null,
        dimensions || null, is_featured || false, is_active !== false
      ]
    );

    console.log(`✅ Local product created: ${name} (ID: ${result.rows[0].id})`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating local product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Update local product (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, description, price, compare_at_price,
      stock_quantity, sku, category, tags,
      images, weight_kg, dimensions,
      is_featured, is_active
    } = req.body;

    const result = await pool.query(
      `UPDATE local_products 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           compare_at_price = $4,
           stock_quantity = COALESCE($5, stock_quantity),
           sku = $6,
           category = COALESCE($7, category),
           tags = COALESCE($8, tags),
           images = COALESCE($9, images),
           weight_kg = $10,
           dimensions = $11,
           is_featured = COALESCE($12, is_featured),
           is_active = COALESCE($13, is_active),
           updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        name, description, price, compare_at_price,
        stock_quantity, sku, category, tags, images,
        weight_kg, dimensions, is_featured, is_active, id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log(`✅ Local product updated: ${result.rows[0].name} (ID: ${id})`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating local product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete local product (admin only - soft delete)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE local_products SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id, name',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log(`✅ Local product deleted: ${result.rows[0].name} (ID: ${req.params.id})`);
    res.json({ message: 'Product deleted successfully', product: result.rows[0] });
  } catch (error) {
    console.error('Error deleting local product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Bulk update stock (admin only)
router.post('/bulk-stock-update', requireAdmin, async (req, res) => {
  try {
    const { updates } = req.body; // Array of { id, stock_quantity }
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Updates must be an array' });
    }

    const results = [];
    for (const update of updates) {
      const result = await pool.query(
        'UPDATE local_products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, stock_quantity',
        [update.stock_quantity, update.id]
      );
      if (result.rows.length > 0) {
        results.push(result.rows[0]);
      }
    }

    console.log(`✅ Bulk stock update: ${results.length} products updated`);
    res.json({ updated: results.length, products: results });
  } catch (error) {
    console.error('Error bulk updating stock:', error);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});
