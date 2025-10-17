# Quick Start Guide - User Authentication System

## 🚀 Get Started in 5 Minutes

### Step 1: Install Backend Dependencies (1 min)
```bash
cd c:\Users\MHlomuka\Downloads\Workspace\backend
npm install
```

### Step 2: Test Backend Locally (1 min)
```bash
npm run dev
```
✅ Should see: "Server running on port 3000" and "✅ Database initialized successfully"

### Step 3: Deploy to Render (2 mins)
1. Push code to GitHub:
   ```bash
   git add .
   git commit -m "Add user authentication system"
   git push origin main
   ```

2. Add environment variable on Render:
   - Go to: https://dashboard.render.com
   - Select: snuggleup-backend
   - Environment → Add Variable:
     - Key: `JWT_SECRET`
     - Value: `snuggleup-secret-2025-change-in-production`
   - Save and wait for auto-deploy

3. Verify deployment:
   - Visit: https://snuggleup-backend.onrender.com/health
   - Should see: `{"status":"ok","database":"connected"}`

### Step 4: Update Frontend on StackBlitz (1 min)
1. Upload these NEW files to StackBlitz:
   - `src/context/AuthContext.jsx`
   - `src/components/Login.jsx`
   - `src/components/Register.jsx`
   - `src/components/UserAccount.jsx`
   - `src/components/Auth.css`
   - `src/components/UserAccount.css`

2. Replace these existing files:
   - `src/main.jsx` (wrapped with AuthProvider)
   - `src/App.jsx` (auth integration)
   - `src/App.css` (new button styles)

### Step 5: Test It! (2 mins)
1. **Register**: Click "Login" → "Register here" → Create account
2. **Checkout**: Add items → Click "Proceed to PayFast Checkout"
3. **View Orders**: Click your name → "Order History" tab

## ✅ You're Done!

Your e-commerce site now has:
- ✅ User registration & login
- ✅ Protected checkout (login required)
- ✅ Order tracking & history
- ✅ User dashboard

---

## 🆘 Quick Troubleshooting

**Problem**: Backend won't start
- **Fix**: Run `npm install` in backend folder

**Problem**: Can't register/login
- **Fix**: Check JWT_SECRET is set on Render

**Problem**: Orders not showing
- **Fix**: Complete a test payment first, then check Order History

---

## 📚 Full Documentation

- **Complete Guide**: USER_AUTH_README.md
- **Testing**: TESTING_GUIDE.md
- **Deployment**: RENDER_DEPLOYMENT_GUIDE.md
- **Summary**: IMPLEMENTATION_SUMMARY.md

---

**Need Help?** Check the full documentation files or review the backend logs on Render!
