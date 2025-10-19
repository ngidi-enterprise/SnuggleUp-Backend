
import pkg from 'pg';
const { Pool } = pkg;

// PostgreSQL connection config (use environment variables in production)
const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'snuggleup',
  password: process.env.PGPASSWORD || 'postgres',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
});

// Create tables if they don't exist
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      order_number TEXT UNIQUE NOT NULL,
      items TEXT NOT NULL,
      subtotal REAL NOT NULL,
      shipping REAL NOT NULL,
      discount REAL DEFAULT 0,
      total REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payfast_payment_id TEXT,
      payfast_signature TEXT,
      customer_email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
  console.log('✅ PostgreSQL database initialized successfully');
}

initDb().catch(err => {
  console.error('PostgreSQL DB init error:', err);
});

export default pool;
