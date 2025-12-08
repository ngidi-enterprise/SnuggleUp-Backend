const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://snuggleup_db_user:bZZtPcmeraARyoBKEKqsMMcyZsny46j6@dpg-d3qhfg2li9vc73cca210-a.oregon-postgres.render.com/snuggleup_db'
});

const orderNumber = 'TEST-' + Date.now();
const items = JSON.stringify([{id: '1', name: 'Test Product', price: 100, quantity: 1, cj_vid: '12345'}]);

pool.query(
  'INSERT INTO orders (user_id, order_number, items, subtotal, shipping, discount, total, status, customer_email, shipping_country, shipping_method, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())',
  ['test-user', orderNumber, items, 100.00, 50.00, 0, 150.00, 'paid', 'test@example.com', 'ZA', 'USPS+'],
  (err, result) => {
    if (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
    console.log('✅ Test order created:', orderNumber);
    console.log('   Status: paid');
    console.log('   Total: R150.00');
    console.log('   CJ Status: Not submitted');
    console.log('\nRefresh your admin Orders page to see the "Submit to CJ" button');
    pool.end();
  }
);
