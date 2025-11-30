import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkBikes() {
  try {
    const result = await pool.query(`
      SELECT id, product_name, cj_pid, cj_vid, custom_price 
      FROM curated_products 
      WHERE product_name ILIKE '%premium%bike%' 
         OR product_name ILIKE '%S20101%'
         OR product_name ILIKE '%20 inch%'
      ORDER BY product_name
    `);
    
    console.log('Found', result.rows.length, 'bike products:');
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkBikes();
