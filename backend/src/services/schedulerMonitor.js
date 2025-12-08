/**
 * Scheduler Monitoring Service
 * Tracks inventory sync and price sync execution history
 * Provides health status and performance metrics
 */

// In-memory store for scheduler execution history
// Production should migrate to DB for persistence across restarts
const executionHistory = {
  inventorySync: [],
  priceSync: [],
  lastCheck: new Date()
};

// Configuration
const MAX_HISTORY_RECORDS = 100; // Keep last 100 executions
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Record an inventory sync execution
 */
export const recordInventorySyncExecution = (result) => {
  const record = {
    timestamp: new Date(),
    status: result.failures === 0 ? 'success' : 'partial',
    updated: result.updated || 0,
    processed: result.processed || 0,
    failures: result.failures || 0,
    batchSize: result.batchSize || 0,
    durationMs: result.durationMs || 0,
    error: result.error || null
  };

  executionHistory.inventorySync.push(record);

  // Keep only recent records
  if (executionHistory.inventorySync.length > MAX_HISTORY_RECORDS) {
    executionHistory.inventorySync = executionHistory.inventorySync.slice(-MAX_HISTORY_RECORDS);
  }

  return record;
};

/**
 * Record a price sync execution
 */
export const recordPriceSyncExecution = (result) => {
  const record = {
    timestamp: new Date(),
    status: result.errors && result.errors.length === 0 ? 'success' : 'partial',
    synced: result.synced || 0,
    priceChanges: result.priceChanges ? result.priceChanges.length : 0,
    errors: result.errors ? result.errors.length : 0,
    batchSize: result.processed || result.synced || 0,
    durationMs: result.durationMs || 0,
    errorDetails: result.errors || null
  };

  executionHistory.priceSync.push(record);

  if (executionHistory.priceSync.length > MAX_HISTORY_RECORDS) {
    executionHistory.priceSync = executionHistory.priceSync.slice(-MAX_HISTORY_RECORDS);
  }

  return record;
};

/**
 * Get health status of both schedulers
 */
export const getSchedulerHealth = () => {
  const now = new Date();
  const invHistory = executionHistory.inventorySync;
  const priceHistory = executionHistory.priceSync;

  // Last execution times
  const lastInvSync = invHistory.length > 0 ? invHistory[invHistory.length - 1].timestamp : null;
  const lastPriceSync = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].timestamp : null;

  // Calculate success rate (last 10 runs)
  const getSuccessRate = (history) => {
    if (history.length === 0) return null;
    const recent = history.slice(-10);
    const successes = recent.filter(r => r.status === 'success').length;
    return (successes / recent.length) * 100;
  };

  // Calculate average duration
  const getAvgDuration = (history) => {
    if (history.length === 0) return null;
    const recent = history.slice(-10);
    const total = recent.reduce((sum, r) => sum + (r.durationMs || 0), 0);
    return Math.round(total / recent.length);
  };

  // Check for overdue runs (if last sync was >1.5x the expected interval)
  const isInventorySyncOverdue = () => {
    if (!lastInvSync) return false;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const expectedIntervalMs = (isWeekend ? 2 : 6) * 60 * 60 * 1000;
    const timeSinceLastSync = now.getTime() - new Date(lastInvSync).getTime();
    return timeSinceLastSync > expectedIntervalMs * 1.5; // 1.5x grace period
  };

  const isPriceSyncOverdue = () => {
    if (!lastPriceSync) return false;
    const now = new Date();
    const lastSync = new Date(lastPriceSync);
    // Price sync should run every 24 hours (allow 26 hour grace period)
    const timeSinceLastSync = now.getTime() - lastSync.getTime();
    const MS_26_HOURS = 26 * 60 * 60 * 1000;
    return timeSinceLastSync > MS_26_HOURS;
  };

  return {
    inventorySync: {
      enabled: process.env.CJ_INVENTORY_SYNC_ENABLED !== 'false',
      lastExecution: lastInvSync,
      totalRuns: invHistory.length,
      successRate: getSuccessRate(invHistory),
      avgDurationMs: getAvgDuration(invHistory),
      overdue: isInventorySyncOverdue(),
      recentRuns: invHistory.slice(-5)
    },
    priceSync: {
      enabled: process.env.CJ_PRICE_SYNC_ENABLED !== 'false',
      lastExecution: lastPriceSync,
      totalRuns: priceHistory.length,
      successRate: getSuccessRate(priceHistory),
      avgDurationMs: getAvgDuration(priceHistory),
      overdue: isPriceSyncOverdue(),
      recentRuns: priceHistory.slice(-5)
    },
    systemHealth: {
      timestamp: now,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      warnings: [
        ...(isInventorySyncOverdue() ? ['⚠️ Inventory sync may be overdue'] : []),
        ...(isPriceSyncOverdue() ? ['⚠️ Price sync may be overdue'] : [])
      ]
    }
  };
};

/**
 * Get detailed execution history (for charts/analytics)
 */
export const getExecutionHistory = (type, limit = 50) => {
  const history = type === 'inventory' ? executionHistory.inventorySync : executionHistory.priceSync;
  return history.slice(-limit).map(record => ({
    ...record,
    timestamp: new Date(record.timestamp).toISOString()
  }));
};

/**
 * Generate a text report for admin viewing
 */
export const generateSchedulerReport = () => {
  const health = getSchedulerHealth();
  const now = new Date();

  const formatTime = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
  };

  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  let report = `
SNUGGLEUP SCHEDULER STATUS REPORT
Generated: ${now.toISOString()}

═════════════════════════════════════════════════════════════

INVENTORY SYNC (CJ Stock Updates)
─────────────────────────────────────────────────────────────
Status:           ${health.inventorySync.enabled ? '✅ ENABLED' : '❌ DISABLED'}
Last Run:         ${formatTime(health.inventorySync.lastExecution)}
Total Runs:       ${health.inventorySync.totalRuns}
Success Rate:     ${health.inventorySync.successRate !== null ? `${health.inventorySync.successRate.toFixed(1)}%` : 'N/A'}
Avg Duration:     ${formatDuration(health.inventorySync.avgDurationMs)}
Status:           ${health.inventorySync.overdue ? '⚠️  OVERDUE' : '✅ ON SCHEDULE'}

Recent Runs:
`;

  if (health.inventorySync.recentRuns.length === 0) {
    report += '  (No runs yet)\n';
  } else {
    health.inventorySync.recentRuns.forEach(run => {
      report += `  • ${formatTime(run.timestamp)} - ${run.status.toUpperCase()} (updated: ${run.updated}/${run.processed}, duration: ${formatDuration(run.durationMs)})\n`;
    });
  }

  report += `
═════════════════════════════════════════════════════════════

PRICE SYNC (CJ Cost Updates)
─────────────────────────────────────────────────────────────
Status:           ${health.priceSync.enabled ? '✅ ENABLED' : '❌ DISABLED'}
Last Run:         ${formatTime(health.priceSync.lastExecution)}
Total Runs:       ${health.priceSync.totalRuns}
Success Rate:     ${health.priceSync.successRate !== null ? `${health.priceSync.successRate.toFixed(1)}%` : 'N/A'}
Avg Duration:     ${formatDuration(health.priceSync.avgDurationMs)}
Status:           ${health.priceSync.overdue ? '⚠️  OVERDUE' : '✅ ON SCHEDULE'}

Recent Runs:
`;

  if (health.priceSync.recentRuns.length === 0) {
    report += '  (No runs yet)\n';
  } else {
    health.priceSync.recentRuns.forEach(run => {
      report += `  • ${formatTime(run.timestamp)} - ${run.status.toUpperCase()} (synced: ${run.synced}, changes: ${run.priceChanges}, duration: ${formatDuration(run.durationMs)})\n`;
    });
  }

  report += `
═════════════════════════════════════════════════════════════

SYSTEM HEALTH
─────────────────────────────────────────────────────────────
Uptime:           ${(health.systemHealth.uptime / 3600).toFixed(1)} hours
Memory Used:      ${(health.systemHealth.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)}MB

Alerts:
${health.systemHealth.warnings.length === 0 ? '  ✅ No warnings' : health.systemHealth.warnings.map(w => `  ${w}`).join('\n')}

═════════════════════════════════════════════════════════════
`;

  return report;
};

export default {
  recordInventorySyncExecution,
  recordPriceSyncExecution,
  getSchedulerHealth,
  getExecutionHistory,
  generateSchedulerReport
};
