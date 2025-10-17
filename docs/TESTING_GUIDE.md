# Testing Checklist for SnuggleUp Authentication System

## ✅ Backend Setup

Before deploying, ensure these dependencies are installed:

```bash
cd c:\Users\MHlomuka\Downloads\Workspace\backend
npm install
```

## 🧪 Local Testing Steps

### 1. Test Backend Locally
```bash
cd backend
npm run dev
```
Server should start on http://localhost:3000

### 2. Test Database Creation
Check that `backend/snuggleup.db` file is created automatically.

### 3. Test Registration Endpoint
```bash
# Using PowerShell
Invoke-WebRequest -Uri "http://localhost:3000/api/auth/register" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"email":"test@example.com","password":"test123","name":"Test User","phone":"+27123456789"}'
```

Expected Response: Token and user data

### 4. Test Login Endpoint
```bash
Invoke-WebRequest -Uri "http://localhost:3000/api/auth/login" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"email":"test@example.com","password":"test123"}'
```

Expected Response: Token and user data

### 5. Test Order History (Protected Route)
```bash
# Replace TOKEN with actual JWT token from login response
Invoke-WebRequest -Uri "http://localhost:3000/api/orders/history" -Method GET -Headers @{"Authorization"="Bearer TOKEN"}
```

Expected Response: Empty orders array (for new user)

## 🌐 Frontend Testing

### 1. Start Frontend
```bash
cd frontend
npm run dev
```

### 2. Test Registration Flow
- [ ] Click "Login" button in header
- [ ] Click "Register here" link
- [ ] Fill in all fields
- [ ] Submit form
- [ ] Verify: Modal closes, user name appears in header

### 3. Test Login Flow
- [ ] Logout (click account button → Logout)
- [ ] Click "Login" button
- [ ] Enter credentials
- [ ] Submit form
- [ ] Verify: User name appears in header

### 4. Test Checkout Protection
- [ ] Logout
- [ ] Add items to cart
- [ ] Click "Proceed to PayFast Checkout"
- [ ] Verify: Alert appears asking to login
- [ ] Verify: Login modal opens automatically

### 5. Test Authenticated Checkout
- [ ] Login
- [ ] Add items to cart
- [ ] Click "Proceed to PayFast Checkout"
- [ ] Verify: PayFast form appears (no login prompt)
- [ ] Check browser console for order creation success

### 6. Test Order History
- [ ] Complete a test payment (PayFast sandbox)
- [ ] Click user name in header
- [ ] Go to "Order History" tab
- [ ] Verify: Order appears with correct details
- [ ] Verify: Status shows as "pending" or "completed"

## 🚀 Render Deployment Testing

### After Deploying Backend to Render:

1. **Test Health Endpoint**
   - Visit: https://snuggleup-backend.onrender.com/health
   - Expected: `{"status":"ok","database":"connected"}`

2. **Test Registration via Frontend**
   - Update frontend to use: https://snuggleup-backend.onrender.com
   - Register a new account
   - Verify token is saved in localStorage

3. **Test Order Creation**
   - Complete full checkout flow
   - Check Render logs for "Order created" message
   - Verify order appears in Order History

4. **Test PayFast Webhook**
   - Complete payment in PayFast sandbox
   - Check Render logs for "Order marked as completed"
   - Refresh Order History → status should be "completed"

## ⚠️ Common Issues & Solutions

### Issue: "Cannot find module 'better-sqlite3'"
**Solution**: Run `npm install` in backend folder

### Issue: "JWT secret not defined"
**Solution**: Add `JWT_SECRET=your-secret-key` to .env or Render environment variables

### Issue: "Database locked"
**Solution**: Ensure only one server instance is running

### Issue: "Invalid token" error
**Solution**: Token may have expired (7 days). Login again to get new token.

### Issue: Orders not appearing in history
**Solution**: 
- Check that payment was completed successfully
- Check Render logs for database errors
- Verify order was created (check logs for order number)

### Issue: User stays logged out after refresh
**Solution**: Check browser localStorage for "token" and "user" keys

## 📝 Pre-Deployment Checklist

- [ ] All npm packages installed in backend
- [ ] JWT_SECRET set in environment variables
- [ ] PayFast credentials configured
- [ ] CORS enabled in backend for your frontend URL
- [ ] Frontend updated with correct backend URL
- [ ] Database schema auto-initializes on first run
- [ ] Test user can register
- [ ] Test user can login
- [ ] Test checkout requires authentication
- [ ] Test order appears in history after payment
- [ ] Test logout clears session

## 🎉 Success Criteria

✅ Users can register with email and password
✅ Users can login and stay logged in across page reloads
✅ Checkout is blocked for unauthenticated users
✅ Orders are created in database with user link
✅ Order history displays all user's orders
✅ Order status updates after PayFast payment
✅ User can view profile information
✅ User can logout successfully

---

**Status**: Ready for deployment! 🚀
**Database**: SQLite (snuggleup.db)
**Authentication**: JWT with 7-day expiry
**Password Security**: bcryptjs with 10 salt rounds
