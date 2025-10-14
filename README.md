# SnuggleUp Monorepo

This repository contains a starter monorepo for your shop with a React frontend and an Express backend.

Structure
```
frontend/   # React (Vite) app
backend/    # Node.js + Express API
README.md
.gitignore
package.json  # optional workspace runner
```

Quick start
1. Install dependencies for both projects (run in repo root or individual folders):

   - From root (if you prefer per-package installs):
     - `cd frontend && npm install`
     - `cd ../backend && npm install`

2. Run the frontend (dev):

   - `cd frontend`
   - `npm run dev`

3. Run the backend (dev):

   - `cd backend`
   - `npm run dev`

PayFast notes
- See `backend/payfast_README.md` for integration notes and required credentials (merchant_id, merchant_key, return_url, notify_url).

Deployment notes
- Frontend: Netlify (push frontend folder to a GitHub repo and connect Netlify)
- Backend: Railway.app (connect GitHub and point at the `backend` folder or a separate backend repo)

Where to go next
- Replace placeholder React files with your converted HTML/CSS pages
- Add authentication (Firebase Auth or your preferred auth)
- Add PayFast server-side payment routes and secure webhook handling

