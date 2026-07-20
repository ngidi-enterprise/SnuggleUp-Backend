import express from 'express';
import { pool } from '../db.js';
import {
  requireProductAssistantOrAdmin,
  requireSuperuser,
  ROLES,
} from '../middleware/admin.js';
import { generateProductDescription, getAvailableProviders } from '../services/descriptionGenerator.js';
import { sendProductUploadReviewEmail } from '../services/productApprovalEmail.js';

export const router = express.Router();

const APPROVAL = {
  APPROVED: 'approved',
  PENDING: 'pending_review',
};

function generateSKU(productName, existingProducts = []) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const mmyy = `${month}${year}`;
  const namePrefix = String(productName || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X');
  const pattern = `SNUG-${mmyy}-`;
  const existingNumbers = existingProducts
    .filter((product) => product.sku && product.sku.startsWith(pattern))
    .map((product) => {
      const match = product.sku.match(/SNUG-\d{4}-(\d{4})-/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((value) => !Number.isNaN(value));
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `SNUG-${mmyy}-${String(nextNumber).padStart(4, '0')}-${namePrefix}`;
}

const CATEGORY_KEYWORDS = {
  Accessories: ['accessory', 'carrier', 'bag', 'backpack', 'strap', 'holder', 'hook', 'organizer'],
  Bedding: ['crib', 'bassinet', 'mattress', 'sheet', 'blanket', 'duvet', 'comforter', 'bedding', 'sleeping bag'],
  'Baby Clothing': ['clothes', 'shirt', 'pants', 'dress', 'onesie', 'romper', 'jacket', 'coat', 'sweater', 'socks'],
  'Nursery Items': ['crib', 'bassinet', 'dresser', 'changing table', 'wardrobe', 'furniture', 'nightlight', 'lamp'],
  Toys: ['toy', 'game', 'puzzle', 'doll', 'teddy', 'rattle', 'mobile', 'play mat', 'building block'],
  Feeding: ['bottle', 'nipple', 'formula', 'feeding', 'breast pump', 'sterilizer', 'warmer', 'bibs', 'spoon', 'fork'],
  'Health & Safety': ['thermometer', 'monitor', 'safety gate', 'corner guard', 'bumper', 'outlet cover', 'helmet', 'first aid'],
  'Moms Essentials': ['nursing', 'breast', 'maternity', 'recovery', 'pillow', 'cushion', 'mom essentials'],
  'Travel / Strollers': ['stroller', 'pram', 'buggy', 'car seat', 'travel', 'portable', 'carrier', 'jogger', 'pushchair'],
  Diapering: ['diaper', 'nappy', 'pull-up', 'wipes', 'rash cream', 'diaper bag', 'changing pad'],
  'Bath & Potty': ['bath', 'bathing', 'bathtub', 'potty', 'seat', 'towel', 'wash', 'shampoo', 'soap', 'shower'],
  Bathtime: ['bath', 'bathing', 'bathtub', 'bathroom', 'wash', 'water', 'tub', 'splash', 'bath toys', 'bath time'],
};

function suggestCategory(productName, productDescription) {
  const text = `${productName} ${productDescription || ''}`.toLowerCase();
  const suggestedCategory = Object.entries(CATEGORY_KEYWORDS)
    .map(([category, keywords]) => ({
      category,
      score: keywords.filter((keyword) => text.includes(keyword)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.category;
  return suggestedCategory || null;
}

const safeArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
};

const optionalInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const optionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const productSelect = `
  id, name, description, price, compare_at_price,
  stock_quantity, sku, category, tags, images, weight_kg, dimensions,
  is_featured, is_active, approval_status, submitted_by_user_id,
  submitted_by_email, approved_by_email, approved_at,
  assistant_notification_read, review_notes, created_at, updated_at
`;

router.get('/suggest-category', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const { productName, description } = req.query;
    if (!productName) {
      return res.status(400).json({ error: 'productName query parameter required' });
    }
    res.json({ category: suggestCategory(productName, description || '') });
  } catch (error) {
    console.error('Error suggesting category:', error);
    res.status(500).json({ error: 'Failed to suggest category' });
  }
});

router.get('/generate-sku', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const { productName } = req.query;
    if (!productName) {
      return res.status(400).json({ error: 'productName query parameter required' });
    }
    const result = await pool.query('SELECT sku FROM local_products WHERE sku IS NOT NULL');
    res.json({ sku: generateSKU(productName, result.rows) });
  } catch (error) {
    console.error('Error generating SKU:', error);
    res.status(500).json({ error: 'Failed to generate SKU' });
  }
});

router.get('/description-providers', requireProductAssistantOrAdmin, async (_req, res) => {
  res.json(getAvailableProviders());
});

router.post('/generate-description', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const { provider, productName, imageBase64, imageMimeType } = req.body;
    if (!productName || !imageBase64) {
      return res.status(400).json({ error: 'Product name and image are required' });
    }
    const description = await generateProductDescription(
      { productName, imageBase64, imageMimeType },
      provider
    );
    res.json({ description, provider });
  } catch (error) {
    console.error('Description generation error:', error);
    res.status(500).json({ error: 'Failed to generate description', details: error.message });
  }
});

router.get('/manage', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const params = [];
    let where = '';

    if (req.access?.role === ROLES.PRODUCT_ASSISTANT) {
      params.push(req.access.email);
      where = 'WHERE lower(submitted_by_email) = lower($1)';
    }

    const result = await pool.query(
      `
        SELECT ${productSelect}
        FROM local_products
        ${where}
        ORDER BY
          CASE approval_status
            WHEN 'pending_review' THEN 0
            WHEN 'approved' THEN 1
            ELSE 2
          END,
          updated_at DESC NULLS LAST,
          created_at DESC
      `,
      params
    );

    res.json({ products: result.rows, count: result.rows.length, role: req.access.role });
  } catch (error) {
    console.error('Error fetching manageable local products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.get('/assistant/notifications', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    if (req.access?.role !== ROLES.PRODUCT_ASSISTANT) {
      return res.json({ notifications: [] });
    }

    const result = await pool.query(
      `
        SELECT id, name, approved_at, updated_at
        FROM local_products
        WHERE lower(submitted_by_email) = lower($1)
          AND approval_status = 'approved'
          AND assistant_notification_read = FALSE
        ORDER BY COALESCE(approved_at, updated_at, created_at) DESC
      `,
      [req.access.email]
    );

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('Error fetching product assistant notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.post('/assistant/notifications/read', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    if (req.access?.role !== ROLES.PRODUCT_ASSISTANT) {
      return res.json({ updated: 0 });
    }

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id))
      : [];

    if (ids.length === 0) {
      return res.json({ updated: 0 });
    }

    const result = await pool.query(
      `
        UPDATE local_products
        SET assistant_notification_read = TRUE
        WHERE id = ANY($1::int[])
          AND lower(submitted_by_email) = lower($2)
        RETURNING id
      `,
      [ids, req.access.email]
    );

    res.json({ updated: result.rowCount });
  } catch (error) {
    console.error('Error marking product assistant notifications read:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { category, search, inStock, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT ${productSelect}
      FROM local_products
      WHERE is_active = TRUE
        AND approval_status = 'approved'
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
      query += ' AND stock_quantity > 0';
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

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${productSelect}
       FROM local_products
       WHERE id = $1
         AND is_active = TRUE
         AND approval_status = 'approved'`,
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

router.post('/', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const {
      name, description, price, compare_at_price,
      stock_quantity, sku, category, tags,
      images, weight_kg, dimensions,
      is_featured, is_active,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const isProductAssistant = req.access?.role === ROLES.PRODUCT_ASSISTANT;
    if (!isProductAssistant && (!price || Number(price) <= 0)) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    let finalSKU = sku;
    if (!finalSKU || finalSKU.trim() === '') {
      const existingProducts = await pool.query('SELECT sku FROM local_products WHERE sku IS NOT NULL');
      finalSKU = generateSKU(name, existingProducts.rows);
    }

    const approvalStatus = isProductAssistant ? APPROVAL.PENDING : APPROVAL.APPROVED;
    const active = isProductAssistant ? false : is_active !== false;
    const insertPrice = isProductAssistant ? 0 : Number(price);
    const insertCompareAt = isProductAssistant ? null : compare_at_price || null;
    const submittedByEmail = isProductAssistant ? req.access.email : null;
    const submittedByUserId = isProductAssistant ? String(req.access.userId || '') : null;

    const result = await pool.query(
      `INSERT INTO local_products
        (name, description, price, compare_at_price, stock_quantity, sku,
         category, tags, images, weight_kg, dimensions, is_featured, is_active,
         approval_status, submitted_by_user_id, submitted_by_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10, $11::jsonb,
         $12, $13, $14, $15, $16)
       RETURNING ${productSelect}`,
      [
        name,
        description || null,
        insertPrice,
        insertCompareAt,
        optionalInt(stock_quantity) ?? 0,
        finalSKU,
        category || 'General',
        safeArray(tags),
        safeArray(images),
        optionalNumber(weight_kg),
        dimensions || null,
        isProductAssistant ? false : Boolean(is_featured),
        active,
        approvalStatus,
        submittedByUserId,
        submittedByEmail,
      ]
    );

    const product = result.rows[0];

    if (isProductAssistant) {
      sendProductUploadReviewEmail({ product, submittedBy: req.access.email })
        .then((emailResult) => {
          if (!emailResult.success) {
            console.warn('[product-approval-email] failed:', emailResult);
          }
        })
        .catch((error) => console.warn('[product-approval-email] error:', error.message));
    }

    res.status(201).json(product);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'SKU must be unique. This SKU already exists.' });
    }
    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Invalid field format. Check product dimensions.' });
    }
    console.error('Error creating local product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

router.put('/:id', requireProductAssistantOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT ${productSelect} FROM local_products WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const current = existing.rows[0];
    const isProductAssistant = req.access?.role === ROLES.PRODUCT_ASSISTANT;

    if (isProductAssistant) {
      const isOwner = String(current.submitted_by_email || '').toLowerCase() === req.access.email;
      if (!isOwner) {
        return res.status(403).json({ error: 'You can only edit products you submitted.' });
      }
      if (current.approval_status === APPROVAL.APPROVED) {
        return res.status(403).json({ error: 'Approved products can only be changed by the superuser.' });
      }

      const {
        name, description, stock_quantity, sku, category, tags,
        images, weight_kg, dimensions,
      } = req.body;

      const result = await pool.query(
        `UPDATE local_products
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             stock_quantity = COALESCE($3, stock_quantity),
             sku = COALESCE($4, sku),
             category = COALESCE($5, category),
             tags = COALESCE($6::text[], tags),
             images = COALESCE($7::text[], images),
             weight_kg = COALESCE($8, weight_kg),
             dimensions = COALESCE($9::jsonb, dimensions),
             approval_status = 'pending_review',
             is_active = FALSE,
             updated_at = NOW()
         WHERE id = $10
         RETURNING ${productSelect}`,
        [
          name,
          description,
          optionalInt(stock_quantity),
          sku,
          category,
          tags !== undefined ? safeArray(tags) : null,
          images !== undefined ? safeArray(images) : null,
          optionalNumber(weight_kg),
          dimensions || null,
          id,
        ]
      );

      return res.json(result.rows[0]);
    }

    const {
      name, description, price, compare_at_price,
      stock_quantity, sku, category, tags,
      images, weight_kg, dimensions,
      is_featured, is_active, review_notes,
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
           review_notes = COALESCE($14, review_notes),
           updated_at = NOW()
       WHERE id = $15
       RETURNING ${productSelect}`,
      [
        name,
        description,
        optionalNumber(price),
        optionalNumber(compare_at_price),
        optionalInt(stock_quantity),
        sku,
        category,
        tags !== undefined ? safeArray(tags) : null,
        images !== undefined ? safeArray(images) : null,
        optionalNumber(weight_kg),
        dimensions || null,
        is_featured,
        is_active,
        review_notes,
        id,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'SKU must be unique. This SKU already exists.' });
    }
    if (error.code === '22P02') {
      return res.status(400).json({ error: 'Invalid field format. Check product dimensions.' });
    }
    console.error('Error updating local product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.post('/:id/approve', requireSuperuser, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(`SELECT ${productSelect} FROM local_products WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const current = existing.rows[0];
    const finalPrice = req.body?.price !== undefined && req.body.price !== ''
      ? Number(req.body.price)
      : Number(current.price);

    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({ error: 'Add a valid price before approving this product.' });
    }

    const result = await pool.query(
      `UPDATE local_products
       SET price = $1,
           compare_at_price = COALESCE($2, compare_at_price),
           stock_quantity = COALESCE($3, stock_quantity),
           is_featured = COALESCE($4, is_featured),
           is_active = TRUE,
           approval_status = 'approved',
           approved_by_email = $5,
           approved_at = NOW(),
           assistant_notification_read = FALSE,
           updated_at = NOW()
       WHERE id = $6
       RETURNING ${productSelect}`,
      [
        finalPrice,
        req.body?.compare_at_price !== undefined && req.body.compare_at_price !== ''
          ? optionalNumber(req.body.compare_at_price)
          : null,
        req.body?.stock_quantity !== undefined && req.body.stock_quantity !== ''
          ? optionalInt(req.body.stock_quantity)
          : null,
        req.body?.is_featured,
        req.access.email,
        id,
      ]
    );

    res.json({ product: result.rows[0] });
  } catch (error) {
    console.error('Error approving local product:', error);
    res.status(500).json({ error: 'Failed to approve product' });
  }
});

router.delete('/:id', requireSuperuser, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE local_products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, name',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully', product: result.rows[0] });
  } catch (error) {
    console.error('Error deleting local product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

router.post('/bulk-stock-update', requireSuperuser, async (req, res) => {
  try {
    const { updates } = req.body;
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

    res.json({ updated: results.length, products: results });
  } catch (error) {
    console.error('Error bulk updating stock:', error);
    res.status(500).json({ error: 'Failed to update stock' });
  }
});
