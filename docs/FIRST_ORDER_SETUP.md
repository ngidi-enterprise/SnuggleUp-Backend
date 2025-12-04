# First Order Testing & Setup Guide

## Status Summary
✅ **Order system is fully implemented and ready for testing!**

All core components are in place:
- PayFast sandbox integration with signature generation
- Order creation in database (pending → paid states)
- Order confirmation emails (configured)
- PayFast webhook handling
- CJ Dropshipping order submission

## Step 1: Verify PayFast Sandbox Credentials

Set these environment variables in Render backend:

```
PAYFAST_MERCHANT_ID=10042854
PAYFAST_MERCHANT_KEY=bmvnyjivavg1a
PAYFAST_PASSPHRASE=your-passphrase-here  (optional but recommended)
PAYFAST_TEST_MODE=true
```

**How to verify:**
1. Go to Render → SnuggleUp Backend → Environment
2. Check that `PAYFAST_TEST_MODE=true` is set
3. Merchant ID and Key should match your PayFast sandbox account
4. For test transactions, use these PayFast sandbox credentials:
   - Name: Test User
   - Email: test@example.com
   - Card: 4111 1111 1111 1111 (Visa test card)
   - Expiry: 01/25
   - CVV: 123

## Step 2: Test First Order (Full Checkout Flow)

### Prerequisites:
- Backend running with `PAYFAST_TEST_MODE=true`
- Frontend running locally or on Render
- At least one product in store with `stock_quantity > 0`
- User logged in (or use guest checkout with email)

### Steps:

1. **Add Product to Cart**
   - Open store: https://snuggleup.co.za
   - Find a product with "In Stock" status
   - Click "Add to Cart"

2. **Open Cart & Review**
   - Click "Checkout" button
   - Verify shipping country selector (default: South Africa)
   - Wait for shipping quotes to load

3. **Select Shipping Method**
   - Choose any available shipping option
   - Note: Estimated cost should display

4. **Optional: Add Insurance**
   - Check "Shipping Insurance" if available
   - Verify insurance cost displays

5. **Enter Shipping Details**
   - Fill in name, address, city, postal code, phone
   - Click "Proceed to PayFast"

6. **Complete PayFast Sandbox Payment**
   - You'll be redirected to PayFast sandbox
   - Use test card: **4111 1111 1111 1111**
   - Expiry: **01/25** | CVV: **123**
   - Name: Any name
   - Click "Pay Now"

7. **Verify Success**
   - Should redirect to order success page
   - Order appears in customer account with status "Paid"
   - Order confirmation email sent (check spam folder)

## Step 3: Check Order in Database

SSH into Render or use database client:

```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 1;
```

Expected output:
- `status`: 'paid'
- `customer_email`: Your test email
- `total`: Total amount charged
- `items`: JSON array of ordered products
- `payfast_payment_id`: Non-null (populated by webhook)

## Step 4: Submit Order to CJ Dropshipping

From admin dashboard:

1. Go to **Order Management** tab
2. Find your test order (status should be "Paid")
3. Click **"Submit to CJ"** button
4. Verify CJ order creation response:
   - `cj_order_id`: Should display CJ order ID
   - `cj_order_number`: Order number from CJ

```sql
SELECT id, order_number, cj_order_id, cj_order_number, cj_status FROM orders 
WHERE order_number = 'ORDER-xxxxx' LIMIT 1;
```

## Step 5: Track Order Status

### Customer View:
1. Log in with test account
2. Go to "My Account" → "Orders"
3. Click on test order
4. Should show:
   - Order details with items and total
   - CJ Dropshipping order ID (if submitted)
   - Estimated delivery date (from shipping quote)
   - Tracking link (once CJ updates)

### Background Automation:
- Scheduled job checks CJ order status every 30 minutes
- Updates order with tracking number and URL
- Customer automatically sees updates in their account

## Common Issues & Fixes

### ❌ PayFast Signature Mismatch
**Cause:** Wrong merchant ID/key or passphrase
**Fix:** Double-check environment variables match PayFast sandbox account

### ❌ Order Status Stays "Pending"
**Cause:** PayFast webhook not being called (IPN disabled in sandbox account)
**Fix:** 
1. Log in to PayFast sandbox
2. Settings → Instant Payment Notification
3. Enable IPN
4. Set URL to: `https://snuggleup-backend.onrender.com/api/payments/notify`

### ❌ "Product not found" / "Not linked to CJ"
**Cause:** Product has no cj_vid or is missing from CJ
**Fix:** Add product through admin "Add Product" with valid CJ PID

### ❌ Shipping quotes failing / empty
**Cause:** Products missing cj_vid or CJ API rate limit
**Fix:** 
1. Run admin endpoint: POST `/api/admin/products/fix-missing-vids`
2. Wait for CJ quota reset if hitting rate limit (after 6pm daily)

## Timeline

**Week 1 (This Week):**
- ✅ Verify PayFast sandbox setup
- ✅ Test first order checkout flow
- ✅ Verify order appears in database
- ✅ Submit test order to CJ
- ✅ Check order confirmation email

**Week 2:**
- Set up production PayFast credentials
- Enable CJ live order submission
- Configure tracking/shipping updates
- Set up order notification emails

## Support

If you hit issues:
1. Check backend logs: `Render → Logs`
2. Check browser console: `F12 → Console`
3. Verify PayFast settings: https://dashboard.payfast.co.za
4. Check email service configuration in backend

---

**Ready to place your first order? Let's go! 🚀**
