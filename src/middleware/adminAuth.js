import { getConfig } from '../config.js';
import { safeEqual } from '../lib/http.js';

// Admin-only routes require `Authorization: Bearer <ADMIN_TOKEN>`.
// With no ADMIN_TOKEN secret configured, admin routes are disabled.
export function requireAdmin() {
  return async (c, next) => {
    const { adminToken } = getConfig(c.env);
    if (!adminToken) {
      return c.json({ success: false, error: 'Admin endpoints are disabled. Set the ADMIN_TOKEN secret to enable them.' }, 403);
    }

    const header = c.req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!safeEqual(token, adminToken)) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    await next();
  };
}
