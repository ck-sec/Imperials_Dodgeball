const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { isValidUuid } = require('./validation');

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_DAYS = 7;
const ADMIN_ACCESS_TOKEN_EXPIRY = '30m';
const ADMIN_REFRESH_TOKEN_EXPIRY = '8h';
const ADMIN_REFRESH_TOKEN_MAX_AGE = 8 * 60 * 60;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET');
  return secret;
}

function createAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: 'member', iss: 'vienna-member' },
    getSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

function adminUserId(user) {
  const userId = typeof user === 'string' ? user : user && user.id;
  if (!isValidUuid(userId)) throw new TypeError('A valid admin user id is required');
  return userId;
}

function createAdminAccessToken(user) {
  return jwt.sign(
    { sub: adminUserId(user), role: 'admin', iss: 'vienna-admin' },
    getSecret(),
    { expiresIn: ADMIN_ACCESS_TOKEN_EXPIRY }
  );
}

function createAdminRefreshToken(user) {
  return jwt.sign(
    { sub: adminUserId(user), role: 'admin-refresh', iss: 'vienna-admin' },
    getSecret(),
    { expiresIn: ADMIN_REFRESH_TOKEN_EXPIRY }
  );
}

function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

function extractTokenFromHeader(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function extractTokenFromCookie(req, name) {
  const cookies = req.headers['cookie'] || '';
  const match = cookies.split(';').find(c => c.trim().startsWith(name + '='));
  return match ? match.split('=')[1].trim() : null;
}

function requireMember(req, res) {
  const token = extractTokenFromCookie(req, 'access_token') || extractTokenFromHeader(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return null;
  }
  const payload = verifyAccessToken(token);
  if (!payload || payload.role !== 'member' || payload.iss !== 'vienna-member') {
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    return null;
  }
  return payload;
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setAccessTokenCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `access_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=900`,
    ...(res.getHeader('Set-Cookie') || [])
  ].flat());
}

function setRefreshTokenCookie(res, token) {
  const maxAge = REFRESH_TOKEN_DAYS * 24 * 60 * 60;
  const existing = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [
    ...(Array.isArray(existing) ? existing : [existing]),
    `refresh_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=${maxAge}`
  ]);
}

function setAdminRefreshTokenCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `admin_refresh_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin-refresh; Max-Age=${ADMIN_REFRESH_TOKEN_MAX_AGE}`
  );
}

function clearAdminRefreshTokenCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'admin_refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin-refresh; Max-Age=0'
  );
}

function verifyAdminRefreshToken(token) {
  try {
    const payload = jwt.verify(token, getSecret());
    return payload.role === 'admin-refresh' && payload.iss === 'vienna-admin' && isValidUuid(payload.sub)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function clearAuthCookies(res) {
  res.setHeader('Set-Cookie', [
    'access_token=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0',
    'refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0'
  ]);
}

function preHashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('base64');
}

function requireAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Admin authentication required', code: 'UNAUTHORIZED' });
    return null;
  }
  try {
    const payload = jwt.verify(token, getSecret());
    if (payload.role !== 'admin' || payload.iss !== 'vienna-admin' || !isValidUuid(payload.sub)) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return null;
    }
    return payload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    return null;
  }
}

module.exports = {
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_DAYS,
  ADMIN_ACCESS_TOKEN_EXPIRY,
  ADMIN_REFRESH_TOKEN_EXPIRY,
  createAccessToken,
  createAdminAccessToken,
  createAdminRefreshToken,
  verifyAccessToken,
  verifyAdminRefreshToken,
  extractTokenFromHeader,
  extractTokenFromCookie,
  requireMember,
  requireAdmin,
  generateRefreshToken,
  hashRefreshToken,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  setAdminRefreshTokenCookie,
  clearAdminRefreshTokenCookie,
  clearAuthCookies,
  preHashPassword,
};
