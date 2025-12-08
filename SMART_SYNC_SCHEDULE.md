# Smart Inventory Sync Schedule + 200 Products Price Sync

## Configuration Summary

### Price Sync (Option 2)
- **Frequency:** Daily at 2am SAST
- **Batch size:** 200 products
- **API calls:** 200/day

### Inventory Sync (Smart Schedule)
**Weekend (Friday, Saturday, Sunday):**
- **Frequency:** Every 2 hours
- **Hours:** 8am - 8pm SAST (wake hours)
- **Sync times:** 8am, 10am, 12pm, 2pm, 4pm, 6pm, 8pm
- **Runs per day:** 7 runs × 50 products = **350 API calls/day**

**Weekday (Monday - Thursday):**
- **Frequency:** Every 6 hours
- **Hours:** 8am - 8pm SAST (wake hours)
- **Sync times:** 8am, 2pm, 8pm
- **Runs per day:** 3 runs × 50 products = **150 API calls/day**

---

## Daily API Call Budget

### Weekend (Fri/Sat/Sun) - High Traffic Days
```
Inventory sync (7 runs):   50 × 7 runs   = 350 calls
Price sync (2am):          200 × 1 run   = 200 calls
Manual operations:                       = 60 calls
──────────────────────────────────────────────────
TOTAL:                                   = 610 calls/day
HEADROOM:                                = 4,390 calls ✅
QUOTA USED:                              = 12.2%
```

### Weekday (Mon-Thu) - Lower Traffic Days
```
Inventory sync (3 runs):   50 × 3 runs   = 150 calls
Price sync (2am):          200 × 1 run   = 200 calls
Manual operations:                       = 60 calls
──────────────────────────────────────────────────
TOTAL:                                   = 410 calls/day
HEADROOM:                                = 4,590 calls ✅
QUOTA USED:                              = 8.2%
```

---

## Smart Scheduler Logic

### How It Works
1. **Day detection:** Checks if today is Fri/Sat/Sun (weekend) or Mon-Thu (weekday)
2. **Interval selection:**
   - Weekend: 2-hour intervals
   - Weekday: 6-hour intervals
3. **Wake hours enforcement:** Only runs between 8am-8pm SAST
4. **Auto-scheduling:** After each sync, calculates next run time
5. **Sleep mode:** If after 8pm, schedules for 8am next day

### Example Schedule

**Friday (Weekend mode - 2h intervals):**
```
08:00 → Inventory sync (50 products)
10:00 → Inventory sync (50 products)
12:00 → Inventory sync (50 products)
14:00 → Inventory sync (50 products)
16:00 → Inventory sync (50 products)
18:00 → Inventory sync (50 products)
20:00 → Inventory sync (50 products) [last run]
20:01 → Sleep until 8am Saturday
```

**Monday (Weekday mode - 6h intervals):**
```
02:00 → Price sync (200 products)
08:00 → Inventory sync (50 products)
14:00 → Inventory sync (50 products)
20:00 → Inventory sync (50 products) [last run]
20:01 → Sleep until 8am Tuesday
```

---

## Benefits of This Approach

### 1. Traffic-Aware Scheduling
- **Weekends:** More frequent checks when shopping traffic is highest
- **Weekdays:** Reduced frequency when traffic is lower
- **Saves API calls** without compromising customer experience

### 2. Wake Hours Only (8am-8pm)
- **No overnight syncs** when traffic is minimal
- **Aligns with customer shopping patterns** in South Africa
- **Prevents wasted API calls** during low-activity hours

### 3. Efficient API Usage
- **Weekends:** 610 calls/day (12% of quota)
- **Weekdays:** 410 calls/day (8% of quota)
- **Average:** ~480 calls/day (9.6% of quota)
- **90% quota available** for growth and manual operations

### 4. Scalability
With this setup, you can scale significantly:
- **Current:** 200 products synced daily for pricing
- **Can increase to:** 4,000+ products before hitting limits
- **Weekend capacity:** Room for 12x more inventory calls
- **Weekday capacity:** Room for 30x more inventory calls

---

## Weekly API Call Breakdown

```
Monday:    410 calls (8.2% quota)
Tuesday:   410 calls (8.2% quota)
Wednesday: 410 calls (8.2% quota)
Thursday:  410 calls (8.2% quota)
Friday:    610 calls (12.2% quota)
Saturday:  610 calls (12.2% quota)
Sunday:    610 calls (12.2% quota)
─────────────────────────────────────
WEEKLY:    3,470 calls
DAILY AVG: 496 calls (9.9% of daily quota)
```

---

## Environment Variables

**Required (already set or defaults are fine):**
```bash
CJ_INVENTORY_SYNC_ENABLED=true  # Enables smart scheduler
CJ_INVENTORY_SYNC_BATCH_LIMIT=50

CJ_PRICE_SYNC_ENABLED=true
CJ_PRICE_SYNC_BATCH_LIMIT=200  # Changed from 50 to 200

USD_TO_ZAR=18.0  # Or set in admin panel
PRICE_MARKUP=1.12  # Or set in admin panel
```

**No longer needed (scheduler is smart now):**
```bash
# CJ_INVENTORY_SYNC_INTERVAL_MS  # Old fixed-interval approach
```

---

## Code Changes Made

### File: `backend/src/server.js`

**Replaced fixed-interval inventory sync with smart scheduler:**

**Old approach:**
```javascript
setInterval(runSync, intervalMs);  // Fixed 15 min or 2 hours
```

**New approach:**
```javascript
const scheduleNextInventorySync = () => {
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
  const intervalHours = isWeekend ? 2 : 6;
  
  // Only run during wake hours (8am-8pm)
  if (currentHour >= WAKE_END) {
    // Schedule for 8am tomorrow
  } else {
    // Schedule for next interval
  }
  
  setTimeout(() => {
    runInventorySync();
    scheduleNextInventorySync(); // Recursive scheduling
  }, msUntilNext);
};
```

**Price sync batch increased:**
```javascript
// Old: 50 products
const limit = Number(process.env.CJ_PRICE_SYNC_BATCH_LIMIT || 50);

// New: 200 products
const limit = Number(process.env.CJ_PRICE_SYNC_BATCH_LIMIT || 200);
```

---

## Console Logs to Expect

### On Server Startup:
```
⏱️  Inventory sync (Fri): 2h interval. Next: Fri 10:00 (in 45min)
⏱️  Price sync scheduler active: next run at 2am (in 487 minutes, 200 products)
```

### During Friday (Weekend):
```
🗃️  CJ inventory sync completed: updated=12 failures=0 processed=50 in 8423ms
⏱️  Inventory sync (Fri): 2h interval. Next: Fri 12:00 (in 120min)
```

### During Monday (Weekday):
```
🗃️  CJ inventory sync completed: updated=8 failures=0 processed=50 in 7234ms
⏱️  Inventory sync (Mon): 6h interval. Next: Mon 14:00 (in 360min)
```

### At 2am (Price Sync):
```
💰 Price sync completed: synced=200 significant_changes=5 errors=0
```

---

## Impact Analysis

### Customer Experience
**Weekends (High Traffic):**
- Inventory updates every 2 hours
- Stock status very current during peak shopping
- Better conversion (fewer "just sold out" scenarios)

**Weekdays (Lower Traffic):**
- Inventory updates every 6 hours
- Still fresh enough for purchases
- Reduced unnecessary API calls

**Pricing:**
- 200 products synced daily at 2am
- With 1000 products, full sync every 5 days
- Catches most price changes before they impact margins

### Business Benefits
- **Cost-efficient:** Uses only 10% of API quota on average
- **Traffic-optimized:** More checks when customers are shopping
- **Scalable:** Room to grow to 4000+ products
- **Margin protection:** 200 products/day price sync prevents loss
- **No overnight waste:** Sleep mode during 8pm-8am

---

## Comparison to Previous Approaches

| Approach | Daily Calls | Weekday | Weekend | Quota Used |
|----------|-------------|---------|---------|------------|
| **Option 1 (Old):** 15min fixed | 4,850 | 4,850 | 4,850 | 97% |
| **Option 2 (Old):** 2h fixed | 860 | 860 | 860 | 17% |
| **Smart (New):** 6h/2h wake hours | **496 avg** | **410** | **610** | **10%** ✅ |

**Smart scheduler saves 40-50% API calls** vs fixed 2-hour while maintaining better weekend coverage!

---

## Scaling Projection

### With 1000 Products

**Price Sync:**
- 200 products/day = Full sync every 5 days
- Acceptable for most price change patterns

**If you need faster price updates:**
- Can increase to 500/day (full sync every 2 days)
- Would use: 500 + 410 = 910 calls/day (weekday)
- Still only 18% of quota ✅

### With 2000 Products

**Option A: Same schedule, double batch size:**
```
Inventory: 100 × 3 runs (weekday) = 300 calls
Price:     400 × 1 run           = 400 calls
Total:                           = 760 calls/day ✅
```

**Option B: Increase price sync:**
```
Inventory: 50 × 3 runs           = 150 calls
Price:     1000 × 1 run          = 1,000 calls
Total:                           = 1,210 calls/day ✅
```

Both still well under 5,000 limit!

---

## Deployment Steps

1. **Deploy updated server.js:**
   ```bash
   git add backend/src/server.js
   git commit -m "Smart inventory sync + 200 products price sync"
   git push
   ```

2. **Update Render environment (optional, defaults are fine):**
   ```
   CJ_PRICE_SYNC_BATCH_LIMIT=200
   CJ_INVENTORY_SYNC_BATCH_LIMIT=50
   ```

3. **Monitor first week:**
   - Check logs for schedule confirmation
   - Verify weekend 2h intervals
   - Verify weekday 6h intervals
   - Confirm 8pm → 8am sleep mode

4. **Adjust if needed:**
   - If 200 products/day too slow: increase to 500
   - If weekend traffic different: adjust intervals in code
   - If different wake hours needed: change WAKE_START/WAKE_END

---

## Summary

✅ **Price Sync:** 200 products/day at 2am (Option 2 implemented)  
✅ **Inventory Sync:** Smart schedule adapts to traffic patterns  
✅ **Weekend (Fri-Sun):** Every 2 hours, 8am-8pm  
✅ **Weekday (Mon-Thu):** Every 6 hours, 8am-8pm  
✅ **API Usage:** 410-610 calls/day (8-12% of quota)  
✅ **Scalable:** Can handle 4,000+ products  
✅ **Optimized:** No wasted overnight calls  

**Your system is now perfectly tuned for South African e-commerce traffic patterns!**
