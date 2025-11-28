-- Fix suggested prices for all products
-- Recalculates: suggested_price = cj_cost_price (USD) * 19.0 * 1.5

UPDATE curated_products 
SET 
  suggested_price = ROUND((cj_cost_price * 19.0 * 1.5) * 100) / 100,
  updated_at = NOW()
WHERE TRUE
RETURNING id, product_name, cj_cost_price AS cost_usd, suggested_price AS new_suggested_price;
