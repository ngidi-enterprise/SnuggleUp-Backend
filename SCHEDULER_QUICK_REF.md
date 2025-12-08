# Scheduler Monitoring - Quick Reference

## TL;DR - How to Check If Schedules Are Working

### **Fastest Way (30 seconds)**
1. Go to **Admin Panel** → **Scheduler Monitor** tab
2. Look at badges:
   - ✅ **ON TIME** = Working perfectly
   - ⚠️ **OVERDUE** = Problem detected
3. Check "Recent Runs" section
4. Done!

### **More Detail (2 minutes)**
1. Same as above
2. Check **Success Rate** (should be ≥90%)
3. Check **Last Run** time (should be recent)
4. Check **Avg Duration** (inventory < 5s, price < 30s)

### **Full Report (5 minutes)**
1. Click **"📄 Download Report"** button
2. Open the text file
3. Read sections:
   - INVENTORY SYNC: Status, Last Run, Recent Runs
   - PRICE SYNC: Status, Last Run, Recent Runs
   - SYSTEM HEALTH: Uptime, Memory

---

## Understanding Status Indicators

```
✅ ON TIME                    ⚠️ OVERDUE                      ❌ DISABLED
│                             │                               │
├─ Running on schedule        ├─ No sync for 1.5× interval   ├─ Turned off
├─ Last run was recent        ├─ Possible failure            ├─ Check env vars:
├─ No warnings                ├─ ACTION: Refresh & check       │   CJ_INVENTORY_SYNC_ENABLED
└─ Everything normal          │   logs or restart              │   CJ_PRICE_SYNC_ENABLED
                              └─ If still stuck > 1h: restart └─ Re-enable if intentional
                                 backend
```

---

## Expected Schedule

| Day | Inventory Sync | Price Sync |
|-----|---|---|
| **Monday-Thursday** | 08:00, 14:00, 20:00 | 02:00 |
| **Friday-Sunday** | 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00 | 02:00 |
| **Every Night** | Sleeps 20:00-08:00 | Runs daily at 2am |

---

## Common Scenarios

### ✅ "Everything looks good"
```
Inventory Sync:  ✅ ON TIME   (95% success, last: 2 min ago)
Price Sync:      ✅ ON TIME   (100% success, last: 2 hours ago)
```
→ **Action**: None. Keep monitoring daily.

---

### ⚠️ "Price sync hasn't run today"
```
Price Sync:      ⚠️ OVERDUE   (last: Dec 6 02:00, 48 hours ago)
```
→ **Action**:
1. Check current time (should run at 2am SAST)
2. If past 2am and still shows yesterday: Check Render logs
3. Try manual sync: Pricing tab → "🔄 Sync CJ Prices" button
4. If still broken: Restart Render backend

---

### ⚠️ "Inventory sync is failing"
```
Inventory Sync:  ⚠️ OVERDUE   (50% success rate, last: 6 hours ago)
Recent Runs:
  • Dec 8 14:00 - FAIL (error: CJ API error)
  • Dec 8 12:00 - FAIL (error: CJ API error)
```
→ **Action**:
1. Check CJ credentials on Render: `CJ_EMAIL`, `CJ_API_KEY`
2. Get fresh token: Admin → "Get CJ Token"
3. Check Render logs for error details
4. Try reducing batch size: `CJ_INVENTORY_SYNC_BATCH_LIMIT=30`

---

### 🔴 "Success rate is low (50%)"
```
Success Rate: 50%   (5 of last 10 failed)
```
→ **Action**:
1. Check if failures are recent or old
2. Check Render logs: `❌ CJ inventory scheduled sync failed:`
3. Common causes:
   - CJ API issues (beyond your control, try again later)
   - Invalid credentials (fix on Render)
   - Rate limited (reduce batch size)
   - Database connection lost (check DATABASE_URL)

---

## What Each Metric Means

| Metric | Good | Bad | Cause |
|--------|------|-----|-------|
| **Status** | ✅ ON TIME | ⚠️ OVERDUE | Sync didn't run when expected |
| **Last Run** | Recent | > 1.5× interval | Scheduler stuck or failing |
| **Success Rate** | ≥90% | <70% | Frequent errors, bad credentials |
| **Avg Duration** | <5s (inv), <30s (price) | >1m | Slow API, large batch size |
| **Enabled** | ✅ ENABLED | ❌ DISABLED | Check env var or manually disabled |

---

## API Endpoints (Advanced)

```bash
# Get JSON health status
GET /api/admin/scheduler-health

Response:
{
  "inventorySync": {
    "enabled": true,
    "lastExecution": "2025-12-08T14:25:32Z",
    "totalRuns": 42,
    "successRate": 95.2,
    "overdue": false,
    "recentRuns": [...]
  },
  "priceSync": { ... },
  "systemHealth": { ... }
}

---

# Get execution history (last 50 runs)
GET /api/admin/scheduler-history?type=inventory&limit=50

Response: Array of execution records

---

# Download text report
GET /api/admin/scheduler-report

Response: Plain text report
```

---

## Red Flags to Watch

🚩 **Immediate Action Needed**
- ⚠️ **OVERDUE** badge appears
- Success rate drops below 50%
- Same error repeated multiple times
- "Last Run: Never" but scheduler enabled

🟡 **Check Next Morning**
- Success rate 50-80%
- Avg duration > 30 seconds
- Any warning in alerts section

✅ **All Clear**
- ✅ ON TIME badges
- Success rate ≥90%
- No warnings
- Recent runs successful

---

## Support Questions to Answer

**"Is my scheduler working?"**
→ Check admin dashboard for ✅ badge

**"How often should it run?"**
→ Inventory: 2-6 hours during 8am-8pm, price: daily at 2am

**"What if it shows ⚠️ OVERDUE?"**
→ Check Render logs, verify credentials, try manual sync, or restart

**"What's a good success rate?"**
→ ≥90% is good, <70% needs investigation

**"How can I fix a stuck scheduler?"**
→ Check logs → verify credentials → try manual sync → restart if needed

**"How long should each sync take?"**
→ Inventory < 5 seconds, Price < 30 seconds

---

## Daily Checklist

- **Every morning**: Open Scheduler Monitor tab, check badges are ✅
- **Every other day**: Verify price sync ran at 2am (check "Last Run" time)
- **Weekly**: Download report and review trends
- **Monthly**: Archive reports to track long-term success rate
- **On any warning**: Click "Refresh" button to verify it's still there

---

## Key Numbers to Remember

```
Weekday inventory sync interval:   6 hours     (Mon-Thu)
Weekend inventory sync interval:   2 hours     (Fri-Sun)
Inventory sync wake hours:         8am-8pm     SAST
Price sync:                        2am         daily
Price sync batch size:             200 products
Inventory batch size:              50 products
Overdue grace period:              1.5× interval
Success rate target:               ≥90%
```

---

## When to Investigate

1. **⚠️ OVERDUE appears** → Check immediately
2. **Success rate drops suddenly** → Something changed
3. **Avg duration triples** → CJ API slow or rate limited
4. **Same error repeated** → Recurring issue, needs fix
5. **No runs after deployment** → Scheduler might need reset

---

## How to Get Help

Gather this info:
1. Screenshot from Scheduler Monitor dashboard
2. Text report (download button)
3. Render backend logs (last 100 lines)
4. Render environment variables (settings)
5. What changed recently? (new products, env var change?)

Then provide to technical support.
