# 🔧 Quick Fix: Check Your Products' VIDs

## The Issue
The HTML tool and API endpoint require authentication. Here are **3 simple ways** to check and fix your products:

---

## ✅ Method 1: Use the Debug Endpoint (Easiest!)

### Step 1: Check VID Status
Open this URL in your browser:
```
https://snuggleup-backend.onrender.com/api/products/debug/check-vids
```

This will show you:
- How many products have VIDs
- How many are missing VIDs
- List of all products with their status

### Step 2: If products are missing VIDs, continue to Method 2 or 3

---

## ✅ Method 2: Direct Database Check (Render Console)

### Step 1: Open PostgreSQL Console
1. Go to https://dashboard.render.com
2. Click on your PostgreSQL database
3. Click "Connect" → "PSQL Command"
4. Click "Connect" (opens a terminal)

### Step 2: Run This Query
```sql
SELECT 
  id,
  product_name,
  cj_pid,
  cj_vid,
  CASE 
    WHEN cj_vid IS NULL OR cj_vid = '' THEN '❌ MISSING'
    ELSE '✅ HAS VID'
  END as status
FROM curated_products 
WHERE is_active = TRUE
ORDER BY id;
```

### Step 3: For Each Product Missing VID

**Option A: Get VID from CJ API**
1. Copy the `cj_pid` from the query result
2. Visit in browser: `https://snuggleup-backend.onrender.com/api/cj/products/YOUR-CJ-PID`
3. Look for `"variants"` in the response
4. Copy the `"vid"` from the first variant
5. Run: 
   ```sql
   UPDATE curated_products 
   SET cj_vid = 'PASTE-VID-HERE', updated_at = NOW() 
   WHERE id = YOUR-PRODUCT-ID;
   ```

**Option B: Get VID from CJ Website**
1. Go to https://www.cjdropshipping.com
2. Search for your product
3. Click on the product
4. Look at the URL - it contains the VID
5. Use the UPDATE query above

---

## ✅ Method 3: PowerShell Script (Windows)

### Run This Command
From the Workspace directory:
```powershell
.\check-and-fix-vids.ps1
```

This will:
- Connect to your database
- Show which products are missing VIDs
- Give you the SQL commands to fix them

---

## 🎯 After Fixing VIDs

### Step 1: Verify Fix Worked
Visit: `https://snuggleup-backend.onrender.com/api/products/debug/check-vids`

You should see:
```json
{
  "total": 5,
  "with_vid": 5,      // ← Should equal total
  "missing_vid": 0,   // ← Should be 0
  "products": [...]
}
```

### Step 2: Clear Your Cart
⚠️ **IMPORTANT**: Remove all items from your cart

### Step 3: Test Shipping Quotes
1. Add a product to cart
2. Open cart
3. You should see real CJ shipping methods (not "Estimated")

---

## 📝 Example: Complete Fix for One Product

### 1. Check the product
```sql
SELECT id, product_name, cj_pid, cj_vid 
FROM curated_products 
WHERE id = 1;
```

Result:
```
id | product_name        | cj_pid  | cj_vid
---+--------------------+---------+--------
1  | Baby Carrier       | ABC123  | NULL
```

### 2. Get VID from CJ API
Visit: `https://snuggleup-backend.onrender.com/api/cj/products/ABC123`

Response includes:
```json
{
  "variants": [
    { "vid": "D4057F56-3F09-4541-8461-9D76D014846D", ... }
  ]
}
```

### 3. Update the database
```sql
UPDATE curated_products 
SET cj_vid = 'D4057F56-3F09-4541-8461-9D76D014846D', 
    updated_at = NOW() 
WHERE id = 1;
```

### 4. Verify
```sql
SELECT id, product_name, cj_vid 
FROM curated_products 
WHERE id = 1;
```

Result:
```
id | product_name  | cj_vid
---+--------------+------------------------------------------
1  | Baby Carrier | D4057F56-3F09-4541-8461-9D76D014846D
```

✅ **Done!** Now clear cart, re-add product, and check shipping quotes.

---

## 🚨 If You Have Many Products

For bulk fixes, consider:
1. Login to admin dashboard (support@snuggleup.co.za)
2. Go to Product Curation tab
3. Click each product to view/edit
4. System should have a "Fetch from CJ" button to auto-populate VID

---

## Need Help?

**Check logs in this order:**
1. Debug endpoint: `/api/products/debug/check-vids`
2. Browser console when viewing cart (F12 → Console)
3. Backend logs on Render

**Common issues:**
- "Failed to fetch" → CORS issue, use Render URL not localhost
- "404 Not Found" → Deploy the backend changes first
- Still showing "Estimated" → Clear cart and re-add products
