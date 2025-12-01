# Diagnosing Missing CJ Variant IDs (cj_vid)

## The Problem
You're seeing "Estimated" shipping rates instead of real CJ quotes because your cart items don't have `cj_vid` (CJ variant IDs).

## Why This Happens
When products are added to the `curated_products` table, the `cj_vid` field might be NULL if:
1. Products were imported without variant selection
2. Products were added manually without linking to a specific CJ variant
3. The CJ product only has one variant and the VID wasn't captured

## Quick Fix: Check Your Database

### Step 1: Check if products have cj_vid
Run this in your PostgreSQL console (Render dashboard → Database → Connect → PSQL):

```sql
-- See which products are missing cj_vid
SELECT id, product_name, cj_pid, cj_vid 
FROM curated_products 
WHERE is_active = TRUE 
ORDER BY id;
```

### Step 2: If cj_vid is NULL, you need to populate it

**Option A: Use Admin Dashboard (Easiest)**
1. Login as admin (support@snuggleup.co.za)
2. Go to Admin Dashboard → Product Curation tab
3. For each product, click "Fetch CJ Details" button
4. This will auto-populate the cj_vid from CJ's API

**Option B: Manual SQL Update (If you know the VID)**
If you know the CJ variant ID for a product:

```sql
UPDATE curated_products 
SET cj_vid = 'ACTUAL-VARIANT-ID-HERE' 
WHERE id = 123;  -- Replace with your product ID
```

**Option C: Fetch VID from CJ API**
For a product with cj_pid but no cj_vid:

1. Get the product details from CJ:
   ```bash
   GET https://snuggleup-backend.onrender.com/api/cj/products/YOUR-CJ-PID
   ```

2. The response will include `variants` array - pick the default variant (usually first one)

3. Copy the `vid` from that variant

4. Update your database:
   ```sql
   UPDATE curated_products 
   SET cj_vid = 'THE-VID-FROM-STEP-2' 
   WHERE cj_pid = 'YOUR-CJ-PID';
   ```

## Step 3: Clear Cart and Re-add Products

After fixing the database:
1. **Clear your cart** (important! Old cart items won't have the VID)
2. Browse store and add products again
3. Open cart - you should now see real shipping quotes instead of "Estimated"

## How to Verify It's Fixed

### Frontend Console (Browser DevTools)
When you open the cart, you should see:
```
🛒 Cart items summary: [
  {
    id: "curated-123",
    name: "Product Name",
    cj_vid: "ACTUAL-VID-HERE",  // ✅ Should NOT be null/undefined
    has_cj_vid: true              // ✅ Should be true
  }
]
```

### Backend Logs (Render Dashboard)
When cart opens and requests shipping:
```
📦 Raw cart items received: [
  { cj_vid: "ACTUAL-VID", quantity: 1, has_vid: true }  // ✅ has_vid should be true
]
🚢 Calling CJ freight API with: {
  products: [{ vid: "ACTUAL-VID", quantity: 1 }]  // ✅ Should have actual VID
}
```

## Prevention: Always Set cj_vid When Adding Products

When curating new products in admin dashboard:
1. Search for CJ product
2. Click "Add to Store" 
3. **Select a specific variant** (color/size)
4. System will auto-set both `cj_pid` AND `cj_vid`

If you're importing products programmatically, always include both fields:
```javascript
{
  cj_pid: "PRODUCT-ID",
  cj_vid: "VARIANT-ID",  // ← Don't skip this!
  // ... other fields
}
```
