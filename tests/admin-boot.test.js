const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('restoring an admin session waits for later dashboard scripts', async () => {
  const listeners = new Map();
  const element = () => ({
    style: {}, dataset: {}, textContent: '', focus() {},
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}
  });
  const nodes = new Map();
  const payload = Buffer.from(JSON.stringify({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'admin',
    iss: 'vienna-admin',
    exp: Math.floor(Date.now() / 1000) + 1800
  })).toString('base64url');
  const token = `header.${payload}.signature`;
  const context = vm.createContext({
    sessionStorage: { getItem: () => token, setItem() {}, removeItem() {} },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async () => { throw new Error('A valid restored token should not refresh during boot.'); },
    document: {
      body: element(),
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
      addEventListener(name, callback) { listeners.set(name, callback); }
    }
  });
  assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-auth.js'), 'utf8'), context));
  let membersLoaded = 0;
  let rankingsRendered = 0;
  context.loadPendingMembers = () => membersLoaded++;
  context.loadPlayersFromAPI = () => Promise.resolve();
  context.render = () => rankingsRendered++;
  assert.equal(membersLoaded, 0);
  await listeners.get('DOMContentLoaded')();
  assert.equal(membersLoaded, 1);
  assert.equal(rankingsRendered, 1);
  assert.equal(nodes.get('loginView').style.display, 'none');
});

test('an authenticated admin request renews once after a 401 and retries with the new token', async () => {
  const listeners = new Map();
  const nodes = new Map();
  const element = () => ({
    style: {}, dataset: {}, textContent: '', focus() {},
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}
  });
  const token = exp => {
    const payload = Buffer.from(JSON.stringify({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'admin',
      iss: 'vienna-admin',
      exp
    })).toString('base64url');
    return `header.${payload}.signature`;
  };
  const oldToken = token(Math.floor(Date.now() / 1000) + 1800);
  const newToken = token(Math.floor(Date.now() / 1000) + 3600);
  const storage = new Map([['vi_admin_token', oldToken]]);
  const calls = [];
  let protectedCalls = 0;
  const context = vm.createContext({
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/admin-refresh') {
        return { ok: true, status: 200, json: async () => ({ token: newToken }) };
      }
      protectedCalls++;
      return protectedCalls === 1
        ? { ok: false, status: 401, json: async () => ({ code: 'INVALID_TOKEN' }) }
        : { ok: true, status: 200, json: async () => ({ members: [] }) };
    },
    document: {
      body: element(),
      querySelectorAll: () => [],
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
      addEventListener(name, callback) { listeners.set(name, callback); }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-auth.js'), 'utf8'), context);
  const response = await context.adminFetch('/api/admin/members?status=all', { cache: 'no-store' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.url), [
    '/api/admin/members?status=all',
    '/api/admin-refresh',
    '/api/admin/members?status=all'
  ]);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + oldToken);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer ' + newToken);
  assert.equal(storage.get('vi_admin_token'), newToken);
  assert.equal(calls[1].options.credentials, 'include');
});

test('boot exchanges an existing member session for admin access without a password', async () => {
  const listeners = new Map();
  const nodes = new Map();
  const storage = new Map();
  const classes = () => {
    const values = new Set();
    return {
      add: value => values.add(value),
      remove: value => values.delete(value),
      toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
      contains: value => values.has(value)
    };
  };
  const element = () => ({
    style: {}, dataset: {}, hidden: false, disabled: false, textContent: '', focus() {},
    classList: classes(), addEventListener() {}
  });
  const payload = Buffer.from(JSON.stringify({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'admin',
    iss: 'vienna-admin',
    exp: Math.floor(Date.now() / 1000) + 1800
  })).toString('base64url');
  const token = `header.${payload}.signature`;
  const calls = [];
  const context = vm.createContext({
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/admin-refresh') {
        return { ok: false, status: 401, json: async () => ({ code: 'INVALID_ADMIN_REFRESH_TOKEN' }) };
      }
      if (url === '/api/admin-login') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token, admin: { display_name: 'Christoph Kopka' } })
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    document: {
      body: element(),
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
      addEventListener(name, callback) { listeners.set(name, callback); }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-auth.js'), 'utf8'), context);
  let membersLoaded = 0;
  context.loadPendingMembers = () => membersLoaded++;
  context.loadPlayersFromAPI = () => Promise.resolve();
  context.render = () => {};

  await listeners.get('DOMContentLoaded')();
  assert.deepEqual(calls.map(call => call.url), ['/api/admin-refresh', '/api/admin-login']);
  assert.equal(storage.get('vi_admin_token'), token);
  assert.equal(nodes.get('loginView').style.display, 'none');
  assert.equal(nodes.get('dashboardView').classList.contains('active'), true);
  assert.equal(membersLoaded, 1);
  assert(!calls.some(call => call.options.body));
});
