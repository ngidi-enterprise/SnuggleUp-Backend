# Final Configuration: 1000+ Products with 2-Hour Inventory Sync

## Changes Made

### 1. Inventory Sync Frequency
**Before:** Every 15 minutes (96 runs/day)  
**After:** Every 2 hours (12 runs/day)

**Configuration:**
```bash
CJ_INVENTORY_SYNC_INTERVAL_MS=7200000  # 2 hours = 7,200,000ms
CJ_INVENTORY_SYNC_BATCH_LIMIT=50
```

### 2. Out of Stock Threshold
**Before:** CJ stock ≤ 20 units  
**After:** Total stock (CJ + factory) < 100 units

**Updated in:** `backend/src/routes/cart.js`
- Now checks `total_inventory` instead of `cj_inventory`
- Threshold increased from 20 to 100
- Provides better safety margin for fulfillment

---

## Daily API Call Budget (1000+ Products)

### Scenario 1: Conservative (50 products/day price sync)
```
Inventory sync (2 hours): 50 × 12 runs  = 600 calls
Price sync (2am):         50 × 1 run    = 50 calls
Manual operations:                      = 60 calls
────────────────────────────────────────────────────
TOTAL:                                  = 710 calls/day
HEADROOM:                               = 4,290 calls ✅
```
**Result:** Takes 20 days to sync all 1000 products

---

### Scenario 2: Moderate (200 products/day price sync)
```
Inventory sync (2 hours): 50 × 12 runs  = 600 calls
Price sync (2am):         200 × 1 run   = 200 calls
Manual operations:                      = 60 calls
────────────────────────────────────────────────────
TOTAL:                                  = 860 calls/day
HEADROOM:                               = 4,140 calls ✅
```
**Result:** Takes 5 days to sync all 1000 products

---

### Scenario 3: Aggressive (500 products/day price sync)
```
Inventory sync (2 hours): 50 × 12 runs  = 600 calls
Price sync (2am):         500 × 1 run   = 500 calls
Manual operations:                      = 60 calls
────────────────────────────────────────────────────
TOTAL:                                  = 1,160 calls/day
HEADROOM:                               = 3,840 calls ✅
```
**Result:** Takes 2 days to sync all 1000 products

---

### Scenario 4: **RECOMMENDED** (1000 products/day price sync)
```
Inventory sync (2 hours): 50 × 12 runs  = 600 calls
Price sync (2am):         1000 × 1 run  = 1,000 calls
Manual operations:                      = 60 calls
────────────────────────────────────────────────────
TOTAL:                                  = 1,660 calls/day
HEADROOM:                               = 3,340 calls ✅
```
**Result:** ALL 1000 products synced DAILY ✅ **BEST OPTION**

---

## Answer to Your Question

### Can you run the cron job at 2am every day with 1000+ products?

**YES! ✅ Absolutely!**

With 2-hour inventory sync, you have **4,290 calls/day headroom**. You can:

1. ✅ Sync **ALL 1000 products daily** (uses only 1,660/5,000 calls)
2. ✅ Still have **3,340 calls left** for manual operations
3. ✅ **66% of daily quota unused** = massive safety margin

---

## Recommended Environment Variables

```bash
# Inventory Sync (Every 2 hours)
CJ_INVENTORY_SYNC_ENABLED=true
CJ_INVENTORY_SYNC_INTERVAL_MS=7200000
CJ_INVENTORY_SYNC_BATCH_LIMIT=50

# Price Sync (Daily at 2am - All products)
CJ_PRICE_SYNC_ENABLED=true
CJ_PRICE_SYNC_BATCH_LIMIT=1000

# Exchange rate & markup (stored in DB, these are fallbacks)
USD_TO_ZAR=18.0
PRICE_MARKUP=1.12
```

---

## Impact on Stock Availability

### Old Rule (CJ stock ≤ 20)
- **Too strict**: Many products marked "Out of Stock" despite factory stock
- Example: CJ stock = 15, Factory = 5,000 → Showed as "Out of Stock" ❌

### New Rule (Total stock < 100)
- **More realistic**: Uses combined CJ + factory inventory
- Example: CJ stock = 15, Factory = 5,000 → Shows as "In Stock" ✅
- Safety margin: 100 units ensures reliable fulfillment
- Less false "Out of Stock" warnings for customers

---

## Daily Timeline Example

```
2:00am  → Price sync starts (1000 products)
2:00am  → 1st call (product 1)
2:01am  → 2nd call (product 2) [1.5s throttle between calls]
...
2:25am  → Price sync completes (1000 calls in ~25 minutes)

4:00am  → Inventory sync (50 products, ~2 minutes)
6:00am  → Inventory sync (50 products, ~2 minutes)
8:00am  → Inventory sync (50 products, ~2 minutes)
10:00am → Inventory sync (50 products, ~2 minutes)
12:00pm → Inventory sync (50 products, ~2 minutes)
2:00pm  → Inventory sync (50 products, ~2 minutes)
4:00pm  → Inventory sync (50 products, ~2 minutes)
6:00pm  → Inventory sync (50 products, ~2 minutes) + CJ quota resets
8:00pm  → Inventory sync (50 products, ~2 minutes)
10:00pm → Inventory sync (50 products, ~2 minutes)
12:00am → Inventory sync (50 products, ~2 minutes)
2:00am  → Inventory sync (50 products) + Price sync starts again

Daily total: 1,660 calls
Quota used: 33.2% (66.8% remaining)
```

---

## Scaling Beyond 1000 Products

If you grow to **2000 products**, you can still sync all daily:

```
Inventory sync (2 hours): 50 × 12 runs  = 600 calls
Price sync (2am):         2000 × 1 run  = 2,000 calls
Manual operations:                      = 60 calls
────────────────────────────────────────────────────
TOTAL:                                  = 2,660 calls/day
HEADROOM:                               = 2,340 calls ✅
```

**Safe up to ~4,000 products** with daily full sync!

---

## What Changed in Code

### File: `backend/src/routes/cart.js`
**Line ~55-82:**
```javascript
// OLD: Check cj_inventory, threshold 20
COALESCE(SUM(cpi.cj_inventory), 0) as total_cj_stock
if (cjStock <= 20) { ... }

// NEW: Check total_inventory, threshold 100
COALESCE(SUM(cpi.total_inventory), 0) as total_stock
if (totalStock < 100) { ... }
```

**Impact:**
- More accurate stock tracking (includes factory stock)
- Fewer false "Out of Stock" messages
- 100-unit threshold provides safety margin for order fulfillment

---

## Summary

| Metric | Value |
|--------|-------|
| **Daily API limit** | 5,000 calls |
| **Inventory sync calls** | 600 (12 runs × 50 products) |
| **Price sync calls** | 1,000 (1 run × 1000 products) |
| **Manual/misc calls** | 60 |
| **Total daily usage** | 1,660 calls (33%) |
| **Remaining headroom** | 3,340 calls (67%) |
| **Can sync 1000 products daily?** | ✅ YES with 67% quota left |
| **Max products for daily sync** | ~4,000 products |
| **Stock threshold** | Total < 100 units |
| **Inventory sync frequency** | Every 2 hours |

---

## Deployment Steps

1. **Update Render environment variables:**
   ```
   CJ_INVENTORY_SYNC_INTERVAL_MS=7200000
   CJ_PRICE_SYNC_BATCH_LIMIT=1000
   ```

2. **Deploy updated code:**
   - `cart.js` with new stock threshold (already updated)
   - `priceSync.js` service (already exists)
   - `server.js` scheduler (already configured)

3. **Monitor first run:**
   - Check logs at 2am for price sync
   - Verify 1000 products synced in ~25 minutes
   - Confirm inventory syncs every 2 hours

4. **Verify stock threshold:**
   - Test adding product with <100 stock
   - Should show "Out of Stock"
   - Products with ≥100 should allow purchase

---

## Conclusion

✅ **Your configuration is PERFECT for 1000+ products!**

- Daily price sync at 2am: **FULLY SUPPORTED**
- All products stay current within 24 hours
- 67% of API quota unused for growth
- More accurate stock tracking
- Scalable to 4,000+ products
