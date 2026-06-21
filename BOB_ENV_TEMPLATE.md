# Bob Go environment template

Add these variables to your backend environment (Render dashboard or local .env):

BOB_API_BASE_URL=https://api.sandbox.bobgo.co.za/v2/
BOB_API_TOKEN=your_bob_bearer_token_here

Optional:
BOB_API_TIMEOUT_MS=20000
BOB_RATES_PATH=rates
BOB_COLLECTION_COMPANY=SnuggleUp
BOB_COLLECTION_STREET=Your warehouse street address
BOB_COLLECTION_SUBURB=Your warehouse suburb
BOB_COLLECTION_CITY=Johannesburg
BOB_COLLECTION_PROVINCE=Gauteng
BOB_COLLECTION_POSTAL_CODE=2196
BOB_COLLECTION_COUNTRY=ZA

# Keep this false/omitted during launch. When omitted, the website can fetch rates
# but cannot create Bob Go orders, shipments, waybills, bookings, or tracking.
BOB_ENABLE_MUTATIONS=false
