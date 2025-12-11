import crypto from 'crypto';

// PayFast's working example from their email
const testData = {
  merchant_id: '10042854',
  merchant_key: 'bmvnyjivavg1a',
  return_url: 'http://ipn.payfast.co.za',
  cancel_url: 'http://ipn.payfast.co.za',
  notify_url: 'http://ipn.payfast.co.za',
  name_first: 'Test',
  email_address: 'test@payfast.co.za',
  m_payment_id: '1',
  amount: '398.00',
  item_name: 'Test'
};

// Field order from PayFast
const fieldOrder = [
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  'name_first',
  'email_address',
  'm_payment_id',
  'amount',
  'item_name'
];

// Build signature string with URL encoding
const signatureString = fieldOrder
  .filter(k => testData[k] !== undefined)
  .map(key => `${key}=${encodeURIComponent(String(testData[key]))}`)
  .join('&');

console.log('Signature string:');
console.log(signatureString);
console.log('');

const hash = crypto.createHash('md5').update(signatureString).digest('hex');

console.log('Our MD5:', hash);
console.log('PayFast expected:', 'cf40aa2612090bfc48f8ffce2cc3b438');
console.log('Match:', hash === 'cf40aa2612090bfc48f8ffce2cc3b438' ? '✅ YES' : '❌ NO');
