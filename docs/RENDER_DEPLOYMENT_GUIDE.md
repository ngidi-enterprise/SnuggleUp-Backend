# Render Deployment Guide - User Authentication System

## 📦 What Changed

### Backend Changes
- **New Dependencies**: bcryptjs, better-sqlite3, jsonwebtoken
- **New Files**: db.js, middleware/auth.js, routes/auth.js, routes/orders.js
- **Updated Files**: server.js, routes/payments.js
- **New Database**: snuggleup.db (SQLite file, auto-created)

### Frontend Changes
- **New Context**: AuthContext for authentication state
- **New Components**: Login, Register, UserAccount
- **Updated**: App.jsx (auth integration), main.jsx (AuthProvider wrapper)
- **New Styles**: Auth.css, UserAccount.css

## 🚀 Deployment Steps

### Step 1: Push Changes to GitHub

```bash
# In your workspace folder
git add .
git commit -m "Add user authentication and order management system"
git push origin main
```

### Step 2: Update Render Backend

1. **Go to Render Dashboard**
   - Navigate to: https://dashboard.render.com
   - Select your `snuggleup-backend` service

2. **Add Environment Variable**
   - Go to "Environment" tab
   - Click "Add Environment Variable"
   - Add:
     ```
     Key: JWT_SECRET
     Value: your-super-secret-key-change-this-to-something-random
     ```
   - Click "Save Changes"

3. **Verify Other Environment Variables**
   Ensure these are still set:
   ```
   PAYFAST_MERCHANT_ID=10042854
   PAYFAST_MERCHANT_KEY=bmvnyjivavg1a
   PAYFAST_TEST_MODE=true
   ```

4. **Deploy**
   - Render should auto-deploy when you push to GitHub
   - Or manually click "Manual Deploy" → "Deploy latest commit"
   - Wait for build to complete (2-3 minutes)

5. **Check Logs**
   - Click "Logs" tab
   - Look for: `✅ Database initialized successfully`
   - Look for: `Server running on port 10000`

### Step 3: Update Frontend (StackBlitz)

Since you're using StackBlitz, you need to manually update the files:

1. **Upload New Files to StackBlitz**
   
   Create these new folders/files:
   ```
   src/context/
     └── AuthContext.jsx
   
   src/components/
     ├── Login.jsx
     ├── Register.jsx
     ├── UserAccount.jsx
     ├── Auth.css
     └── UserAccount.css
   ```

2. **Update Existing Files**
   - Replace `src/main.jsx` with updated version (AuthProvider wrapper)
   - Replace `src/App.jsx` with updated version (auth integration)
   - Update `src/App.css` with new button styles

3. **Important**: Keep backend URL correct in all components:
   ```javascript
   'https://snuggleup-backend.onrender.com/api/...'
   ```

### Step 4: Test the Deployment

1. **Test Backend Health**
   ```
   https://snuggleup-backend.onrender.com/health
   ```
   Should return: `{"status":"ok","database":"connected"}`

2. **Test Registration**
   - Open your StackBlitz app
   - Click "Login"
   - Click "Register here"
   - Create a test account
   - Verify you're logged in (name appears in header)

3. **Test Checkout**
   - Add items to cart
   - Try checkout while logged out → should show login prompt
   - Login and try again → should proceed to PayFast

4. **Test Order History**
   - Complete a PayFast payment
   - Click your name in header
   - Go to "Order History" tab
   - Verify order appears

## ⚠️ Important Notes

### Database Persistence on Render

**Free Tier Warning**: Render's free tier may reset your SQLite database when the service sleeps or restarts. Consider:

1. **Option A**: Upgrade to paid tier for persistent storage
2. **Option B**: Switch to PostgreSQL (Render offers free PostgreSQL with limitations)
3. **Option C**: Use for testing only, understand data may be lost

### SQLite File Location
The database file (`snuggleup.db`) is created in the backend directory on Render. It will persist during normal operation but may be lost on:
- Service restarts (free tier sleep/wake cycles)
- Redeployments (unless you add persistent storage)

### Migrating to PostgreSQL (Recommended for Production)

If you want persistent data, I can help you migrate to PostgreSQL:
- Render offers free PostgreSQL (expires after 90 days)
- Better for production use
- Requires code changes (replace better-sqlite3 with pg)

## 🔍 Troubleshooting

### Backend won't build
**Error**: "Cannot find module 'better-sqlite3'"
**Fix**: 
- Ensure package.json has been updated
- Check Render build logs
- Manual fix: Add build command in Render:
  ```
  npm install && npm start
  ```

### Authentication not working
**Error**: "Invalid or expired token"
**Fix**:
- Check JWT_SECRET is set in Render environment variables
- Try logging out and logging in again
- Check browser console for errors

### Orders not saving
**Error**: Orders don't appear in history
**Fix**:
- Check Render logs for database errors
- Verify database was initialized (look for ✅ message in logs)
- Check that token is being sent with payment request

### Database locked error
**Error**: "Database is locked"
**Fix**:
- This shouldn't happen on Render (single instance)
- If it does, redeploy the service

## 📊 Monitoring

### Check These Logs Regularly

1. **Order Creation**
   ```
   ✅ Order ORDER_1234567890 created for user 1
   ```

2. **Payment Completion**
   ```
   ✅ Order ORDER_1234567890 marked as completed
   ```

3. **Authentication**
   ```
   POST /api/auth/register
   POST /api/auth/login
   ```

4. **Order History Requests**
   ```
   GET /api/orders/history
   ```

## 🎯 Success Checklist

After deployment, verify:

- [ ] Backend health endpoint returns OK with database connected
- [ ] Can register a new user
- [ ] Can login with registered user
- [ ] User name appears in header after login
- [ ] Checkout blocked when logged out
- [ ] Checkout works when logged in
- [ ] Order appears in history after payment
- [ ] Can view order details
- [ ] Can logout and login again
- [ ] Token persists across page reloads

## 🔐 Security Reminders

1. **Change JWT_SECRET**: Use a strong, random secret in production
2. **HTTPS Only**: Render automatically uses HTTPS
3. **Password Requirements**: Currently minimum 6 characters
4. **Token Expiry**: 7 days (configurable in middleware/auth.js)

## 📝 Next Steps After Deployment

1. **Test with real users**: Create a few test accounts
2. **Monitor logs**: Watch for any errors
3. **Consider upgrades**: 
   - PostgreSQL for data persistence
   - Email notifications for order confirmation
   - Password reset functionality
4. **Backup data**: If using SQLite, consider periodic backups

---

**Deployment Status**: Ready ✅
**Estimated Deploy Time**: 3-5 minutes
**Database**: Auto-initializing SQLite
**Dependencies**: All included in package.json
