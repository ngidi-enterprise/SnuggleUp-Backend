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
import { cjClient } from './services/cjClient.js';
import { syncCuratedInventory } from './services/inventorySync.js';
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
  // Optional scheduled CJ inventory sync
  const enabled = process.env.CJ_INVENTORY_SYNC_ENABLED !== 'false';
  if (enabled) {
    const intervalMs = Number(process.env.CJ_INVENTORY_SYNC_INTERVAL_MS || 15 * 60 * 1000); // default 15 min
    let inventorySyncRunning = false;
    const runSync = async () => {
      if (inventorySyncRunning) return; // prevent overlapping runs
      inventorySyncRunning = true;
      try {
        const limit = process.env.CJ_INVENTORY_SYNC_BATCH_LIMIT ? Number(process.env.CJ_INVENTORY_SYNC_BATCH_LIMIT) : undefined;
        const started = Date.now();
        const result = await syncCuratedInventory({ limit });
        const elapsed = Date.now() - started;
        console.log(`🗃️  CJ inventory sync completed: updated=${result.updated} failures=${result.failures} processed=${result.processed} in ${elapsed}ms`);
      } catch (e) {
        console.error('❌ CJ inventory scheduled sync failed:', e.message);
      } finally {
        inventorySyncRunning = false;
      }
    };
    // Kick off first run shortly after start (stagger to avoid cold start pressure)
    setTimeout(runSync, 5000);
    setInterval(runSync, intervalMs);
    console.log(`⏱️  CJ inventory sync scheduler active (interval=${intervalMs}ms, enabled=${enabled})`);
  } else {
    console.log('⏱️  CJ inventory sync scheduler disabled via CJ_INVENTORY_SYNC_ENABLED=false');
  }
});
