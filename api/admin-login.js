const { setCors } = require('../lib/cors');
const { getDb } = require('../lib/db');
const { findAuthorizedAdmin, isMissingAdminSchema } = require('../lib/admin-access');
const {
  requireMember,
  createAdminAccessToken,
  createAdminRefreshToken,
  setAdminRefreshTokenCookie,
} = require('../lib/auth');

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });

  const member = requireMember(req, res);
  if (!member) return;

  let admin;
  try {
    admin = await findAuthorizedAdmin(getDb(), member.sub);
  } catch (error) {
    console.error('Admin access lookup failed:', error);
    if (isMissingAdminSchema(error)) {
      return res.status(503).json({
        error: 'Admin access is not configured',
        code: 'ADMIN_ACCESS_NOT_CONFIGURED',
      });
    }
    return res.status(500).json({ error: 'Admin access lookup failed', code: 'ADMIN_ACCESS_LOOKUP_FAILED' });
  }

  if (!admin) {
    return res.status(403).json({
      error: 'This member account is not authorized for the admin dashboard',
      code: 'ADMIN_ACCESS_DENIED',
    });
  }

  const token = createAdminAccessToken(admin);
  setAdminRefreshTokenCookie(res, createAdminRefreshToken(admin));
  return res.status(200).json({ token, admin: { display_name: admin.display_name } });
};
