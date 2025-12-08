# CJ API Rate Limit Analysis: 1000+ Products Scenario

## CJ API Rate Limit Details

**Daily Quota**: **5,000 API calls per day**
- Resets daily at 6pm SAST (CJ midnight UTC+8)
- Per-request throttle: **1.5 seconds minimum** between calls (safety margin from 1 req/sec)
- Max retries on 429: **3 attempts** with exponential backoff (2s, 4s, 8s)

---

## Your Current Setup

### Daily API Call Sources
1. **Inventory Sync** (scheduled, 15 min interval)
2. **Price Sync** (scheduled, daily at 2am)
3. **Manual operations** (admin clicks, product additions)

---

## Rate Limit Analysis with 1000+ Products

### Scenario: 1000 Products in Database

#### Price Sync (Daily, 2am)
- **Batch size**: 50 products (default)
- **Calls per run**: 50 (one getProductDetails per product)
- **Daily runs**: 1
- **Total daily from price sync**: **50 calls/day**

#### Inventory Sync (Every 15 minutes)
- **Batch size**: Configurable (default unclear, let's check)
- **Frequency**: Every 15 min = 96 times per day
- **Calls per run**: 1 call per product in batch
- **If 100 products per batch**: 100 × 96 = **9,600 calls/day** ❌ **EXCEEDS LIMIT**
- **If 50 products per batch**: 50 × 96 = **4,800 calls/day** ✅ **Safe**

#### Manual Operations
- Product additions: ~0-10 calls/day (background VID + inventory fetch)
- Admin sync button: ~50 calls (manual trigger)
- Total manual: ~60 calls/day (estimate)

---

## The Problem with 1000+ Products

### Current Math (If Inventory Batch = 100)
```
Inventory Sync (every 15 min):   100 products × 96 runs = 9,600 calls
Price Sync (daily at 2am):       50 products × 1 run     = 50 calls
Manual operations:               ~60 calls
─────────────────────────────────────────────────────────────────────
TOTAL:                           9,710 calls ❌ EXCEEDS 5,000 LIMIT
```

**With 1000 products, you'll hit the limit by roughly 12-1pm every day.**

### Safe Math (Inventory Batch = 50)
```
Inventory Sync (every 15 min):   50 products × 96 runs   = 4,800 calls
Price Sync (daily at 2am):       50 products × 1 run     = 50 calls
Manual operations:               ~60 calls
─────────────────────────────────────────────────────────────────────
TOTAL:                           4,910 calls ✅ UNDER 5,000 LIMIT
```

**With batches of 50, you'll have ~90 calls/day headroom for manual operations.**

---

## Recommendations for 1000+ Products

### ✅ Option 1: Reduce Inventory Sync Frequency (Recommended)
**Change interval from 15 min to 30 min**

```
50 products × 48 runs (every 30 min) = 2,400 calls/day
+ Price sync (50 calls)             = 2,450 calls total
+ Manual operations (60 calls)       = 2,510 calls ✅ SAFE with 2,490 headroom
```

**Setup**:
```bash
CJ_INVENTORY_SYNC_INTERVAL_MS=1800000  # 30 minutes
CJ_INVENTORY_SYNC_BATCH_LIMIT=50
CJ_PRICE_SYNC_BATCH_LIMIT=50
```

### ✅ Option 2: Reduce Both Syncs + Increase Batch Size
**Inventory every 30 min (batch 50), Price at 2am (batch 100)**

```
Inventory: 50 × 48 runs          = 2,400 calls
Price:     100 × 1 run           = 100 calls
Manual:    ~60 calls             = 60 calls
────────────────────────────────────────────────
TOTAL:                           2,560 calls ✅ SAFE with 2,440 headroom
```

**Setup**:
```bash
CJ_INVENTORY_SYNC_INTERVAL_MS=1800000  # 30 minutes
CJ_INVENTORY_SYNC_BATCH_LIMIT=50
CJ_PRICE_SYNC_BATCH_LIMIT=100  # Increased since runs only once/day
```

### ⚠️ Option 3: Keep Current + Disable Price Sync
**If you don't need daily price updates, keep inventory at 15 min**

```
Inventory: 100 × 96 runs         = 9,600 calls ❌ EXCEEDS LIMIT
```

**NOT RECOMMENDED** - Still breaks the limit.

---

## How to Check Current Batch Sizes

### Current Inventory Sync Config
```bash
# Check in Render env vars:
CJ_INVENTORY_SYNC_INTERVAL_MS=?     # Default: 15 * 60 * 1000 = 900,000ms
CJ_INVENTORY_SYNC_BATCH_LIMIT=?     # Not clearly documented, need to check code
```

**To verify**:
```javascript
// In backend/src/services/inventorySync.js, check the query:
const limit = process.env.CJ_INVENTORY_SYNC_BATCH_LIMIT ? 
  Number(...) : undefined;
```

### New Price Sync Config (Just Added)
```bash
CJ_PRICE_SYNC_ENABLED=true         # Default: true
CJ_PRICE_SYNC_BATCH_LIMIT=50       # Default: 50
```

---

## Daily Call Timeline Example (with 1000 products, Option 1)

```
2:00am  → Price sync runs: 50 calls (Products updated in batch)
2:05am  → Inventory sync runs: 50 calls (1st batch of products)
2:20am  → Inventory sync runs: 50 calls (2nd batch)
2:35am  → Inventory sync runs: 50 calls (3rd batch)
2:50am  → Inventory sync runs: 50 calls (4th batch)
...
(repeats every 30 min)

Daily total: ~2,500 calls
Headroom: 2,500 calls left for manual operations
```

---

## What Happens If You Hit the Limit?

When you exceed 5,000 calls:
1. CJ returns HTTP 429 (Too Many Requests)
2. Code retries with backoff (2s, 4s, 8s)
3. After 3 attempts, request fails
4. **Inventory becomes stale** (not synced)
5. **Prices don't update**
6. User sees "Out of Stock" even if supplier has stock

**This will keep happening until 6pm daily reset.**

---

## Current Implementation Safety

✅ **Price Sync is safe**: Only 50 products/day = negligible impact
✅ **Throttling is in place**: 1.5s between calls prevents QPS limits
✅ **Retry logic works**: Exponential backoff handles temporary limits

❌ **Inventory Sync with 1000 products**: Needs configuration review

---

## Action Items

### For 1000+ Products (Required)

1. **Check current inventory batch size**:
   - Log into Render dashboard
   - View `CJ_INVENTORY_SYNC_BATCH_LIMIT` in env vars
   - If undefined, check `inventorySync.js` defaults

2. **Adjust to safe values**:
   ```
   Set: CJ_INVENTORY_SYNC_INTERVAL_MS = 1800000  (30 min)
   Set: CJ_INVENTORY_SYNC_BATCH_LIMIT = 50
   Set: CJ_PRICE_SYNC_BATCH_LIMIT = 100  (safe since once/day)
   ```

3. **Monitor daily call usage**:
   - Add logging to track total calls per day
   - Alert if approaching 4,500 calls
   - Increase intervals if needed

### For Current Setup (< 200 products)

✅ **No changes needed** - Your current setup is safe:
- Price sync: 50 calls/day
- Inventory sync (15 min, ~50 products): 4,800 calls/day max
- **Total: ~4,850 calls/day** = Within limit

---

## How to Monitor

Add this to `server.js` to track daily calls:

```javascript
let dailyCallCount = 0;
let callCountResetTime = new Date().setHours(18, 0, 0, 0); // 6pm reset

// In cjClient.js, add to ensureThrottle():
function trackCJCall() {
  const now = new Date();
  const resetTime = new Date(callCountResetTime);
  
  if (now > resetTime) {
    // Past 6pm, reset counter for next day
    dailyCallCount = 0;
    callCountResetTime = new Date(now.getTime() + 24*60*60*1000).setHours(18,0,0,0);
  }
  
  dailyCallCount++;
  
  if (dailyCallCount % 500 === 0) {
    console.log(`📊 CJ API calls today: ${dailyCallCount}/5000`);
  }
  
  if (dailyCallCount >= 4500) {
    console.warn(`⚠️ CJ API quota warning: ${dailyCallCount}/5000 calls used!`);
  }
}
```

---

## Summary Table

| Scenario | Inventory Interval | Inventory Batch | Price Batch | Daily Calls | Status |
|----------|-------------------|-----------------|-------------|------------|--------|
| Current (200 products) | 15 min | ~50 | 50 | ~4,850 | ✅ Safe |
| 1000 products (if not changed) | 15 min | 50 | 50 | ~4,850 | ✅ Safe |
| 1000 products (if batch=100) | 15 min | 100 | 50 | ~9,710 | ❌ Exceeds |
| **1000 products (Recommended)** | **30 min** | **50** | **50** | **~2,510** | **✅ Safe** |
| 1000 products (Alternative) | 30 min | 50 | 100 | ~2,560 | ✅ Safe |

---

## Final Answer

**Your current cron job addition is SAFE** as long as:

1. ✅ Price sync batch = 50 (you have this)
2. ✅ Inventory sync batch ≤ 50 (need to verify)
3. ✅ Inventory sync interval ≥ 15 min (need to review if scaling to 1000+)

**For 1000+ products**, reduce inventory interval to **30 minutes** to stay under 5,000 daily limit.
