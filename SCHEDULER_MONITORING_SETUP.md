# Scheduler Monitoring Implementation Summary

## What Was Added

You now have **3 ways to monitor** if your schedulers are working:

### 1. **Admin Dashboard (Visual, Real-time)** ⭐ EASIEST
- New tab: **"Scheduler Monitor"** in admin panel
- Shows status, success rate, last run time, recent 5 executions
- One-click **"Download Report"** button
- Auto-refresh every 30 seconds (optional)

### 2. **Text Report (Detailed, Exportable)** 📄
- Download from admin dashboard or API
- Shows full health status with all metrics
- Formatted for email/sharing
- Includes warnings and alerts

### 3. **JSON API (For Integrations)** 🔌
```
GET /api/admin/scheduler-health
GET /api/admin/scheduler-history?type=inventory
GET /api/admin/scheduler-report (returns text)
```

---

## Files Created/Modified

### New Files
1. **`backend/src/services/schedulerMonitor.js`**
   - Records every sync execution (timestamp, status, updates, duration)
   - Provides health checks (overdue detection, success rate)
   - Generates formatted reports
   - ~350 lines

2. **`frontend/src/components/admin/SchedulerMonitor.jsx`**
   - Dashboard component for real-time monitoring
   - Shows status badges, recent runs, metrics
   - Download report button
   - Auto-refresh toggle
   - ~380 lines

3. **`SCHEDULER_MONITORING_GUIDE.md`**
   - Complete guide on how to use monitoring
   - Troubleshooting section
   - Expected behavior by day
   - Alert setup instructions

### Modified Files
1. **`backend/src/server.js`**
   - Import schedulerMonitor service
   - Added duration tracking to inventory sync
   - Added duration tracking to price sync
   - Records every execution (success/failure)

2. **`backend/src/routes/admin.js`**
   - Added 3 new endpoints:
     - `GET /api/admin/scheduler-health` → JSON health status
     - `GET /api/admin/scheduler-history?type={inventory|price}` → Execution history
     - `GET /api/admin/scheduler-report` → Text report (downloadable)

---

## How It Works

### Recording Executions
Every time a scheduler runs, it records:
```javascript
{
  timestamp: "2025-12-08T14:25:32Z",
  status: "success",
  updated: 32,        // for inventory
  processed: 50,
  failures: 0,
  durationMs: 2100,
  error: null
}
```

Keeps last 100 executions in memory (24+ hours of history for normal schedules).

### Health Detection
Automatically identifies issues:
- **Overdue**: If no sync for 1.5× expected interval
  - Inventory: 3 hours on weekends (expected 2), 9 hours on weekdays (expected 6)
  - Price: 26 hours (expected 24)
- **Success Rate**: % of last 10 runs with status="success"
- **Warnings**: Lists overdue issues automatically

### Accessible Via
- **Admin panel**: Visual dashboard (refresh every 30s)
- **Text report**: Download and share
- **API**: Raw JSON for custom monitoring

---

## Expected Output Examples

### When Everything Works ✅

```
INVENTORY SYNC
Status:           ✅ ENABLED
Last Run:         Dec 8 14:25:32
Total Runs:       42
Success Rate:     95.2%
Status:           ✅ ON SCHEDULE
```

Dashboard shows:
- Green "✅ ON TIME" badge
- Success rate 95.2%
- Last run 2 minutes ago (within 2-hour weekend interval)

### When There's an Issue ⚠️

```
PRICE SYNC
Status:           ✅ ENABLED
Last Run:         Dec 6 02:00:15   (48 hours ago!)
Total Runs:       18
Success Rate:     88.9%
Status:           ⚠️ OVERDUE
```

Dashboard shows:
- Red "⚠️ OVERDUE" badge
- Warning banner at top: "Price sync may be overdue"
- Should have run Dec 8 at 2am, but didn't

---

## How to Use It

### In Admin Dashboard
1. Go to **Admin Panel** → **Scheduler Monitor** tab
2. See instant status with ✅/⚠️ badges
3. Review "Recent Runs" section
4. Enable "Auto-refresh (30s)" to monitor live
5. Click "📄 Download Report" to export

### From Command Line
```bash
# Get health status as JSON
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-health | jq .

# Download report
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://snuggleup-backend.onrender.com/api/admin/scheduler-report \
  > report.txt
```

### Daily Routine (Recommended)
- Every Monday: Check dashboard for weekend inventory syncs
- Every morning around 2:05am: Verify price sync ran (last run shows "Dec X 02:00")
- If warning badge appears: Click "Refresh" button
  - If still overdue: Check Render logs, might need restart

---

## Troubleshooting

### "Last Run: Never" or No History
- **Cause**: Scheduler just deployed, not yet run
- **Fix**: Wait for next scheduled time:
  - Inventory: Wait until 8am SAST (or next 2/6-hour interval)
  - Price: Wait until 2am SAST tonight
- Check console logs in Render: Look for "⏱️ Inventory sync" or "💰 Price sync" messages

### "Success Rate: 50%" (Low success)
- **Cause**: CJ API errors or CJ credentials invalid
- **Fix**:
  1. Check Render env vars: `CJ_EMAIL` and `CJ_API_KEY` are set
  2. Check Render logs for "❌ CJ inventory scheduled sync failed: ..."
  3. Get fresh CJ token: Admin panel → "Get CJ Token"
  4. Verify database connection

### "⚠️ Inventory sync OVERDUE"
- **Cause**: Last sync was more than 1.5× expected interval ago
- **Fix**:
  1. Check current time (should be 8am-8pm SAST for sync to run)
  2. Check Render logs for recent errors
  3. Try manual inventory sync from CJ menu
  4. If stuck > 1 hour: Restart Render backend

### Still Not Working?
1. Download report and check "System Health" section
2. Share report with technical support
3. Provide: Report, Render logs, admin token for API check

---

## Notes

- **In-memory storage**: Execution history persists until Render restart
  - After redeploy, history resets (that's normal)
  - History includes timestamp so you can see when restart happened
  
- **30-second refresh**: Auto-refresh polls every 30 seconds
  - Won't catch minute-by-minute changes but good enough for daily monitoring
  - Can manually refresh for immediate status

- **Overdue grace period**:
  - Inventory: 1.5× interval (so 3 hours on weekends, 9 on weekdays)
  - Price: 26 hours (1 hour grace on 24-hour cycle)
  - Prevents false alarms from slight delays

- **Success rate based on last 10 runs**:
  - If you see 50% = 5 of last 10 failed
  - Look at timestamps to see if they're old or recent
  - Recent failures indicate ongoing issue

---

## Next Steps

1. **Deploy to Render**: Push the changes
   ```bash
   git add .
   git commit -m "Add scheduler monitoring dashboard"
   git push
   ```

2. **Wait for first schedule run**: 
   - Inventory: Next 2/6-hour interval
   - Price: Next 2am SAST
   - Monitor will start showing data automatically

3. **Check tomorrow morning**: Verify both syncs ran overnight

4. **Bookmark admin dashboard**: Keep the Scheduler Monitor tab handy for daily checks

---

## Success Criteria

✅ Everything is working when:
- Dashboard shows "✅ ON TIME" for both syncs
- Success rate ≥90% for both
- No warning banners
- Recent runs show within expected intervals
- Duration looks reasonable (inventory < 5s, price < 30s)
