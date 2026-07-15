
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
      shipping_id_number TEXT,
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
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_id_number TEXT;`);
  
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

  // SMS tracking consent and destination. SMS is only sent when the customer opts in.
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_tracking_opt_in BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_tracking_phone TEXT;`);
  
  // Email tracking - prevent duplicate confirmation emails on PayFast IPN retries
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sent_confirmation BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS owner_order_email_sent BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS owner_order_sms_sent BOOLEAN DEFAULT FALSE;`);

  // Customer-reported late delivery/pickup flags for admin follow-up.
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_order_flagged_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_order_flag_count INTEGER DEFAULT 0;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_order_flag_status TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_order_flag_notified_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_order_flag_email_last_error TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_late_order_flagged_at ON orders(late_order_flagged_at) WHERE late_order_flagged_at IS NOT NULL;`);

  // Bob Go tracking fields. Shipments are still created manually in Bob Go;
  // these fields let Bob Go webhooks update customer-facing tracking.
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_shipment_id TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_tracking_reference TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_tracking_url TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_courier_name TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_provider_slug TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_service_level TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_tracking_status TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_health_status TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_health_status_reason TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_tracking_events JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_tracking_last_event_time TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_tracking_updated_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS bob_last_webhook_topic TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_bob_tracking_reference ON orders(bob_tracking_reference);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_bob_shipment_id ON orders(bob_shipment_id);`);

  // Supplier handoff confirmation. The supplier opens a private tokenized link,
  // taps one large action, and the order records whether the parcel left them.
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_pickup_token TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_pickup_status TEXT DEFAULT 'waiting';`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_pickup_confirmed_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_pickup_updated_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_pickup_notes TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_pickup_last_sent_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_waybill_url TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_supplier_pickup_token ON orders(supplier_pickup_token) WHERE supplier_pickup_token IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_supplier_pickup_status ON orders(supplier_pickup_status);`);
  
  // Migration: Change user_id from INTEGER to TEXT for Supabase UUID compatibility
  try {
    // Check current type first
    const typeCheck = await pool.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name = 'orders' AND column_name = 'user_id'
    `);
    const currentType = typeCheck.rows[0]?.data_type;
    console.log('📊 Current user_id type:', currentType);
    
    if (currentType === 'integer') {
      console.log('🔄 Converting user_id from INTEGER to TEXT...');
      // Drop legacy FK that points to users.id (integer) so we can widen the column
      await pool.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;`);
      // Use USING clause to convert existing integer IDs to text
      await pool.query(`ALTER TABLE orders ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;`);
      console.log('✅ Migrated orders.user_id to TEXT for Supabase UUIDs');
    } else if (currentType === 'text') {
      console.log('✅ user_id is already TEXT - no migration needed');
    }
  } catch (err) {
    console.error('❌ orders.user_id migration failed:', err.message);
    console.error('Full error:', err);
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

  // Cached translated product reviews (source hash to avoid re-translating unchanged reviews)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_review_translations (
      id SERIAL PRIMARY KEY,
      pid TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      source_text TEXT,
      translated_text TEXT NOT NULL,
      detected_lang TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(pid, comment_id, source_hash)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_translations_pid ON product_review_translations(pid);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_review_translations_comment ON product_review_translations(comment_id);`);

  // Customer reviews - user-submitted reviews for purchased products
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_reviews (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title TEXT,
      comment TEXT NOT NULL,
      verified_purchase BOOLEAN DEFAULT TRUE,
      helpful_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id, order_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_reviews_user ON customer_reviews(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_reviews_product ON customer_reviews(product_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_reviews_order ON customer_reviews(order_id);`);

  // Local warehouse products - manually added inventory
  await pool.query(`
    CREATE TABLE IF NOT EXISTS local_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      compare_at_price DECIMAL(10,2),
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      sku TEXT UNIQUE,
      category TEXT DEFAULT 'General',
      tags TEXT[] DEFAULT '{}',
      images TEXT[] DEFAULT '{}',
      weight_kg DECIMAL(8,2),
      dimensions JSONB,
      is_featured BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_local_products_category ON local_products(category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_local_products_sku ON local_products(sku);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_local_products_active ON local_products(is_active);`);
  
  console.log('✅ PostgreSQL database initialized successfully');
}

initDb().catch(err => {
  console.error('PostgreSQL DB init error:', err);
});

// Export both default and named for flexibility
export { pool };
export default pool;
