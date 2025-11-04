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
    /\.onrender\.com$/,
    /\.webcontainer\.io$/,
    /\.local$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'CJ-Access-Token']
}));
app.use(express.json());

// Routes
app.use('/api/payments', paymentsRouter);
app.use('/api/cj', cjRouter);
app.use('/api/admin', adminRouter);
app.use('/api/setup', setupRouter);
app.use('/api/products', productsRouter); // Public curated products

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
