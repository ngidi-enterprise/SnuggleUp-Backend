import { cjClient } from './cjClient.js';
import pool from '../db.js';

/**
 * Sync inventory for curated products from CJ.
 * Strategy:
 *  - Fetch all curated products with cj_pid (and optional cj_vid)
 *  - For each product, ensure we have a variant id (cj_vid); if missing, fetch product details and pick first variant
 *  - Call CJ inventory endpoint per variant (throttled by cjClient)
 *  - Aggregate totalInventory across warehouses -> stock_quantity on curated_products
 *  - Upsert detailed warehouse rows into curated_product_inventories (one row per warehouse)
 *  - Skip products with no cj_vid even after detail lookup
 *  - Return summary with counts and failures
 *  - Log sync run to inventory_sync_history table
 */
export async function syncCuratedInventory({ limit, syncType = 'scheduled' } = {}) {
  const startTime = new Date();
  const failures = [];
  const updated = [];
  const details = [];

  // Create sync history record
  const historyResult = await pool.query(
    `INSERT INTO inventory_sync_history (started_at, status, sync_type) 
     VALUES ($1, 'running', $2) RETURNING id`,
    [startTime, syncType]
  );
  const syncHistoryId = historyResult.rows[0].id;

  try {
    // Optional LIMIT to reduce API usage
    const limitClause = limit ? 'WHERE is_active = TRUE ORDER BY updated_at ASC LIMIT $1' : 'WHERE is_active = TRUE';
    const productsRes = limit
      ? await pool.query(`SELECT id, cj_pid, cj_vid FROM curated_products ${limitClause}`, [limit])
      : await pool.query(`SELECT id, cj_pid, cj_vid FROM curated_products ${limitClause}`);

    for (const row of productsRes.rows) {
      const { id, cj_pid } = row;
      let { cj_vid } = row;

      try {
        // Attempt to derive cj_vid if missing by fetching product details
        if (!cj_vid && cj_pid) {
          try {
            const productDetails = await cjClient.getProductDetails(cj_pid);
            cj_vid = productDetails?.variants?.[0]?.vid || null;
            if (cj_vid) {
              await pool.query('UPDATE curated_products SET cj_vid = $1, updated_at = NOW() WHERE id = $2', [cj_vid, id]);
            }
          } catch (e) {
            // Soft failure; we'll skip if still missing
            console.warn(`Failed to fetch details for pid ${cj_pid}:`, e.message);
          }
        }

        if (!cj_vid) {
          failures.push({ id, cj_pid, reason: 'Missing cj_vid' });
          continue;
        }

        // Fetch inventory per variant
        const inventory = await cjClient.getInventory(cj_vid);
        
        // Calculate CJ warehouse stock only (ready to ship) - IGNORE factory stock
        const cjStock = inventory.reduce((sum, w) => sum + (Number(w.cjInventory) || 0), 0);
        
        // CRITICAL: Keep products active even if out of stock - they still show on storefront with "OUT OF STOCK" badge
        // Only deactivate if explicitly set by admin or product has other issues
        const shouldBeActive = true; // Always keep active to show out of stock items
        
        // Store stock_quantity based on threshold:
        // - If CJ stock ≤ 20: set stock_quantity = 0 (shows "OUT OF STOCK" badge)
        // - If CJ stock > 20: set stock_quantity = actual CJ stock
        const stockQuantity = cjStock <= 20 ? 0 : cjStock;
        
        await pool.query(
          'UPDATE curated_products SET stock_quantity = $1, is_active = $2, updated_at = NOW() WHERE id = $3',
          [stockQuantity, shouldBeActive, id]
        );

        // Upsert warehouse rows; simplest strategy: delete old rows then insert
        await pool.query('DELETE FROM curated_product_inventories WHERE curated_product_id = $1', [id]);
        for (const w of inventory) {
          await pool.query(
            `INSERT INTO curated_product_inventories (
               curated_product_id, cj_pid, cj_vid, warehouse_id, warehouse_name, country_code, total_inventory, cj_inventory, factory_inventory, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
            [
              id,
              cj_pid,
              cj_vid,
              w.warehouseId,
              w.warehouseName,
              w.countryCode,
              w.totalInventory,
              w.cjInventory,
              w.factoryInventory
            ]
          );
        }

        updated.push({ id, cj_pid, cj_vid, cjStock, warehouses: inventory.length });
        details.push({ id, cj_pid, cj_vid, inventory });
      } catch (err) {
        console.error('Inventory sync error for product', id, cj_pid, err.message);
        failures.push({ id, cj_pid, cj_vid, reason: err.message });
      }
    }

    // Update sync history with success
    await pool.query(
      `UPDATE inventory_sync_history 
       SET completed_at = NOW(), 
           products_updated = $1, 
           products_failed = $2, 
           status = 'completed'
       WHERE id = $3`,
      [updated.length, failures.length, syncHistoryId]
    );

    return {
      ok: true,
      processed: productsRes.rows.length,
      updated: updated.length,
      failures: failures.length,
      updatedProducts: updated,
      failuresList: failures,
      syncHistoryId,
    };
  } catch (err) {
    // Update sync history with error
    await pool.query(
      `UPDATE inventory_sync_history 
       SET completed_at = NOW(), 
           products_failed = $1, 
           status = 'failed',
           error_message = $2
       WHERE id = $3`,
      [failures.length, err.message, syncHistoryId]
    );
    
    throw err;
  }
}

/**
 * Lightweight getter to read current warehouse inventory for curated products.
 */
export async function getCuratedInventorySnapshot() {
  const rows = await pool.query(`
    SELECT c.id as curated_product_id, c.product_name, c.cj_pid, c.cj_vid, c.stock_quantity,
           i.warehouse_id, i.warehouse_name, i.country_code, i.total_inventory, i.cj_inventory, i.factory_inventory,
           i.updated_at
    FROM curated_products c
    LEFT JOIN curated_product_inventories i ON c.id = i.curated_product_id
    WHERE c.is_active = TRUE
    ORDER BY c.id, i.warehouse_id
  `);

  const grouped = {};
  for (const r of rows.rows) {
    if (!grouped[r.curated_product_id]) {
      grouped[r.curated_product_id] = {
        curatedProductId: r.curated_product_id,
        productName: r.product_name,
        cj_pid: r.cj_pid,
        cj_vid: r.cj_vid,
        stock_quantity: r.stock_quantity,
        warehouses: []
      };
    }
    if (r.warehouse_id) {
      grouped[r.curated_product_id].warehouses.push({
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        countryCode: r.country_code,
        totalInventory: r.total_inventory,
        cjInventory: r.cj_inventory,
        factoryInventory: r.factory_inventory,
        updated_at: r.updated_at
      });
    }
  }

  return Object.values(grouped);
}

export default { syncCuratedInventory, getCuratedInventorySnapshot };
