# PayFast Integration Notes

## Setup Requirements

1. PayFast Credentials:
   - Merchant ID
   - Merchant Key
   - Get these from your PayFast account

2. Environment Variables (add to .env):
```
FRONTEND_URL=https://snuggleup.co.za
BACKEND_URL=https://api.snuggleup.co.za
PAYFAST_MERCHANT_ID=your_live_merchant_id
PAYFAST_MERCHANT_KEY=your_live_merchant_key
PAYFAST_PASSPHRASE=your_live_passphrase
PAYFAST_NO_PASSPHRASE=false
PAYFAST_TEST_MODE=false
PAYFAST_DEBUG_LOGS=false
```

3. PayFast callback URLs are sent with each checkout request:
   - Return URL: https://api.snuggleup.co.za/api/payments/success
   - Cancel URL: https://api.snuggleup.co.za/api/payments/cancel
   - Notify URL: https://api.snuggleup.co.za/api/payments/notify

4. Confirm live mode after deployment:
   - Open `https://api.snuggleup.co.za/api/payments/health`
   - It should show `"mode":"live"`, `"ready":true`, and `"usingKnownSandboxCredentials":false`

## Integration Flow

1. Frontend initiates payment:
```javascript
// Example frontend checkout flow
const startCheckout = async (cartData) => {
  const response = await fetch('/api/payments/create', {
    method: 'POST',
    body: JSON.stringify(cartData)
  });
  const { paymentUrl } = await response.json();
  window.location.href = paymentUrl;
};
```

2. Backend creates payment:
```javascript
// Example backend route (see payments/routes.js)
app.post('/api/payments/create', async (req, res) => {
  // Generate payment signature and URL
  // Redirect user to PayFast
});
```

3. PayFast notifies your backend:
```javascript
// Example notification handler (see payments/notify.js)
app.post('/api/payments/notify', async (req, res) => {
  // Verify payment signature
  // Update order status
  // Send confirmation email
});
```

## Testing

Use these test card details only in sandbox/test mode:
- Card Number: 5200000000000015
- CVV: 123
- Expiry: Any future date

## Security Notes

1. Always verify payment notifications server-side
2. Use HTTPS for all URLs
3. Keep your merchant key and passphrase secure
4. Validate all payment amounts
5. Use PayFast's signature validation
