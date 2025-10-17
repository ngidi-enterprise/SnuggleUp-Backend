import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import db from './db.js';
import { router as paymentsRouter } from './routes/payments.js';
import { router as authRouter } from './routes/auth.js';
import { router as ordersRouter } from './routes/orders.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} from ${req.headers.origin || req.ip}`);
  next();
});
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/payments', paymentsRouter);
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'connected' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
