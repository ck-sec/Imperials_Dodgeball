const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'timer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'timer.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'timer.css'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const context = vm.createContext({
  window: {},
  document: { readyState: 'loading', addEventListener() {} },
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
});
vm.runInContext(source, context);
const ui = context.window.MatchTimer;
const EVENT = '11111111-1111-4111-8111-111111111111';
const clone = value => JSON.parse(JSON.stringify(value));
const reply = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return clone(data); },
});

function payload(canControl = true) {
  return {
    event: {
      id: EVENT,
      version: 4,
      title: 'Thursday League',
      session_date: '2026-09-10',
      start_time: '19:00:00',
      end_time: '21:00:00',
      location: 'Vienna',
      status: 'published',
    },
    match: {
      number: 1,
      court: 1,
      round_number: 1,
      start_minute: 0,
      end_minute: 20,
      score_a: null,
      score_b: null,
      team_a: { number: 1, name: 'Gold', players: [{ display_name: 'A' }] },
      team_b: { number: 2, name: 'Navy', players: [{ display_name: 'B' }] },
    },
    timer: {
      revision: 0,
      phase: 'ready',
      status: 'ready',
      match_default_seconds: 1200,
      set_default_seconds: 180,
      match_remaining_seconds: 1200,
      set_remaining_seconds: 180,
      match_remaining_ms: 1200000,
      set_remaining_ms: 180000,
      started_at: null,
      updated_at: null,
      as_of: '2026-09-10T17:00:00.000Z',
    },
    permissions: {
      is_admin: canControl,
      is_scorekeeper: false,
      signed_in: canControl,
      can_control: canControl,
    },
  };
}

test('timer page is branded, external-script-only, responsive and publicly routable', () => {
  assert.ok(config.rewrites.some(rule => rule.source === '/timer' && rule.destination === '/timer.html'));
  assert.match(html, /Vienna Imperials/);
  assert.match(html, /id="timerMatchClock"/);
  assert.match(html, /id="timerSetClock"/);
  assert.match(html, /data-timer-action="start"/);
  assert.match(html, /data-timer-action="pause"/);
  assert.doesNotMatch(html, /data-timer-operator hidden/);
  assert.match(html, /id="timerConfig" data-timer-operator open/);
  assert.match(html, /id="timerMatchConfigForm"/);
  assert.match(html, /id="timerSetConfigForm"/);
  assert.match(html, /timer\.css\?v=20260914b/);
  assert.match(html, /timer\.js\?v=20260914d/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(script[1], /src="\/js\/[^"]+"/);
    assert.equal(script[2].trim(), '');
  }
  assert.match(css, /timer-gold: #d4961a/);
  assert.match(css, /min-height: 62px/);
  assert.match(css, /timer-controls-locked/);
  assert.match(css, /:fullscreen/);
  assert.match(css, /prefers-reduced-motion/);
});

test('timer route and member return links accept only one canonical local fixture target', () => {
  assert.equal(JSON.stringify(ui.parseRoute('?event=' + EVENT + '&match=1')), JSON.stringify({
    eventId: EVENT,
    matchNumber: 1,
    invalid: false,
  }));
  assert.equal(ui.timerPath(EVENT, 10), '/timer?event=' + EVENT + '&match=10');
  assert.equal(ui.memberLoginHref(EVENT, 1),
    '/member?return_to=' + encodeURIComponent('/timer?event=' + EVENT + '&match=1'));
  for (const search of [
    '',
    '?event=bad&match=1',
    '?event=' + EVENT + '&match=0',
    '?event=' + EVENT + '&match=11',
    '?event=' + EVENT + '&event=' + EVENT + '&match=1',
    '?event=' + EVENT + '&match=1&match=2',
  ]) assert.equal(ui.parseRoute(search).invalid, true);
});

test('display projection uses the synchronized anchor and preserves independent expiry states', () => {
  assert.equal(ui.formatClock(0), '00:00');
  assert.equal(ui.formatClock(61000), '01:01');
  const running = payload().timer;
  Object.assign(running, {
    phase: 'running',
    status: 'live',
    match_remaining_ms: 10000,
    set_remaining_ms: 3000,
  });
  let clock = ui.projectedTimer(running, Date.parse(running.as_of) + 2500);
  assert.equal(ui.formatClock(clock.match_remaining_ms), '00:08');
  assert.equal(ui.formatClock(clock.set_remaining_ms), '00:01');
  clock = ui.projectedTimer(running, Date.parse(running.as_of) + 3500);
  assert.equal(clock.status, 'set_expired');
  assert.equal(clock.phase, 'running');
  clock = ui.projectedTimer(running, Date.parse(running.as_of) + 11000);
  assert.equal(clock.status, 'expired');
  assert.equal(clock.phase, 'paused');
  clock = ui.projectedTimer({ ...running, phase: 'ready', match_remaining_ms: 1000, set_remaining_ms: 0 },
    Date.parse(running.as_of));
  assert.equal(clock.status, 'set_expired');
});

test('authorized controls send one revisioned command and adopt the server clock', async () => {
  let now = Date.parse('2026-09-10T17:00:00.000Z');
  let current = payload(true);
  const requests = [];
  const controller = ui.createController({
    eventId: EVENT,
    matchNumber: 1,
    token: 'admin-token',
    now: () => now,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (!options.body) return reply(200, current);
      const body = JSON.parse(options.body);
      current = clone(current);
      current.success = true;
      current.timer.revision = 1;
      current.timer.phase = 'running';
      current.timer.status = 'live';
      current.timer.started_at = current.timer.as_of;
      return reply(200, current);
    },
  });
  assert.equal(await controller.load(), true);
  assert.equal(await controller.command('start'), true);
  const write = requests.find(request => request.method === 'POST');
  assert.deepEqual(JSON.parse(write.body), {
    action: 'start',
    event_id: EVENT,
    match_number: 1,
    revision: 0,
  });
  assert.equal(write.headers.Authorization, 'Bearer admin-token');
  assert.equal(write.credentials, 'include');
  assert.equal(write.cache, 'no-store');
  assert.equal(controller.state.data.timer.revision, 1);
  now += 1500;
  assert.equal(ui.formatClock(controller.current().set_remaining_ms), '02:59');
});

test('public viewers cannot write and conflicts reload without replaying a command', async () => {
  let current = payload(false);
  const publicRequests = [];
  const viewer = ui.createController({
    eventId: EVENT,
    matchNumber: 1,
    fetch: async (url, options) => {
      publicRequests.push({ url, ...options });
      return reply(200, current);
    },
  });
  await viewer.load();
  assert.equal(await viewer.command('start'), false);
  assert.equal(publicRequests.filter(request => request.method === 'POST').length, 0);

  current = payload(true);
  const requests = [];
  const operator = ui.createController({
    eventId: EVENT,
    matchNumber: 1,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return options.body ? reply(409, { error: 'changed' }) : reply(200, current);
    },
  });
  await operator.load();
  assert.equal(await operator.command('start'), false);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  assert.equal(requests.filter(request => !request.body).length, 2);
  assert.equal(operator.state.notice, 'conflict');
});
