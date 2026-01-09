# SnuggleUp E-commerce Platform — AI Agent Instructions

**Last Updated**: Jan 2026 | Baby products e-commerce: React (Vite) frontend + Express (ESM) backend + PostgreSQL + CJ Dropshipping + PayFast (South Africa)

## Critical Constraints

- **Web-only**: No desktop/Electron. Browser-based only (StackBlitz-compatible).
- **⚠️ Branding rule**: Never expose "CJ Dropshipping" in customer UI. Use "supplier" or "fulfillment partner" in storefront. CJ references only in admin & backend logs.
- **Responsive**: Mobile & desktop. Always test layout at 375px (mobile) and 1024px (tablet).

---

## Architecture at a Glance

```
frontend/src/App.jsx                    ← Cart state hub (props-based, no Redux/Zustand)
  ├─ context/AuthContext.jsx            ← Supabase session management
  ├─ lib/supabaseClient.js              ← Supabase JS client init
  ├─ lib/cjApi.js                       ← Frontend CJ proxy (calls backend /api/cj/*)
  └─ components/CJCatalog.jsx           ← Browse curated + CJ products, image normalization

backend/src/server.js                   ← Express entry point, CORS, health check
  ├─ middleware/auth.js                 ← Dual strategy: RS256 (JWKS) → HS256 (legacy) → app JWT
  ├─ middleware/admin.js                ← Hardcoded ADMIN_EMAILS + local user auto-provision
  ├─ routes/                            ← API endpoints (payments, cj, products, orders, admin, etc.)
  ├─ services/cjClient.js               ← CJ API with 1.5s throttle + token caching + reviews translation
  ├─ services/inventorySync.js          ← Scheduled sync: curated products → warehouse inventory
  ├─ services/priceSync.js              ← Scheduled sync: curated product prices
  └─ db.js                              ← PostgreSQL pool, idempotent table init (ALTER IF EXISTS pattern)
```

**Data Flow**: Customer browse CJCatalog → frontend calls `/api/cj/search` → backend cjClient hits CJ API (throttled) → returns normalized products + images.

---

## Dev Workflows (Exact Commands)

### Local Development
```bash
# Terminal 1: Backend (port 3000)
cd backend
npm install  # First time only
npm run dev  # nodemon watches src/server.js

# Terminal 2: Frontend (port 5173)
cd frontend
npm install  # First time only
npm run dev  # Vite dev server

# Visit http://localhost:5173
```

### PayFast Webhook Testing (Local)
```bash
# Expose backend to internet
ngrok http 3000

# Set in backend/.env
BACKEND_URL=https://<ngrok-url>
PAYFAST_TEST_MODE=true
```

### Deployment (Render)
- Backend: Auto-deploys on `git push` to `snuggleup-backend` service
- Frontend: Built with `npm run build`, served on `snuggleup.co.za`
- Check logs: Render dashboard → service → logs tab

---

## Project Conventions (Must Follow)

### Backend (Express + ESM)
- **Imports**: Always use explicit `.js` extensions. `import { router } from './routes/cj.js'` (not just `'./routes/cj'`)
- **Auth strategy**: 
  - Public endpoints: no middleware (or `optionalAuth`)
  - Customer/user endpoints: `authenticateToken` 
  - Admin endpoints: `authenticateToken` + `requireAdmin`
- **Error handling**: Return `{ error: 'message' }` JSON, not 500 HTML. Use consistent status codes (400, 401, 404, 429, 500).
- **Logging**: Use template literals. `console.log('✅ Token verified'); console.error('❌ Failed');`

### Frontend (React + Vite)
- **State management**: No libraries. Lift state to `App.jsx`, pass via props/context.
- **Auth context**: `useAuth()` hook from `AuthContext.jsx` for user + token + loading + logout.
- **API calls**: Use `cjApi.js` helpers (wraps `fetch`). Catch errors gracefully for backend downtime.
- **CSS**: Separate `.css` files per component. Media queries for responsive design (see `CJCatalog.jsx` for pattern).

---

## Critical Integrations & Gotchas

### CJ API Throttling (1.5s per request)
**Where**: `backend/src/services/cjClient.js`  
**Pattern**: 
```javascript
async function ensureThrottle() {
  const diff = Date.now() - lastCJCallAt;
  if (diff < 1500) await sleep(1500 - diff);
  lastCJCallAt = Date.now();
}
// Call before every CJ API request: await ensureThrottle(); fetch(...);
```
**Adding new CJ methods**: 
1. Add to `cjClient.js` with throttle guard
2. Export function
3. Use in `routes/cj.js` endpoint
4. Document in `CJ_API_REFERENCE.md`

### Image URL Normalization
**Why**: CJ returns `//...` or `http://`, frontend serves HTTPS.  
**Pattern** (frontend):
```javascript
const normalizeUrl = (u) => {
  if (!u) return '';
  let s = String(u).trim();
  if (s.startsWith('//')) s = 'https:' + s;
  if (s.startsWith('http://')) s = s.replace(/^http:/, 'https:');
  return s;
};
```
**Where used**: `CJCatalog.jsx`, `CJProductDetail.jsx`

### Authentication Layers (Backend)
Tries in order—stops at first success:
1. **RS256 via JWKS**: Modern Supabase projects (JWKS endpoint at `/auth/v1/jwks`)
2. **HS256 with SUPABASE_JWT_SECRET**: Legacy Supabase projects
3. **App JWT (HS256)**: Local fallback (`JWT_SECRET` env var)

**Key file**: `backend/src/middleware/auth.js`  
**Gotcha**: If token fails all 3 methods, request is rejected (401). Test with `Authorization: Bearer <token>` header.

### Admin Access (Email-Based)
**Hardcoded admins** in `backend/src/middleware/admin.js`:
```javascript
const ADMIN_EMAILS = ['support@snuggleup.co.za'];
const isHardcodedAdmin = ADMIN_EMAILS.includes(email.toLowerCase());
```
**Auto-provision**: First time an admin email logs in, a local user row is created with `is_admin=true`.  
**To add admin**: Add email to `ADMIN_EMAILS` array or insert into `users` table with `is_admin=true`.

### PayFast Signature (South Africa Payment Gateway)
**Critical**: Param order is **alphabetical**, not insertion order.  
**Pattern** (in `routes/payments.js`):
```javascript
const sortedParams = Object.keys(params).sort();
const paramStr = sortedParams.map(k => `${k}=${params[k]}`).join('&');
const sig = crypto.createHash('md5').update(paramStr + passphrase).digest('hex');
// In TEST mode: add test=1 BEFORE signature calculation
```
**IPN validation**: Server-to-server check against `https://www.payfast.co.za/eng/query/?` (or test endpoint).  
**Reference**: `payfast_README.md`

---

## Where to Make Changes

### Add a CJ Feature (Search, Filters, Reviews)
1. `cjClient.js`: Add/update method with throttle guard
2. `routes/cj.js`: Expose as `POST /api/cj/<endpoint>`
3. `frontend/src/lib/cjApi.js`: Add wrapper function
4. `CJCatalog.jsx` or component: Call wrapper
5. Update `CJ_API_REFERENCE.md`

### Add Auth-Required User Feature
1. Backend: 
   - `routes/<domain>.js`: Add route with `authenticateToken` middleware
   - Validate `req.user.email` / `req.user.userId`
2. Frontend:
   - Component: Import `useAuth()`, check `user && token`
   - Show login prompt if not authenticated
   - Pass token in `Authorization: Bearer <token>` header (cjApi.js does this automatically)

### Add Admin Feature
1. Backend:
   - `routes/admin.js`: Add route with `requireAdmin` middleware (which includes `authenticateToken`)
   - Endpoint body auto-loads `req.user` with email verification
2. Frontend:
   - `components/admin/*.jsx`: Check `isAdmin` prop
   - Call `/api/admin/<endpoint>` (must send token in header)
3. Ensure user email is in `ADMIN_EMAILS` or `users.is_admin=true`

---

## Key Reference Files (Skim These)

| File | Purpose | Key Pattern |
|------|---------|-------------|
| `backend/src/services/cjClient.js` | CJ API client, throttling, caching | `await ensureThrottle(); await fetch(...)` |
| `backend/src/middleware/auth.js` | Token verification (RS256 → HS256 → app JWT) | Try/catch three strategies, set `req.user` |
| `backend/src/middleware/admin.js` | Admin role check + auto-provision users | Extract email from token, check `ADMIN_EMAILS`, create row if missing |
| `backend/src/routes/payments.js` | PayFast checkout + IPN webhook | Alphabetical params, signature, server validation |
| `backend/src/services/inventorySync.js` | Sync curated product stock from CJ warehouses | Fetch per variant, aggregate CN warehouses, upsert rows |
| `frontend/src/lib/cjApi.js` | Frontend CJ proxy, environment-aware API base | Detects prod domain, adds auth header automatically |
| `frontend/src/components/CJCatalog.jsx` | Browse products, filtering, pagination | Normalizes images, handles loading, category sidebar |

---

## Common Scenarios

### Product Out of Stock
- Curated products remain `is_active=true` even with `stock_quantity=0`
- UI shows "OUT OF STOCK" badge; customers cannot add to cart
- Reason: Keep product visible for SEO & wishlist

### Customer Couldn't Checkout (Backend Down)
- Frontend detects failed health check → shows banner "Backend service unavailable"
- `setBackendDown(true)` in `App.jsx`, disable checkout button
- Recovery: Backend auto-recovers, frontend retries health check every 30s

### CJ Variant ID Missing
- If `curated_products.cj_vid` is null, `inventorySync.js` tries to fetch product details
- If still null, product is skipped with reason "Missing cj_vid"
- Admin must manually set `cj_vid` via admin dashboard or SQL

### PayFast Webhook Never Received
- Check Render logs for `/api/payments/notify` POST requests
- If not arriving: ngrok/domain misconfiguration in PayFast dashboard
- Test with `/api/payments/test-webhook` endpoint (admin only)

---

## Testing Checklist

Before deploying new features:
- [ ] Backend: `npm run dev` starts without errors
- [ ] Frontend: `npm run dev` loads catalog (images visible)
- [ ] Auth: Register → Login → Logout cycle works
- [ ] Checkout: Add items → PayFast redirect works (test mode)
- [ ] Admin: Login with admin email → Dashboard loads
- [ ] Mobile: View at 375px width, cart & checkout responsive
- [ ] CJ API: New endpoint throttled correctly (check logs for timings)

---

## Environment Variables (Backend `.env`)

```env
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/snuggleup

# Auth
JWT_SECRET=snuggleup-secret-key-change-in-production
SUPABASE_URL=https://ljywlweffxmktrjbaurc.supabase.co
SUPABASE_JWT_SECRET=<legacy-secret-or-empty>

# CJ Dropshipping
CJ_EMAIL=your@email.com
CJ_API_KEY=your-api-key
CJ_ACCESS_TOKEN=<optional-pre-fetched-token>

# PayFast (South Africa)
PAYFAST_MERCHANT_ID=10000100
PAYFAST_MERCHANT_KEY=your-key
PAYFAST_PASSPHRASE=optional-passphrase
PAYFAST_TEST_MODE=true

# Pricing
USD_TO_ZAR=18.0
PRICE_MARKUP=1.4

# URLs
BACKEND_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173
```

---

**Expand a section?** Ask which area needs more depth (CJ API examples, PayFast webhook walkthrough, database schema, etc.).
