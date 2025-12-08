import pool from '../db.js';
import { cjClient } from './cjClient.js';

/**
 * Sync product prices with current CJ prices
 * Runs daily to keep costs and retail prices up-to-date
 * @param {Object} options - Sync configuration
 * @param {number} options.limit - Max products to sync (default 50)
 * @param {string} options.syncType - 'scheduled' or 'manual'
 * @returns {Promise<Object>} Sync results
 */
export async function syncProductPrices({ limit = 50, syncType = 'scheduled' } = {}) {
  const started = Date.now();
  console.log(`[priceSync] Starting ${syncType} price sync (limit=${limit})...`);

  try {
    // Get active products with CJ PIDs, ordered by least recently updated
    const result = await pool.query(`
      SELECT id, cj_pid, product_name, cj_cost_price, custom_price 
      FROM curated_products 
      WHERE cj_pid IS NOT NULL AND is_active = TRUE
      ORDER BY updated_at ASC
      LIMIT $1
    `, [limit]);

    if (result.rows.length === 0) {
      console.log('[priceSync] No products to sync');
      return { synced: 0, priceChanges: [], errors: [], processed: 0 };
    }

    console.log(`[priceSync] Found ${result.rows.length} products to sync`);

    const priceChanges = [];
    const errors = [];
    let syncedCount = 0;

    // Load current pricing config
    const configResult = await pool.query(`SELECT key, value FROM site_config WHERE key IN ('usd_to_zar','price_markup')`);
    const configMap = Object.fromEntries(configResult.rows.map(r => [r.key, r.value]));
    const USD_TO_ZAR = parseFloat(configMap.usd_to_zar || process.env.USD_TO_ZAR || 18.0);
    const PRICE_MARKUP = parseFloat(configMap.price_markup || process.env.PRICE_MARKUP || 1.12);

    for (const product of result.rows) {
      try {
        // Fetch current CJ price
        const cjProduct = await cjClient.getProductDetails(product.cj_pid);
        const currentCJPrice = parseFloat(cjProduct.price || 0);

        if (currentCJPrice <= 0) {
          errors.push({ id: product.id, name: product.product_name, reason: 'Invalid CJ price' });
          continue;
        }

        const storedCJPrice = parseFloat(product.cj_cost_price || 0);
        const priceDiff = Math.abs(currentCJPrice - storedCJPrice);
        const percentChange = storedCJPrice > 0 ? (priceDiff / storedCJPrice) * 100 : 0;

        // Always update if price is different
        if (currentCJPrice !== storedCJPrice) {
          const costZAR = Math.round(currentCJPrice * USD_TO_ZAR * 100) / 100;
          const newRetailPrice = Math.round(costZAR * PRICE_MARKUP * 100) / 100;

          await pool.query(`
            UPDATE curated_products 
            SET cj_cost_price = $1, 
                suggested_price = $2,
                custom_price = $3,
                updated_at = NOW()
            WHERE id = $4
          `, [currentCJPrice, newRetailPrice, newRetailPrice, product.id]);

          // Log significant changes (>0.5%)
          if (percentChange > 0.5) {
            priceChanges.push({
              id: product.id,
              name: product.product_name,
              oldCostUSD: storedCJPrice,
              newCostUSD: currentCJPrice,
              oldPriceZAR: product.custom_price,
              newPriceZAR: newRetailPrice,
              percentChange: Math.round(percentChange * 10) / 10,
              increased: currentCJPrice > storedCJPrice
            });
          }

          syncedCount++;
        }
      } catch (err) {
        errors.push({ id: product.id, name: product.product_name, reason: err.message });
        console.error(`[priceSync] Failed for ${product.cj_pid}:`, err.message);
      }
    }

    const elapsed = Date.now() - started;
    const summary = {
      synced: syncedCount,
      priceChanges,
      errors,
      processed: result.rows.length,
      elapsed
    };

    if (priceChanges.length > 0) {
      console.log(`[priceSync] ✓ Synced ${syncedCount} products, ${priceChanges.length} significant changes in ${elapsed}ms`);
      priceChanges.slice(0, 5).forEach(c => {
        console.log(`  • ${c.name}: $${c.oldCostUSD} → $${c.newCostUSD} (${c.increased ? '↑' : '↓'}${c.percentChange}%)`);
      });
    } else {
      console.log(`[priceSync] ✓ Synced ${syncedCount} products, no significant changes in ${elapsed}ms`);
    }

    if (errors.length > 0) {
      console.warn(`[priceSync] ⚠️ ${errors.length} errors:`, errors.slice(0, 3));
    }

    return summary;
  } catch (error) {
    console.error('[priceSync] Fatal error:', error);
    throw error;
  }
}
