const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const auth = require('../lib/auth');
const { loadModule, response } = require('./auth-test-helpers');

const secret = 'admin-session-test-secret-with-enough-entropy';
const adminId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = secret;
test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

function loginHandler(findAuthorizedAdmin) {
  return loadModule('api\\admin-login.js', {
    '../lib/cors': { setCors() {} },
    '../lib/db': { getDb: () => ({}) },
    '../lib/admin-access': {
      findAuthorizedAdmin,
      isMissingAdminSchema: error => error && error.code === '42P01',
    },
    '../lib/auth': auth,
  }, { process: { env: { JWT_SECRET: secret } } }).exports;
}

function refreshHandler(findAuthorizedAdmin) {
  return loadModule('api\\admin-refresh.js', {
    '../lib/cors': { setCors() {} },
    '../lib/db': { getDb: () => ({}) },
    '../lib/admin-access': {
      findAuthorizedAdmin,
      isMissingAdminSchema: error => error && error.code === '42P01',
    },
    '../lib/auth': auth,
  }, { process: { env: { JWT_SECRET: secret } } }).exports;
}

test('an authorized member session is elevated to a subject-bound admin session', async () => {
  let lookedUpId = '';
  const handler = loginHandler(async (_sql, userId) => {
    lookedUpId = userId;
    return { id: adminId, display_name: 'Christoph Kopka' };
  });
  const memberToken = auth.createAccessToken({ id: adminId });
  const res = response();
  await handler({
    method: 'POST',
    headers: { cookie: `access_token=${memberToken}` },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(lookedUpId, adminId);
  assert.equal(res.body.admin.display_name, 'Christoph Kopka');
  const access = jwt.verify(res.body.token, secret);
  assert.equal(access.sub, adminId);
  assert.equal(access.role, 'admin');
  assert.equal(access.iss, 'vienna-admin');
  assert.match(res.headers['Set-Cookie'], /^admin_refresh_token=/);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict; Path=\/api\/admin-refresh; Max-Age=28800/);
  const refreshToken = /^admin_refresh_token=([^;]+)/.exec(res.headers['Set-Cookie'])[1];
  assert.equal(auth.verifyAdminRefreshToken(refreshToken).sub, adminId);
});

test('admin elevation denies non-admin members and requires member authentication', async () => {
  const handler = loginHandler(async () => null);
  const denied = response();
  await handler({
    method: 'POST',
    headers: { cookie: `access_token=${auth.createAccessToken({ id: otherId })}` },
  }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'ADMIN_ACCESS_DENIED');
  assert.equal(denied.headers['Set-Cookie'], undefined);

  const anonymous = response();
  await handler({ method: 'POST', headers: {} }, anonymous);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.body.code, 'UNAUTHORIZED');
});

test('admin refresh rechecks access, rotates valid sessions, and rejects revoked or legacy sessions', async () => {
  const handler = refreshHandler(async (_sql, userId) => (
    userId === adminId ? { id: adminId, display_name: 'Christoph Kopka' } : null
  ));
  const refreshToken = auth.createAdminRefreshToken(adminId);
  const renewed = response();
  await handler({
    method: 'POST',
    headers: { cookie: `other=value; admin_refresh_token=${refreshToken}` },
  }, renewed);
  assert.equal(renewed.statusCode, 200);
  assert.equal(jwt.verify(renewed.body.token, secret).sub, adminId);
  assert.match(renewed.headers['Set-Cookie'], /^admin_refresh_token=/);

  const revoked = response();
  await handler({
    method: 'POST',
    headers: { cookie: `admin_refresh_token=${auth.createAdminRefreshToken(otherId)}` },
  }, revoked);
  assert.equal(revoked.statusCode, 403);
  assert.equal(revoked.body.code, 'ADMIN_ACCESS_REVOKED');
  assert.match(revoked.headers['Set-Cookie'], /Max-Age=0/);

  const legacyToken = jwt.sign({ role: 'admin-refresh', iss: 'vienna-admin' }, secret, { expiresIn: '5m' });
  const legacy = response();
  await handler({ method: 'POST', headers: { cookie: `admin_refresh_token=${legacyToken}` } }, legacy);
  assert.equal(legacy.statusCode, 401);
  assert.equal(legacy.body.code, 'INVALID_ADMIN_REFRESH_TOKEN');
  assert.match(legacy.headers['Set-Cookie'], /Max-Age=0/);

  const deleted = response();
  await handler({ method: 'DELETE', headers: {} }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.success, true);
  assert.match(deleted.headers['Set-Cookie'], /Max-Age=0/);
});

test('admin access verification requires the role, issuer, and immutable user subject', () => {
  const wrongIssuer = jwt.sign({ sub: adminId, role: 'admin', iss: 'another-service' }, secret, { expiresIn: '5m' });
  const forbidden = response();
  assert.equal(auth.requireAdmin({ headers: { authorization: ['Bearer', wrongIssuer].join(' ') } }, forbidden), null);
  assert.equal(forbidden.statusCode, 403);

  const legacy = response();
  const legacyToken = jwt.sign({ role: 'admin', iss: 'vienna-admin' }, secret, { expiresIn: '5m' });
  assert.equal(auth.requireAdmin({ headers: { authorization: ['Bearer', legacyToken].join(' ') } }, legacy), null);
  assert.equal(legacy.statusCode, 403);

  const allowed = response();
  const payload = auth.requireAdmin({
    headers: { authorization: ['Bearer', auth.createAdminAccessToken(adminId)].join(' ') }
  }, allowed);
  assert.equal(payload.iss, 'vienna-admin');
  assert.equal(payload.sub, adminId);
});
