# SnuggleUp E-commerce Platform - AI Agent Instructions

## Project Overview
Full-stack baby products e-commerce with CJ Dropshipping integration, PayFast payments (South African gateway), and Supabase authentication. React (Vite) frontend + Express backend with PostgreSQL.

**Critical Constraints**:
- **Web-only platform**: No desktop apps, Electron, or downloadables. Browser-accessible development environment only (StackBlitz-compatible).
- **Responsive design**: All UI must work on mobile and desktop with graceful adaptation.
- **⚠️ CRITICAL BRANDING RULE**: Never mention "CJ Dropshipping" or "CJ" in customer-facing UI/messages. Only use in admin dashboard and backend logs. Use generic terms like "supplier", "shipping provider", or "fulfillment partner" for customers.

## Architecture & Data Flow

### Tech Stack
- **Frontend**: React 18 + Vite, React Router, Supabase Auth, no state management library
- **Backend**: Express with ES Modules (`"type": "module"`), PostgreSQL (pg), JWT auth
## SnuggleUp — Quick AI agent instructions

This repo is a web-only React (Vite) frontend + Express (ESM) backend that integrates CJ Dropshipping, PayFast (SA gateway), and Supabase auth. Keep guidance short and actionable — follow these repo-specific rules when editing or adding code.

- Architecture at-a-glance:
  - Frontend: `frontend/` (Vite, React 18). Cart state lives in `App.jsx`. Auth via `src/context/AuthContext.jsx` and `frontend/src/lib/supabaseClient.js`.
  - Backend: `backend/` (Express with ESM, port 3000 by default). API routes under `backend/src/routes/` and services in `backend/src/services/`.
  - Data: PostgreSQL initialized by `backend/src/db.js` (idempotent CREATE/ALTER patterns).

- Dev workflows (exact):
  - Start backend: from `backend/` run `npm run dev` (nodemon, :3000).
  - Start frontend: from `frontend/` run `npm run dev` (Vite, :5173).
  - For PayFast webhook testing: expose backend with `ngrok http 3000`, set `BACKEND_URL` to the ngrok URL and `PAYFAST_TEST_MODE=true`.

- Project conventions (must follow):
  - Backend imports use explicit `.js` extensions (ESM). Example: `import { router } from './routes/cj.js'`.
  - Use `optionalAuth` on endpoints that accept both anonymous and authenticated users (CJ/catalog and some payment endpoints).
  - No global state library — lift state in `App.jsx` and pass via props/context.

- Critical integration & gotchas (copyable checks):
  - CJ API throttling: follow `backend/src/services/cjClient.js` throttling pattern (1 req/sec + backoff on 429). Add new CJ methods there.
  - Image URL normalization: CJ returns `//...` or `http://` — normalize to `https:`. See `frontend/src/lib/cjApi.js` and `frontend/src/components/CJCatalog.jsx` for examples.
  - Dual auth strategy (backend): RS256 via JWKS, then HS256 fallback, then app JWT. See `backend/src/middleware/auth.js`.
  - PayFast form/signature: alphabetical param order, add `test=1` before signature in test mode. See `backend/src/routes/payments.js` and `payfast_README.md`.

- Where to make changes:
  - Add CJ endpoints: `backend/src/services/cjClient.js` -> `backend/src/routes/cj.js` -> frontend `frontend/src/lib/cjApi.js` -> update `CJ_API_REFERENCE.md`.
  - Add auth-required features: frontend use `useAuth()` and backend use `authenticateToken` (not `optionalAuth`).
  - Admin features: `frontend/src/components/admin/` components use `requireAdmin` middleware on backend routes.

- Quick reference files:
  - CJ throttling: `backend/src/services/cjClient.js`
  - Auth middleware: `backend/src/middleware/auth.js`
  - CJ catalog + normalization: `frontend/src/components/CJCatalog.jsx`, `frontend/src/lib/cjApi.js`
  - PayFast routes & webhook: `backend/src/routes/payments.js`, `payfast_README.md`
  - DB init: `backend/src/db.js`
  - GA4 tracking: `frontend/src/lib/analytics.js` (see `GOOGLE_ANALYTICS_SETUP.md`)

If any integration detail is missing or you want more examples (unit tests, sample requests, or a step-by-step PayFast webhook walkthrough), tell me which area to expand and I will iterate.
