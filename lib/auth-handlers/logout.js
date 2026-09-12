const { getDb } = require('../db');
const { setCors } = require('../cors');
const { extractTokenFromCookie, hashRefreshToken, clearAuthCookies } = require('../auth');

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });

  try {
    const refreshToken = extractTokenFromCookie(req, 'refresh_token');

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const sql = getDb();
      await sql`DELETE FROM refresh_tokens WHERE token_hash = ${tokenHash}`;
    }

    clearAuthCookies(res);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    clearAuthCookies(res);
    return res.status(200).json({ success: true });
  }
};
