import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { router as paymentsRouter } from './routes/payments.js';
import { router as cjRouter } from './routes/cj.js';
import { router as adminRouter } from './routes/admin.js';
import { router as setupRouter } from './routes/setup.js';
import { router as productsRouter } from './routes/products.js';
import { router as cartRouter } from './routes/cart.js';
import { router as shippingRouter } from './routes/shipping.js';
import { cjClient } from './services/cjClient.js';
import { syncCuratedInventory } from './services/inventorySync.js';
import { syncProductPrices } from './services/priceSync.js';
import db from './db.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware - CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://snuggleup.co.za',
    'https://www.snuggleup.co.za',
    'https://api.snuggleup.co.za',
    /\.onrender\.com$/,
    /\.webcontainer\.io$/,
    /\.local$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'CJ-Access-Token']
}));
// Parse URL-encoded form bodies (required for PayFast IPN)
app.use(express.urlencoded({ extended: false }));
// Parse JSON bodies
app.use(express.json());

// Routes
app.use('/api/payments', paymentsRouter);
app.use('/api/cj', cjRouter);
app.use('/api/admin', adminRouter);
app.use('/api/setup', setupRouter);
app.use('/api/products', productsRouter); // Public curated products
app.use('/api/cart', cartRouter); // Cart persistence
app.use('/api/shipping', shippingRouter); // Shipping quotes

// Health check (legacy)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Super-light ping to distinguish platform 502s from app errors
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Environment checklist health endpoint
app.get('/api/health', async (req, res) => {
  // Basic DB check
  let dbOk = false;
  let dbError = null;
  try {
    await db.query('SELECT 1');
    dbOk = true;
  } catch (e) {
    dbOk = false;
    dbError = e.message;
  }

  const cjStatus = cjClient.getStatus();
  const payfastMode = process.env.PAYFAST_TEST_MODE === 'true' ? 'sandbox' : 'live';

  const checklist = {
    service: 'snuggleup-backend',
    time: new Date().toISOString(),
    status: 'ok',
    db: { ok: dbOk, error: dbError },
    env: {
      nodeEnv: process.env.NODE_ENV || 'development',
      backendUrl: process.env.BACKEND_URL || null,
      frontendUrl: process.env.FRONTEND_URL || null,
      usdToZarSet: Boolean(process.env.USD_TO_ZAR),
      corsPatterns: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        '/*.onrender.com',
        '/*.webcontainer.io',
        '/*.local'
      ],
      payfast: {
        mode: payfastMode,
        merchantIdSet: Boolean(process.env.PAYFAST_MERCHANT_ID),
        merchantKeySet: Boolean(process.env.PAYFAST_MERCHANT_KEY),
        passphraseSet: Boolean(process.env.PAYFAST_PASSPHRASE),
        notifyUrl: (process.env.BACKEND_URL || '') + '/api/payments/notify'
      },
      cj: {
        baseUrl: cjStatus.baseUrl,
        hasEmail: cjStatus.hasEmail,
        hasApiKey: cjStatus.hasApiKey,
        webhookVerification: cjStatus.webhookVerification,
        tokenExpiry: cjStatus.tokenExpiry || null
      }
    }
  };

  // Simple readiness flags
  const ready = {
    backendUrlSet: Boolean(process.env.BACKEND_URL),
    frontendUrlSet: Boolean(process.env.FRONTEND_URL),
    payfastLiveReady: payfastMode === 'live' && Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY && process.env.PAYFAST_PASSPHRASE),
    cjReady: cjStatus.hasEmail && cjStatus.hasApiKey,
    dbReady: dbOk,
  };

  res.json({ checklist, ready });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  
  // Smart CJ inventory sync: adapts to shopping patterns
  // Fri-Sun: Every 2 hours (8am-8pm SAST) - high traffic
  // Mon-Thu: Every 6 hours (8am-8pm SAST) - lower traffic
  const inventorySyncEnabled = process.env.CJ_INVENTORY_SYNC_ENABLED !== 'false';
  if (inventorySyncEnabled) {
    let inventorySyncRunning = false;
    
    const runInventorySync = async () => {
      if (inventorySyncRunning) return;
      inventorySyncRunning = true;
      try {
        const limit = Number(process.env.CJ_INVENTORY_SYNC_BATCH_LIMIT || 50);
        const started = Date.now();
        const result = await syncCuratedInventory({ limit, syncType: 'scheduled' });
        const elapsed = Date.now() - started;
        console.log(`🗃️  CJ inventory sync completed: updated=${result.updated} failures=${result.failures} processed=${result.processed} in ${elapsed}ms`);
      } catch (e) {
        console.error('❌ CJ inventory scheduled sync failed:', e.message);
      } finally {
        inventorySyncRunning = false;
      }
    };

    const scheduleNextInventorySync = () => {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
      const currentHour = now.getHours();
      
      // Weekend (Fri=5, Sat=6, Sun=0): every 2 hours, 8am-8pm
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
      const intervalHours = isWeekend ? 2 : 6; // 2h on weekends, 6h on weekdays
      
      // Wake hours: 8am-8pm SAST
      const WAKE_START = 8;
      const WAKE_END = 20;
      
      // Calculate next sync time
      let nextSync = new Date(now);
      
      if (currentHour < WAKE_START) {
        // Before 8am: schedule for 8am today
        nextSync.setHours(WAKE_START, 0, 0, 0);
      } else if (currentHour >= WAKE_END) {
        // After 8pm: schedule for 8am tomorrow
        nextSync.setDate(nextSync.getDate() + 1);
        nextSync.setHours(WAKE_START, 0, 0, 0);
      } else {
        // During wake hours: schedule next interval
        const nextHour = currentHour + intervalHours;
        if (nextHour >= WAKE_END) {
          // Next sync would be after 8pm, schedule for 8am tomorrow
          nextSync.setDate(nextSync.getDate() + 1);
          nextSync.setHours(WAKE_START, 0, 0, 0);
        } else {
          // Schedule for next interval slot
          nextSync.setHours(nextHour, 0, 0, 0);
        }
      }
      
      const msUntilNext = nextSync.getTime() - now.getTime();
      const minutesUntil = Math.round(msUntilNext / 1000 / 60);
      
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
      const nextDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nextSync.getDay()];
      console.log(`⏱️  Inventory sync (${dayName}): ${isWeekend ? '2h' : '6h'} interval. Next: ${nextDayName} ${nextSync.getHours()}:00 (in ${minutesUntil}min)`);
      
      setTimeout(() => {
        runInventorySync();
        scheduleNextInventorySync(); // Recursively schedule next run
      }, msUntilNext);
    };
    
    // Run first sync shortly after startup (if within wake hours)
    const now = new Date();
    const currentHour = now.getHours();
    if (currentHour >= 8 && currentHour < 20) {
      setTimeout(runInventorySync, 5000); // 5 seconds after startup
    }
    
    scheduleNextInventorySync();
  } else {
    console.log('⏱️  CJ inventory sync scheduler disabled via CJ_INVENTORY_SYNC_ENABLED=false');
  }

  // Daily price sync at 2am (SAST - South African Standard Time)
  const priceSyncEnabled = process.env.CJ_PRICE_SYNC_ENABLED !== 'false';
  if (priceSyncEnabled) {
    const HOUR_2AM = 2;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    
    // Calculate time until next 2am
    const getTimeUntil2am = () => {
      const now = new Date();
      const next2am = new Date();
      next2am.setHours(HOUR_2AM, 0, 0, 0);
      
      // If 2am already passed today, schedule for tomorrow
      if (now >= next2am) {
        next2am.setDate(next2am.getDate() + 1);
      }
      
      return next2am.getTime() - now.getTime();
    };

    let priceSyncRunning = false;
    const runPriceSync = async () => {
      if (priceSyncRunning) return;
      priceSyncRunning = true;
      try {
        const limit = Number(process.env.CJ_PRICE_SYNC_BATCH_LIMIT || 200); // Changed from 50 to 200
        const result = await syncProductPrices({ limit, syncType: 'scheduled' });
        console.log(`💰 Price sync completed: synced=${result.synced} significant_changes=${result.priceChanges.length} errors=${result.errors.length}`);
      } catch (e) {
        console.error('❌ Scheduled price sync failed:', e.message);
      } finally {
        priceSyncRunning = false;
      }
    };

    // Schedule first run at 2am
    const timeUntil2am = getTimeUntil2am();
    console.log(`⏱️  Price sync scheduler active: next run at 2am (in ${Math.round(timeUntil2am / 1000 / 60)} minutes, 200 products)`);
    
    setTimeout(() => {
      runPriceSync();
      // After first run, schedule daily at 2am
      setInterval(runPriceSync, MS_PER_DAY);
    }, timeUntil2am);
  } else {
    console.log('⏱️  Price sync scheduler disabled via CJ_PRICE_SYNC_ENABLED=false');
  }
});
