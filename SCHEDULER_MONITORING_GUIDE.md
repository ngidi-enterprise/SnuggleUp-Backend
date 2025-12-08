# Scheduler Monitoring Guide

## Overview
The scheduler monitoring system tracks both the **Inventory Sync** (CJ stock updates) and **Price Sync** (CJ cost updates) to help you know when they're working and when something's wrong.

---

## How to Monitor Schedulers

### **Method 1: Admin Dashboard (Real-time UI)**

1. Go to **Admin Panel** → **Scheduler Monitor** tab
2. You'll see:
   - ✅ **Status indicators** (✅ ON TIME or ⚠️ OVERDUE)
   - 📊 **Success rate** (last 10 runs)
   - ⏱️ **Last run time** (e.g., "Dec 8, 14:25:32")
   - 📈 **Average duration** (how long each sync takes)
   - 📋 **Recent 5 runs** with detailed results

3. Click **↻ Refresh** for instant update, or enable **Auto-refresh (30s)** for live monitoring
4. Click **📄 Download Report** to export text report for email/sharing

---

### **Method 2: Text Report (Detailed)**

Download from admin dashboard or curl from your terminal:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-report
```

Example output:
```
SNUGGLEUP SCHEDULER STATUS REPORT
Generated: 2025-12-08T14:30:00Z

═════════════════════════════════════════════════════════════

INVENTORY SYNC (CJ Stock Updates)
─────────────────────────────────────────────────────────────
Status:           ✅ ENABLED
Last Run:         Dec 8 14:25:32
Total Runs:       42
Success Rate:     95.2%
Avg Duration:     2.3s
Status:           ✅ ON SCHEDULE

Recent Runs:
  • Dec 8 14:25:32 - SUCCESS (updated: 32/50, duration: 2.1s)
  • Dec 8 12:25:18 - SUCCESS (updated: 28/50, duration: 2.4s)
  • Dec 8 10:24:45 - SUCCESS (updated: 31/50, duration: 2.2s)

═════════════════════════════════════════════════════════════

PRICE SYNC (CJ Cost Updates)
─────────────────────────────────────────────────────────────
Status:           ✅ ENABLED
Last Run:         Dec 8 02:00:15
Total Runs:       18
Success Rate:     100.0%
Avg Duration:     15.3s
Status:           ✅ ON SCHEDULE

Recent Runs:
  • Dec 8 02:00:15 - SUCCESS (synced: 200, changes: 3, duration: 14.8s)
  • Dec 7 02:00:22 - SUCCESS (synced: 200, changes: 1, duration: 15.9s)
```

---

### **Method 3: JSON API (For Custom Monitoring)**

```bash
# Get health status
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-health

# Get execution history (last 50 inventory syncs)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-history?type=inventory&limit=50

# Get price sync history
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-history?type=price&limit=50
```

---

## What to Look For

### ✅ **Everything is Working**
- **Status**: ✅ ON SCHEDULE
- **Success Rate**: ≥90%
- **Last Run**: Within expected interval
  - Inventory: 2 hours on weekends (Fri-Sun), 6 hours on weekdays (Mon-Thu)
  - Price: Every 24 hours at 2am SAST

---

### ⚠️ **Warnings (Action Required)**

| Warning | Cause | Solution |
|---------|-------|----------|
| **⚠️ Inventory sync OVERDUE** | No sync in 1.5× expected interval | Check Render logs, restart backend if stuck |
| **⚠️ Price sync OVERDUE** | No sync in 26+ hours | Check Render logs, manual sync button in Pricing tab |
| **Success Rate < 80%** | Frequent failures (CJ API issues?) | Check recent error logs, verify CJ credentials |
| **❌ DISABLED** | Disabled via env var | Check `CJ_INVENTORY_SYNC_ENABLED` or `CJ_PRICE_SYNC_ENABLED` |

---

## Reading the Details

### Inventory Sync Example
```
Dec 8 14:25:32 - SUCCESS (updated: 32/50, duration: 2.1s)
├─ Dec 8 14:25:32 = When it ran (SAST)
├─ SUCCESS = No errors
├─ updated: 32/50 = Updated 32 products out of 50 processed
│  (18 had no inventory changes)
└─ duration: 2.1s = Completed in 2.1 seconds
```

**What this means:**
- ✅ Sync ran on schedule
- ✅ Processed 50 products
- ✅ Found inventory changes in 32 products
- ✅ Completed quickly (< 5s is good)

---

### Price Sync Example
```
Dec 8 02:00:15 - SUCCESS (synced: 200, changes: 3, duration: 14.8s)
├─ Dec 8 02:00:15 = When it ran (at 2am as expected)
├─ SUCCESS = No errors
├─ synced: 200 = Synced 200 products with CJ API
├─ changes: 3 = 3 products had price changes (>0.5%)
└─ duration: 14.8s = Completed in 14.8 seconds
```

**What this means:**
- ✅ Ran at 2am SAST as scheduled
- ✅ Checked 200 products with CJ API
- ✅ Found 3 price changes (margin protection working)
- ✅ Completed in reasonable time (< 30s is good)

---

## Expected Behavior by Day

### Inventory Sync Schedule
```
FRIDAY through SUNDAY (Busy Days)
├─ 08:00 - First sync of the day
├─ 10:00 - 2-hour interval
├─ 12:00
├─ 14:00
├─ 16:00
├─ 18:00
└─ 20:00 - Last sync before sleep mode

MONDAY through THURSDAY (Quieter Days)
├─ 08:00 - First sync of the day
├─ 14:00 - 6-hour interval
└─ 20:00 - Last sync before sleep mode

EVERY NIGHT (20:00 - 08:00)
└─ No syncs (sleep mode)
```

### Price Sync Schedule
```
EVERY DAY AT 02:00 SAST
├─ Syncs 200 products
├─ Takes ~10-20 seconds
└─ Runs regardless of day/weekend
```

---

## Troubleshooting

### "Last Run: Never" (No runs yet)
- **Cause**: Scheduler just started or disabled
- **Action**: Wait for next scheduled time, or check env vars
- **For Inventory**: Check if current time is 8am-8pm SAST
- **For Price**: Will run at 2am SAST tonight

### "Success Rate: 50%" (High failures)
- **Cause**: CJ API errors or invalid credentials
- **Action**:
  1. Check `CJ_EMAIL` and `CJ_API_KEY` on Render
  2. Verify CJ token hasn't expired (check admin `/get-cj-token` endpoint)
  3. Check Render logs for "❌ CJ inventory scheduled sync failed"

### "Avg Duration: 2m+" (Very slow)
- **Cause**: CJ API throttling or slow network
- **Action**:
  1. This is normal with large product counts (>500)
  2. If getting "429 Rate Limited", reduce batch size:
     ```
     CJ_INVENTORY_SYNC_BATCH_LIMIT=30  # Default 50
     CJ_PRICE_SYNC_BATCH_LIMIT=100     # Default 200
     ```

### Scheduler Appears Stuck
- **Check**:
  1. Is current time 8am-8pm SAST? (Sleep mode 8pm-8am)
  2. Check Render logs for errors in past 30 min
  3. Try manual sync from admin UI (Pricing tab → "Sync CJ Prices")
- **Fix**:
  1. If stuck, restart Render backend: `Redeploy` button
  2. Check env vars are set correctly
  3. Verify database connection is working

---

## Setting Up Alerts (Optional)

### Email notifications (recommended)
You can set up a simple monitoring script that checks the API every 30 minutes and emails you on issues:

```bash
# Check if overdue (bash script)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-health \
  | grep -o '"overdue": *true' && \
  echo "ALERT: Scheduler overdue!" | mail -s "Snuggleup Alert" admin@example.com
```

Or set up Render monitoring alerts:
1. Render Dashboard → Your Backend Service
2. Alerts → Create Alert
3. Trigger: "Response time > 10s" (indicates API lag)
4. Notification: Email

---

## Dashboard Tips

1. **Auto-refresh while working**: Enable "Auto-refresh (30s)" and keep the tab open to watch in real-time
2. **Download reports daily**: Keep Tuesday reports to compare with Monday performance
3. **Check after Render restarts**: Schedulers reset uptime after redeploys
4. **Monitor success rate**: If drops below 80%, investigate immediately
5. **Set a reminder**: Check dashboard every Monday morning to ensure weekend syncs happened

---

## Key Metrics to Track

Over time, collect these metrics to spot trends:

- **Inventory sync**: Success rate, average duration
- **Price sync**: Number of price changes per day, success rate
- **System uptime**: Hours between Render restarts/redeployments
- **Warnings**: How often "overdue" appears

If success rate drops or warnings appear frequently, it indicates:
- CJ API issues (beyond your control)
- Rate limiting (adjust batch sizes down)
- Database connection problems
- Render resource constraints
