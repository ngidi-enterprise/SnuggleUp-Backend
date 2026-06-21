import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
const bobEndpoint = `${baseUrl}/api/bob/health`;

const run = async () => {
  try {
    const response = await fetch(bobEndpoint);
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Bob test failed:', error.message);
  }
};

run();
