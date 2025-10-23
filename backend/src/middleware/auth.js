import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'snuggleup-secret-key-change-in-production';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your-supabase-jwt-secret';

// Verify Supabase token (from Supabase Auth)
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Try Supabase JWT first (issued by Supabase Auth)
  jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => {
    if (!err) {
      // Valid Supabase token
      req.user = { 
        userId: decoded.sub, 
        email: decoded.email,
        supabaseUser: true 
      };
      return next();
    }

    // Fallback to legacy JWT (for backward compatibility)
    jwt.verify(token, JWT_SECRET, (err2, user) => {
      if (err2) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.user = user; // { userId, email }
      next();
    });
  });
};

export const generateToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
};
