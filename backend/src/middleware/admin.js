import { authenticateToken } from './auth.js';
import pool from '../db.js';

export const ROLES = {
  CUSTOMER: 'customer',
  PRODUCT_ASSISTANT: 'product_assistant',
  SUPERUSER: 'superuser',
};

const configuredSuperuserEmails = String(
  process.env.SUPERUSER_EMAILS ||
  process.env.SUPER_ADMIN_EMAILS ||
  process.env.ADMIN_EMAILS ||
  ''
)
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const configuredProductAssistantEmails = String(process.env.PRODUCT_ASSISTANT_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const superuserEmails = new Set([
  'support@snuggleup.co.za',
  ...configuredSuperuserEmails,
]);

const productAssistantEmails = new Set(configuredProductAssistantEmails);

export const normalizeRole = (role) => {
  const value = String(role || '').trim().toLowerCase();
  if (value === ROLES.SUPERUSER || value === 'super_admin' || value === 'admin') {
    return ROLES.SUPERUSER;
  }
  if (value === ROLES.PRODUCT_ASSISTANT || value === 'product_admin' || value === 'lower_admin') {
    return ROLES.PRODUCT_ASSISTANT;
  }
  return ROLES.CUSTOMER;
};

const roleFromConfiguredEmail = (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return ROLES.CUSTOMER;
  if (superuserEmails.has(normalizedEmail)) return ROLES.SUPERUSER;
  if (productAssistantEmails.has(normalizedEmail)) return ROLES.PRODUCT_ASSISTANT;
  return ROLES.CUSTOMER;
};

const fetchLocalUser = async (email) => {
  try {
    const result = await pool.query(
      'SELECT id, is_admin, role FROM users WHERE lower(email) = lower($1)',
      [email]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code === '42703') {
      const fallback = await pool.query(
        'SELECT id, is_admin FROM users WHERE lower(email) = lower($1)',
        [email]
      );
      return fallback.rows[0] || null;
    }
    throw error;
  }
};

const ensureLocalUser = async (req, configuredRole) => {
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (!email) return null;

  const name = String(req.user?.name || email.split('@')[0] || 'SnuggleUp user').trim();
  const role = configuredRole && configuredRole !== ROLES.CUSTOMER ? configuredRole : ROLES.CUSTOMER;

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password, name, role, is_admin)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(NULLIF(users.name, ''), EXCLUDED.name)
       RETURNING id, is_admin, role`,
      [email, 'supabase-managed', name, role, role === ROLES.SUPERUSER]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Local user sync failed:', error.message);
    return null;
  }
};

export const getUserAccess = async (req) => {
  const email = String(req.user?.email || '').trim().toLowerCase();
  const configuredRole = roleFromConfiguredEmail(email);
  let dbUser = null;

  if (email) {
    try {
      dbUser = await fetchLocalUser(email);
      if (!dbUser) {
        dbUser = await ensureLocalUser(req, configuredRole);
      }
    } catch (error) {
      console.error('Access role lookup failed:', error.message);
    }
  }

  const dbRole = normalizeRole(dbUser?.role);
  const isSuperuser = configuredRole === ROLES.SUPERUSER || dbRole === ROLES.SUPERUSER || dbUser?.is_admin === true;
  const isProductAssistant = !isSuperuser && (
    configuredRole === ROLES.PRODUCT_ASSISTANT ||
    dbRole === ROLES.PRODUCT_ASSISTANT
  );
  const role = isSuperuser
    ? ROLES.SUPERUSER
    : isProductAssistant
      ? ROLES.PRODUCT_ASSISTANT
      : ROLES.CUSTOMER;

  return {
    role,
    email,
    userId: dbUser?.id || req.user?.userId || email || null,
    isSuperuser,
    isProductAssistant,
    isAdmin: isSuperuser,
    canManageProducts: isSuperuser || isProductAssistant,
    canApproveProducts: isSuperuser,
  };
};

export const requireRoles = (allowedRoles, label = 'Authorized access') => (req, res, next) => {
  return authenticateToken(req, res, async (err) => {
    if (err) {
      console.error(`${label} auth failed:`, err);
      return res.status(401).json({ error: 'Authentication failed' });
    }

    try {
      const access = await getUserAccess(req);
      req.access = access;
      req.localUserId = access.userId;

      if (allowedRoles.includes(access.role)) {
        return next();
      }

      return res.status(403).json({ error: `${label} required`, role: access.role });
    } catch (error) {
      console.error(`${label} middleware error:`, error);
      return res.status(500).json({ error: 'Authorization check failed', details: error.message });
    }
  });
};

// Full admin/superuser routes only. The product assistant does not pass this.
export const requireAdmin = requireRoles([ROLES.SUPERUSER], 'Superuser access');
export const requireSuperuser = requireAdmin;

// Product-preparation routes for the lower access helper plus the superuser.
export const requireProductAssistantOrAdmin = requireRoles(
  [ROLES.SUPERUSER, ROLES.PRODUCT_ASSISTANT],
  'Product manager access'
);
