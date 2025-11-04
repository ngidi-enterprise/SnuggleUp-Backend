# SnuggleUp E-commerce Platform - AI Agent Instructions

## Project Overview
A full-stack baby products e-commerce platform with dropshipping integration via CJ Dropshipping, payment processing through PayFast (South African gateway), and authentication via Supabase. The architecture is split into React (Vite) frontend and Express backend with PostgreSQL database.

**Critical Constraint**: This is a **web-only platform** — all functionality must remain browser-based. Never suggest desktop apps, Electron wrappers, or downloadable clients. Users access the store exclusively through web browsers. The development environment must also be **fully portable and browser-accessible** — avoid dependencies or tools that require local installation or tie development to a single machine. The codebase should be maintainable from anywhere in the world using only a web browser and standard web-based development tools.

**Responsive Design**: The website must be fully functional and user-friendly on both mobile and desktop devices. All UI components should adapt gracefully to different screen sizes.

## Architecture & Data Flow

### Tech Stack
- **Frontend**: React 18 + Vite, React Router, Supabase Auth
- **Backend**: Express + ES Modules (`"type": "module"`), PostgreSQL (pg), JWT auth
- **External APIs**: CJ Dropshipping (product catalog/orders), PayFast (payments), Supabase (auth)

### Request Flow
1. Frontend → Backend API (`/api/*`) → External Services (CJ/PayFast)
2. Auth: Supabase client → JWT tokens → Backend `authenticateToken` middleware
3. Products: `CJCatalog.jsx` → `frontend/src/lib/cjApi.js` → `backend/src/routes/cj.js` → `backend/src/services/cjClient.js` → CJ API
4. Orders: Cart → PayFast payment → Webhook → Database (`orders` table)

### Key Integration Points
- **CJ API Throttling**: Strict 1 req/sec limit enforced in `cjClient.js` via `ensureThrottle()` with exponential backoff on 429s
- **URL Normalization**: CJ images often start with `//` — always normalize to `https://` (see `CJProductDetail.jsx` line 26-31)
- **Dual Auth Strategy**: Backend supports both RS256 (JWKS) and HS256 (legacy) Supabase tokens (`auth.js` lines 28-56)
- **Environment Fallbacks**: All configs have hardcoded fallbacks for StackBlitz/local dev (see `cjApi.js` line 5-7, `supabaseClient.js` line 26-27)

## Critical Developer Workflows

### Development Commands
```powershell
# Backend (from backend/ directory)
npm run dev          # Starts nodemon on port 3000

# Frontend (from frontend/ directory)  
npm run dev          # Starts Vite on port 5173

# Both must run simultaneously for full functionality
```

### Environment Variables Setup
**Backend** (`.env` in `backend/`):
```
CJ_EMAIL=support@snuggleup.co.za
CJ_API_KEY=c8d6ec9d12be40cf8117bf79ce721ba1
PAYFAST_MERCHANT_ID=10042854
PAYFAST_MERCHANT_KEY=bmvnyjivavg1a
PAYFAST_TEST_MODE=true
JWT_SECRET=your-secret-key
SUPABASE_URL=https://ljywlweffxmktrjbaurc.supabase.co
DATABASE_URL=postgresql://user:pass@host:5432/dbname  # or individual PG* vars
```

**Frontend** (`.env` in `frontend/`):
```
VITE_SUPABASE_URL=https://ljywlweffxmktrjbaurc.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...  # Public anon key
VITE_API_BASE=http://localhost:3000  # Optional, defaults to Render production URL
```

### Database Operations
PostgreSQL schema auto-initializes on startup via `db.js` `initDb()`. Tables: `users`, `orders`.  
No manual migrations needed — uses `CREATE TABLE IF NOT EXISTS` with `ALTER TABLE ADD COLUMN IF NOT EXISTS` for schema updates.

### Debugging CJ Integration
1. Check health: `GET /api/cj/health` returns token status
2. Enable verbose logs: `cjClient.js` logs all API calls to console
3. Common issues:
   - 429 errors → Throttling working, retries automatic
   - Image 404s → Normalize URLs (add `https:`)
   - Empty variants → Product may not support dropshipping

### Testing Payments Locally
PayFast sandbox requires public URLs. Use:
1. `ngrok http 3000` to expose backend
2. Update `BACKEND_URL` env var to ngrok URL
3. Set `PAYFAST_TEST_MODE=true`
4. Test card: No specific test cards, PayFast redirects to sandbox

## Project-Specific Conventions

### Import Patterns
- **Backend**: ES Modules only — all imports use `.js` extension explicitly (`import { router } from './routes/cj.js'`)
- **Frontend**: Vite auto-resolves — no extensions needed (`import { useAuth } from '../context/AuthContext'`)

### Component Architecture
- **Modals**: All detail views use `.product-detail-modal` overlay pattern (see `CJProductDetail.jsx`, `ProductDetail.jsx`)
- **Optional Auth**: Routes use `optionalAuth` middleware — validates token if present, passes through if absent (see `routes/cj.js` line 7-11)
- **State Management**: AuthContext via React Context API, cart state lifted to `App.jsx`, no Redux

### Error Handling Strategy
- **Backend**: Try-catch with 502 for external API failures, 401/403 for auth, 400 for validation
- **Frontend**: Display errors inline as text (`<div style={{color: '#a30000'}}>{error}</div>`), no toast library
- **CJ Client**: Up to 3 retries with increasing delays on rate limits before throwing

### Data Normalization Patterns
```javascript
// Always handle multiple possible field names from CJ API
const pid = p.pid || p.productId || p.id;
const name = p.productNameEn || p.productName || p.name || 'Product';
const price = v.sellPrice || v.price || product?.minPrice || 0;

// Image URL normalization (critical for CJ images)
const normalizeUrl = (u) => {
  if (!u) return '';
  let s = String(u).trim();
  if (s.startsWith('//')) s = 'https:' + s;
  if (s.startsWith('http://')) s = s.replace(/^http:/, 'https:');
  return s;
};
```

### CSS Conventions
- BEM-like naming: `.cj-catalog`, `.product-detail-modal`, `.add-to-cart-btn`
- Colors: Primary green `#28a745`, error red `#a30000`, link blue `#007bff`
- Responsive: Must support both mobile and desktop - use media queries and flexible layouts for cross-device compatibility

## Common Tasks & Examples

### Adding a New CJ API Endpoint
1. Add method to `cjClient.js` (follow throttling pattern)
2. Add route to `routes/cj.js` with `optionalAuth`
3. Add frontend helper to `lib/cjApi.js`
4. Update `CJ_API_REFERENCE.md` documentation

### Adding User-Facing Feature Requiring Auth
1. Wrap with `const { isAuthenticated, user } = useAuth();`
2. Show login prompt: `setShowAuthModal(true)`
3. Backend route: Use `authenticateToken` middleware (not `optionalAuth`)
4. Access user via `req.user.userId` and `req.user.email`

### PayFast Signature Generation
Order matters! See `routes/payments.js` line 49-64. Must:
1. Build params object (alphabetical keys)
2. Add `test=1` BEFORE signature if test mode
3. Generate via `generateSignature(data, passphrase)`
4. Append as `&signature=xxx` to URL

## Important File References
- **CJ throttling logic**: `backend/src/services/cjClient.js` lines 17-30
- **Auth dual strategy**: `backend/src/middleware/auth.js` lines 23-66
- **Product normalization**: `frontend/src/components/CJCatalog.jsx` lines 5-25
- **Order webhook handler**: `backend/src/routes/payments.js` lines 113-156
- **Supabase fallback loader**: `frontend/src/lib/supabaseClient.js` lines 7-36

## Documentation Index
Refer to existing docs for detailed setup:
- `CJ_SETUP.md` - CJ Dropshipping integration credentials and endpoints
- `USER_AUTH_README.md` - Complete auth system implementation details  
- `RENDER_DEPLOYMENT_GUIDE.md` - Production deployment checklist
- `SUPABASE_JWT_SETUP.md` - RS256 vs HS256 token verification
- `TESTING_GUIDE.md` - End-to-end testing scenarios
