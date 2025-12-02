# Automatic Sold Out Management for Low Stock Products

## Overview
This document describes the automatic sold out system that prevents customers from purchasing products with insufficient supplier (CJ Dropshipping) inventory.

## Business Rule
**Products with less than 20 units in CJ warehouse stock are automatically marked as "Sold Out" and cannot be purchased.**

### Why 20 units?
- Ensures reliable fulfillment from CJ Dropshipping
- Prevents order failures due to temporary stock fluctuations
- Maintains customer trust by only showing items we can reliably ship
- Accounts for potential inventory sync delays

## System Components

### 1. Backend Stock Validation

#### Products Route (`backend/src/routes/products.js`)
- **Already implemented**: Aggregates CJ inventory from `curated_product_inventories` table
- Automatically sets `stock_quantity = 0` when CJ stock < 20
- Applied to both catalog listing and individual product detail endpoints

```javascript
// Apply stock rules: CJ stock < 20 = sold out
for (const [id, product] of Object.entries(productsMap)) {
  const cjStock = stockMap[id] || 0;
  if (cjStock < 20) {
    product.stock_quantity = 0; // Mark as sold out
  }
}
```

#### Cart Route (`backend/src/routes/cart.js`)
- **Enhanced**: Validates stock before saving cart
- Rejects cart save if any item has CJ stock < 20
- Returns clear error message listing sold out items

```javascript
// Products with CJ stock < 20 are considered sold out
if (cjStock < 20) {
  soldOutItems.push(row.product_name);
}

if (soldOutItems.length > 0) {
  return res.status(400).json({
    error: 'Some items in your cart are sold out',
    soldOutItems,
    message: `The following items are currently sold out (less than 20 in stock)...`
  });
}
```

#### Payment Route (`backend/src/routes/payments.js`)
- **Enhanced**: Final validation before payment processing
- Prevents checkout if any cart item has CJ stock < 20
- Last line of defense to ensure no sold out items are purchased

```javascript
// Products with CJ stock < 20 are considered sold out
if (cjStock < 20) {
  soldOutItems.push(row.product_name);
}

if (soldOutItems.length > 0) {
  return res.status(400).json({
    error: 'Cannot complete payment - some items are sold out',
    soldOutItems,
    message: `...Please remove them from your cart.`
  });
}
```

### 2. Frontend User Interface

#### Catalog Display (`frontend/src/components/CJCatalog.jsx`)
- **Already implemented**: Shows "OUT OF STOCK" badge when `stock_quantity = 0`
- Red badge prominently displayed on product cards
- Visual indicator prevents accidental attempts to purchase

```jsx
{isOutOfStock && (
  <div style={{
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: '#e74c3c',
    color: 'white',
    padding: '4px 10px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    zIndex: 10,
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
  }}>
    OUT OF STOCK
  </div>
)}
```

#### Add to Cart Validation (`frontend/src/App.jsx`)
- **Enhanced**: Both `addToCart` and `addToCartCj` functions check stock
- Shows alert message if user tries to add sold out item
- Prevents adding more than available stock

```javascript
const addToCart = (product) => {
  const stockQty = typeof product.stock_quantity === 'number' 
    ? product.stock_quantity 
    : Number(product.stock_quantity || 0);
  
  if (stockQty === 0) {
    alert('Sorry, this item is currently sold out and cannot be added to your cart.');
    return;
  }
  
  // Check if adding would exceed available stock
  if (existingItem && existingItem.quantity >= stockQty) {
    alert(`Only ${stockQty} available in stock.`);
    return;
  }
  // ... add to cart logic
}
```

#### Product Detail Modal (`frontend/src/components/CJProductDetail.jsx` & `ProductDetail.jsx`)
- **Already implemented**: Disables "Add to Cart" button when out of stock
- Shows "😔 Sold Out - Check Again Soon" message
- Button styling changes (gray background, not-allowed cursor)
- Variant selection also handles per-variant stock status

```jsx
<button 
  className="add-to-cart-btn" 
  onClick={handleAdd}
  disabled={isOutOfStock}
  style={{
    opacity: isOutOfStock ? 0.8 : 1,
    cursor: isOutOfStock ? 'not-allowed' : 'pointer',
    background: isOutOfStock ? '#95a5a6' : undefined,
  }}
>
  {isOutOfStock ? '😔 Sold Out - Check Again Soon' : '🛒 Add to Cart'}
</button>
```

## Data Flow

### Inventory Sync Process
1. **Automated sync** (`backend/src/services/inventorySync.js`) runs every 15 minutes
2. Fetches latest CJ inventory via `cjClient.getInventory(vid)`
3. Aggregates `cjInventory` (ready-to-ship stock) across all warehouses
4. Updates `curated_products.stock_quantity` and `is_active` status
5. If CJ stock < 20, sets `is_active = FALSE` and `stock_quantity = 0`

### User Purchase Attempt Flow
1. **User views catalog**: Sees "OUT OF STOCK" badge on products with `stock_quantity = 0`
2. **User clicks product**: Detail modal shows disabled "Add to Cart" button if sold out
3. **User tries to add**: Frontend blocks with alert message
4. **User saves cart** (if auth): Backend validates and rejects if CJ stock < 20
5. **User proceeds to checkout**: Payment route performs final CJ stock validation
6. **Payment blocked**: User receives clear error listing sold out items

## Multi-Layer Protection

The system uses **defense in depth** with 5 validation layers:

1. ✅ **Inventory Sync Service** - Auto-deactivates products when CJ stock < 20
2. ✅ **Products API** - Returns `stock_quantity = 0` for low stock items
3. ✅ **Frontend UI** - Shows sold out badges and disables buttons
4. ✅ **Frontend Cart Logic** - Validates stock before adding to cart
5. ✅ **Cart API** - Validates on cart save (authenticated users)
6. ✅ **Payment API** - Final validation before payment processing

## Error Messages

### User-Facing Messages
- **Catalog**: "OUT OF STOCK" badge (red)
- **Product detail**: "😔 Sold Out - Check Again Soon"
- **Add to cart attempt**: "Sorry, this item is currently sold out and cannot be added to your cart."
- **Cart save rejection**: "The following items are currently sold out (less than 20 in stock) and cannot be purchased: [Product Names]"
- **Payment rejection**: "Cannot complete payment - some items are sold out. The following items are currently sold out (less than 20 in stock) and cannot be purchased: [Product Names]. Please remove them from your cart."

### Admin/Debug Messages
- Console logs include CJ stock levels during validation
- Stock sync history tracks inventory updates in `inventory_sync_history` table
- Error logs include product IDs and CJ stock counts for troubleshooting

## Configuration

### Stock Threshold
The 20-unit threshold is currently hardcoded in:
- `backend/src/services/inventorySync.js` (line ~72)
- `backend/src/routes/products.js` (line ~75)
- `backend/src/routes/cart.js` (line ~42)
- `backend/src/routes/payments.js` (line ~60)

To change the threshold, update the `< 20` comparisons in these files.

### Sync Interval
Inventory sync runs every 15 minutes by default:
- Configured in `backend/src/server.js`
- Environment variable: `CJ_INVENTORY_SYNC_INTERVAL_MS`
- Default: `15 * 60 * 1000` (900,000ms = 15 minutes)

## Testing

### Manual Testing Steps
1. Find a product with CJ stock < 20 via admin dashboard
2. Verify "OUT OF STOCK" badge appears in catalog
3. Attempt to click product detail - verify button is disabled
4. Try to add via cart (if enabled) - verify alert message appears
5. If item somehow gets in cart, try checkout - verify payment rejection

### Automated Testing
- Backend unit tests should validate stock checks in cart/payment routes
- Frontend tests should verify button states based on `stock_quantity`
- Integration tests should test full purchase flow rejection

## Monitoring

### Check Inventory Sync Status
```bash
GET /api/cj/inventory/sync-status
```
Returns:
- Last successful sync timestamp
- Number of products updated
- Whether a sync is currently running
- Next scheduled sync time

### View Sync History
```bash
GET /api/cj/inventory/sync-history?limit=20
```
Shows recent sync runs with:
- Products updated/failed counts
- Duration
- Error messages (if any)

## Troubleshooting

### Product shows as in-stock but has low CJ inventory
1. Check last sync timestamp: `GET /api/cj/inventory/sync-status`
2. If sync is stale (>20 min), trigger manual sync: `POST /api/cj/inventory/sync` (admin only)
3. Verify CJ API is responding: `GET /api/cj/health`

### User bypassed validation and purchased sold-out item
1. Check inventory sync logs in `inventory_sync_history` table
2. Review payment webhook logs for CJ order creation response
3. If CJ rejects order, they will notify via webhook (handled in `backend/src/routes/cj.js`)
4. Customer service should proactively contact customer and offer alternatives

### Stock showing 0 but CJ has inventory
1. Verify CJ stock is >= 20 (not just > 0)
2. Check if `is_active = FALSE` in `curated_products` table
3. Review last inventory sync for that product ID
4. Manually trigger sync for specific products if needed

## Future Enhancements

### Potential Improvements
- [ ] Make stock threshold configurable per product category
- [ ] Add "Notify when back in stock" feature
- [ ] Show estimated restock date based on CJ data
- [ ] Implement partial order fulfillment (buy available stock only)
- [ ] Add admin override to sell below threshold (backorder mode)
- [ ] Real-time stock updates via CJ webhooks (if supported)

## Related Documentation
- `INVENTORY_SYNC_MONITORING.md` - Detailed inventory sync process
- `STOCK_MANAGEMENT.md` - Overall stock management strategy
- `CJ_API_REFERENCE.md` - CJ Dropshipping API integration
- `backend/src/services/inventorySync.js` - Sync service implementation

## Summary

The automatic sold out system ensures customers can only purchase products with reliable CJ inventory (>= 20 units). The multi-layer validation approach prevents sold out items from being:
1. ✅ Displayed as available
2. ✅ Added to cart
3. ✅ Saved in cart (authenticated users)
4. ✅ Checked out
5. ✅ Paid for

This protects both customer experience and business reputation by only accepting orders we can fulfill.
