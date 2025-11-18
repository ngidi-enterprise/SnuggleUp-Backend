# Test which ID format CJ's shipping API needs
# This will test: VID (numeric), SKU (CJXXXXXXX), and PID formats

Write-Host "🧪 Testing CJ Shipping API - ID Format Discovery" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""

# From user's screenshot
$testSku = "CJYE206896609IR"
# Note: We don't have the VID for this product yet, but we'll try the PID

Write-Host "⏳ Checking if CJ rate limit allows request..." -ForegroundColor Yellow
Write-Host ""

# Try to get token
try {
    $tokenBody = '{"email":"ngidiproject@gmail.com","apiKey":"CJ4893357@api@93e9dd0791994b77ad1d12e0bced45ce"}'
    $tokenResponse = Invoke-RestMethod -Uri "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken" -Method Post -Body $tokenBody -ContentType "application/json"
    $token = $tokenResponse.data.accessToken
    
    Write-Host "✅ Token acquired successfully!" -ForegroundColor Green
    Write-Host "   Expires: $($tokenResponse.data.accessTokenExpiryDate)" -ForegroundColor Gray
    Write-Host ""
} catch {
    if ($_.Exception.Message -match "429") {
        Write-Host "❌ Rate limit hit! Wait 5 minutes and try again." -ForegroundColor Red
        Write-Host "   Or use existing token from Render environment" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "❌ Token generation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 1: Try with SKU format (most likely to work based on website)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "TEST 1: Using variantSku (CJXXXXXXX format)" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

try {
    Start-Sleep -Seconds 2  # Rate limiting
    
    $body1 = @{
        startCountryCode = "CN"
        endCountryCode = "ZA"
        products = @(
            @{ variantSku = $testSku; quantity = 1 }
        )
    } | ConvertTo-Json
    
    Write-Host "Request body:" -ForegroundColor Gray
    Write-Host $body1 -ForegroundColor DarkGray
    Write-Host ""
    
    $response1 = Invoke-RestMethod `
        -Uri "https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate" `
        -Method Post `
        -Body $body1 `
        -Headers @{ "CJ-Access-Token" = $token; "Content-Type" = "application/json" }
    
    Write-Host "✅ SUCCESS! SKU format works!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response data:" -ForegroundColor White
    $response1.data | ConvertTo-Json -Depth 3 | Write-Host -ForegroundColor White
    Write-Host ""
    Write-Host "👉 USE THIS FORMAT: variantSku" -ForegroundColor Green -BackgroundColor Black
    Write-Host ""
} catch {
    Write-Host "❌ SKU format failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor DarkRed
    Write-Host ""
}

# Test 2: Try with vid format (numeric ID)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "TEST 2: Using vid (numeric format)" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

Write-Host "⚠️  We don't have the numeric VID for $testSku yet" -ForegroundColor Yellow
Write-Host "   Need to search CJ API first to get it..." -ForegroundColor Gray
Write-Host ""
Write-Host "   Skipping this test for now." -ForegroundColor DarkGray
Write-Host ""

# Test 3: Alternative field names CJ might use
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "TEST 3: Using sku (without 'variant' prefix)" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

try {
    Start-Sleep -Seconds 2  # Rate limiting
    
    $body3 = @{
        startCountryCode = "CN"
        endCountryCode = "ZA"
        products = @(
            @{ sku = $testSku; quantity = 1 }
        )
    } | ConvertTo-Json
    
    Write-Host "Request body:" -ForegroundColor Gray
    Write-Host $body3 -ForegroundColor DarkGray
    Write-Host ""
    
    $response3 = Invoke-RestMethod `
        -Uri "https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate" `
        -Method Post `
        -Body $body3 `
        -Headers @{ "CJ-Access-Token" = $token; "Content-Type" = "application/json" }
    
    Write-Host "✅ SUCCESS! 'sku' format works!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response data:" -ForegroundColor White
    $response3.data | ConvertTo-Json -Depth 3 | Write-Host -ForegroundColor White
    Write-Host ""
    Write-Host "👉 USE THIS FORMAT: sku" -ForegroundColor Green -BackgroundColor Black
    Write-Host ""
} catch {
    Write-Host "❌ 'sku' format failed" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor DarkRed
    Write-Host ""
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "🎯 SUMMARY" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "Test SKU: $testSku" -ForegroundColor White
Write-Host ""
Write-Host "Results will show which field name to use in shipping API." -ForegroundColor Gray
Write-Host "Update backend/src/services/cjClient.js getFreightQuote()" -ForegroundColor Gray
Write-Host "to use the working format." -ForegroundColor Gray
Write-Host ""
Write-Host "💾 Save successful format to: CJ_ID_SYSTEM_FIX.md" -ForegroundColor Yellow
Write-Host ""
