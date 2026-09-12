const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const auth = require('../lib/auth');
const reset = require('../lib/password-reset');
const validation = require('../lib/validation');
const templates = require('../lib/email-templates');
const { loadModule, response, json } = require('./auth-test-helpers');

const token = 'ab'.repeat(32);
const requestBody = { action: 'request', email: 'member@example.test' };
const resetBody = { action: 'reset', token, password: 'NewPassword123' };
const genericSuccess = {
  success: true,
  message: 'If your account is eligible, you will receive a password reset email shortly.',
};

function harness(options = {}) {
  const calls = { db: 0, rate: [], issue: [], discard: [], consume: [], email: [], hash: [], provider: 0 };
  const sql = {};
  const helpers = {
    ...reset,
    generateResetToken: () => token,
    consumeRateLimit: async (...args) => {
      calls.rate.push(args);
      return { limited: false, retryAfter: 900 };
    },
    issueResetToken: async (...args) => {
      calls.issue.push(args);
      return options.user === undefined
        ? { email: requestBody.email, display_name: 'Member' } : options.user;
    },
    discardResetToken: async (...args) => { calls.discard.push(args); },
    consumeResetToken: async (...args) => { calls.consume.push(args); return true; },
    ...options.helpers,
  };
  const loaded = loadModule('lib\\auth-handlers\\password-reset.js', {
    bcryptjs: options.bcrypt || {
      hash: async (...args) => { calls.hash.push(args); return 'bcrypt-result'; },
    },
    '../db': { getDb: () => {
      calls.db++;
      if (options.dbError) throw options.dbError;
      return sql;
    } },
    '../cors': { setCors() {} },
    '../validation': validation,
    '../auth': auth,
    '../password-reset': helpers,
    '../email-templates': templates,
    '../email': {
      getResend: () => {
        calls.provider++;
        if (options.providerError) throw options.providerError;
      },
      sendPasswordResetEmail: async message => {
        calls.email.push(message);
        if (options.send) return options.send(message);
        return { data: { id: 'accepted-message' } };
      },
    },
  });
  async function request(body = requestBody, overrides = {}) {
    const res = response();
    await loaded.exports({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '192.0.2.1' },
      body,
      ...overrides,
    }, res);
    return res;
  }
  return { request, calls, logs: loaded.logs, sql };
}

test('reset endpoint supports preflight, rejects methods/content types, and disables caching/referrers', async () => {
  const app = harness();
  for (const [method, headers, status, code] of [
    ['GET', {}, 405, 'METHOD_NOT_ALLOWED'],
    ['POST', {}, 415, 'INVALID_CONTENT_TYPE'],
    ['POST', { 'content-type': 'text/plain' }, 415, 'INVALID_CONTENT_TYPE'],
  ]) {
    const res = await app.request(requestBody, { method, headers });
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code, code);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  }
  const preflight = await app.request(undefined, { method: 'OPTIONS', headers: {} });
  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.ended, true);
  assert.equal(app.calls.db, 0);
});

test('invalid bodies, emails, reset tokens and passwords fail before database or bcrypt work', async () => {
  const app = harness();
  const cases = [
    [null, 'VALIDATION_ERROR'],
    [{}, 'VALIDATION_ERROR'],
    [{ action: 'other' }, 'VALIDATION_ERROR'],
    [{ action: 'request' }, 'VALIDATION_ERROR'],
    [{ action: 'request', email: {} }, 'VALIDATION_ERROR'],
    [{ action: 'request', email: 'invalid' }, 'VALIDATION_ERROR'],
    [{ action: 'request', email: `${'a'.repeat(250)}@example.test` }, 'VALIDATION_ERROR'],
    ...[null, 12, '', 'ab', 'g'.repeat(64), 'A'.repeat(64), `${token}\n`]
      .map(value => [{ ...resetBody, token: value }, 'INVALID_RESET_TOKEN']),
    ...[null, 12, '', 'Abc1234', 'onlyletters', '12345678', `A1${'a'.repeat(127)}`]
      .map(value => [{ ...resetBody, password: value }, 'WEAK_PASSWORD']),
  ];
  for (const [body, code] of cases) {
    const res = await app.request(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.body.code, code);
  }
  assert.equal(app.calls.db, 0);
  assert.equal(app.calls.hash.length, 0);
  assert.equal(app.calls.email.length, 0);
});

test('request normalizes email and gives identical generic success for eligible and unknown/ineligible users', async () => {
  const eligible = harness();
  const unknown = harness({ user: null });
  for (const app of [eligible, unknown]) {
    const res = await app.request({ action: 'request', email: '  MEMBER@Example.test ' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res.body), genericSuccess);
    assert.equal(app.calls.issue[0][1], requestBody.email);
    assert.equal(app.calls.issue[0][2], reset.hashResetToken(token));
    assert.equal(app.calls.provider, 1);
    assert(!JSON.stringify(res.body).includes(token));
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.deepEqual(app.calls.rate.map(call => call.slice(1)), [
      ['request:ip:192.0.2.1', 30], ['request:identity:member@example.test', 5],
    ]);
  }
  assert.equal(eligible.calls.email.length, 1);
  assert.equal(unknown.calls.email.length, 0);
  const mail = eligible.calls.email[0];
  assert.equal(mail.to, requestBody.email);
  assert(mail.html.includes(`https://www.imperialsdodgeball.com/member#reset=${token}`));
  assert(mail.text.includes(`https://www.imperialsdodgeball.com/member#reset=${token}`));
});

test('request must await provider acceptance rather than returning a fake success', async () => {
  let accept;
  let sending;
  const started = new Promise(resolve => { sending = resolve; });
  const app = harness({ send: () => {
    sending();
    return new Promise(resolve => { accept = resolve; });
  } });
  let finished = false;
  const pending = app.request().then(res => { finished = true; return res; });
  await started;
  assert.equal(finished, false);
  accept({ data: { id: 'accepted-message' } });
  assert.equal((await pending).statusCode, 200);
});

test('provider rejection, network failure, and missing acceptance id invalidate only the issued token', async () => {
  for (const send of [
    async () => { throw new Error(`secret-provider-payload ${token}`); },
    async () => undefined,
    async () => ({ data: {} }),
    async () => ({ data: { id: '' } }),
    async () => ({ data: { id: ' ' } }),
    async () => ({ data: { id: 123 } }),
  ]) {
    const app = harness({ send });
    const res = await app.request();
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SERVICE_UNAVAILABLE');
    assert.deepEqual(app.calls.discard, [[app.sql, reset.hashResetToken(token)]]);
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert(!JSON.stringify([app.logs, res.body]).includes('secret-provider-payload'));
    assert(!JSON.stringify([app.logs, res.body]).includes(token));
  }
});

test('an older failed delivery cannot discard a newer request token', async () => {
  const tokens = [token, 'cd'.repeat(32)];
  let outstanding;
  let rejectOld;
  let sendingOld;
  const started = new Promise(resolve => { sendingOld = resolve; });
  const app = harness({
    helpers: {
      generateResetToken: () => tokens.shift(),
      issueResetToken: async (_sql, _email, tokenHash) => {
        outstanding = tokenHash;
        return { email: requestBody.email };
      },
      discardResetToken: async (_sql, tokenHash) => {
        if (outstanding === tokenHash) outstanding = null;
      },
    },
    send: message => {
      if (!message.text.includes(token)) return { data: { id: 'new-email' } };
      sendingOld();
      return new Promise((_resolve, reject) => { rejectOld = reject; });
    },
  });
  const oldRequest = app.request();
  await started;
  assert.equal((await app.request()).statusCode, 200);
  rejectOld(new Error('Failed'));
  assert.equal((await oldRequest).statusCode, 503);
  assert.equal(outstanding, reset.hashResetToken('cd'.repeat(32)));
});

test('missing provider configuration returns the same generic outage for eligible and unknown accounts', async () => {
  for (const user of [null, { email: requestBody.email }]) {
    const app = harness({ user, providerError: new Error('secret-provider-key') });
    const res = await app.request();
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SERVICE_UNAVAILABLE');
    assert.equal(app.calls.issue.length, 0);
    assert(!JSON.stringify([app.logs, res.body]).includes('secret-provider-key'));
  }
});

test('IP and identity limits return Retry-After and avoid sending or expensive password hashing', async () => {
  for (const action of ['request', 'reset']) {
    for (const limitIndex of [1, 2]) {
      let count = 0;
      const app = harness({ helpers: { consumeRateLimit: async () => ({
        limited: ++count === limitIndex,
        retryAfter: 123,
      }) } });
      const res = await app.request(action === 'request' ? requestBody : resetBody);
      assert.equal(res.statusCode, 429);
      assert.equal(res.body.code, 'RATE_LIMITED');
      assert.equal(res.body.retry_after, 123);
      assert.equal(res.headers['Retry-After'], '123');
      assert.equal(count, limitIndex);
      assert.equal(app.calls.hash.length, 0);
      assert.equal(app.calls.issue.length, 0);
      assert.equal(app.calls.consume.length, 0);
      assert.equal(app.calls.email.length, 0);
    }
  }
});

test('rate limiting uses platform IP first, then forwarded IP, then socket or unknown', async () => {
  for (const [extraHeaders, socket, expected] of [
    [{ 'x-vercel-forwarded-for': '192.0.2.2, 192.0.2.3', 'x-forwarded-for': 'spoof' }, {}, '192.0.2.2'],
    [{ 'x-forwarded-for': '192.0.2.4, 192.0.2.5' }, {}, '192.0.2.4'],
    [{}, { remoteAddress: '192.0.2.6' }, '192.0.2.6'],
    [{}, undefined, 'unknown'],
  ]) {
    const app = harness({ user: null });
    await app.request(requestBody, {
      headers: { 'content-type': 'application/json', ...extraHeaders }, socket,
    });
    assert.equal(app.calls.rate[0][1], `request:ip:${expected}`);
  }
});

test('reset prehashes before bcrypt cost 12, consumes only SHA256 token, clears cookies and never logs in', async () => {
  const app = harness();
  const res = await app.request(resetBody);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json(res.body), { success: true });
  assert.deepEqual(app.calls.hash, [[auth.preHashPassword(resetBody.password), 12]]);
  assert.deepEqual(app.calls.consume, [[app.sql, reset.hashResetToken(token), 'bcrypt-result']]);
  assert.deepEqual(app.calls.rate.map(call => call.slice(1)), [
    ['reset:ip:192.0.2.1', 30], [`reset:identity:${token}`, 5],
  ]);
  const cookies = res.headers['Set-Cookie'];
  assert.equal(cookies.length, 2);
  assert(cookies.every(cookie => cookie.includes('Max-Age=0') && cookie.includes('HttpOnly')));
  assert.equal(app.calls.email.length, 0);
  assert.equal(app.calls.provider, 0);
  assert.equal(auth.ACCESS_TOKEN_EXPIRY, '15m');
});

test('reset uses the actual existing bcrypt/prehash format including passwords longer than 72 bytes', async () => {
  const password = `A1${'x'.repeat(90)}`;
  const app = harness({ bcrypt });
  assert.equal((await app.request({ ...resetBody, password })).statusCode, 200);
  const storedHash = app.calls.consume[0][2];
  assert.match(storedHash, /^\$2[aby]\$12\$/);
  assert(await bcrypt.compare(auth.preHashPassword(password), storedHash));
  assert.equal(await bcrypt.compare(auth.preHashPassword(`${password.slice(0, -1)}y`), storedHash), false);
});

test('missing, consumed, expired or ineligible reset token results are uniformly invalid and do not clear cookies', async () => {
  const app = harness({ helpers: { consumeResetToken: async () => false } });
  const res = await app.request(resetBody);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_RESET_TOKEN');
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('database, transaction, cleanup and bcrypt failures expose only generic service errors and safe logs', async () => {
  const secret = new Error(`private-database-url member@example.test ${token}`);
  const cases = [
    [{ dbError: secret }, requestBody],
    [{ helpers: { consumeRateLimit: async () => { throw secret; } } }, requestBody],
    [{ helpers: { issueResetToken: async () => { throw secret; } } }, requestBody],
    [{ helpers: { consumeResetToken: async () => { throw secret; } } }, resetBody],
    [{ bcrypt: { hash: async () => { throw secret; } } }, resetBody],
    [{
      send: async () => { throw secret; },
      helpers: { discardResetToken: async () => { throw secret; } },
    }, requestBody],
  ];
  for (const [options, body] of cases) {
    const app = harness(options);
    const res = await app.request(body);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SERVICE_UNAVAILABLE');
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.deepEqual(app.logs, [['Password recovery unavailable']]);
    assert(!JSON.stringify(res.body).includes(token));
    assert(!JSON.stringify(res.body).includes('private-database-url'));
  }
});
