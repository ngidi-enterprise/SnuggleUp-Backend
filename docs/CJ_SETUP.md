# CJ Dropshipping Integration (Scaffold)

This project includes a lightweight CJ Dropshipping integration scaffold so you can:
- Search CJ products from your store backend
- Create CJ orders from your local orders
- Receive CJ webhooks for fulfillment/tracking

It ships in a safe default state (mock mode) until you add credentials.

## 1) Environment Variables

Add the following to your Render backend environment:

```
# CJ API (Required)
CJ_EMAIL=support@snuggleup.co.za
CJ_API_KEY=c8d6ec9d12be40cf8117bf79ce721ba1
CJ_BASE_URL=https://developers.cjdropshipping.com/api2.0/v1

# Webhook verification (Optional, for production)
CJ_WEBHOOK_SECRET=
```

**How to add in Render:**
1. Go to https://dashboard.render.com/web/srv-d3m3brumcj7s73achkg0
2. Click **Environment** in left sidebar
3. Click **Add Environment Variable** for each:
   - `CJ_EMAIL` = `support@snuggleup.co.za`
   - `CJ_API_KEY` = `c8d6ec9d12be40cf8117bf79ce721ba1`
   - `CJ_BASE_URL` = `https://developers.cjdropshipping.com/api2.0/v1`
4. Click **Save Changes**
5. Render will auto-deploy (~2 minutes)

**How it works:**
- Backend will POST to `https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken` with your email and API key
- CJ returns an access token (valid 15 days) which is cached and used for all API calls
- Token auto-refreshes when needed

## 2) Endpoints

Backend mounts under `/api/cj`:

- `GET /api/cj/health` — Status of config and availability.
- `GET /api/cj/products?q=keyword&page=1&pageSize=20` — Searches CJ products. Returns mock data if `CJ_ACCESS_TOKEN` is not set.
- `POST /api/cj/orders` — Creates an order in CJ (payload mirrors your order model; adjust as needed).
- `POST /api/cj/webhook` — Receives CJ webhooks. Configure in CJ dashboard to point to this URL.

## 3) Implementation Details

- Client implementation lives in `backend/src/services/cjClient.js`.
- Uses global `fetch` (Node 18+). If your runtime is older, upgrade Node or add `node-fetch`.
- Paths `/api/product/list` and `/api/order/create` are placeholders — replace with paths from the official CJ Open API for your account tier. The code is structured so you only need to edit the `path` strings and (optionally) response mapping.

## 4) Local Testing

- Without credentials, `GET /api/cj/products` returns a mock product so you can build the UI.
- With `CJ_ACCESS_TOKEN` set, it will call CJ and pass back data.

## 5) Next Steps

- Confirm the exact CJ Open API endpoint paths for product search and order creation and update them in `cjClient.js`.
- Map CJ product fields precisely to your store schema in the `searchProducts` mapping.
- Extend `verifyWebhook` based on CJ's signing algorithm and headers.
- Wire up order status updates in `/api/cj/webhook` to update your DB (e.g., set tracking number and status to fulfilled).

## 6) Troubleshooting

- 401 from CJ: Check `CJ_ACCESS_TOKEN` validity and base URL.
- Network errors: Ensure Render/hosting outbound rules allow requests to CJ.
- Webhook signature mismatch: Set `CJ_WEBHOOK_SECRET` and confirm CJ's signature construction method, then adjust `verifyWebhook` accordingly.
