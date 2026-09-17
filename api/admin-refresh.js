const { setCors } = require('../lib/cors');
const { getDb } = require('../lib/db');
const { findAuthorizedAdmin, isMissingAdminSchema } = require('../lib/admin-access');
const {
  createAdminAccessToken,
  createAdminRefreshToken,
  extractTokenFromCookie,
  verifyAdminRefreshToken,
  setAdminRefreshTokenCookie,
  clearAdminRefreshTokenCookie,
} = require('../lib/auth');

module.exports = async (req, res) => {
  setCors(req, res, 'POST, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'DELETE') {
    clearAdminRefreshTokenCookie(res);
    return res.status(200).json({ success: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const refreshToken = extractTokenFromCookie(req, 'admin_refresh_token');
  const session = refreshToken && verifyAdminRefreshToken(refreshToken);
  if (!session) {
    clearAdminRefreshTokenCookie(res);
    return res.status(401).json({ error: 'Admin session expired', code: 'INVALID_ADMIN_REFRESH_TOKEN' });
  }

  let admin;
  try {
    admin = await findAuthorizedAdmin(getDb(), session.sub);
  } catch (error) {
    console.error('Admin refresh access lookup failed:', error);
    clearAdminRefreshTokenCookie(res);
    if (isMissingAdminSchema(error)) {
      return res.status(503).json({
        error: 'Admin access is not configured',
        code: 'ADMIN_ACCESS_NOT_CONFIGURED',
      });
    }
    return res.status(500).json({ error: 'Admin access lookup failed', code: 'ADMIN_ACCESS_LOOKUP_FAILED' });
  }

  if (!admin) {
    clearAdminRefreshTokenCookie(res);
    return res.status(403).json({ error: 'Admin access has been revoked', code: 'ADMIN_ACCESS_REVOKED' });
  }

  const token = createAdminAccessToken(admin);
  setAdminRefreshTokenCookie(res, createAdminRefreshToken(admin));
  return res.status(200).json({ token });
};
