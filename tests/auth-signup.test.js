const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../lib/validation');
const templates = require('../lib/email-templates');
const { loadModule, response, json } = require('./auth-test-helpers');

function harness(options = {}) {
  const calls = { queries: [], email: [] };
  const sql = (strings, ...values) => {
    const query = { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
    calls.queries.push(query);
    return Promise.resolve().then(() => {
      if (options.query) return options.query(query);
      return query.text.startsWith('SELECT COUNT') ? [{ cnt: options.count || 0 }] : [];
    });
  };
  const app = loadModule('api\\signup.js', {
    '../lib/db': { getDb: () => sql },
    '../lib/cors': { setCors() {} },
    '../lib/validation': validation,
    '../lib/email-templates': templates,
    '../lib/email': { sendEmail: async message => {
      calls.email.push(message);
      if (options.emailError) throw options.emailError;
      return { data: { id: 'accepted-email' } };
    } },
  });
  async function request(body = { name: 'Member Name', email: 'member@example.test' }, overrides = {}) {
    const res = response();
    await app.exports({
      method: 'POST', headers: { 'content-type': 'application/json' }, body, ...overrides,
    }, res);
    return res;
  }
  return { request, calls, logs: app.logs };
}

test('homepage signup without a type stores join, normalizes email, and keeps its existing success contract', async () => {
  const app = harness();
  const res = await app.request({ name: ' Member Name ', email: ' MEMBER@Example.test ', level: '', source: 'homepage' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json(res.body), {
    success: true,
    message: "Thanks for signing up! We'll be in touch. / Danke! Wir melden uns bald.",
  });
  const insert = app.calls.queries.find(query => query.text.startsWith('INSERT INTO signups'));
  assert.deepEqual(insert.values, ['Member Name', 'member@example.test', 'join', null, 'homepage']);
  assert(insert.values.every(value => value !== undefined));
  assert.equal(app.calls.email[0].to, 'member@example.test');
  const audit = app.calls.queries.find(query => query.text.startsWith('INSERT INTO email_log'));
  assert.equal(audit.values.at(-1), 'accepted-email');
  assert.equal(res.headers['Set-Cookie'], undefined);
  assert(!app.calls.queries.some(query => /INSERT INTO users|password_hash|status = 'approved'/.test(query.text)));
});

test('signup ignores arbitrary type values and retains safe optional field and CSV handling', async () => {
  const app = harness();
  assert.equal((await app.request({
    name: '=Name "Formula"', email: 'member@example.test', type: 'admin', level: {}, source: null,
  })).statusCode, 200);
  const insert = app.calls.queries.find(query => query.text.startsWith('INSERT INTO signups'));
  assert.deepEqual(insert.values, ['\'=Name ""Formula""', 'member@example.test', 'join', null, null]);
});

test('signup method/content-type/input errors happen before database writes', async () => {
  const app = harness();
  for (const [body, overrides, status, code] of [
    [{}, { method: 'GET' }, 405, 'METHOD_NOT_ALLOWED'],
    [{}, { headers: {} }, 415, 'INVALID_CONTENT_TYPE'],
    [null, {}, 400, 'VALIDATION_ERROR'],
    [{ name: 'Member' }, {}, 400, 'VALIDATION_ERROR'],
    [{ name: 'Member', email: 'invalid' }, {}, 400, 'VALIDATION_ERROR'],
    [{ name: ' ', email: 'member@example.test' }, {}, 400, 'VALIDATION_ERROR'],
    [{ name: 'a'.repeat(101), email: 'member@example.test' }, {}, 400, 'VALIDATION_ERROR'],
  ]) {
    const res = await app.request(body, overrides);
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code, code);
  }
  const preflight = await app.request(null, { method: 'OPTIONS', headers: {} });
  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.ended, true);
  assert.equal(app.calls.queries.length, 0);
});

test('signup retains the existing five-per-hour email limit', async () => {
  const app = harness({ count: 5 });
  const res = await app.request();
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'RATE_LIMITED');
  assert.equal(app.calls.email.length, 0);
  assert(!app.calls.queries.some(query => query.text.startsWith('INSERT')));
});

test('signup succeeds on confirmation email failure without falsely recording a sent email or leaking the failure', async () => {
  const app = harness({ emailError: new Error('private-email-provider-key') });
  const res = await app.request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert(!app.calls.queries.some(query => query.text.startsWith('INSERT INTO email_log')));
  assert.deepEqual(app.logs, [['Failed to send confirmation email']]);
});

test('signup database failure is explicit and a rejected setup promise is retried on the next request', async () => {
  let attempts = 0;
  const app = harness({ query: query => {
    if (query.text.startsWith('CREATE TABLE IF NOT EXISTS signups') && ++attempts === 1) {
      throw new Error('private-database-connection');
    }
    return query.text.startsWith('SELECT COUNT') ? [{ cnt: 0 }] : [];
  } });
  const failed = await app.request();
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.code, 'SERVER_ERROR');
  assert.deepEqual(app.logs, [['Could not save signup']]);
  assert.equal((await app.request()).statusCode, 200);
  assert.equal((await app.request()).statusCode, 200);
  assert.equal(attempts, 2);
});

test('email audit setup is retried after a transient failure but never breaks a saved signup', async () => {
  let attempts = 0;
  const app = harness({ query: query => {
    if (query.text.startsWith('CREATE TABLE IF NOT EXISTS email_log') && ++attempts === 1) {
      throw new Error('private-audit-connection');
    }
    return query.text.startsWith('SELECT COUNT') ? [{ cnt: 0 }] : [];
  } });
  assert.equal((await app.request()).statusCode, 200);
  assert.equal((await app.request()).statusCode, 200);
  assert.equal(attempts, 2);
  assert.equal(app.calls.queries.filter(query => query.text.startsWith('INSERT INTO email_log')).length, 1);
  assert(!JSON.stringify(app.logs).includes('private-audit-connection'));
});
