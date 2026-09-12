const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../lib/auth');
const validation = require('../lib/validation');
const { loadModule, response, json } = require('./auth-test-helpers');

const actions = ['login', 'logout', 'refresh', 'register', 'password-reset'];

function dispatcher(handlerFactory) {
  const dependencies = { '../../lib/cors': { setCors() {} } };
  for (const action of actions) {
    dependencies[`../../lib/auth-handlers/${action}`] = handlerFactory(action);
  }
  return loadModule('api\\auth\\[action].js', dependencies).exports;
}

function offlineHandler(action) {
  const forbidden = () => { throw new Error('External services are forbidden in dispatcher tests'); };
  return loadModule(`lib\\auth-handlers\\${action}.js`, {
    bcryptjs: { compare: forbidden, hash: forbidden },
    '../db': { getDb: forbidden },
    '../cors': { setCors() {} },
    '../auth': auth,
    '../auth-sessions': require('../lib/auth-sessions'),
    '../validation': validation,
    '../rate-limit': { checkRateLimit: forbidden, recordAttempt: forbidden, clearAttempts: forbidden },
    '../password-reset': require('../lib/password-reset'),
    '../email-templates': require('../lib/email-templates'),
    '../email': { getResend: forbidden, sendPasswordResetEmail: forbidden },
  }).exports;
}

test('dispatcher routes exactly the five allowed URL actions and forwards the original request/response', async () => {
  const calls = [];
  const handle = dispatcher(action => async (req, res) => {
    calls.push({ action, req, res });
    return res.status(201).json({ selected: action });
  });
  for (const action of actions) {
    const req = { method: 'POST', headers: {}, query: { action }, body: { action: 'request' } };
    const res = response();
    assert.equal(await handle(req, res), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.selected, action);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(calls.at(-1).req, req);
    assert.equal(calls.at(-1).res, res);
  }
  assert.deepEqual(calls.map(call => call.action), actions);
});

test('unknown actions, arrays, traversal and prototype property names are always 404 without dispatch', async () => {
  const handle = dispatcher(() => () => { throw new Error('Invalid route dispatched'); });
  for (const action of [
    undefined, null, '', ' ', 1, {}, [], ['login'], ['login', 'logout'],
    'unknown', 'LOGIN', 'login.js', '../login', 'password-reset/reset',
    '__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty',
  ]) {
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const res = response();
      await handle({ method, headers: {}, query: { action }, body: { action: 'login' } }, res);
      assert.equal(res.statusCode, 404, `${method} ${String(action)}`);
      assert.deepEqual(json(res.body), { error: 'Not found', code: 'NOT_FOUND' });
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
  }
  const missing = response();
  await handle({ method: 'POST', headers: {}, body: { action: 'login' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('password-reset body action remains separate from the Vercel route action', async () => {
  const calls = [];
  const handle = dispatcher(action => (req, res) => {
    calls.push([action, req.body.action, req.query.action]);
    return res.json({ success: true });
  });
  for (const action of ['request', 'reset']) {
    await handle({
      method: 'POST', headers: {}, query: { action: 'password-reset' },
      body: { action, email: 'member@example.test', token: 'ab'.repeat(32), password: 'Password123' },
    }, response());
  }
  assert.deepEqual(calls, [
    ['password-reset', 'request', 'password-reset'],
    ['password-reset', 'reset', 'password-reset'],
  ]);
});

test('moved real handlers preserve POST/OPTIONS and reject other methods identically', async () => {
  const handle = dispatcher(offlineHandler);
  for (const action of actions) {
    const preflight = response();
    await handle({ method: 'OPTIONS', headers: {}, query: { action } }, preflight);
    assert.equal(preflight.statusCode, 200);
    assert.equal(preflight.ended, true);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const res = response();
      await handle({ method, headers: {}, query: { action } }, res);
      assert.equal(res.statusCode, 405);
      assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
    }
  }
});

test('moved real handlers retain their distinct POST validation and logout/refresh behavior', async () => {
  const handle = dispatcher(offlineHandler);
  for (const [action, status, code] of [
    ['login', 400, 'VALIDATION_ERROR'],
    ['logout', 200, undefined],
    ['refresh', 401, 'NO_REFRESH_TOKEN'],
    ['register', 400, 'VALIDATION_ERROR'],
    ['password-reset', 400, 'VALIDATION_ERROR'],
  ]) {
    const res = response();
    await handle({
      method: 'POST', headers: { 'content-type': 'application/json' }, query: { action }, body: {},
    }, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code, code);
    if (action === 'logout') {
      assert.deepEqual(json(res.body), { success: true });
      assert.equal(res.headers['Set-Cookie'].length, 2);
    }
  }
  for (const action of ['login', 'register', 'password-reset']) {
    const res = response();
    await handle({ method: 'POST', headers: {}, query: { action }, body: {} }, res);
    assert.equal(res.statusCode, 415);
    assert.equal(res.body.code, 'INVALID_CONTENT_TYPE');
  }
});

test('dispatcher preserves asynchronous completion and rejection', async () => {
  const error = new Error('handler failure');
  const handle = dispatcher(() => async () => { throw error; });
  await assert.rejects(handle({ headers: {}, query: { action: 'login' } }, response()), error);
});

test('all moved relative imports resolve and only one auth file remains in the API deployment tree', () => {
  const root = path.join(__dirname, '..');
  assert.deepEqual(fs.readdirSync(path.join(root, 'api', 'auth')), ['[action].js']);
  for (const action of actions) {
    const filename = path.join(root, 'lib', 'auth-handlers', `${action}.js`);
    const source = fs.readFileSync(filename, 'utf8');
    for (const [, relative] of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      assert(fs.existsSync(path.resolve(path.dirname(filename), `${relative}.js`)), `${action}: ${relative}`);
    }
    assert.equal(fs.existsSync(path.join(root, 'api', 'auth', `${action}.js`)), false);
  }
});

test('plain API function count stays within the current twelve-function plan', () => {
  function functionsIn(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? functionsIn(filename) : /\.(?:[cm]?js|ts)$/.test(entry.name) ? [filename] : [];
    });
  }
  const files = functionsIn(path.join(__dirname, '..', 'api'));
  assert(files.length <= 12, `Found ${files.length} API functions, exceeding the plan limit`);
});
