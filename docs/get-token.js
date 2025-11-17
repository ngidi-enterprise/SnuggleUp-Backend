// Simple script to get CJ access token
// Run: node get-token.js

import dotenv from 'dotenv';
dotenv.config({ path: './backend/.env' });

const CJ_EMAIL = process.env.CJ_EMAIL;
const CJ_API_KEY = process.env.CJ_API_KEY;
const CJ_BASE_URL = 'https://developers.cjdropshipping.com/api2.0/v1';

if (!CJ_EMAIL || !CJ_API_KEY) {
  console.error('❌ Missing CJ_EMAIL or CJ_API_KEY in backend/.env');
  process.exit(1);
}

console.log('🔄 Requesting CJ access token...');
console.log(`Email: ${CJ_EMAIL}`);

try {
  const response = await fetch(CJ_BASE_URL + '/authentication/getAccessToken', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: CJ_EMAIL,
      apiKey: CJ_API_KEY,
    }),
  });

  const json = await response.json();

  if (!response.ok || !json.result) {
    console.error('❌ Failed to get token:', json.message || 'Unknown error');
    console.error('Response:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Success! Copy this token to your Render environment variables:\n');
  console.log('━'.repeat(80));
  console.log(`CJ_ACCESS_TOKEN=${json.data.accessToken}`);
  console.log('━'.repeat(80));
  console.log(`\nExpiry: ${json.data.accessTokenExpiryDate}`);
  console.log(`\n📋 Copy the full line above and add it to Render's environment variables.`);

} catch (error) {
  console.error('❌ Network error:', error.message);
  process.exit(1);
}
