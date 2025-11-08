# SnuggleUp E-commerce Platform

Minimal overview. See `QUICK_START.md` for dev flow; this README focuses on Production Setup readiness.

## Production Setup
1. Domains
   - Frontend: `snuggleup.co.za` (A/AAAA or CNAME to host) -> verify HTTPS.
   - Backend/API: `api.snuggleup.co.za` (CNAME to Render service) -> verify HTTPS.
2. Environment Variables (Backend)
   - `BACKEND_URL=https://api.snuggleup.co.za`
   - `FRONTEND_URL=https://snuggleup.co.za`
   - `PAYFAST_TEST_MODE=false` (after live switch)
   - `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`
   - `CJ_EMAIL`, `CJ_API_KEY`, `USD_TO_ZAR` (e.g. 18.50)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`
3. Environment Variables (Frontend - Vite)
   - `VITE_API_BASE=https://api.snuggleup.co.za/api`
4. Supabase Redirects
   - Add both domain URLs (frontend + backend) under Authentication -> URL Configuration.
5. PayFast Dashboard
   - Set return/cancel/notify URLs to: `https://api.snuggleup.co.za/api/payments/success|cancel|notify`.
6. Analytics & SEO
   - GA4 Measurement ID in `frontend/index.html`.
   - JSON-LD organization node uses production domain/logo.
7. Shipping & Orders
   - Ensure curated products include CJ variant IDs for freight quotes & future auto-order.
   - Confirm `USD_TO_ZAR` is updated daily/weekly.

## Health Checklist Endpoint
GET `https://api.snuggleup.co.za/api/health`
Returns JSON with readiness flags (DB, PayFast live creds, CJ auth config, env URLs).

## PayFast IPN Flow (Implemented)
1. User redirected to PayFast via /api/payments/create.
2. PayFast posts IPN to `/api/payments/notify`.
3. Server:
   - Rebuild signature (alphabetical params + optional passphrase).
   - Server-to-server validation against PayFast validate endpoint.
   - Updates order status (`paid`, `failed`, `pending`).

## Step-by-Step Live Switch
1. Point domains & wait for HTTPS.
2. Set backend env vars (above list) & redeploy.
3. Set frontend `VITE_API_BASE` & rebuild.
4. Flip `PAYFAST_TEST_MODE=false`; add live merchant creds/passphrase.
5. Update Supabase redirect URLs.
6. Hit `/api/health` -> verify `ready.payfastLiveReady=true`.
7. Perform a small live transaction (low-priced test item) & confirm order status becomes `paid`.

## Next (Optional)
- Implement CJ auto-order on successful PayFast IPN (call `cjClient.createOrder`).
- Add address capture & pass logisticName / variant mapping.
- Add email notifications (order confirmation, shipping updates).

Refer to `DEPLOYMENT_CHECKLIST.md` and `payfast_README.md` for deeper detail.
