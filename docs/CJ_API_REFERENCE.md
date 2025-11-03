# CJ Dropshipping API Quick Reference

## 🚀 Implemented Endpoints

### 1. Search Products
**Endpoint:** `GET /api/cj/products`

**Query Parameters:**
- `productNameEn` - Search by product name (e.g., "baby toys")
- `pageNum` - Page number (default: 1)
- `pageSize` - Results per page (default: 20, max: 200)
- `categoryId` - Filter by category ID
- `minPrice` - Minimum price filter
- `maxPrice` - Maximum price filter

**Example:**
```bash
GET /api/cj/products?productNameEn=baby&pageNum=1&pageSize=10&minPrice=5&maxPrice=20
```

**Response:**
```json
{
  "source": "cj",
  "items": [
    {
      "pid": "PRODUCT-ID",
      "name": "Product Name",
      "sku": "CJXXXXXX",
      "price": 12.99,
      "image": "https://...",
      "categoryName": "Baby Products",
      "isFreeShipping": true
    }
  ],
  "pageNum": 1,
  "pageSize": 10,
  "total": 150
}
```

---

### 2. Get Product Details
**Endpoint:** `GET /api/cj/products/:pid`

**Example:**
```bash
GET /api/cj/products/000B9312-456A-4D31-94BD-B083E2A198E8
```

**Response:**
```json
{
  "pid": "000B9312-456A-4D31-94BD-B083E2A198E8",
  "name": "Product Name",
  "sku": "CJXXXXXX",
  "price": 12.99,
  "description": "Full product description...",
  "variants": [
    {
      "vid": "VARIANT-ID",
      "name": "Blue - Large",
      "sku": "CJXXXXXX-Blue-L",
      "price": 12.99,
      "weight": 500,
      "key": "Blue,Large"
    }
  ]
}
```

---

### 3. Check Inventory
**Endpoint:** `GET /api/cj/inventory/:vid`

**Example:**
```bash
GET /api/cj/inventory/D4057F56-3F09-4541-8461-9D76D014846D
```

**Response:**
```json
{
  "vid": "D4057F56-3F09-4541-8461-9D76D014846D",
  "inventory": [
    {
      "warehouseId": "1",
      "warehouseName": "China Warehouse",
      "countryCode": "CN",
      "totalInventory": 1000,
      "cjInventory": 200,
      "factoryInventory": 800
    },
    {
      "warehouseId": "2",
      "warehouseName": "US Warehouse",
      "countryCode": "US",
      "totalInventory": 50
    }
  ]
}
```

---

### 4. Create Order
**Endpoint:** `POST /api/cj/orders`

**Required Fields:**
```json
{
  "orderNumber": "YOUR-ORDER-12345",
  "shippingCountryCode": "US",
  "shippingCountry": "United States",
  "shippingProvince": "California",
  "shippingCity": "Los Angeles",
  "shippingCustomerName": "John Doe",
  "shippingAddress": "123 Main St",
  "shippingPhone": "1234567890",
  "logisticName": "USPS+",
  "fromCountryCode": "CN",
  "products": [
    {
      "vid": "D4057F56-3F09-4541-8461-9D76D014846D",
      "quantity": 2
    }
  ]
}
```

**Optional Fields:**
- `shippingZip` - Postal code
- `shippingAddress2` - Address line 2
- `email` - Customer email
- `remark` - Order notes
- `payType` - Payment type (2 = balance payment, 3 = manual payment)

**Response:**
```json
{
  "orderId": "CJ-ORDER-ID",
  "orderNumber": "YOUR-ORDER-12345",
  "orderStatus": "UNPAID",
  "orderAmount": 25.50,
  "productAmount": 20.00,
  "postageAmount": 5.50,
  "productInfoList": [...]
}
```

---

### 5. Get Order Status
**Endpoint:** `GET /api/cj/orders/:orderId`

**Example:**
```bash
GET /api/cj/orders/210823100016290555
```

**Response:**
```json
{
  "orderId": "210823100016290555",
  "orderNum": "YOUR-ORDER-12345",
  "cjOrderId": "CJ-12345",
  "orderStatus": "SHIPPED",
  "trackNumber": "TRACK123456789",
  "trackingUrl": "https://...",
  "logisticName": "USPS+",
  "orderAmount": 25.50,
  "createDate": "2024-01-01 10:00:00",
  "paymentDate": "2024-01-01 10:05:00"
}
```

**Order Statuses:**
- `CREATED` - Order created, awaiting confirmation
- `IN_CART` - In cart, awaiting confirmation
- `UNPAID` - Confirmed, awaiting payment
- `UNSHIPPED` - Paid, awaiting shipment
- `SHIPPED` - Shipped, in transit
- `DELIVERED` - Delivered to customer
- `CANCELLED` - Order cancelled

---

### 6. Get Tracking Info
**Endpoint:** `GET /api/cj/tracking/:trackNumber`

**Example:**
```bash
GET /api/cj/tracking/CJPKL7160102171YQ
```

**Response:**
```json
{
  "trackNumber": "CJPKL7160102171YQ",
  "tracking": [
    {
      "trackingNumber": "CJPKL7160102171YQ",
      "logisticName": "CJPacket",
      "trackingFrom": "CN",
      "trackingTo": "US",
      "deliveryDay": "13",
      "deliveryTime": "2024-01-15 07:04:04",
      "trackingStatus": "Delivered",
      "lastMileCarrier": "USPS",
      "lastTrackNumber": "9261129030321245"
    }
  ]
}
```

---

### 7. Webhook Endpoint
**Endpoint:** `POST /api/cj/webhook`

Configure in CJ dashboard to point to:
```
https://snuggleup-backend.onrender.com/api/cj/webhook
```

**Webhook Types:**
- `order` - Order status updates
- `logistics` - Tracking updates
- `stock` - Inventory updates
- `product` - Product updates

---

## 🔑 Environment Variables

Required in Render dashboard:
```env
CJ_EMAIL=support@snuggleup.co.za
CJ_API_KEY=c8d6ec9d12be40cf8117bf79ce721ba1
CJ_BASE_URL=https://developers.cjdropshipping.com/api2.0/v1
```

Optional:
```env
CJ_WEBHOOK_SECRET=your-webhook-secret
```

---

## 📝 Frontend Integration Flow

### Product Search & Display
1. User searches products: `GET /api/cj/products?productNameEn=baby`
2. Display results with images, prices
3. User clicks product → `GET /api/cj/products/:pid` for details
4. Show variants and options

### Checkout Flow
1. User adds to cart (store locally)
2. Before checkout, check inventory: `GET /api/cj/inventory/:vid`
3. User completes checkout in your store
4. Create CJ order: `POST /api/cj/orders`
5. Store CJ order ID with your order

### Order Tracking
1. Poll for status: `GET /api/cj/orders/:orderId`
2. When status = "SHIPPED", get tracking: `GET /api/cj/tracking/:trackNumber`
3. Display tracking info to customer
4. Or use webhooks for real-time updates

---

## 🧪 Testing Checklist

- [ ] Deploy to Render with environment variables
- [ ] Test health check: `GET /api/cj/health`
- [ ] Test product search: `GET /api/cj/products?productNameEn=baby`
- [ ] Test product details with real PID
- [ ] Test inventory check with real VID
- [ ] Create test order with CJ
- [ ] Monitor order status
- [ ] Verify tracking info

---

## 🚨 Common Issues

**401 Unauthorized:**
- Check CJ_EMAIL and CJ_API_KEY are correct
- Token may have expired (should auto-refresh)

**Product not found:**
- Verify PID/VID from CJ dashboard
- Some products may be delisted

**Order creation fails:**
- Check all required fields are provided
- Verify shipping address format
- Ensure logistics method is available for destination

**Insufficient inventory:**
- Check inventory before order creation
- CJ inventory updates in real-time
