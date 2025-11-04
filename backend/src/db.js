
import pkg from 'pg';
const { Pool } = pkg;

// PostgreSQL connection config (supports Render DATABASE_URL and SSL)
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });
} else {
  const baseConfig = {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'snuggleup',
    password: process.env.PGPASSWORD || 'postgres',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
  };
  // Enable SSL if explicitly requested
  if (process.env.PGSSLMODE === 'require') {
    baseConfig.ssl = { rejectUnauthorized: false };
  }
  pool = new Pool(baseConfig);
}

// Create tables if they don't exist
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
        reset_token TEXT,
        reset_token_expires TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure reset columns exist even if the table was created before these fields were added
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
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
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
  
  // Migration: Change user_id from INTEGER to TEXT for Supabase UUID compatibility
  try {
    await pool.query(`ALTER TABLE orders ALTER COLUMN user_id TYPE TEXT;`);
    console.log('✅ Migrated orders.user_id to TEXT for Supabase UUIDs');
  } catch (err) {
    // Column might already be TEXT or migration already ran
    console.log('ℹ️ orders.user_id migration skipped:', err.message);
  }

  // Admin role column
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);

  // Curated products table - stores selected CJ products with custom pricing
  await pool.query(`
    CREATE TABLE IF NOT EXISTS curated_products (
      id SERIAL PRIMARY KEY,
      cj_pid TEXT UNIQUE NOT NULL,
      cj_vid TEXT,
      product_name TEXT NOT NULL,
      product_description TEXT,
      product_image TEXT,
      cj_cost_price REAL NOT NULL,
      suggested_price REAL NOT NULL,
      custom_price REAL,
      is_active BOOLEAN DEFAULT TRUE,
      category TEXT,
      stock_quantity INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_curated_products_active ON curated_products(is_active);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_curated_products_category ON curated_products(category);`);
  
  console.log('✅ PostgreSQL database initialized successfully');
}

initDb().catch(err => {
  console.error('PostgreSQL DB init error:', err);
});

export default pool;
