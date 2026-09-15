const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'member.html'), 'utf8');
const source = name => fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8');

function element(id = '') {
  const classes = new Set();
  const attributes = {};
  return {
    id, dataset: {}, value: '', checked: false, disabled: false, hidden: false, open: false,
    textContent: '', innerHTML: '', type: '', listeners: {}, style: {},
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    removeAttribute(name) { delete attributes[name]; },
    focus() { this.focused = true; },
    showModal() { this.open = true; }, close() { this.open = false; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
}

function fixtureApp(options = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = element(match[3]);
    node.hidden = /\bhidden\b/.test(match[2]);
    node.type = (/\btype="([^"]+)"/.exec(match[2]) || [])[1] || '';
    const tab = /\bdata-tab="([^"]+)"/.exec(match[2]);
    if (tab) node.dataset.tab = tab[1];
    elements.set(node.id, node);
  }
  const docListeners = {};
  const translated = [element('translated')];
  translated[0].dataset = { de: 'Training wählen', en: 'Choose training' };
  const tabs = ['training', 'league', 'account'].map(name => elements.get('tabButton-' + name));
  const panels = ['training', 'league', 'account'].map(name => elements.get('tab-' + name));
  const tablist = element();
  const resetToggle = element();
  resetToggle.setAttribute('aria-controls', 'resetPassword');
  elements.get('resetForm').querySelectorAll = selector => {
    if (selector === '.password-toggle') return [resetToggle];
    if (selector === '.field-error') return ['resetPasswordError', 'resetConfirmError'].map(id => elements.get(id));
    if (selector === '[aria-invalid]') return ['resetPassword', 'resetConfirm'].map(id => elements.get(id));
    return [];
  };
  const document = {
    activeElement: null,
    documentElement: { lang: 'de' },
    getElementById: id => elements.get(id),
    querySelectorAll(selector) {
      if (selector === '.dash-tab') return tabs;
      if (selector === '.tab-panel') return panels;
      if (selector === '[data-de][data-en]') return translated;
      if (selector === 'input[type="password"]') return [...elements.values()].filter(node => node.type === 'password');
      return [];
    },
    querySelector: selector => selector === '.dash-tabs' ? tablist : null,
    addEventListener(name, fn) { (docListeners[name] ||= []).push(fn); },
    dispatchEvent(event) { for (const listener of docListeners[event.type] || []) listener(event); }
  };
  const requests = [];
  const history = [];
  const redirects = [];
  const storage = options.storage || new Map();
  const timers = [];
  const logs = [];
  const windowEvents = new EventTarget();
  let lang = options.lang || 'de';
  const window = {
    location: {
      hash: options.hash || '', pathname: '/member.html', search: options.search === undefined ? '?from=mail' : options.search,
      replace: target => redirects.push(target)
    },
    history: { replaceState(...args) { history.push(args); window.location.hash = ''; } },
    addEventListener: (...args) => windowEvents.addEventListener(...args),
    dispatchEvent: event => windowEvents.dispatchEvent(event),
    SiteLanguage: {
      get: () => lang,
      set(value) { lang = value; document.dispatchEvent({ type: 'site-language-change', detail: { lang } }); }
    }
  };
  const context = vm.createContext({
    window, document, URLSearchParams, Intl, Date, Set, Map, Event,
    console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    sessionStorage: {
      getItem(key) { if (options.blockStorage) throw new Error('Storage blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (options.blockStorage) throw new Error('Storage blocked'); storage.set(key, value); },
      removeItem(key) { if (options.blockStorage) throw new Error('Storage blocked'); storage.delete(key); }
    },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      return options.fetch ? options.fetch(url, opts) : { ok: true, status: 200, json: async () => ({}) };
    }
  });
  ['member-recovery-token', 'member-core', 'member-auth', 'league-scoring', 'league-ui', 'member-league', 'member-dashboard', 'member-training'].forEach(name =>
    vm.runInContext(source(name), context, { filename: name + '.js' }));
  vm.runInContext(source('member-init').replace(/\ninitMember\(\);\s*$/, ''), context, { filename: 'member-init.js' });
  return {
    context, window, elements, requests, history, redirects, storage, timers, logs, translated, tabs, panels, tablist, resetToggle,
    hashChange(hash) {
      window.location.hash = hash;
      window.dispatchEvent(new Event('hashchange'));
    },
    run: code => vm.runInContext(code, context),
    node: id => elements.get(id)
  };
}

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const submit = { preventDefault() {} };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const session = { id: 'session-a', title: 'Training', session_date: '2099-09-17', start_time: '19:00', end_time: '21:00', attending_count: 1, my_status: 'pending' };
const ownEvent = {
  id: 'league-a', season_id: 'autumn', session_id: 'session-a', title: 'Training', session_date: '2099-09-17',
  start_time: '19:00', end_time: '21:00', team_size: 1, status: 'published', my_team_number: 2,
  teams: [
    { number: 1, name: 'Gold', players: [{ display_name: 'Same Name', id: 'private-player-a' }] },
    { number: 2, name: 'Navy', players: [{ display_name: 'Same Name', id: 'private-player-b' }] },
    { number: 3, name: 'Red', players: [{ display_name: 'Guest <script>', rating: 900 }] }
  ],
  schedule: {
    duration_minutes: 60, available_minutes: 120, match_minutes: 20, break_minutes: 0,
    rounds: [
      { number: 1, start_minute: 0, end_minute: 20, bye_teams: [3], matches: [{ number: 1, team_a: 1, team_b: 2, court: 1, score_a: 2, score_b: 1 }] },
      { number: 2, start_minute: 20, end_minute: 40, bye_teams: [1], matches: [{ number: 2, team_a: 2, team_b: 3, court: 2, score_a: null, score_b: null }] },
      { number: 3, start_minute: 40, end_minute: 60, bye_teams: [2], matches: [{ number: 3, team_a: 1, team_b: 3, court: 1, score_a: null, score_b: null }] }
    ]
  }
};
const season = {
  id: 'autumn', name: 'Autumn', start_date: '2099-09-01', end_date: '2099-12-01',
  scoring_mode: 'fixed', placement_points: [3, 2, 1]
};

test('member page is German-first, training-first and versions every local style/script', () => {
  assert.match(html, /<html lang="de">/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.match(html, /data-tab="training" role="tab"[^>]+aria-selected="true"/);
  assert.doesNotMatch(html, /href="\/#training-league"|data-tab="stats"|data-tab="settings"/);
  assert.match(html, /<details[^>]+id="seasonOneArchive"/);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:css|js)[^"]*)"/g)) assert.match(match[1], /\?v=202609(?:12[b-d]?|14[de]?|15)$/);
  assert.ok(html.includes('/league.css?v=20260915'));
  assert.ok(html.includes('/js/league-scoring.js?v=20260912d'));
  assert.ok(html.includes('/js/league-ui.js?v=20260915'));
  assert.ok(html.includes('/js/member-league.js?v=20260915'));
  assert.ok(html.includes('/js/member-core.js?v=20260914'));
  for (const asset of ['/js/member-dashboard.js', '/js/member-init.js']) assert.ok(html.includes(asset + '?v=20260912c'));
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.ok(html.indexOf('member-recovery-token.js') < html.indexOf('<link'));
  assert.doesNotMatch(source('member-auth') + source('member-init') + source('member-recovery-token'), /localStorage|sessionStorage/);
  assert.doesNotMatch(source('member-core'), /localStorage/);
});

const returnEvent = '11111111-1111-4111-8111-111111111111';
const returnPath = '/spieltag?event=' + returnEvent;
const timerReturnPath = '/timer?event=' + returnEvent + '&match=1';
const returnQuery = '?return_to=' + encodeURIComponent(returnPath);
function loginFields(app) {
  app.node('loginEmail').value = 'member@example.test';
  app.node('loginPassword').value = 'normalPassword123';
}

test('central login allowlists only local matchday and timer targets and rejects redirect tricks', () => {
  const app = fixtureApp();
  assert.equal(app.context.safeMemberReturn(returnPath), returnPath);
  assert.equal(app.context.safeMemberReturn('/spieltag'), '/spieltag');
  assert.equal(app.context.safeMemberReturn(timerReturnPath), timerReturnPath);
  assert.equal(app.context.safeMemberReturn('/timer?event=' + returnEvent.toUpperCase() + '&match=10'),
    '/timer?event=' + returnEvent + '&match=10');
  for (const target of [
    '//evil.example', 'https://evil.example/spieltag', 'https://vienna-imperials.at/spieltag',
    '/\\evil.example', '/member', '/admin', '/spieltag/../admin', '/spieltag#token=x',
    '/spieltag?event=' + returnEvent + '&next=https://evil.example',
    '/spieltag?event=' + returnEvent + '&event=' + returnEvent,
    '/spieltag?event=bad', '/timer?match=1&event=' + returnEvent,
    '/timer?event=' + returnEvent + '&match=11',
    '/timer?event=' + returnEvent + '&match=1&next=https://evil.example',
    '/timer?event=' + returnEvent + '&match=1#token=x',
    '/spieltag\n', '%2Fspieltag', null, {}
  ]) assert.equal(app.context.safeMemberReturn(target), '');
});

test('successful normal login returns to the same event without replacing the existing login request', async () => {
  const app = fixtureApp({ search: returnQuery, fetch: () => response({ user: { id: 'approved', display_name: 'Member' } }) });
  app.context.initMemberReturn();
  loginFields(app);
  app.node('rememberMe').checked = true;
  await app.context.handleLogin(submit);
  assert.deepEqual(app.redirects, [returnPath]);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/auth/login');
  assert.equal(app.requests[0].opts.credentials, 'include');
  assert.deepEqual(JSON.parse(app.requests[0].opts.body), { email: 'member@example.test', password: 'normalPassword123', remember_me: true });
  assert.equal(app.node('loginPassword').value, '');
  assert.equal(app.storage.has('vi_member_return'), false);
});

test('an already signed-in member returns immediately after the normal approved-account check', async () => {
  const app = fixtureApp({ search: returnQuery, fetch: () => response({ user: { id: 'approved' } }) });
  await app.context.initMember();
  assert.deepEqual(app.redirects, [returnPath]);
  assert.deepEqual(app.requests.map(request => request.url), ['/api/member/stats?view=account']);
  assert.equal(app.node('memberReturnLink').href, returnPath);
});

test('failed, rate-limited and pending-approval sign-ins never follow the return target', async () => {
  for (const [status, body] of [[401, {}], [429, { retry_after: 5 }], [403, { code: 'PENDING_APPROVAL' }]]) {
    const app = fixtureApp({ search: returnQuery, fetch: () => response(body, status) });
    app.context.initMemberReturn();
    loginFields(app);
    await app.context.handleLogin(submit);
    assert.deepEqual(app.redirects, []);
    assert.equal(app.run('memberReturnTo'), returnPath);
    assert.equal(app.run('currentUser'), null);
    if (status === 403) assert.equal(app.run('currentView'), 'pending');
  }
  const pending = fixtureApp({ search: returnQuery, fetch: () => response({}, 403) });
  await pending.context.initMember();
  assert.deepEqual(pending.redirects, []);
  assert.equal(pending.run('currentView'), 'pending');
});

test('signup keeps the return flow pending until approval and a subsequent successful login', async () => {
  const app = fixtureApp({
    search: returnQuery,
    fetch: url => url === '/api/auth/register' ? response({ pending: true }) : response({ user: { id: 'approved' } })
  });
  app.context.initMemberReturn();
  app.context.showView('register');
  app.node('regName').value = 'New member';
  app.node('regEmail').value = 'new@example.test';
  app.node('regPassword').value = 'newPassword123';
  app.node('regConfirm').value = 'newPassword123';
  await app.context.handleRegister(submit);
  assert.equal(app.run('currentView'), 'pending');
  assert.deepEqual(app.redirects, []);
  assert.equal(app.node('memberReturnLink').href, returnPath);
  app.context.showView('login');
  loginFields(app);
  await app.context.handleLogin(submit);
  assert.deepEqual(app.redirects, [returnPath]);
});

test('password reset retains only the allowlisted target, never redirects before the new login', async () => {
  const token = 'a'.repeat(64);
  const app = fixtureApp({
    search: returnQuery, hash: '#reset=' + token,
    fetch: url => url === '/api/auth/password-reset' ? response({ success: true }) : response({ user: { id: 'approved' } })
  });
  await app.context.initMember();
  assert.equal(app.run('currentView'), 'reset');
  assert.equal(app.requests.length, 0);
  assert.deepEqual(app.redirects, []);
  assert.doesNotMatch(JSON.stringify([...app.storage]), new RegExp(token + '|password|email'));
  app.node('resetPassword').value = 'changedPassword123';
  app.node('resetConfirm').value = 'changedPassword123';
  await app.context.handleResetPassword(submit);
  assert.equal(app.run('currentView'), 'login');
  assert.deepEqual(app.redirects, []);
  loginFields(app);
  await app.context.handleLogin(submit);
  assert.deepEqual(app.redirects, [returnPath]);
});

test('same-tab reset links can recover a short-lived return target but ordinary member visits do not auto-redirect', async () => {
  const storage = new Map([['vi_member_return', JSON.stringify({ target: returnPath, expires: Date.now() + 60000 })]]);
  const reset = fixtureApp({ storage, search: '', hash: '#reset=' + 'b'.repeat(64) });
  await reset.context.initMember();
  assert.equal(reset.run('memberReturnTo'), returnPath);
  assert.deepEqual(reset.redirects, []);
  const ordinary = fixtureApp({ storage, search: '' });
  ordinary.context.initMemberReturn();
  ordinary.run("currentUser = { id: 'member' }");
  assert.equal(ordinary.context.completeMemberReturn(), false);
  const expired = fixtureApp({
    search: '', hash: '#reset=' + 'b'.repeat(64),
    storage: new Map([['vi_member_return', JSON.stringify({ target: returnPath, expires: 1 })]])
  });
  await expired.context.initMember();
  assert.equal(expired.run('memberReturnTo'), '');
});

test('invalid or duplicate return parameters clear old targets; disabled storage does not break a valid login return', async () => {
  const storage = new Map([['vi_member_return', JSON.stringify({ target: returnPath, expires: Date.now() + 60000 })]]);
  const invalid = fixtureApp({ storage, search: returnQuery + '&return_to=%2Fadmin' });
  invalid.context.initMemberReturn();
  invalid.run("currentUser = { id: 'member' }");
  assert.equal(invalid.context.completeMemberReturn(), false);
  assert.equal(storage.has('vi_member_return'), false);
  const app = fixtureApp({ search: returnQuery, blockStorage: true, fetch: () => response({ user: { id: 'approved' } }) });
  app.context.initMemberReturn();
  loginFields(app);
  await app.context.handleLogin(submit);
  assert.deepEqual(app.redirects, [returnPath]);
});

test('reset tokens are captured only in memory and fragments stripped before init', async () => {
  const token = 'a'.repeat(64);
  const app = fixtureApp({ hash: '#reset=' + token });
  assert.equal(app.window.MemberRecovery.getToken(), token);
  assert.deepEqual(app.history[0], [null, '', '/member.html?from=mail']);
  assert.equal(app.window.location.hash, '');
  await app.context.initMember();
  assert.equal(app.run('currentView'), 'reset');
  assert.equal(app.requests.length, 0, 'reset link must not initialize a logged-in dashboard');
  assert.equal(app.node('resetPassword').value, '');
});

test('malformed reset fragments are stripped and cannot be submitted', async () => {
  const app = fixtureApp({ hash: '#reset=not-a-token' });
  await app.context.initMember();
  assert.equal(app.history.length, 1);
  assert.equal(app.window.MemberRecovery.getToken(), null);
  assert.equal(app.node('resetForm').hidden, true);
  assert.match(app.node('resetError').textContent, /ungültig/);
  await app.context.handleResetPassword(submit);
  assert.equal(app.requests.length, 0);
  const navigation = fixtureApp({ hash: '#training' });
  assert.equal(navigation.history.length, 0);
});

test('same-document reset hashchange strips the URL and opens the form without auth requests', () => {
  const app = fixtureApp();
  app.run("currentView = 'recovery'");
  app.node('recoveryForm').hidden = true;
  app.node('recoveryMessage').hidden = false;
  const token = 'b'.repeat(64);
  let notifications = 0;
  app.context.document.addEventListener('member-reset-link', event => {
    notifications++;
    assert.equal(app.window.location.hash, '', 'strip before notifying the UI');
    assert.equal(event.detail, undefined, 'do not include the token in event payloads');
  });
  app.hashChange('#reset=' + token);
  assert.equal(notifications, 1);
  assert.equal(app.window.MemberRecovery.getToken(), token);
  assert.deepEqual(app.history[0], [null, '', '/member.html?from=mail']);
  assert.equal(app.run('currentView'), 'reset');
  assert.equal(app.node('resetView').hidden, false);
  assert.equal(app.node('recoveryView').hidden, true);
  assert.equal(app.node('resetForm').hidden, false);
  assert.equal(app.node('resetBtn').disabled, false);
  assert.equal(app.requests.length, 0);
});

test('new reset hashes clear old credentials/errors and recover from invalid to valid', () => {
  const app = fixtureApp({ hash: '#reset=' + 'a'.repeat(64) });
  app.context.openMemberReset();
  app.node('resetPassword').value = 'oldPassword12';
  app.node('resetConfirm').value = 'oldPassword12';
  app.hashChange('#reset=malformed');
  assert.equal(app.window.location.hash, '');
  assert.equal(app.window.MemberRecovery.getToken(), null);
  assert.equal(app.node('resetForm').hidden, true);
  assert.equal(app.node('resetPassword').value, '');
  assert.equal(app.node('resetConfirm').value, '');
  assert.match(app.node('resetError').textContent, /ungültig/);
  assert.equal(app.node('resetError').focused, true);
  app.node('resetPassword').value = 'discardMe12';
  app.node('resetPassword').type = 'text';
  app.node('resetPassword').setAttribute('aria-invalid', 'true');
  app.resetToggle.setAttribute('aria-pressed', 'true');
  app.resetToggle.textContent = 'Verbergen';
  app.context.fieldError('resetPasswordError', 'Alter Fehler', 'Old error');
  app.context.fieldError('resetConfirmError', 'Noch ein Fehler', 'Another error');
  app.node('resetBtn').disabled = true;
  app.node('resetBtn').dataset.retryUntil = String(Date.now() + 60000);
  const nextToken = 'c'.repeat(64);
  app.hashChange('#reset=' + nextToken);
  assert.equal(app.window.MemberRecovery.getToken(), nextToken);
  assert.equal(app.window.location.hash, '');
  assert.equal(app.node('resetForm').hidden, false);
  assert.equal(app.node('resetBtn').disabled, false);
  assert.equal(app.node('resetBtn').dataset.retryUntil, undefined);
  assert.equal(app.node('resetPassword').value, '');
  assert.equal(app.node('resetConfirm').value, '');
  assert.equal(app.node('resetPassword').type, 'password');
  assert.equal(app.node('resetPassword').getAttribute('aria-invalid'), null);
  assert.equal(app.resetToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(app.resetToggle.textContent, 'Zeigen');
  for (const id of ['resetError', 'resetPasswordError', 'resetConfirmError']) {
    assert.equal(app.node(id).hidden, true);
    assert.equal(app.node(id).textContent, '');
    assert.equal(app.node(id).dataset.de, undefined);
  }
  assert.equal(app.requests.length, 0);
});

test('ordinary hash anchors never strip URLs, replace reset credentials or change views', () => {
  const app = fixtureApp();
  app.run("currentView = 'dashboard'");
  app.hashChange('#training');
  assert.equal(app.window.location.hash, '#training');
  assert.equal(app.history.length, 0);
  assert.equal(app.run('currentView'), 'dashboard');
  const token = 'a'.repeat(64);
  app.hashChange('#reset=' + token);
  app.node('resetPassword').value = 'keepMe123';
  const revision = app.window.MemberRecovery.getRevision();
  app.hashChange('#main-content');
  assert.equal(app.window.location.hash, '#main-content');
  assert.equal(app.history.length, 1);
  assert.equal(app.window.MemberRecovery.getToken(), token);
  assert.equal(app.window.MemberRecovery.getRevision(), revision);
  assert.equal(app.run('currentView'), 'reset');
  assert.equal(app.node('resetPassword').value, 'keepMe123');
});

test('a hash reset supersedes an in-flight account initialization without auto-login', async () => {
  const pending = deferred();
  const app = fixtureApp({ fetch: () => pending.promise });
  const initial = app.context.initMember();
  app.hashChange('#reset=' + 'a'.repeat(64));
  pending.resolve(response({ user: { id: 'member', email: 'member@example.test' } }));
  await initial;
  assert.equal(app.run('currentView'), 'reset');
  assert.equal(app.run('currentUser'), null);
  assert.equal(app.requests.length, 1);
});

test('a superseded reset response cannot invalidate, redirect or enable a new pending reset', async () => {
  for (const oldResponse of [
    response({ code: 'INVALID_RESET_TOKEN' }, 400), response({ success: true })
  ]) {
    const oldRequest = deferred();
    const newRequest = deferred();
    let calls = 0;
    const app = fixtureApp({ fetch: () => ++calls === 1 ? oldRequest.promise : newRequest.promise });
    app.hashChange('#reset=' + 'a'.repeat(64));
    app.node('resetPassword').value = 'firstPassword1';
    app.node('resetConfirm').value = 'firstPassword1';
    const oldSubmit = app.context.handleResetPassword(submit);
    app.hashChange('#reset=' + 'b'.repeat(64));
    app.node('resetPassword').value = 'secondPassword2';
    app.node('resetConfirm').value = 'secondPassword2';
    const newSubmit = app.context.handleResetPassword(submit);
    oldRequest.resolve(oldResponse);
    await oldSubmit;
    assert.equal(app.window.MemberRecovery.getToken(), 'b'.repeat(64));
    assert.equal(app.run('currentView'), 'reset');
    assert.equal(app.node('resetPassword').value, 'secondPassword2');
    assert.equal(app.node('resetBtn').disabled, true);
    assert.equal(app.node('resetError').hidden, true);
    newRequest.resolve(response({ success: true }));
    await newSubmit;
    assert.equal(app.run('currentView'), 'login');
    assert.equal(app.window.MemberRecovery.getToken(), null);
  }
});

test('password contract requires length 8–128, letter and digit', () => {
  const app = fixtureApp();
  for (const password of ['abcdefghi', '12345678', 'Abc1234', 'A1' + 'x'.repeat(127)]) {
    assert.equal(app.context.validPassword(password), false);
  }
  assert.equal(app.context.validPassword('abcd1234'), true);
  assert.equal(app.context.validPassword('A1' + 'x'.repeat(126)), true);
});

test('password recovery confirmation is generic and never echoes provider errors or email', async () => {
  const app = fixtureApp({ fetch: () => response({ success: true, error: 'A known fixture@example.test user exists' }) });
  app.node('recoveryEmail').value = 'fixture@example.test';
  await app.context.handleRecovery(submit);
  assert.deepEqual(JSON.parse(app.requests[0].opts.body), { action: 'request', email: 'fixture@example.test' });
  assert.match(app.node('recoveryMessage').textContent, /Falls ein berechtigtes Konto existiert/);
  assert.doesNotMatch(app.node('recoveryMessage').textContent, /fixture@example|known/);
  assert.equal(app.node('recoveryForm').hidden, true);
});

test('successful reset clears the token and password without signing in', async () => {
  const token = 'B'.repeat(64);
  const app = fixtureApp({ hash: '#reset=' + token, fetch: () => response({ success: true }) });
  app.run("currentView = 'reset'");
  app.node('resetPassword').value = 'password12';
  app.node('resetConfirm').value = 'password12';
  await app.context.handleResetPassword(submit);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/auth/password-reset');
  assert.deepEqual(JSON.parse(app.requests[0].opts.body), { action: 'reset', token, password: 'password12' });
  assert.equal(app.window.MemberRecovery.getToken(), null);
  assert.equal(app.node('resetPassword').value, '');
  assert.equal(app.node('resetConfirm').value, '');
  assert.equal(app.run('currentUser'), null);
  assert.equal(app.run('currentView'), 'login');
  assert.match(app.node('loginMessage').textContent, /neu an/);
});

test('reset handles weak, invalid, rate-limited and unavailable responses explicitly', async () => {
  for (const [code, status, pattern] of [
    ['WEAK_PASSWORD', 400, /8–128/], ['INVALID_RESET_TOKEN', 400, /ungültig/],
    ['SERVICE_UNAVAILABLE', 503, /nicht erreichbar/], ['VALIDATION_ERROR', 400, /Eingaben/],
    ['INVALID_CONTENT_TYPE', 415, /neu/], ['RATE_LIMITED', 429, /23 Sekunden/]
  ]) {
    const app = fixtureApp({ hash: '#reset=' + 'a'.repeat(64), fetch: () => response({ code, retry_after: 23 }, status) });
    app.node('resetPassword').value = 'password12';
    app.node('resetConfirm').value = 'password12';
    await app.context.handleResetPassword(submit);
    assert.match(app.node('resetError').textContent, pattern);
    assert.equal(app.node('resetBtn').disabled, code === 'RATE_LIMITED');
    if (code === 'INVALID_RESET_TOKEN') {
      assert.equal(app.window.MemberRecovery.getToken(), null);
      assert.equal(app.node('resetForm').hidden, true);
    }
  }
});

test('leaving reset discards sensitive in-memory credentials', () => {
  const app = fixtureApp({ hash: '#reset=' + 'a'.repeat(64) });
  app.run("currentView = 'reset'");
  app.node('resetPassword').value = 'password12';
  app.node('resetConfirm').value = 'password12';
  app.context.showView('login');
  assert.equal(app.window.MemberRecovery.getToken(), null);
  assert.equal(app.node('resetPassword').value, '');
  assert.equal(app.node('resetConfirm').value, '');
});

test('pending approval sign-in cannot enter training and remains retryable', async () => {
  const app = fixtureApp({ fetch: () => response({ code: 'PENDING_APPROVAL' }, 403) });
  app.node('loginEmail').value = 'member@example.test';
  app.node('loginPassword').value = 'password12';
  await app.context.handleLogin(submit);
  assert.equal(app.run('currentView'), 'pending');
  assert.equal(app.run('currentUser'), null);
  assert.equal(app.node('loginBtn').disabled, false);
  assert.equal(app.requests.length, 1);
});

test('failed logout is visible and does not falsely claim that secure cookies were cleared', async () => {
  const app = fixtureApp({ fetch: () => response({}, 503) });
  app.run("currentView = 'dashboard'; currentUser = { id: 'member' }");
  await app.context.handleLogout();
  assert.equal(app.run('currentUser.id'), 'member');
  assert.equal(app.run('currentView'), 'dashboard');
  assert.match(app.node('accountMessage').textContent, /noch aktiv/);
});

test('authenticated requests refresh once, then retry with credentials', async () => {
  let trainingRequests = 0;
  const app = fixtureApp({ fetch: (url, opts) => {
    assert.equal(opts.credentials, 'include');
    if (url === '/api/auth/refresh') return response({ user: { id: 'member' } });
    return ++trainingRequests === 1 ? response({}, 401) : response({ sessions: [] });
  } });
  const result = await app.context.api('/api/training?view=upcoming');
  assert.equal(result.status, 200);
  assert.equal(app.requests.length, 3);
  assert.equal(app.node('sessionOverlay').open, false);
});

test('one tap RSVP is deduplicated, waits for the server and applies canonical counts', async () => {
  const pending = deferred();
  const app = fixtureApp({ fetch: () => pending.promise });
  app.context.input = session;
  app.run("currentUser = { id: 'user' }; trainingSessions = [{ ...input }]");
  const first = app.context.handleRsvp('session-a', 'attending');
  await app.context.handleRsvp('session-a', 'attending');
  assert.equal(app.requests.length, 1);
  assert.equal(app.run('trainingSessions[0].my_status'), 'pending');
  assert.match(app.node('trainingList').innerHTML, /data-rsvp-status="attending"[^>]* disabled/);
  pending.resolve(response({ my_status: 'attending', attending_count: 2, not_attending_count: 0 }));
  await first;
  assert.equal(app.run('trainingSessions[0].my_status'), 'attending');
  assert.equal(app.run('trainingSessions[0].attending_count'), 2);
  assert.match(app.node('trainingList').innerHTML, /Du bist dabei/);
});

test('RSVP failures keep prior status and show a visible retry message', async () => {
  const app = fixtureApp({ fetch: () => { throw new Error('Offline'); } });
  app.context.input = session;
  app.run("currentUser = { id: 'user' }; trainingSessions = [{ ...input }]");
  await app.context.handleRsvp('session-a', 'attending');
  assert.equal(app.run('trainingSessions[0].my_status'), 'pending');
  assert.match(app.node('trainingList').innerHTML, /role="alert"/);
  assert.equal(app.run('rsvpInFlight.size'), 0);
});

test('published, finalized, cancelled and past sessions never expose roster edits', async () => {
  const app = fixtureApp();
  for (const changes of [{ league_status: 'published' }, { league_status: 'finalized' }, { rsvp_locked: true }, { is_cancelled: true }, { session_date: '2001-01-01' }]) {
    app.context.input = { ...session, ...changes };
    app.run('trainingSessions = [input]');
    assert.doesNotMatch(app.context.renderSessionCard(app.context.input), /data-rsvp-session/);
    await app.context.handleRsvp('session-a', 'attending');
  }
  assert.equal(app.requests.length, 0);
});

test('canonical session/team identity beats duplicate names and blocks stale RSVP controls', () => {
  const app = fixtureApp();
  app.context.event = ownEvent;
  app.context.session = session;
  app.run("memberEvents = [event]; currentUser = { id: 'user', display_name: 'Same Name' }");
  const content = app.context.renderSessionCard(session);
  assert.match(content, /Dein Team<\/p><h4>Navy<\/h4>/);
  assert.match(content, /19:20 · gegen Red/);
  assert.match(content, /Runde 2 · Feld 2/);
  assert.doesNotMatch(content, /data-rsvp-session|private-player|rating|href="\/#|<script>/);
  assert.match(content, /Guest &lt;script&gt;/);
  assert.equal(app.context.memberEventForSession('another-session'), null);
  app.context.event = { ...ownEvent, session_id: 'another-session' };
  app.run('memberEvents = [event]');
  assert.match(app.context.renderSessionCard(session), /data-rsvp-session/);
});

test('manual team assignments are distinguished from RSVP counts without changing attendance', () => {
  const app = fixtureApp();
  app.context.event = ownEvent;
  app.run('memberEvents = [event]');
  for (const status of ['pending', 'not_attending']) {
    const input = { ...session, my_status: status, attending_count: 0 };
    const content = app.context.renderSessionCard(input);
    assert.match(content, /0 Zusagen/);
    assert.match(content, /Im Team eingeplant/);
    assert.doesNotMatch(content, /Noch keine Antwort|Du bist nicht dabei/);
    assert.equal(input.my_status, status);
  }
  app.window.SiteLanguage.set('en');
  assert.match(app.context.renderSessionCard(session), /Assigned to a team/);
});

test('next fixture skips scored, elapsed and other-team games', () => {
  const app = fixtureApp();
  const upcoming = app.context.nextMemberFixture(ownEvent, { date: '2099-09-17', minutes: 19 * 60 + 10 });
  assert.equal(upcoming.round.number, 2);
  assert.equal(app.context.nextMemberFixture(ownEvent, { date: '2099-09-17', minutes: 19 * 60 + 45 }), null);
  assert.equal(app.context.nextMemberFixture({ ...ownEvent, status: 'finalized' }, { date: '2099-09-16', minutes: 0 }), null);
});

test('league movement uses the supplied common baseline and marks new entrants', () => {
  const app = fixtureApp();
  app.context.payload = {
    season, seasons: [season], my_events: [ownEvent], events: [], history: [],
    stats: { rank: 1, points: 3, played: 1, wins: 1, points_gain: 3, previous_rank: null, rank_gain: null },
    standings: [], comparison_event: { title: 'Latest scored', session_date: '2099-09-10' }
  };
  app.run('memberLeagueData = payload; memberCurrentLeagueData = payload; renderMemberLeague(); renderTrainingSummary()');
  assert.match(app.node('trainingLeagueSummary').innerHTML, /Neu/);
  assert.match(app.node('trainingLeagueSummary').innerHTML, /\+3 Punkte/);
  assert.match(app.node('memberLeagueContent').innerHTML, /Latest scored/);
  assert.match(app.node('memberLeagueContent').innerHTML, /Neu dabei\? Die Liga in 60 Sekunden/);
  app.window.SiteLanguage.set('en');
  assert.match(app.node('trainingLeagueSummary').innerHTML, /New/);
  assert.match(app.node('trainingLeagueSummary').innerHTML, /\+3 Points/);
  assert.match(app.node('memberLeagueContent').innerHTML, /New here\? The league in 60 seconds/);
  assert.equal(app.translated[0].textContent, 'Choose training');
});

test('member summaries and training history show BP as part of the server total', () => {
  const app = fixtureApp();
  app.context.payload = {
    season, seasons: [season], my_events: [], events: [], standings: [],
    stats: { rank: 1, points: 3.5, base_points: 3, bonus_points: 0.5, played: 1, wins: 1 },
    history: [{ title: 'Thursday', session_date: '2026-09-17', team_name: 'Gold', placement: 1, points: 3.5, bonus_points: 0.5 }]
  };
  app.run('memberLeagueData = payload; memberCurrentLeagueData = payload; renderMemberLeague(); renderTrainingSummary()');
  assert.match(app.node('trainingLeagueSummary').innerHTML, /3.5 Punkte[\s\S]*BP 0,5/);
  assert.match(app.node('memberLeagueContent').innerHTML, /<strong>3.5<\/strong>/);
  assert.match(app.node('memberLeagueContent').innerHTML, /\+3.5 Punkte[\s\S]*BP 0,5/);
  app.window.SiteLanguage.set('en');
  assert.match(app.node('memberLeagueContent').innerHTML, /Your total points/);
  assert.match(app.node('memberLeagueContent').innerHTML, /BP 0.5/);
});

test('own Thursday team has one visible matchday link before expandable details', () => {
  const app = fixtureApp();
  app.context.event = { ...ownEvent, id: '00000000-0000-4000-8000-000000000001', session_date: '2026-09-17' };
  const output = app.run('renderMemberEvent(event)');
  assert.equal((output.match(/href="\/spieltag\?/g) || []).length, 1);
  assert.ok(output.indexOf('/spieltag?') < output.indexOf('<details'));
});

test('archive absence stays absent and does not fabricate movement', () => {
  const app = fixtureApp();
  app.run("archiveData = { stats: null, rankings: [{ rank: 1, name: 'Archived', points: 10, played: 2 }] }; renderMemberArchive()");
  const content = app.node('memberArchiveContent').innerHTML;
  assert.match(content, /Kein Season-1-Ergebnis/);
  assert.doesNotMatch(content, /league-movement|Neu|New|\+10/);
});

test('cross-season own published events outside the training window remain inline', () => {
  const app = fixtureApp();
  app.context.event = { ...ownEvent, season_id: 'next-season', session_id: 'future-session' };
  app.run('memberEvents = [event]; trainingSessions = []; renderOtherMemberEvents()');
  assert.match(app.node('otherMemberEvents').innerHTML, /future-session/);
  assert.match(app.node('otherMemberEvents').innerHTML, /Dein Team/);
  assert.doesNotMatch(app.node('otherMemberEvents').innerHTML, /data-rsvp-session/);
});

test('logout invalidates in-flight training and clears another member’s cached data', async () => {
  const pending = deferred();
  const app = fixtureApp({ fetch: () => pending.promise });
  app.run("currentUser = { id: 'first' }");
  const request = app.context.loadTrainingSessions();
  app.context.clearMemberState();
  app.run("currentUser = { id: 'second' }");
  pending.resolve(response({ sessions: [session] }));
  await request;
  assert.equal(app.run('trainingSessions.length'), 0);
  assert.equal(app.run('trainingLoading'), false);
  assert.equal(app.node('trainingList').textContent, '');
});

test('late unauthorized requests cannot refresh or reopen a previous user’s session dialog', async () => {
  const pending = deferred();
  const app = fixtureApp({ fetch: () => pending.promise });
  app.run("currentUser = { id: 'first' }; currentView = 'dashboard'");
  const request = app.context.loadTrainingSessions();
  app.context.clearMemberState();
  app.run("currentView = 'login'");
  pending.resolve(response({}, 401));
  await request;
  assert.equal(app.requests.length, 1);
  assert.equal(app.node('sessionOverlay').open, false);
});

test('tab keyboard navigation and shared language preserve account form values', () => {
  const app = fixtureApp();
  app.run('trainingLoaded = true');
  app.node('emailNotifToggle').checked = false;
  app.node('loginEmail').value = 'typed@example.test';
  app.tablist.listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(app.run('activeTab'), 'account');
  assert.equal(app.node('tabButton-account').tabIndex, 0);
  assert.equal(app.node('tab-training').hidden, true);
  app.window.SiteLanguage.set('en');
  assert.equal(app.node('emailNotifToggle').checked, false);
  assert.equal(app.node('loginEmail').value, 'typed@example.test');
});

test('startup uses lightweight account view and opens training before archive', async () => {
  const app = fixtureApp({ fetch: url => {
    if (url === '/api/member/stats?view=account') return response({ user: { id: 'user', display_name: 'Member', email: 'm@example.test' } });
    if (url.startsWith('/api/league')) return response({ season: null, my_events: [], events: [] });
    if (url.startsWith('/api/training')) return response({ sessions: [] });
    throw new Error('Unexpected startup request: ' + url);
  } });
  await app.context.initMember();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.run('activeTab'), 'training');
  assert.equal(app.run('currentView'), 'dashboard');
  assert.equal(app.requests.length, 3);
  assert.ok(app.requests.every(request => request.url !== '/api/member/stats'));
});

test('transient refresh failure is visible and does not silently pretend no session', async () => {
  const app = fixtureApp({ fetch: url => response({}, url === '/api/auth/refresh' ? 503 : 401) });
  await app.context.initMember();
  assert.equal(app.node('loginMessage').hidden, false);
  assert.match(app.node('loginMessage').textContent, /nicht geprüft/);
  assert.equal(app.logs.length, 1);
});
