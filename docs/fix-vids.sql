-- SQL Script to Check and Fix Missing CJ Variant IDs
-- Run this in Render Dashboard → PostgreSQL → Connect → PSQL Console

-- ==================================================
-- STEP 1: Check which products are missing cj_vid
-- ==================================================

SELECT 
  id,
  product_name,
  cj_pid,
  cj_vid,
  CASE 
    WHEN cj_vid IS NULL OR cj_vid = '' THEN '❌ MISSING'
    ELSE '✅ HAS VID'
  END as status
FROM curated_products 
WHERE is_active = TRUE
ORDER BY id;

-- ==================================================
-- STEP 2: See how many are missing
-- ==================================================

SELECT 
  COUNT(*) FILTER (WHERE cj_vid IS NOT NULL AND cj_vid != '') as with_vid,
  COUNT(*) FILTER (WHERE cj_vid IS NULL OR cj_vid = '') as missing_vid,
  COUNT(*) as total
FROM curated_products 
WHERE is_active = TRUE;

-- ==================================================
-- STEP 3: For each product missing VID, you need to:
-- ==================================================

-- 1. Go to CJ website and find the product
-- 2. Get the variant ID (vid) for the specific color/size
-- 3. Run an UPDATE query like this:

-- Example (replace with your actual data):
-- UPDATE curated_products 
-- SET cj_vid = 'D4057F56-3F09-4541-8461-9D76D014846D',
--     updated_at = NOW()
-- WHERE id = 1;

-- ==================================================
-- STEP 4: Verify the fix worked
-- ==================================================

-- After updating, run this to confirm:
SELECT 
  id,
  product_name,
  cj_vid,
  updated_at
FROM curated_products 
WHERE is_active = TRUE
AND cj_vid IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;

-- ==================================================
-- ALTERNATIVE: Get VID from CJ API
-- ==================================================

-- If you know the CJ Product ID (cj_pid), you can:
-- 1. Visit: https://snuggleup-backend.onrender.com/api/cj/products/YOUR-CJ-PID
-- 2. Look in the response for "variants" array
-- 3. Copy the "vid" from the first variant
-- 4. Use it in the UPDATE query above

-- Example for product with cj_pid = 'ABC123':
-- GET https://snuggleup-backend.onrender.com/api/cj/products/ABC123
-- Response will include: { "variants": [{ "vid": "XYZ789", ... }] }
-- Then: UPDATE curated_products SET cj_vid = 'XYZ789' WHERE cj_pid = 'ABC123';

-- ==================================================
-- QUICK FIX: If you have just a few products
-- ==================================================

-- List products that need VIDs with their CJ PIDs:
SELECT 
  id,
  product_name,
  cj_pid,
  'UPDATE curated_products SET cj_vid = ''PASTE-VID-HERE'', updated_at = NOW() WHERE id = ' || id || ';' as update_query
FROM curated_products 
WHERE is_active = TRUE
AND (cj_vid IS NULL OR cj_vid = '')
ORDER BY id;

-- This will generate UPDATE queries for you - just replace 'PASTE-VID-HERE' with actual VIDs
