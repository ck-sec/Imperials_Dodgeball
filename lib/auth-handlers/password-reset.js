const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { setCors } = require('../cors');
const { validateEmail, validatePassword, requireJSON } = require('../validation');
const { preHashPassword, clearAuthCookies } = require('../auth');
const { getResend, sendPasswordResetEmail } = require('../email');
const { passwordReset } = require('../email-templates');
const {
  TOKEN_RE, generateResetToken, hashResetToken, consumeRateLimit,
  issueResetToken, discardResetToken, consumeResetToken,
} = require('../password-reset');

const REQUEST_MESSAGE = 'If your account is eligible, you will receive a password reset email shortly.';

function clientAddress(req) {
  const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = async (req, res) => {
  setCors(req, res, 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  if (!requireJSON(req)) return res.status(415).json({ error: 'Content-Type must be application/json', code: 'INVALID_CONTENT_TYPE' });

  const { action, email, token, password } = req.body || {};
  if (action !== 'request' && action !== 'reset') {
    return res.status(400).json({ error: 'Invalid password recovery request', code: 'VALIDATION_ERROR' });
  }
  if (action === 'request' && validateEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address', code: 'VALIDATION_ERROR' });
  }
  if (action === 'reset') {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      return res.status(400).json({ error: 'Invalid or expired reset link', code: 'INVALID_RESET_TOKEN' });
    }
    if (validatePassword(password)) {
      return res.status(400).json({ error: 'Use 8–128 characters, including a letter and a number', code: 'WEAK_PASSWORD' });
    }
  }

  try {
    const sql = getDb();
    const addressLimit = await consumeRateLimit(sql, `${action}:ip:${clientAddress(req)}`, 30);
    const identityKey = action === 'request' ? email.trim().toLowerCase() : token;
    const identityLimit = addressLimit.limited ? addressLimit
      : await consumeRateLimit(sql, `${action}:identity:${identityKey}`, 5);
    if (identityLimit.limited) {
      res.setHeader('Retry-After', String(identityLimit.retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Try again later.',
        code: 'RATE_LIMITED',
        retry_after: identityLimit.retryAfter,
      });
    }

    if (action === 'request') {
      // Validate provider configuration even for unknown/ineligible accounts.
      getResend();
      const rawToken = generateResetToken();
      const tokenHash = hashResetToken(rawToken);
      const user = await issueResetToken(sql, identityKey, tokenHash);
      if (user) {
        try {
          const template = passwordReset({ name: user.display_name, token: rawToken });
          const result = await sendPasswordResetEmail({ to: user.email, ...template });
          if (typeof result?.data?.id !== 'string' || !result.data.id.trim()) {
            throw new Error('Email was not accepted');
          }
        } catch {
          await discardResetToken(sql, tokenHash);
          throw new Error('Password reset delivery unavailable');
        }
      }
      return res.status(200).json({ success: true, message: REQUEST_MESSAGE });
    }

    const passwordHash = await bcrypt.hash(preHashPassword(password), 12);
    if (!await consumeResetToken(sql, hashResetToken(token), passwordHash)) {
      return res.status(400).json({ error: 'Invalid or expired reset link', code: 'INVALID_RESET_TOKEN' });
    }
    clearAuthCookies(res);
    return res.status(200).json({ success: true });
  } catch {
    // Do not log provider/database payloads, tokens, credentials, or account identifiers.
    console.error('Password recovery unavailable');
    return res.status(503).json({
      error: 'Password recovery is temporarily unavailable. Please try again later.',
      code: 'SERVICE_UNAVAILABLE',
    });
  }
};
