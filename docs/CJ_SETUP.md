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

### Product Endpoints
- `GET /api/cj/health` — Health check and config status
- `GET /api/cj/products?productNameEn=baby&pageNum=1&pageSize=20&minPrice=5&maxPrice=50` — Search CJ products
- `GET /api/cj/products/:pid` — Get product details with variants
- `GET /api/cj/inventory/:vid` — Check real-time inventory for a variant

### Order Endpoints
- `POST /api/cj/orders` — Create order in CJ
  - Required fields: `orderNumber`, `shippingCountryCode`, `shippingCustomerName`, `shippingAddress`, `logisticName`, `fromCountryCode`, `products: [{vid, quantity}]`
- `GET /api/cj/orders/:orderId` — Get order status and tracking info

### Tracking Endpoints
- `GET /api/cj/tracking/:trackNumber` — Get tracking updates for shipped orders

### Webhook Endpoint
- `POST /api/cj/webhook` — Receives CJ webhooks for order/tracking updates (configure in CJ dashboard)

## 3) Implementation Details

- Client implementation lives in `backend/src/services/cjClient.js`
- Uses global `fetch` (Node 18+)
- Production-ready endpoints implemented:
  - **searchProducts**: `GET /product/list` - Search products by keyword, price, category
  - **getProductDetails**: `GET /product/query` - Get full product details with variants
  - **getInventory**: `GET /product/stock/queryByVid` - Real-time inventory check
  - **createOrder**: `POST /shopping/order/createOrderV2` - Create order with balance payment
  - **getOrderStatus**: `GET /shopping/order/getOrderDetail` - Get order status and tracking
  - **getTracking**: `GET /logistic/trackInfo` - Get shipment tracking updates

## 4) Testing the Integration

Once deployed to Render with environment variables:

**Test product search:**
```bash
curl https://snuggleup-backend.onrender.com/api/cj/products?productNameEn=baby&pageNum=1&pageSize=10
```

**Test product details:**
```bash
curl https://snuggleup-backend.onrender.com/api/cj/products/PRODUCT_PID_HERE
```

**Test inventory check:**
```bash
curl https://snuggleup-backend.onrender.com/api/cj/inventory/VARIANT_VID_HERE
```

## 5) Next Steps

### Backend (Completed ✅)
- ✅ Implement production CJ API endpoints
- ✅ Token caching with auto-refresh
- ✅ Product search, details, inventory check
- ✅ Order creation and status tracking
- ✅ Webhook endpoint for CJ updates

### To Deploy
1. **Option A: GitHub Desktop**
   - Open GitHub Desktop
   - Commit changes: "Add CJ Dropshipping integration"
   - Push to GitHub → Render auto-deploys

2. **Option B: Render Manual Deploy**
   - Go to https://dashboard.render.com/web/srv-d3m3brumcj7s73achkg0
   - Click "Manual Deploy" → "Deploy latest commit"

3. **Add Environment Variables in Render:**
   - `CJ_EMAIL` = `support@snuggleup.co.za`
   - `CJ_API_KEY` = `c8d6ec9d12be40cf8117bf79ce721ba1`
   - `CJ_BASE_URL` = `https://developers.cjdropshipping.com/api2.0/v1`
   - Click "Save Changes" → Render will redeploy

### Frontend Integration
- Build product search UI that calls `/api/cj/products`
- Display product details from `/api/cj/products/:pid`
- Check inventory before checkout using `/api/cj/inventory/:vid`
- Create CJ orders when customers place orders via `/api/cj/orders`
- Poll `/api/cj/orders/:orderId` or use webhooks to track fulfillment

## 6) Troubleshooting

- 401 from CJ: Check `CJ_ACCESS_TOKEN` validity and base URL.
- Network errors: Ensure Render/hosting outbound rules allow requests to CJ.
- Webhook signature mismatch: Set `CJ_WEBHOOK_SECRET` and confirm CJ's signature construction method, then adjust `verifyWebhook` accordingly.
