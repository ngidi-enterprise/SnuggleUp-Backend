# 🔧 CJ ID System Fix - Complete Solution

## 🚨 ROOT CAUSE DISCOVERED

**Problem:** We're confusing CJ's TWO different ID systems:

### CJ Uses TWO ID Formats:
1. **Internal IDs** (for API calls):
   - `pid`: `2510160925241648700` (Product ID - long number)
   - `vid`: `2510160925241649000` (Variant ID - long number)

2. **Public SKUs** (for website/catalog):
   - `productSku`: Not commonly used on website
   - `variantSku`: **`CJYE206896609IR`** ← This is what you see on CJ's website!

### What We're Doing Wrong:
- ❌ Database stores `cj_pid` and `cj_vid` (numeric IDs only)
- ❌ Shipping API sends `vid` in products array
- ❌ **CJ's freight API might require SKU instead of VID**
- ❌ No way to search CJ website with our stored IDs

### What We Should Be Doing:
- ✅ Store BOTH `cj_vid` AND `cj_sku` in database
- ✅ Use **SKU** for shipping quotes (if that's what CJ expects)
- ✅ Use SKU for human-readable product lookup
- ✅ Keep VID for other API endpoints that need it

---

## 🎯 IMMEDIATE FIX PLAN

### Step 1: Update Database Schema
Add `cj_sku` column to `curated_products` table:

```sql
ALTER TABLE curated_products 
ADD COLUMN IF NOT EXISTS cj_sku VARCHAR(50);

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_curated_products_cj_sku 
ON curated_products(cj_sku);
```

### Step 2: Update Admin Product Linking
When admin links a product, save BOTH `vid` AND `variantSku`:

**File:** `backend/src/routes/admin.js` (or wherever product linking happens)

```javascript
// When linking product to CJ variant
const variantData = await cjClient.getProductDetail(pid);
const selectedVariant = variantData.variants.find(v => v.vid === chosenVid);

await pool.query(
  `UPDATE curated_products 
   SET cj_pid = $1, 
       cj_vid = $2,
       cj_sku = $3,  -- NEW: Store the SKU too!
       updated_at = NOW()
   WHERE id = $4`,
  [pid, selectedVariant.vid, selectedVariant.sku, productId]
);
```

### Step 3: Test CJ Shipping API - Which ID Does It Need?

Run this test to determine if CJ wants `vid` or `sku`:

**Test Script:** (save as `test-cj-shipping-id-format.ps1`)

```powershell
# From your screenshot:
$testSku = "CJYE206896609IR"
$testVid = "2510160925241649000"  # If you have this

# Get fresh token
$tokenBody = '{"email":"ngidiproject@gmail.com","apiKey":"CJ4893357@api@93e9dd0791994b77ad1d12e0bced45ce"}'
$tokenResponse = Invoke-RestMethod -Uri "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken" -Method Post -Body $tokenBody -ContentType "application/json"
$token = $tokenResponse.data.accessToken

Write-Host "Testing with VID format..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Test 1: Try with VID
try {
    $body1 = @{
        startCountryCode = "CN"
        endCountryCode = "ZA"
        products = @(
            @{ vid = $testVid; quantity = 1 }
        )
    } | ConvertTo-Json
    
    $response1 = Invoke-RestMethod `
        -Uri "https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate" `
        -Method Post `
        -Body $body1 `
        -Headers @{ "CJ-Access-Token" = $token; "Content-Type" = "application/json" }
    
    Write-Host "✅ VID format works!" -ForegroundColor Green
    Write-Host "Response: $($response1 | ConvertTo-Json -Depth 5)" -ForegroundColor White
} catch {
    Write-Host "❌ VID format failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nTesting with SKU format..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Test 2: Try with SKU (variantSku)
try {
    $body2 = @{
        startCountryCode = "CN"
        endCountryCode = "ZA"
        products = @(
            @{ variantSku = $testSku; quantity = 1 }
        )
    } | ConvertTo-Json
    
    $response2 = Invoke-RestMethod `
        -Uri "https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate" `
        -Method Post `
        -Body $body2 `
        -Headers @{ "CJ-Access-Token" = $token; "Content-Type" = "application/json" }
    
    Write-Host "✅ SKU format works!" -ForegroundColor Green
    Write-Host "Response: $($response2 | ConvertTo-Json -Depth 5)" -ForegroundColor White
} catch {
    Write-Host "❌ SKU format failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nTesting with PID format (for comparison)..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Test 3: Try with PID (productSku)
try {
    $body3 = @{
        startCountryCode = "CN"
        endCountryCode = "ZA"
        products = @(
            @{ pid = "2510160925241648700"; quantity = 1 }
        )
    } | ConvertTo-Json
    
    $response3 = Invoke-RestMethod `
        -Uri "https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate" `
        -Method Post `
        -Body $body3 `
        -Headers @{ "CJ-Access-Token" = $token; "Content-Type" = "application/json" }
    
    Write-Host "✅ PID format works!" -ForegroundColor Green
    Write-Host "Response: $($response3 | ConvertTo-Json -Depth 5)" -ForegroundColor White
} catch {
    Write-Host "❌ PID format failed: $($_.Exception.Message)" -ForegroundColor Red
}
```

### Step 4: Update Shipping Route Based on Test Results

Once we know which ID format works, update `backend/src/routes/shipping.js`:

**Option A: If SKU is required**
```javascript
// Map cart items to CJ format: { variantSku, quantity }
const cjProducts = items.map(item => ({
  variantSku: item.cj_sku,  // Use SKU instead of VID!
  quantity: item.quantity || 1
}));

// Validate all items have cj_sku
const missingSku = cjProducts.find(p => !p.variantSku);
if (missingSku) {
  return res.status(400).json({ 
    error: 'All items must have cj_sku (variant SKU)' 
  });
}
```

**Option B: If VID works but needs different field name**
```javascript
const cjProducts = items.map(item => ({
  productId: item.cj_vid,  // Or whatever field name CJ actually uses
  quantity: item.quantity || 1
}));
```

### Step 5: Update Frontend Cart to Include SKU

**File:** `frontend/src/App.jsx`

When products are added to cart, ensure `cj_sku` is included:

```javascript
const addToCart = (product) => {
  const existingItem = cartItems.find(item => item.id === product.id);
  
  if (existingItem) {
    setCartItems(cartItems.map(item => 
      item.id === product.id 
        ? { ...item, quantity: item.quantity + 1 }
        : item
    ));
  } else {
    setCartItems([...cartItems, { 
      ...product, 
      quantity: 1,
      cj_vid: product.cj_vid,    // Keep VID
      cj_sku: product.cj_sku     // ADD SKU!
    }]);
  }
  
  setCartCount(cartCount + 1);
  trackAddToCart(product, 1);
};
```

### Step 6: Backfill Existing Products

For products already linked (but missing SKU), query CJ API to get SKU:

```javascript
// Admin script to backfill SKUs
async function backfillCjSkus() {
  const { rows } = await pool.query(
    'SELECT id, cj_pid, cj_vid FROM curated_products WHERE cj_vid IS NOT NULL AND cj_sku IS NULL'
  );
  
  for (const product of rows) {
    try {
      const details = await cjClient.getProductDetail(product.cj_pid);
      const variant = details.variants.find(v => v.vid === product.cj_vid);
      
      if (variant && variant.sku) {
        await pool.query(
          'UPDATE curated_products SET cj_sku = $1 WHERE id = $2',
          [variant.sku, product.id]
        );
        console.log(`✅ Updated product ${product.id} with SKU: ${variant.sku}`);
      }
    } catch (err) {
      console.error(`❌ Failed to backfill product ${product.id}:`, err.message);
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
```

---

## 🧪 TESTING CHECKLIST

- [ ] Run `test-cj-shipping-id-format.ps1` to determine correct ID format
- [ ] Add `cj_sku` column to database
- [ ] Update product linking to save SKU
- [ ] Update shipping route to use correct ID field
- [ ] Update cart to include SKU in item data
- [ ] Test: Add product to cart → Open cart → Verify shipping quotes appear
- [ ] Backfill existing products with SKUs
- [ ] Verify CJ website search works with stored SKUs

---

## 📝 IMMEDIATE ACTION

**RUN THIS FIRST** (wait for rate limit reset if needed):

```powershell
# Save as test-cj-id-format.ps1
$testSku = "CJYE206896609IR"

# Wait for rate limit (if hit recently)
Write-Host "Waiting 5 minutes for CJ rate limit..." -ForegroundColor Yellow
Start-Sleep -Seconds 300

# Then run the test above
```

This will tell us EXACTLY which ID format to use!
