import express from 'express';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

export const router = express.Router();

// SKU Generator Utility
function generateSKU(productName, existingProducts = []) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const mmyy = `${month}${year}`;
  
  // Get first 3 alphanumeric characters of product name (uppercase)
  const namePrefix = productName
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X'); // Pad with X if less than 3 chars
  
  // Find highest existing sequence number for this month/year
  const pattern = `SNUG-${mmyy}-`;
  const existingNumbers = existingProducts
    .filter(p => p.sku && p.sku.startsWith(pattern))
    .map(p => {
      const match = p.sku.match(/SNUG-\d{4}-(\d{4})-/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => !isNaN(n));
  
  const nextNumber = existingNumbers.length > 0 
    ? Math.max(...existingNumbers) + 1 
    : 1;
  
  const sequenceNum = String(nextNumber).padStart(4, '0');
  
  return `SNUG-${mmyy}-${sequenceNum}-${namePrefix}`;
}

// Category Suggestion Utility
const CATEGORY_KEYWORDS = {
  'Accessories': ['accessory', 'carrier', 'bag', 'backpack', 'strap', 'holder', 'hook', 'organizer'],
  'Bedding': ['crib', 'bassinet', 'mattress', 'sheet', 'blanket', 'duvet', 'comforter', 'bedding', 'sleeping bag'],
  'Baby Clothing': ['clothes', 'shirt', 'pants', 'dress', 'onesie', 'romper', 'jacket', 'coat', 'sweater', 'socks'],
  'Nursery Items': ['crib', 'bassinet', 'dresser', 'changing table', 'wardrobe', 'furniture', 'nightlight', 'lamp'],
  'Toys': ['toy', 'game', 'puzzle', 'doll', 'teddy', 'rattle', 'mobile', 'play mat', 'building block'],
  'Feeding': ['bottle', 'nipple', 'formula', 'feeding', 'breast pump', 'sterilizer', 'warmer', 'bibs', 'spoon', 'fork'],
  'Health & Safety': ['thermometer', 'monitor', 'safety gate', 'corner guard', 'bumper', 'outlet cover', 'helmet', 'first aid'],
  'Moms Essentials': ['nursing', 'breast', 'maternity', 'recovery', 'pillow', 'cushion', 'mom essentials'],
  'Travel / Strollers': ['stroller', 'pram', 'buggy', 'car seat', 'travel', 'portable', 'carrier', 'jogger', 'pushchair'],
  'Diapering': ['diaper', 'nappy', 'pull-up', 'wipes', 'rash cream', 'diaper bag', 'changing pad']
};

function suggestCategory(productName, productDescription) {
  const text = `${productName} ${productDescription || ''}`.toLowerCase();
  const scores = {};
  
  // Score each category based on keyword matches
  Object.entries(CATEGORY_KEYWORDS).forEach(([category, keywords]) => {
    scores[category] = keywords.filter(keyword => text.includes(keyword)).length;
  });
  
  // Find category with highest score
  const suggestedCategory = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  
  return suggestedCategory || null;
}

// Suggest category (admin only)
router.get('/suggest-category', requireAdmin, async (req, res) => {
  try {
    const { productName, description } = req.query;
    
    if (!productName) {
      return res.status(400).json({ error: 'productName query parameter required' });
    }
    
    const suggestedCategory = suggestCategory(productName, description || '');
    res.json({ category: suggestedCategory });
  } catch (error) {
    console.error('Error suggesting category:', error);
    res.status(500).json({ error: 'Failed to suggest category' });
  }
});

// Generate SKU preview (admin only)
router.get('/generate-sku', requireAdmin, async (req, res) => {
  try {
    const { productName } = req.query;
    
    if (!productName) {
      return res.status(400).json({ error: 'productName query parameter required' });
    }
    
    // Fetch existing products to determine next sequence number
    const result = await pool.query('SELECT sku FROM local_products WHERE sku IS NOT NULL');
    const generatedSKU = generateSKU(productName, result.rows);
    
    res.json({ sku: generatedSKU });
  } catch (error) {
    console.error('Error generating SKU:', error);
    res.status(500).json({ error: 'Failed to generate SKU' });
  }
});

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

    // Auto-generate SKU if not provided
    let finalSKU = sku;
    if (!finalSKU || finalSKU.trim() === '') {
      const existingProducts = await pool.query('SELECT sku FROM local_products WHERE sku IS NOT NULL');
      finalSKU = generateSKU(name, existingProducts.rows);
      console.log(`📝 Auto-generated SKU: ${finalSKU} for product: ${name}`);
    }

    const result = await pool.query(
      `INSERT INTO local_products 
        (name, description, price, compare_at_price, stock_quantity, sku, 
         category, tags, images, weight_kg, dimensions, is_featured, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        name, description, price, compare_at_price || null,
        stock_quantity, finalSKU, category || 'General',
        tags || [], images || [], weight_kg || null,
        dimensions || null, is_featured || false, is_active !== false
      ]
    );

    console.log(`✅ Local product created: ${name} (ID: ${result.rows[0].id})`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    // Handle common DB errors with clearer messages
    if (error.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'SKU must be unique. This SKU already exists.' });
    }
    if (error.code === '22P02') { // invalid_text_representation (e.g., JSON parse)
      return res.status(400).json({ error: 'Invalid field format (check JSON for dimensions).' });
    }
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
           compare_at_price = COALESCE($4, compare_at_price),
           stock_quantity = COALESCE($5, stock_quantity),
           sku = COALESCE($6, sku),
           category = COALESCE($7, category),
           tags = COALESCE($8::text[], tags),
           images = COALESCE($9::text[], images),
           weight_kg = COALESCE($10, weight_kg),
           dimensions = COALESCE($11::jsonb, dimensions),
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
    // Handle common DB errors with clearer messages
    if (error.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'SKU must be unique. This SKU already exists.' });
    }
    if (error.code === '22P02') { // invalid_text_representation (e.g., JSON parse)
      return res.status(400).json({ error: 'Invalid field format (check JSON for dimensions).' });
    }
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
