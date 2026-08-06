const MANAGEMENT_ROUTE_PATTERNS = [
  /^\/admin(?:\/|$)/i,
  /^\/superuser(?:\/|$)/i,
  /^\/login\/admin(?:\/|$)/i,
  /^\/admin-login(?:\/|$)/i,
  /^\/management(?:\/|$)/i,
];

export const isManagementAnalyticsPath = (value) => {
  const path = String(value || '/').trim().split('?')[0] || '/';
  return MANAGEMENT_ROUTE_PATTERNS.some((pattern) => pattern.test(path));
};
