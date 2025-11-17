# Get CJ Access Token

Since the HTML tool failed due to CORS and rate limits, here are alternative methods:

## Method 1: Wait and use HTML tool (Recommended)
1. Wait 5 minutes from your last attempt
2. Open `get-cj-token.html` in your browser
3. Click "Get Access Token"
4. Copy the token it displays

## Method 2: Use CJ Developer Portal
1. Go to https://developers.cjdropshipping.com/
2. Log in with your CJ account
3. Navigate to API Documentation → Authentication
4. Look for "Access Token" section
5. Copy your token

## Method 3: Use PowerShell (if you have curl)
```powershell
# Replace YOUR_EMAIL and YOUR_API_KEY with your actual credentials
$body = @{
    email = "YOUR_EMAIL"
    apiKey = "YOUR_API_KEY"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken" -Method Post -Body $body -ContentType "application/json"

Write-Host "Access Token:" -ForegroundColor Green
Write-Host $response.data.accessToken
Write-Host "`nExpiry:" -ForegroundColor Yellow
Write-Host $response.data.accessTokenExpiryDate
```

## After you get the token:
1. Go to your Render dashboard
2. Select your backend service
3. Go to Environment tab
4. Add these two variables:
   - `CJ_ACCESS_TOKEN` = (paste your token here)
   - `CJ_INVENTORY_SYNC_ENABLED` = `false`
5. Save and redeploy

The token is valid for 15 days, so you won't need to do this often.
