const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { setCors } = require('../cors');
const { validateEmail, requireJSON } = require('../validation');
const { createAccessToken, generateRefreshToken, hashRefreshToken, setAccessTokenCookie, setRefreshTokenCookie, preHashPassword, REFRESH_TOKEN_DAYS } = require('../auth');
const { checkRateLimit, recordAttempt, clearAttempts } = require('../rate-limit');
const { issueLoginSession } = require('../auth-sessions');

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  if (!requireJSON(req)) return res.status(415).json({ error: 'Content-Type must be application/json', code: 'INVALID_CONTENT_TYPE' });

  try {
    const { email, password, remember_me = false } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' });
    }

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr, code: 'VALIDATION_ERROR' });

    const normalizedEmail = email.trim().toLowerCase();

    const rateCheck = await checkRateLimit(normalizedEmail);
    if (rateCheck.limited) {
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`,
        code: 'RATE_LIMITED',
        retry_after: rateCheck.retryAfter
      });
    }

    const sql = getDb();
    const users = await sql`
      SELECT id, email, password_hash, display_name, ranking_player_name, is_active, status
      FROM users WHERE email = ${normalizedEmail}
    `;

    if (users.length === 0) {
      await recordAttempt(normalizedEmail);
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const user = users[0];

    // Verify password before revealing account status (prevents user enumeration)
    const preHashed = preHashPassword(password);
    const valid = await bcrypt.compare(preHashed, user.password_hash);
    if (!valid) {
      await recordAttempt(normalizedEmail);
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const refreshToken = remember_me ? generateRefreshToken() : null;
    const refreshHash = refreshToken ? hashRefreshToken(refreshToken) : null;
    const expiresAt = refreshToken
      ? new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString() : null;
    const sessionUser = await issueLoginSession(sql, user.id, user.password_hash, refreshHash, expiresAt);
    if (!sessionUser) {
      await recordAttempt(normalizedEmail);
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    if (!sessionUser.is_active) {
      if (sessionUser.status === 'pending') {
        return res.status(403).json({ error: 'Your account is awaiting admin approval.', code: 'PENDING_APPROVAL' });
      }
      if (sessionUser.status === 'rejected') {
        return res.status(403).json({ error: 'Your registration was not approved. Contact imperialsdodgeball@gmail.com for more info.', code: 'REJECTED' });
      }
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    await clearAttempts(normalizedEmail);

    const accessToken = createAccessToken(sessionUser);
    setAccessTokenCookie(res, accessToken);

    if (refreshToken) {
      setRefreshTokenCookie(res, refreshToken);
    }

    return res.status(200).json({
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        display_name: sessionUser.display_name,
        ranking_player_name: sessionUser.ranking_player_name
      }
    });
  } catch {
    console.error('Login failed');
    return res.status(500).json({ error: 'Login failed. Please try again.', code: 'SERVER_ERROR' });
  }
};
