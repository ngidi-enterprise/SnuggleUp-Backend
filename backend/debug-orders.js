import db from './src/db.js';

try {
  const res = await db.query(`
    SELECT 
      id, 
      order_number, 
      shipping_phone, 
      shipping_postal_code,
      customer_name,
      shipping_address,
      shipping_city
    FROM orders 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  
  console.log('\n=== RECENT ORDERS IN DATABASE ===\n');
  res.rows.forEach((row, i) => {
    console.log(`${i+1}. Order #${row.order_number}`);
    console.log(`   Phone: "${row.shipping_phone}" (type: ${typeof row.shipping_phone})`);
    console.log(`   Postal: "${row.shipping_postal_code}" (type: ${typeof row.shipping_postal_code})`);
    console.log(`   Name: "${row.customer_name}"`);
    console.log(`   Address: "${row.shipping_address}"`);
    console.log(`   City: "${row.shipping_city}"\n`);
  });
  
  process.exit(0);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
