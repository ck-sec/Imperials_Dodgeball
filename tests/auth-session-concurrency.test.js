const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../lib/auth');
const sessions = require('../lib/auth-sessions');
const recovery = require('../lib/password-reset');
const validation = require('../lib/validation');
const { loadModule, response, json } = require('./auth-test-helpers');

const userId = '00000000-0000-4000-8000-000000000001';
const oldRefresh = '11'.repeat(32);
const oldRefreshHash = auth.hashRefreshToken(oldRefresh);
const resetHash = recovery.hashResetToken('22'.repeat(32));
const oldPasswordHash = 'previous-bcrypt-hash';
const newPasswordHash = 'replacement-bcrypt-hash';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// A single-member, lazy-query Neon model: snapshots refresh after the shared row lock.
// SQL guards/order are checked independently in auth-sessions.test.js.
function database() {
  let now = Date.parse('2026-01-01T00:00:00Z');
  let state = {
    user: { id: userId, email: 'member@example.test', display_name: 'Member',
      ranking_player_name: 'Player', password_hash: oldPasswordHash, status: 'approved',
      is_active: true, is_email_verified: false, last_login: null },
    refresh: new Map([[oldRefreshHash, { id: 'old-refresh', user_id: userId, expires_at: now + 3600000 }]]),
    reset: new Map([[resetHash, { user_id: userId, expires_at: now + 1800000 }]]),
  };
  let tail = Promise.resolve();
  const pauses = new Map();
  const events = [];
  const waiters = new Map();
  let failKind;
  const emit = event => {
    events.push(event);
    const count = events.filter(value => value === event).length;
    const pending = [];
    for (const waiter of waiters.get(event) || []) {
      if (count >= waiter.count) waiter.resolve();
      else pending.push(waiter);
    }
    waiters.set(event, pending);
  };
  const publicUser = user => ({
    id: user.id, email: user.email, display_name: user.display_name,
    ranking_player_name: user.ranking_player_name, is_active: user.is_active, status: user.status,
  });
  const sql = (strings, ...values) => {
    const query = { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
    return {
      ...query,
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          assert.match(query.text, /FROM users WHERE email = \?$/);
          return state.user.email === values[0] ? [structuredClone(state.user)] : [];
        }).then(resolve, reject);
      },
    };
  };
  sql.transaction = async (queries, options) => {
    assert.deepEqual(options, { isolationLevel: 'ReadCommitted' });
    assert.equal(queries.length, 2);
    const [lock, write] = queries;
    assert.match(lock.text, /FROM users/);
    assert.match(lock.text, /FOR UPDATE(?: OF u)?$/);
    const kind = write.text.startsWith('WITH authenticated') ? 'login'
      : write.text.startsWith('WITH candidate') ? 'refresh' : 'reset';
    const owner = kind === 'login' ? lock.values[0]
      : (kind === 'refresh' ? state.refresh : state.reset).get(lock.values[0])?.user_id;
    if (owner !== state.user.id) return [[], []];
    const released = deferred();
    const previous = tail;
    tail = released.promise;
    emit(`waiting:${kind}`);
    await previous;
    try {
      emit(`locked:${kind}`);
      const pause = pauses.get(kind);
      if (pause) {
        pauses.delete(kind);
        pause.reached.resolve();
        await pause.release.promise;
      }
      const next = structuredClone(state);
      const user = next.user;
      let rows = [];
      if (kind === 'login') {
        const [id, observedHash, refreshHash, expiresAt] = write.values;
        if (user.id === id && user.password_hash === observedHash) {
          if (user.is_active) {
            user.last_login = now;
            if (refreshHash !== null) {
              next.refresh.set(refreshHash, { id: refreshHash, user_id: id, expires_at: Date.parse(expiresAt) });
            }
          }
          rows = [publicUser(user)];
        }
      } else if (kind === 'refresh') {
        const [oldHash, newHash, expiresAt] = write.values;
        const old = next.refresh.get(oldHash);
        if (old && old.expires_at > now) {
          if (user.is_active) {
            next.refresh.delete(oldHash);
            next.refresh.set(newHash, { id: newHash, user_id: user.id, expires_at: Date.parse(expiresAt) });
          } else {
            for (const [hash, item] of next.refresh) if (item.user_id === user.id) next.refresh.delete(hash);
          }
          rows = [{ ...publicUser(user), user_id: user.id }];
        }
      } else {
        assert.match(write.text, /^WITH consumed AS/);
        const [hash, passwordHash] = write.values;
        const token = next.reset.get(hash);
        if (token && token.expires_at > now
          && (user.status === 'pending' || (user.status === 'approved' && user.is_active))) {
          next.reset.delete(hash);
          user.password_hash = passwordHash;
          for (const [hash, item] of next.refresh) if (item.user_id === user.id) next.refresh.delete(hash);
          rows = [{ id: user.id }];
        }
      }
      if (failKind === kind) {
        failKind = undefined;
        throw new Error('private-transaction-failure');
      }
      state = next;
      emit(`committed:${kind}`);
      return [[{ id: owner }], rows];
    } finally {
      released.resolve();
    }
  };
  return {
    sql, events,
    get state() { return state; },
    advance(milliseconds) { now += milliseconds; },
    failCommit(kind) { failKind = kind; },
    waitFor(event, count = 1) {
      if (events.filter(value => value === event).length >= count) return Promise.resolve();
      const waiter = deferred();
      waiters.set(event, [...(waiters.get(event) || []), { ...waiter, count }]);
      return waiter.promise;
    },
    pauseAfterLock(kind) {
      const pause = { reached: deferred(), release: deferred() };
      pauses.set(kind, pause);
      return { reached: pause.reached.promise, release: pause.release.resolve };
    },
  };
}

function application(db, options = {}) {
  let tokenNumber = 100;
  const calls = { access: [], compare: [], attempts: [], clear: [] };
  const mocks = {
    bcryptjs: { compare: async (...args) => {
      calls.compare.push(args);
      return options.compare ? options.compare(...args) : true;
    } },
    '../db': { getDb: () => db.sql },
    '../cors': { setCors() {} },
    '../validation': validation,
    '../auth-sessions': sessions,
    '../auth': {
      ...auth,
      generateRefreshToken: () => (++tokenNumber).toString(16).padStart(64, '0'),
      createAccessToken: user => { calls.access.push(user.id); return 'offline-access-token'; },
    },
    '../rate-limit': {
      checkRateLimit: async () => options.rateLimit || { limited: false },
      recordAttempt: async key => { calls.attempts.push(key); },
      clearAttempts: async key => { calls.clear.push(key); },
    },
  };
  const login = loadModule('lib\\auth-handlers\\login.js', mocks);
  const refresh = loadModule('lib\\auth-handlers\\refresh.js', mocks);
  async function request(handler, req) {
    const res = response();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, ...req }, res);
    return res;
  }
  return {
    calls, logs: { login: login.logs, refresh: refresh.logs },
    login: (body = {}) => request(login.exports, {
      body: { email: 'member@example.test', password: 'Password123', remember_me: true, ...body },
    }),
    refresh: (raw = oldRefresh) => request(refresh.exports, { headers: { cookie: `refresh_token=${raw}` } }),
  };
}

function refreshCookie(res) {
  const cookie = res.headers['Set-Cookie']?.find(value => value.startsWith('refresh_token='));
  return cookie?.split(';')[0].slice('refresh_token='.length);
}

function assertDenied(res, code) {
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, code);
  assert.equal(res.headers['Set-Cookie'], undefined);
}

test('reset during bcrypt invalidates the observed password for remembered and session-only login', { timeout: 5000 }, async () => {
  for (const remember_me of [true, false]) {
    const db = database();
    const comparing = deferred();
    const finishCompare = deferred();
    const app = application(db, { compare: async () => {
      comparing.resolve();
      await finishCompare.promise;
      return true;
    } });
    const pending = app.login({ remember_me });
    await comparing.promise;
    assert.equal(await recovery.consumeResetToken(db.sql, resetHash, newPasswordHash), true);
    finishCompare.resolve();
    assertDenied(await pending, 'INVALID_CREDENTIALS');
    assert.equal(db.state.user.password_hash, newPasswordHash);
    assert.equal(db.state.refresh.size, 0);
    assert.equal(db.state.user.last_login, null);
    assert.equal(app.calls.access.length, 0);
    assert.deepEqual(app.calls.compare, [[auth.preHashPassword('Password123'), oldPasswordHash]]);
  }
});

test('login already waiting on reset user lock revalidates using a fresh post-reset snapshot', { timeout: 5000 }, async () => {
  const db = database();
  const pause = db.pauseAfterLock('reset');
  const resetting = recovery.consumeResetToken(db.sql, resetHash, newPasswordHash);
  await pause.reached;
  const app = application(db);
  const loggingIn = app.login();
  await db.waitFor('waiting:login');
  assert.equal(db.events.includes('locked:login'), false);
  pause.release();
  assert.equal(await resetting, true);
  assertDenied(await loggingIn, 'INVALID_CREDENTIALS');
  assert.equal(db.state.refresh.size, 0);
  assert(db.events.indexOf('committed:reset') < db.events.indexOf('locked:login'));
});

test('login that commits first cannot leave its newly issued refresh token alive after reset', { timeout: 5000 }, async () => {
  const db = database();
  const app = application(db);
  const pause = db.pauseAfterLock('login');
  const loggingIn = app.login();
  await pause.reached;
  const resetting = recovery.consumeResetToken(db.sql, resetHash, newPasswordHash);
  await db.waitFor('waiting:reset');
  assert.equal(db.events.includes('locked:reset'), false);
  pause.release();
  const res = await loggingIn;
  assert.equal(res.statusCode, 200);
  assert.equal(await resetting, true);
  assert.equal(db.state.refresh.size, 0);
  assertDenied(await app.refresh(refreshCookie(res)), 'INVALID_REFRESH_TOKEN');
  assert(db.events.indexOf('committed:login') < db.events.indexOf('locked:reset'));
});

test('refresh waiting on reset cannot rotate the old token from its earlier lock-query snapshot', { timeout: 5000 }, async () => {
  const db = database();
  const pause = db.pauseAfterLock('reset');
  const resetting = recovery.consumeResetToken(db.sql, resetHash, newPasswordHash);
  await pause.reached;
  const app = application(db);
  const refreshing = app.refresh();
  await db.waitFor('waiting:refresh');
  assert.equal(db.events.includes('locked:refresh'), false);
  pause.release();
  assert.equal(await resetting, true);
  assertDenied(await refreshing, 'INVALID_REFRESH_TOKEN');
  assert.equal(app.calls.access.length, 0);
  assert.equal(db.state.refresh.size, 0);
});

test('refresh that commits first is fully revoked by the waiting reset, including its replacement', { timeout: 5000 }, async () => {
  const db = database();
  const app = application(db);
  const pause = db.pauseAfterLock('refresh');
  const refreshing = app.refresh();
  await pause.reached;
  const resetting = recovery.consumeResetToken(db.sql, resetHash, newPasswordHash);
  await db.waitFor('waiting:reset');
  pause.release();
  const res = await refreshing;
  assert.equal(res.statusCode, 200);
  assert.equal(await resetting, true);
  assert.equal(db.state.refresh.size, 0);
  assertDenied(await app.refresh(refreshCookie(res)), 'INVALID_REFRESH_TOKEN');
});

test('concurrent refresh requests consume the same old token only once under the shared lock', { timeout: 5000 }, async () => {
  const db = database();
  const first = application(db);
  const second = application(db);
  const pause = db.pauseAfterLock('refresh');
  const one = first.refresh();
  await pause.reached;
  const two = second.refresh();
  await db.waitFor('waiting:refresh', 2);
  assert.equal(db.events.filter(event => event === 'locked:refresh').length, 1);
  pause.release();
  const [accepted, rejected] = await Promise.all([one, two]);
  assert.equal(accepted.statusCode, 200);
  assertDenied(rejected, 'INVALID_REFRESH_TOKEN');
  assert.equal(db.state.refresh.size, 1);
  assert.equal(db.state.refresh.has(oldRefreshHash), false);
  assert.equal(second.calls.access.length, 0);
  assertDenied(await first.refresh(), 'INVALID_REFRESH_TOKEN');
});

test('refresh rechecks expiry after waiting instead of trusting transaction-start time', { timeout: 5000 }, async () => {
  const db = database();
  const app = application(db);
  const pause = db.pauseAfterLock('refresh');
  const refreshing = app.refresh();
  await pause.reached;
  db.advance(3600001);
  pause.release();
  assertDenied(await refreshing, 'INVALID_REFRESH_TOKEN');
  assert.equal(app.calls.access.length, 0);
});

test('login preserves pending/rejected/inactive responses and never changes approval state', async () => {
  for (const [status, code, httpStatus] of [
    ['pending', 'PENDING_APPROVAL', 403],
    ['rejected', 'REJECTED', 403],
    ['approved', 'INVALID_CREDENTIALS', 401],
  ]) {
    const db = database();
    db.state.user.status = status;
    db.state.user.is_active = false;
    const app = application(db);
    const res = await app.login();
    assert.equal(res.statusCode, httpStatus);
    assert.equal(res.body.code, code);
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.equal(db.state.user.status, status);
    assert.equal(db.state.user.is_active, false);
    assert.equal(db.state.user.last_login, null);
    assert.equal(db.state.refresh.size, 1);
  }
});

test('approval/deactivation changes during bcrypt are checked from the locked current account', { timeout: 5000 }, async () => {
  const db = database();
  const comparing = deferred();
  const finish = deferred();
  const app = application(db, { compare: async () => {
    comparing.resolve();
    await finish.promise;
    return true;
  } });
  const pending = app.login();
  await comparing.promise;
  db.state.user.is_active = false;
  db.state.user.status = 'pending';
  finish.resolve();
  const res = await pending;
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'PENDING_APPROVAL');
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('deactivated refresh preserves its error and revokes the member tokens without issuing a replacement', async () => {
  const db = database();
  db.state.user.is_active = false;
  const app = application(db);
  const res = await app.refresh();
  assertDenied(res, 'INVALID_REFRESH_TOKEN');
  assert.equal(res.body.error, 'Account deactivated');
  assert.equal(db.state.refresh.size, 0);
  assert.equal(db.state.user.is_active, false);
  assert.equal(db.state.user.status, 'approved');
});

test('successful login/refresh preserve response shape, cookie paths, remember-me and the access TTL', async () => {
  for (const remember_me of [true, false]) {
    const db = database();
    const app = application(db);
    const res = await app.login({ email: ' MEMBER@Example.test ', remember_me });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res.body), {
      user: { id: userId, email: 'member@example.test', display_name: 'Member', ranking_player_name: 'Player' },
    });
    const cookies = res.headers['Set-Cookie'];
    assert.equal(cookies.length, remember_me ? 2 : 1);
    assert(cookies[0].includes('Path=/api; Max-Age=900'));
    assert.equal(db.state.refresh.size, remember_me ? 2 : 1);
    assert.equal(db.state.user.status, 'approved');
    assert.equal(db.state.user.is_email_verified, false);
    if (remember_me) {
      assert(cookies[1].includes('Path=/api/auth; Max-Age=604800'));
      const refreshed = await app.refresh(refreshCookie(res));
      assert.equal(refreshed.statusCode, 200);
      assert.deepEqual(json(refreshed.body), json(res.body));
    }
  }
  assert.equal(auth.ACCESS_TOKEN_EXPIRY, '15m');
});

test('transaction rollback never sets cookies, consumes old tokens, updates last_login or logs private errors', async () => {
  for (const action of ['login', 'refresh']) {
    const db = database();
    const before = structuredClone(db.state);
    db.failCommit(action);
    const app = application(db);
    const res = await app[action]();
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'SERVER_ERROR');
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.deepEqual(db.state, before);
    assert.equal(app.calls.access.length, 0);
    assert.deepEqual(app.logs[action], [[action === 'login' ? 'Login failed' : 'Token refresh failed']]);
  }
});

test('wrong passwords and existing rate limits reject before session transactions', async () => {
  const db = database();
  const wrong = application(db, { compare: async () => false });
  assertDenied(await wrong.login(), 'INVALID_CREDENTIALS');
  assert.equal(db.events.length, 0);
  const limited = application(db, { rateLimit: { limited: true, retryAfter: 123 } });
  for (const action of ['login', 'refresh']) {
    const res = await limited[action]();
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.code, 'RATE_LIMITED');
    assert.equal(res.body[action === 'login' ? 'retry_after' : 'retryAfter'], 123);
  }
  assert.equal(db.events.length, 0);
});
