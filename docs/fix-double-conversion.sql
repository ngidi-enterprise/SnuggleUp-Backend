-- Fix product #51 (and any others) that got double-converted
-- This divides the inflated ZAR prices by 18.5 to undo the double conversion

-- Check current prices first
SELECT id, product_name, cj_cost_price, suggested_price, custom_price 
FROM curated_products 
WHERE id = 51;

-- Fix the double-converted prices (divide by USD_TO_ZAR to undo extra conversion)
UPDATE curated_products 
SET 
  cj_cost_price = ROUND(cj_cost_price / 18.90, 2),
  suggested_price = ROUND(suggested_price / 18.90, 2),
  custom_price = ROUND(custom_price / 18.90, 2)
WHERE id = 51;

-- Verify the fix
SELECT id, product_name, cj_cost_price, suggested_price, custom_price 
FROM curated_products 
WHERE id = 51;

-- If there are other products added during the buggy period, run this:
-- (Check for products with suspiciously high prices - over R1000 for baby items)
-- SELECT id, product_name, cj_cost_price, suggested_price FROM curated_products WHERE cj_cost_price > 1000;
-- Then manually apply the same UPDATE with the specific IDs if needed
