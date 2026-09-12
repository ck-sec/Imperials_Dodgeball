const { getDb } = require('../db');
const { setCors } = require('../cors');
const { extractTokenFromCookie, createAccessToken, generateRefreshToken, hashRefreshToken, setAccessTokenCookie, setRefreshTokenCookie, REFRESH_TOKEN_DAYS } = require('../auth');
const { checkRateLimit, recordAttempt, clearAttempts } = require('../rate-limit');
const { rotateRefreshSession } = require('../auth-sessions');

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });

  try {
    const refreshToken = extractTokenFromCookie(req, 'refresh_token');
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
    }

    // Rate limit refresh attempts by token hash to prevent brute-force
    const tokenHash = hashRefreshToken(refreshToken);
    const rateKey = `refresh_${tokenHash.slice(0, 16)}`;
    const rateCheck = await checkRateLimit(rateKey);
    if (rateCheck.limited) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.', code: 'RATE_LIMITED', retryAfter: rateCheck.retryAfter });
    }

    const sql = getDb();

    const newRefreshToken = generateRefreshToken();
    const newHash = hashRefreshToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const row = await rotateRefreshSession(sql, tokenHash, newHash, expiresAt);

    if (!row) {
      await recordAttempt(rateKey);
      return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
    }

    if (!row.is_active) {
      return res.status(401).json({ error: 'Account deactivated', code: 'INVALID_REFRESH_TOKEN' });
    }

    const accessToken = createAccessToken({ id: row.user_id });
    setAccessTokenCookie(res, accessToken);
    setRefreshTokenCookie(res, newRefreshToken);

    await clearAttempts(rateKey);

    return res.status(200).json({
      user: {
        id: row.user_id,
        email: row.email,
        display_name: row.display_name,
        ranking_player_name: row.ranking_player_name
      }
    });
  } catch {
    console.error('Token refresh failed');
    return res.status(500).json({ error: 'Token refresh failed', code: 'SERVER_ERROR' });
  }
};
