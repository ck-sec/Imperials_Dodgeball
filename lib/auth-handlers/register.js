const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { setCors } = require('../cors');
const { validateEmail, validatePassword, validateDisplayName, sanitizeHtml, requireJSON } = require('../validation');
const { createAccessToken, generateRefreshToken, hashRefreshToken, setAccessTokenCookie, setRefreshTokenCookie, preHashPassword, REFRESH_TOKEN_DAYS } = require('../auth');
const { checkRateLimit, recordAttempt } = require('../rate-limit');

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  if (!requireJSON(req)) return res.status(415).json({ error: 'Content-Type must be application/json', code: 'INVALID_CONTENT_TYPE' });

  try {
    const { email, password, display_name } = req.body || {};

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr, code: 'VALIDATION_ERROR' });

    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ error: passErr, code: 'WEAK_PASSWORD' });

    const nameErr = validateDisplayName(display_name);
    if (nameErr) return res.status(400).json({ error: nameErr, code: 'VALIDATION_ERROR' });

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = sanitizeHtml(display_name.trim());

    const rateCheck = await checkRateLimit(normalizedEmail);
    if (rateCheck.limited) {
      return res.status(429).json({
        error: 'Too many requests. Try again later.',
        code: 'RATE_LIMITED',
        retry_after: rateCheck.retryAfter
      });
    }

    const preHashed = preHashPassword(password);
    const passwordHash = await bcrypt.hash(preHashed, 12);

    const sql = getDb();
    let rows;
    try {
      rows = await sql`
        INSERT INTO users (email, password_hash, display_name, is_active, status)
        VALUES (${normalizedEmail}, ${passwordHash}, ${trimmedName}, false, 'pending')
        RETURNING id, email, display_name, created_at
      `;
    } catch (err) {
      if (err.message && (err.message.includes('unique') || err.message.includes('duplicate'))) {
        // Return generic success to prevent user enumeration
        return res.status(200).json({
          pending: true,
          message: 'Registration request received. If eligible, your account will be reviewed by an admin.'
        });
      }
      throw err;
    }

    const user = rows[0];

    return res.status(200).json({
      pending: true,
      message: 'Registration request received. If eligible, your account will be reviewed by an admin.'
    });
  } catch (err) {
    console.error('Registration failed:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.', code: 'SERVER_ERROR' });
  }
};
