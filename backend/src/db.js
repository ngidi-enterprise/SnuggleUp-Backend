
// Postgres Pool setup (ESM)
// Use direct named import to avoid interop edge cases that can produce an object
// without a functioning query method on some deployments.
import { Pool } from 'pg';

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

// Defensive: if for any reason Pool construction yielded an object without query,
// attempt a second initialization. This guards against rare module interop issues.
if (!pool || typeof pool.query !== 'function') {
  try {
    console.warn('⚠️ Postgres pool missing query method on first init. Retrying with fresh Pool instance.');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
  } catch (e) {
    console.error('❌ Failed second attempt to initialize Postgres pool:', e.message);
  }
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
      shipping_country TEXT DEFAULT 'ZA',
      shipping_method TEXT,
      insurance_selected BOOLEAN DEFAULT FALSE,
      insurance_cost REAL DEFAULT 0,
      insurance_coverage REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`);
  
  // Ensure new order columns exist (idempotent adds for existing deployments)
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country TEXT DEFAULT 'ZA';`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_method TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS insurance_selected BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS insurance_cost REAL DEFAULT 0;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS insurance_coverage REAL DEFAULT 0;`);
  
  // CJ Dropshipping order tracking columns
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cj_order_id TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cj_order_number TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cj_tracking_number TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cj_tracking_url TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cj_submitted_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cj_status TEXT;`);
  
  // Customer shipping details columns
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_province TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_postal_code TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_phone TEXT;`);
  
  // Email tracking - prevent duplicate confirmation emails on PayFast IPN retries
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sent_confirmation BOOLEAN DEFAULT FALSE;`);
  
  // Migration: Change user_id from INTEGER to TEXT for Supabase UUID compatibility
  try {
    // Use USING clause to convert existing integer IDs to text
    await pool.query(`ALTER TABLE orders ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;`);
    console.log('✅ Migrated orders.user_id to TEXT for Supabase UUIDs');
  } catch (err) {
    // If migration fails, log the error but continue
    console.log('⚠️ orders.user_id migration issue:', err.message);
    // Check current type
    try {
      const typeCheck = await pool.query(`
        SELECT data_type FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'user_id'
      `);
      console.log('📊 Current user_id type:', typeCheck.rows[0]?.data_type);
    } catch {}
  }

  // Admin role column
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);

  // Curated products table - stores selected CJ products with custom pricing
  await pool.query(`
    CREATE TABLE IF NOT EXISTS curated_products (
      id SERIAL PRIMARY KEY,
      cj_pid TEXT UNIQUE NOT NULL,
      cj_vid TEXT,
      group_code TEXT,
      product_name TEXT NOT NULL,
      original_cj_title TEXT,
      seo_title TEXT,
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

  // Add new columns to existing table if they don't exist (migration)
  await pool.query(`
    ALTER TABLE curated_products 
    ADD COLUMN IF NOT EXISTS original_cj_title TEXT,
    ADD COLUMN IF NOT EXISTS seo_title TEXT,
    ADD COLUMN IF NOT EXISTS product_material TEXT,
    ADD COLUMN IF NOT EXISTS product_features TEXT,
    ADD COLUMN IF NOT EXISTS package_size TEXT,
    ADD COLUMN IF NOT EXISTS packing_list TEXT,
    ADD COLUMN IF NOT EXISTS product_weight TEXT,
    ADD COLUMN IF NOT EXISTS group_code TEXT;
  `);

  // Detailed per-warehouse inventory snapshots for curated products
  await pool.query(`
    CREATE TABLE IF NOT EXISTS curated_product_inventories (
      id SERIAL PRIMARY KEY,
      curated_product_id INTEGER NOT NULL REFERENCES curated_products(id) ON DELETE CASCADE,
      cj_pid TEXT,
      cj_vid TEXT,
      warehouse_id TEXT,
      warehouse_name TEXT,
      country_code TEXT,
      total_inventory INTEGER,
      cj_inventory INTEGER,
      factory_inventory INTEGER,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_curated_inv_curated_product_id ON curated_product_inventories(curated_product_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_curated_inv_cj_vid ON curated_product_inventories(cj_vid);`);

  // Inventory sync history - tracks each sync run with metadata
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_sync_history (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMP NOT NULL,
      completed_at TIMESTAMP,
      products_updated INTEGER DEFAULT 0,
      products_failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_message TEXT,
      sync_type TEXT DEFAULT 'scheduled',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sync_history_started_at ON inventory_sync_history(started_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sync_history_status ON inventory_sync_history(status);`);

  // Global site configuration key/value store (pricing etc.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Seed default pricing config if absent
  await pool.query(`INSERT INTO site_config (key, value) VALUES ('price_markup','1.4') ON CONFLICT (key) DO NOTHING;`);
  await pool.query(`INSERT INTO site_config (key, value) VALUES ('usd_to_zar','18.0') ON CONFLICT (key) DO NOTHING;`);

  // Cart persistence table - stores user cart items
  await pool.query(`
    CREATE TABLE IF NOT EXISTS carts (
      id SERIAL PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      items JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id);`);
  
  console.log('✅ PostgreSQL database initialized successfully');
}

initDb().catch(err => {
  console.error('PostgreSQL DB init error:', err);
});

// Export both default and named for flexibility
export { pool };
export default pool;
