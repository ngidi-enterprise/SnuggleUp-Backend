import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'snuggleup-secret-key-change-in-production';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '6Mi5NgpwsKlmvdIHeqWr7wOm5CaeUM8A2B+47hJvL5U7y5RtsHq3f8zSrV9DtkIQCfby7HcA3zmYkaOwZNiaoQ==';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ljywlweffxmktrjbaurc.supabase.co';

// Lazy JWKS client (RS256 verification for modern Supabase projects)
let jwks = null;
function getJwks() {
  if (!jwks) {
    // Supabase exposes JWKS at /auth/v1/jwks
    const jwksUrl = new URL('/auth/v1/jwks', SUPABASE_URL);
    jwks = createRemoteJWKSet(jwksUrl);
  }
  return jwks;
}

// Verify Supabase/legacy tokens
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // 1) Try RS256 via JWKS (new Supabase default)
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      algorithms: ['RS256'],
      issuer: undefined,
      audience: undefined
    });
    // Attempt to extract human-friendly name from Supabase JWT claims
    const meta = payload.user_metadata || payload.userMeta || {};
    const nameClaim = meta.full_name || meta.name || payload.name || payload.nickname || null;
    req.user = { userId: payload.sub, email: payload.email, name: nameClaim, supabaseUser: true };
    console.log('✅ Token verified via JWKS (RS256)');
    return next();
  } catch (err) {
    console.log('❌ JWKS verification failed:', err.message);
    // continue to HS256 paths
  }

  // 2) Try HS256 with Supabase legacy secret (older projects)
  if (SUPABASE_JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
      const meta = decoded.user_metadata || decoded.userMeta || {};
      const nameClaim = meta.full_name || meta.name || decoded.name || decoded.nickname || null;
      req.user = { userId: decoded.sub, email: decoded.email, name: nameClaim, supabaseUser: true };
      console.log('✅ Token verified via HS256 (Supabase JWT Secret)');
      return next();
    } catch (err) {
      console.log('❌ HS256 verification failed:', err.message);
      // continue to app-JWT path
    }
  } else {
    console.log('⚠️ SUPABASE_JWT_SECRET not set, skipping HS256 verification');
  }

  // 3) Fallback to app's own JWT (if any)
  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user; // { userId, email }
    console.log('✅ Token verified via app JWT');
    return next();
  } catch (err) {
    console.log('❌ App JWT verification failed:', err.message);
    console.log('🚫 All token verification methods failed');
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Optional auth: if a valid token is provided, populate req.user; otherwise continue anonymous
export const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    // Try RS256 via JWKS
    const { payload } = await jwtVerify(token, getJwks(), {
      algorithms: ['RS256'],
      issuer: undefined,
      audience: undefined
    });
    const meta = payload.user_metadata || payload.userMeta || {};
    const nameClaim = meta.full_name || meta.name || payload.name || payload.nickname || null;
    req.user = { userId: payload.sub, email: payload.email, name: nameClaim, supabaseUser: true };
    return next();
  } catch (_) {
    // continue to HS256/app JWT paths
  }

  if (SUPABASE_JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
      const meta = decoded.user_metadata || decoded.userMeta || {};
      const nameClaim = meta.full_name || meta.name || decoded.name || decoded.nickname || null;
      req.user = { userId: decoded.sub, email: decoded.email, name: nameClaim, supabaseUser: true };
      return next();
    } catch (_) {
      // continue to app JWT path
    }
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user; // { userId, email }
    return next();
  } catch (_) {
    // If token invalid, just proceed unauthenticated
    return next();
  }
};

export const generateToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
};
