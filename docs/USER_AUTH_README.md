# SnuggleUp User Authentication & Order Management

## 🎉 New Features Implemented

### User Authentication System
- **User Registration**: Create account with email, password, name, and phone
- **Secure Login**: JWT-based authentication with 7-day token expiry
- **Password Security**: Passwords hashed with bcryptjs (10 salt rounds)
- **Persistent Sessions**: Tokens stored in localStorage for seamless experience

### Order Management
- **Order History**: View all past orders with complete details
- **Order Tracking**: Real-time status updates (Pending → Completed/Failed)
- **Order Details**: See items, quantities, pricing breakdown, and shipping
- **Database Storage**: SQLite database stores all user and order data

### Enhanced Checkout Flow
- **Login Required**: Users must be authenticated before checkout
- **Auto-prompt**: Shows login/register modal if user attempts checkout while logged out
- **User Data Integration**: Orders automatically linked to user account
- **Order Creation**: Each payment creates a database record with full order details

## 📁 New Files Created

### Backend Files
```
backend/src/
├── db.js                        # SQLite database setup and schema
├── middleware/
│   └── auth.js                  # JWT authentication middleware
└── routes/
    ├── auth.js                  # Registration and login endpoints
    └── orders.js                # Order history and details endpoints
```

### Frontend Files
```
frontend/src/
├── context/
│   └── AuthContext.jsx          # React Context for authentication state
└── components/
    ├── Login.jsx                # Login form component
    ├── Register.jsx             # Registration form component
    ├── UserAccount.jsx          # User profile and order history
    ├── Auth.css                 # Styles for login/register
    └── UserAccount.css          # Styles for account dashboard
```

## 🗄️ Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Orders Table
```sql
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_number TEXT UNIQUE NOT NULL,
  items TEXT NOT NULL,                    -- JSON string of cart items
  subtotal REAL NOT NULL,
  shipping REAL NOT NULL,
  discount REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT DEFAULT 'pending',          -- pending, completed, failed
  payfast_payment_id TEXT,
  payfast_signature TEXT,
  customer_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

## 🔌 API Endpoints

### Authentication Endpoints

#### POST /api/auth/register
Register a new user account
```json
Request:
{
  "email": "user@example.com",
  "password": "secure123",
  "name": "John Doe",
  "phone": "+27 12 345 6789"
}

Response:
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "phone": "+27 12 345 6789"
  }
}
```

#### POST /api/auth/login
Login with existing account
```json
Request:
{
  "email": "user@example.com",
  "password": "secure123"
}

Response:
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "phone": "+27 12 345 6789"
  }
}
```

### Order Endpoints

#### GET /api/orders/history
Get all orders for authenticated user
```
Headers:
Authorization: Bearer <token>

Response:
{
  "orders": [
    {
      "id": 1,
      "order_number": "ORDER_1734465789123",
      "total": 898.00,
      "status": "completed",
      "created_at": "2025-10-17T10:30:00.000Z",
      "items": [...],
      "subtotal": 799.00,
      "shipping": 99.00,
      "discount": 0
    }
  ]
}
```

#### GET /api/orders/:orderId
Get single order details
```
Headers:
Authorization: Bearer <token>

Response:
{
  "order": {
    "id": 1,
    "order_number": "ORDER_1734465789123",
    "items": [
      {
        "id": 3,
        "name": "Baby Walker",
        "price": 799,
        "quantity": 1
      }
    ],
    "subtotal": 799.00,
    "shipping": 99.00,
    "discount": 0,
    "total": 898.00,
    "status": "completed",
    "payfast_payment_id": "1234567",
    "created_at": "2025-10-17T10:30:00.000Z"
  }
}
```

## 🔒 Security Features

1. **Password Hashing**: All passwords hashed with bcryptjs before storage
2. **JWT Tokens**: Secure authentication tokens with 7-day expiry
3. **Protected Routes**: Order endpoints require valid JWT token
4. **CORS Enabled**: Backend configured for cross-origin requests
5. **Input Validation**: Email, password length, and required fields validated

## 📱 Frontend Features

### Header Updates
- **Login Button**: Shows for unauthenticated users
- **User Account Button**: Shows user's name when logged in
- **Seamless Integration**: No page reloads, modal-based authentication

### User Account Dashboard
- **Profile Tab**: View account information
- **Order History Tab**: See all past orders
- **Order Status Colors**:
  - ✓ Green: Completed
  - ⏳ Orange: Pending
  - ✗ Red: Failed
- **Logout**: Clear session and return to guest mode

### Enhanced Checkout
- **Authentication Check**: Prevents checkout without login
- **User-friendly Alerts**: Clear messaging for login requirement
- **Data Pre-fill**: User email automatically included in payment

## 🚀 Deployment Notes

### Backend Dependencies to Install
```bash
cd backend
npm install
```

The package.json has been updated with:
- `bcryptjs`: ^2.4.3
- `better-sqlite3`: ^9.2.2
- `jsonwebtoken`: ^9.0.2

### Environment Variables
Add to your `.env` file or Render environment variables:
```
JWT_SECRET=your-secret-key-change-in-production
```

### Database File
The SQLite database (`snuggleup.db`) will be created automatically in the backend directory on first run. On Render, this will persist as long as the service is running (note: free tier may reset on sleep).

## 🧪 Testing the System

### Test User Registration
1. Click "Login" in header
2. Click "Register here"
3. Fill in: Name, Email, Phone, Password
4. Submit → Auto-logged in

### Test Login
1. Click "Login" in header
2. Enter registered email and password
3. Submit → See your name in header

### Test Checkout Flow
1. Add items to cart
2. Click "Proceed to PayFast Checkout"
3. If not logged in → See login prompt
4. After login → Payment created and order saved
5. Complete PayFast payment → Order status updates to "completed"

### Test Order History
1. Click your name in header
2. Go to "Order History" tab
3. See all your orders with full details
4. Check order status and items

## 📊 Order Status Flow

```
Guest User → Add to Cart → Checkout
              ↓
      Login/Register Required
              ↓
      Authenticated → Create Payment
              ↓
      Order Created (Status: pending)
              ↓
      PayFast Payment Gateway
              ↓
      ├─ Success → Order Status: completed
      └─ Cancel/Fail → Order Status: failed
```

## 🎯 Future Enhancements

1. **Password Reset**: Email-based password recovery
2. **Email Notifications**: Order confirmation emails
3. **Order Tracking**: Shipment tracking integration
4. **Address Book**: Save multiple shipping addresses
5. **Payment History**: Detailed payment transaction records
6. **Wish List**: Save items for later
7. **Product Reviews**: Let users review purchased items

## 💡 Notes

- SQLite is perfect for small to medium traffic
- Consider PostgreSQL or MongoDB for high-traffic production
- JWT tokens expire after 7 days (configurable)
- Database auto-initializes on first server start
- All orders linked to user accounts for easy history tracking
