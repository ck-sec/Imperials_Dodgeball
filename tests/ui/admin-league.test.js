const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSchedule, matchStandings } = require('../../lib/league-matches');

const rootPath = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(rootPath, 'js', 'admin-league.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function node(id = '', dataset = {}) {
  const attributes = {};
  const classes = new Set();
  const captured = new Set();
  return {
    id, dataset, value: '', name: '', type: '', checked: false, disabled: false,
    hidden: false, textContent: '', innerHTML: '', listeners: {}, children: [], elements: [],
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(key, value) { attributes[key] = String(value); },
    getAttribute(key) { return attributes[key]; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    contains(item) { return item?.outside !== true; },
    focus() { this.focused = true; },
    reportValidity() { return true; },
    setPointerCapture(id) { captured.add(id); },
    hasPointerCapture(id) { return captured.has(id); },
    releasePointerCapture(id) { captured.delete(id); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest(selector) {
      if (selector.includes('form[')) return this.form || null;
      if (selector === '[data-al-handle]') return this.dataset.alHandle ? this : null;
      if (selector.includes('data-al-drop')) return this.dataset.alDropPlayer || this.dataset.alDropTeam ? this : null;
      if (selector === '[data-al-action]') return this.dataset.alAction ? this : null;
      return null;
    }
  };
}

function dataFixture() {
  const players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i + 1}`, user_id: i === 5 ? null : `u${i + 1}`, display_name: `Player ${i + 1}`,
    gender: 'unspecified', rating: 1000, initial_rating: 1000
  }));
  return {
    seasons: [
      { id: 'old', name: 'Season 1', start_date: '2025-09-01', end_date: '2026-07-03', placement_points: [3, 2, 1] },
      { id: 's2', name: 'Season 2', start_date: '2026-09-14', end_date: '2027-07-02', placement_points: [3, 2, 1], bonus_points_max: 9, bonus_points_step: 1 }
    ],
    players,
    members: players.filter(p => p.user_id).map(p => ({ id: p.user_id, display_name: p.display_name, league_scorekeeper: false })),
    sessions: [
      { id: 'far', session_date: '2027-07-01', title: 'Thursday', start_time: '19:00', attending_player_ids: [] },
      { id: 'monday', session_date: '2026-09-21', title: 'Monday', attending_player_ids: [] },
      { id: 'cancelled', session_date: '2026-09-24', is_cancelled: true, title: 'Cancelled', attending_player_ids: [] },
      { id: 'next', session_date: '2026-09-17', start_time: '19:00', title: 'Thursday', attending_player_ids: ['p1', 'p2', 'p3', 'p4'] },
      { id: 'another', session_date: '2026-10-01', start_time: '19:00', title: 'Thursday', attending_player_ids: [] },
      { id: 'outside', session_date: '2027-07-08', title: 'Outside Season 2', attending_player_ids: [] }
    ],
    events: [{
      id: 'event-1', session_id: 'next', season_id: 's2', session_date: '2026-09-17',
      version: 3, status: 'draft', team_size: 2, max_teams: 5,
      settings: { bonus_points_max: 1, bonus_points_step: 0.5 }, bonus_points: { p1: 0.5 },
      teams: [
        { number: 1, name: 'Gold', players: players.slice(0, 2) },
        { number: 2, name: 'Navy', players: players.slice(2, 4) }
      ]
    }]
  };
}

async function app(options = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, node(id));
    return elements.get(id);
  };
  const leagueRoot = get('tab-league');
  let rendered = '';
  let forms = [];
  Object.defineProperty(get('al-app'), 'innerHTML', {
    get: () => rendered,
    set(html) {
      rendered = html;
      for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
        const id = /\bid="([^"]+)"/.exec(tag[0])?.[1];
        if (!id) continue;
        const el = node(decode(id));
        for (const attr of tag[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
          const [, key, raw] = attr;
          const value = decode(raw);
          if (key.startsWith('data-')) el.dataset[key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
          else if (['name', 'type', 'value'].includes(key)) el[key] = value;
          else el.setAttribute(key, value);
        }
        el.hidden = /\shidden(?:\s|>)/.test(tag[0]);
        el.disabled = /\sdisabled(?:\s|>)/.test(tag[0]);
        el.checked = /\schecked(?:\s|>)/.test(tag[0]);
        elements.set(el.id, el);
      }
      forms = [...html.matchAll(/<form\s+data-al-form="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].map(([, type, markup]) => {
        const form = node('', { alForm: type });
        form.elements = [...markup.matchAll(/<(?:input|select|button)\s[^>]*id="([^"]+)"[^>]*>/g)].map(match => get(decode(match[1])));
        for (const select of markup.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
          const options = [...select[2].matchAll(/<option value="([^"]*)"([^>]*)>/g)];
          const selected = options.find(option => /\bselected\b/.test(option[2])) || options[0];
          get(select[1]).value = decode(selected?.[1] || '');
        }
        form.elements.forEach(field => { field.form = form; });
        return form;
      });
    }
  });
  leagueRoot.querySelector = selector => selector === '[data-al-action="discard-teams"]' ? node() : null;
  leagueRoot.querySelectorAll = selector => selector === 'form[data-al-form]' ? forms : [];
  let hit = null;
  const document = {
    getElementById: get, createElement: () => node(),
    elementFromPoint: () => hit
  };
  const store = clone(options.data || dataFixture());
  const requests = [];
  const frames = new Map();
  const scrolls = [];
  let frameId = 0;
  const window = {
    confirm: options.confirm || (() => true), listeners: {}, innerHeight: 700,
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    scrollBy(value) { scrolls.push(value); },
    addEventListener(type, fn) { this.listeners[type] = fn; }
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [options.now || '2026-09-16T22:15:00Z'])); }
    static now() { return new Date(options.now || '2026-09-16T22:15:00Z').getTime(); }
  }
  const context = vm.createContext({
    window, document, console, Date: FixedDate, Map, Set,
    getToken: () => 'admin-test-token', esc: escape, toast() {},
    FormData: class { constructor(form) { this.fields = form.fields || {}; } get(name) { return this.fields[name] ?? null; } has(name) { return name in this.fields; } },
    fetch: async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body) : null;
      requests.push({ url, body });
      const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => clone(value) });
      if (!body) return response(store);
      if (options.rejectAction === body.action) return response({ error: 'Training changed. Refresh before retrying.' }, 409);
      const event = store.events.find(e => e.id === body.event_id
        || (!body.event_id && e.session_id === body.session_id));
      if (body.action === 'save_draft') {
        event.teams = body.teams.map(t => ({ ...t, players: t.player_ids.map(id => store.players.find(p => p.id === id)) }));
        event.team_size = body.team_size;
        event.roster_stale = false;
        event.version++;
      } else if (body.action === 'save_bonus_points') {
        event.bonus_points = Object.fromEntries(body.awards.filter(a => a.points).map(a => [a.player_id, a.points]));
        event.version++;
      } else if (body.action === 'set_scorekeeper') {
        store.members.find(m => m.id === body.user_id).league_scorekeeper = body.enabled;
      } else if (body.action === 'generate') {
        event.max_teams = body.max_teams;
        event.schedule = null;
        event.version++;
      } else if (body.action === 'generate_schedule') {
        event.schedule = buildSchedule(event.teams.length, body);
        event.version++;
      } else if (body.action === 'delete_schedule') {
        event.schedule = null;
        event.status = 'draft';
        event.version++;
      }
      return response({ event_id: event?.id });
    }
  });
  vm.runInContext(fs.readFileSync(path.join(rootPath, 'js', 'league-scoring.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootPath, 'js', 'league-ui.js'), 'utf8'), context);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.testAdmin = { state, sessions, dateOnly, loadData, render, handleAction, submit, changeSelection, hasChanges, publishWarning, bonusSettings, eligibleScorekeeper }; })();'), context);
  const api = window.testAdmin;
  if (!options.skipLoad) { await api.loadData(); api.render(); }
  return {
    api, store, requests, window, get, frames, scrolls, html: () => rendered,
    action: name => api.handleAction(name),
    emit: (type, target, extra = {}) => leagueRoot.listeners[type]({ target, preventDefault() {}, ...extra }),
    hit: value => { hit = value; },
    input(id, value, dataset = {}) {
      const input = get(id);
      Object.assign(input, { value, dataset: { ...input.dataset, ...dataset } });
      leagueRoot.listeners.input({ target: input });
      return input;
    },
    form(type, fields = {}) { return Object.assign(node('', { alForm: type }), { fields }); }
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const ids = state => state.teams.map(t => Array.from(t.player_ids));

test('fixed exact Season 2, Vienna civil Thursdays, chronological upcoming and no free season picker', async () => {
  const a = await app();
  assert.equal(a.api.state.seasonId, 's2');
  assert.equal(a.api.state.sessionId, 'next');
  assert.deepEqual(Array.from(a.api.sessions(), s => s.id), ['next', 'cancelled', 'another', 'far']);
  assert.equal(a.api.dateOnly('2026-09-16T22:15:00Z'), '2026-09-17');
  assert.match(a.html(), /★ Next · Thu 2026-09-17/);
  assert.match(a.html(), /Upcoming Thursdays/);
  assert.match(a.html(), /needed for three 2-a-side teams/);
  assert.doesNotMatch(a.html(), /al-season-select|new-season|Create another season|value="monday"|value="outside"/);
  assert.match(a.html(), /\/spieltag\?event=event-1/);
  for (const size of [2, 3, 4, 5, 6]) assert.match(a.html(), new RegExp(`value="${size}"[^>]*>${size} on court`));
  const late = await app({ now: '2026-10-02T10:00:00Z' });
  assert.match(late.html(), /Past Thursdays — results \/ corrections/);
  assert.equal(late.api.state.sessionId, 'far');
});

test('missing and ambiguous Season 2 fail closed rather than using the first season', async () => {
  for (const ambiguous of [false, true]) {
    const data = dataFixture();
    if (ambiguous) data.seasons.push({ ...data.seasons[1], id: 'duplicate' });
    else data.seasons[1].name = 'Season 20';
    const a = await app({ data, skipLoad: true });
    await assert.rejects(a.api.loadData(), ambiguous ? /ambiguous/ : /missing/);
    assert.equal(a.api.state.seasonId, '');
    assert.equal(a.requests.filter(r => r.body).length, 0);
  }
});

test('two-team mode generates head-to-head fixtures with an external ref and deletes a published schedule', async () => {
  const a = await app();
  assert.match(a.html(), /value="2"[^>]*>2 squads maximum/);
  const maximum = node('al-max-teams');
  maximum.value = '2';
  a.emit('change', maximum);
  assert.match(a.get('al-plan').textContent, /external Head Ref\/admin/);
  await a.action('generate');
  const generate = a.requests.find(request => request.body?.action === 'generate').body;
  assert.equal(generate.max_teams, 2);
  assert.equal(generate.player_ids.length, 4);
  assert.equal(a.api.state.conflict, false, JSON.stringify({
    busy: a.api.state.busy,
    notice: a.get('al-notice').children.map(child => child.textContent),
  }));

  await a.api.submit(a.form('schedule', {
    meetup_time: '18:00', courts: '1', match_minutes: '60', break_minutes: '0',
    warmup_minutes: '15', available_minutes: '120', finale_minutes: '10',
  }));
  const scheduleWrite = a.requests.find(request => request.body?.action === 'generate_schedule');
  assert(scheduleWrite, JSON.stringify(a.requests));
  const scheduleRequest = scheduleWrite.body;
  assert.equal(scheduleRequest.courts, 1);
  assert.match(a.html(), /External ref:<\/strong> Head Ref\/admin required/);

  a.store.events[0].status = 'published';
  a.api.state.data.events[0].status = 'published';
  a.api.render();
  assert.match(a.html(), /Delete published schedule/);
  await a.action('delete-schedule');
  assert.deepEqual(a.requests.find(request => request.body?.action === 'delete_schedule').body, {
    action: 'delete_schedule', event_id: 'event-1', version: 5,
  });
  assert.equal(a.store.events[0].status, 'draft');
  assert.equal(a.store.events[0].schedule, null);
  assert.match(a.html(), /No schedule saved/);
});

test('schedule deletion refuses unresolved local edits before contacting the server', async () => {
  const data = dataFixture();
  data.events[0].status = 'published';
  data.events[0].schedule = buildSchedule(2);
  const a = await app({ data });
  a.api.state.dirtySchedule = true;
  await assert.rejects(a.action('delete-schedule'), /Save or discard all local/);
  assert.equal(a.requests.filter(request => request.body?.action === 'delete_schedule').length, 0);
});

test('selection and unsaved edits survive refresh RSVP and rejected training switch; server conflict never retries', async () => {
  const a = await app({ confirm: () => false });
  await a.action('remove-player:p1');
  await a.api.changeSelection('another');
  assert.equal(a.api.state.sessionId, 'next');
  assert.equal(a.get('al-session-select').value, 'next');
  await a.action('retry-rsvp');
  assert.deepEqual(ids(a.api.state), [['p2'], ['p3', 'p4']]);
  assert.equal(a.api.state.dirtyRoster, true);
  a.store.events[0].version++;
  await a.action('retry-rsvp');
  assert.equal(a.api.state.conflict, true);
  assert.deepEqual(ids(a.api.state), [['p2'], ['p3', 'p4']]);
  await a.action('save-draft');
  assert.equal(a.requests.filter(r => r.body).length, 0);
});

test('remove changes this draft only, keeps roster filters and other squads consistent; undo/discard restore both', async () => {
  const a = await app();
  a.api.state.selectedOnly = true;
  await a.action('remove-player:p1');
  assert.deepEqual(ids(a.api.state), [['p2'], ['p3', 'p4']]);
  assert.equal(a.api.state.selected.has('p1'), false);
  assert.doesNotMatch(a.html(), /data-al-player="p1"/);
  assert.equal(a.store.players.length, 6);
  assert.equal(a.store.events[0].teams[0].players.length, 2);
  assert.equal(a.requests.filter(r => r.body).length, 0);
  assert.match(a.api.publishWarning(), /at least 4/);
  assert.equal(a.get('al-save-teams').disabled, false);
  assert.equal(a.get('al-publish-button').disabled, true);
  await a.action('undo-draft');
  assert.deepEqual(ids(a.api.state), [['p1', 'p2'], ['p3', 'p4']]);
  assert.equal(a.api.state.selected.size, 4);
  const checkbox = node('al-roster-p2', { alPlayer: 'p2' });
  checkbox.checked = false;
  a.emit('change', checkbox);
  assert.deepEqual(ids(a.api.state), [['p1'], ['p3', 'p4']]);
  await a.action('discard-teams');
  assert.deepEqual(ids(a.api.state), [['p1', 'p2'], ['p3', 'p4']]);
  assert.equal(a.api.state.selected.size, 4);
  assert.equal(a.api.state.dirtyRoster, false);
});

test('save_draft persists an understrength lineup with version; no rebalance or publish request', async () => {
  const a = await app();
  await a.action('remove-player:p1');
  await a.action('save-draft');
  const writes = a.requests.filter(r => r.body).map(r => r.body);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    action: 'save_draft', event_id: 'event-1', version: 3, team_size: 2,
    teams: [{ number: 1, name: 'Gold', player_ids: ['p2'] }, { number: 2, name: 'Navy', player_ids: ['p3', 'p4'] }]
  });
  assert.equal(a.api.state.dirtyTeams, false);
  assert.equal(a.api.state.sessionId, 'next');
  await assert.rejects(a.action('publish'), /at least 4/);
  assert.equal(a.requests.filter(r => r.body).length, 1);
});

test('draft conflict keeps local removals and blocks retries until explicit refresh', async () => {
  const a = await app({ rejectAction: 'save_draft' });
  await a.action('remove-player:p1');
  await a.action('save-draft');
  assert.equal(a.api.state.conflict, true);
  assert.equal(a.api.state.dirtyTeams, true);
  assert.equal(a.api.state.selected.has('p1'), false);
  await a.action('save-draft');
  assert.equal(a.requests.filter(r => r.body).length, 1);
});

test('unsaved guest/settings fields survive roster redraws and trigger leave protection', async () => {
  const a = await app({ confirm: () => false });
  a.input('al-guest-name', 'Guest pending input');
  a.input('al-season-bonus-max', '1.5');
  assert.equal(a.api.hasChanges(), true);
  await a.action('remove-player:p1');
  assert.equal(a.get('al-guest-name').value, 'Guest pending input');
  assert.equal(a.get('al-season-bonus-max').value, '1.5');
  await a.api.changeSelection('another');
  assert.equal(a.api.state.sessionId, 'next');
  let prevented = false;
  const unload = { preventDefault() { prevented = true; } };
  a.window.listeners.beforeunload(unload);
  assert.equal(prevented, true);
  assert.equal(unload.returnValue, '');
});

test('tap/keyboard selection swaps and moves without reshuffling; unassigned adds require explicit placement', async () => {
  const a = await app();
  await a.action('pick-player:p1');
  await a.action('pick-player:p3');
  assert.deepEqual(ids(a.api.state), [['p3', 'p2'], ['p1', 'p4']]);
  const handle = node('', { alAction: 'pick-player:p2', alHandle: 'p2' });
  a.emit('click', handle, { detail: 0 });
  await flush();
  assert.equal(a.api.state.pickedPlayer, 'p2');
  a.emit('keydown', handle, { key: 'Escape' });
  assert.equal(a.api.state.pickedPlayer, '');
  await a.action('pick-player:p2');
  await a.action('place-player:2');
  assert.deepEqual(ids(a.api.state), [['p3'], ['p1', 'p4', 'p2']]);
  assert.match(a.api.publishWarning(), /needs 2/);
  const added = node('al-roster-p5', { alPlayer: 'p5' });
  added.checked = true;
  a.emit('change', added);
  await assert.rejects(a.action('save-draft'), /Assign every selected player/);
  await a.action('pick-player:p5');
  await a.action('place-player:1');
  assert.deepEqual(ids(a.api.state), [['p3', 'p5'], ['p1', 'p4', 'p2']]);
  assert.equal(a.api.state.selected.size, 5);
});

test('touch pointer drag swaps/moves; pointercancel and outside drop never mutate a roster', async () => {
  const a = await app();
  const handle = () => node('', { alHandle: 'p1', alAction: 'pick-player:p1' });
  const down = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 10, clientY: 10 };
  const move = { ...down, clientX: 90, clientY: 150 };
  let h = handle();
  a.emit('pointerdown', h, down);
  a.hit(node('', { alDropPlayer: 'p3' }));
  a.emit('pointermove', h, move);
  a.emit('pointercancel', h, move);
  a.emit('pointerup', h, move);
  assert.deepEqual(ids(a.api.state), [['p1', 'p2'], ['p3', 'p4']]);
  assert.equal(h.hasPointerCapture(7), false);
  h = handle();
  a.emit('pointerdown', h, down);
  a.hit(null);
  a.emit('pointermove', h, move);
  a.emit('pointerup', h, move);
  assert.deepEqual(ids(a.api.state), [['p1', 'p2'], ['p3', 'p4']]);
  h = handle();
  a.emit('pointerdown', h, down);
  a.hit(node('', { alDropPlayer: 'p3' }));
  a.emit('pointermove', h, move);
  a.emit('pointerup', h, move);
  assert.deepEqual(ids(a.api.state), [['p3', 'p2'], ['p1', 'p4']]);
  h = handle();
  a.emit('pointerdown', h, down);
  a.hit(node('', { alDropTeam: '1' }));
  a.emit('pointermove', h, move);
  a.emit('pointerup', h, move);
  assert.deepEqual(ids(a.api.state), [['p3', 'p2', 'p1'], ['p4']]);
  assert.equal(a.requests.filter(r => r.body).length, 0);
});

test('mobile edge scrolling stops on Escape or lost pointer capture without changing teams', async () => {
  const a = await app();
  for (const cancel of ['keydown', 'lostpointercapture']) {
    const h = node('', { alHandle: 'p1', alAction: 'pick-player:p1' });
    a.emit('pointerdown', h, { pointerId: 9, button: 0, clientX: 20, clientY: 100 });
    a.hit(node('', { alDropTeam: '2' }));
    a.emit('pointermove', h, { pointerId: 9, clientX: 20, clientY: 690 });
    const [id, frame] = [...a.frames][0];
    a.frames.delete(id);
    frame();
    assert.equal(a.scrolls.at(-1).top, 14);
    a.emit(cancel, h, { pointerId: 9, key: 'Escape' });
    assert.equal(a.frames.size, 0);
    a.emit('pointerup', h, { pointerId: 9, clientX: 20, clientY: 690 });
    assert.deepEqual(ids(a.api.state), [['p1', 'p2'], ['p3', 'p4']]);
  }
});

test('published, roster-locked, scored and cancelled sessions cannot mutate draft; cancelled scoring/BP blocked', async () => {
  for (const mode of ['published', 'locked', 'scored', 'cancelled']) {
    const data = dataFixture();
    if (mode === 'published') data.events[0].status = 'published';
    if (mode === 'locked') data.events[0].roster_locked = true;
    if (mode === 'scored') data.events[0].schedule = { rounds: [{ matches: [{ score_a: 0, score_b: 0 }] }] };
    if (mode === 'cancelled') data.sessions.find(s => s.id === 'next').is_cancelled = true;
    const a = await app({ data, skipLoad: true });
    a.api.state.sessionId = 'next';
    await a.api.loadData();
    if (mode !== 'scored') a.api.render();
    await a.action('remove-player:p1');
    await a.action('pick-player:p1');
    await a.action('save-draft');
    assert.equal(a.api.state.selected.size, 4);
    assert.equal(a.requests.filter(r => r.body).length, 0);
    if (mode === 'cancelled') {
      assert.match(a.html(), /Cancelled training — read-only/);
      await assert.rejects(a.api.submit(a.form('bonus')), /read-only/);
      await assert.rejects(a.api.submit(a.form('match')), /read-only/);
    }
  }
});

test('bonus awards use training snapshot rules, replace all players including filtered rows, and retain edits across draft save', async () => {
  const a = await app();
  assert.deepEqual(clone(a.api.bonusSettings()), { max: 1, step: 0.5 });
  a.input('al-bonus-p1', '1', { alBonus: 'p1' });
  a.input('al-bonus-p3', '0.5', { alBonus: 'p3' });
  a.input('al-bonus-search', 'Player 1');
  await a.action('remove-player:p2');
  await a.action('save-draft');
  assert.equal(a.api.state.dirtyBonus, true);
  assert.equal(a.api.state.bonusAwards.p3, '0.5');
  await a.api.submit(a.form('bonus'));
  const request = a.requests.find(r => r.body?.action === 'save_bonus_points').body;
  assert.equal(request.version, 4);
  assert.deepEqual(request.awards, [{ player_id: 'p1', points: 1 }, { player_id: 'p3', points: 0.5 }, { player_id: 'p4', points: 0 }]);
  assert.equal(a.api.state.dirtyBonus, false);
  assert.equal(a.store.events[0].bonus_points.p1, 1);
});

test('the admin BP replacement request satisfies the real offline backend action contract', async () => {
  const playerId = id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  const data = JSON.parse(JSON.stringify(dataFixture()), (_, value) =>
    typeof value === 'string' && /^p\d+$/.test(value) ? playerId(value.slice(1)) : value);
  data.events[0].id = playerId(100);
  data.events[0].bonus_points = {};
  const a = await app({ data });
  a.input(`al-bonus-${playerId(1)}`, '0.5', { alBonus: playerId(1) });
  await a.api.submit(a.form('bonus'));
  const payload = a.requests.find(r => r.body?.action === 'save_bonus_points').body;
  const validated = require(path.join(rootPath, 'lib', 'league.js')).validateAction(payload);
  assert.equal(validated.action, 'save_bonus_points');
  assert.equal(validated.version, 3);
  assert.deepEqual(validated.awards, payload.awards);
});

test('Last Man and Last Woman selectors save the exact +1/+0.5 awards before finalization', async () => {
  const data = dataFixture();
  data.players.forEach((player, index) => {
    player.gender = index < 2 ? 'male' : index < 4 ? 'female' : 'unspecified';
  });
  const event = data.events[0];
  event.status = 'published';
  event.teams = [
    { number: 1, name: 'Gold', players: [data.players[0], data.players[2]] },
    { number: 2, name: 'Navy', players: [data.players[1], data.players[3]] },
    { number: 3, name: 'White', players: [data.players[4], data.players[5]] },
  ];
  event.schedule = buildSchedule(3);
  for (const match of event.schedule.rounds.flatMap(round => round.matches)) {
    match.score_a = match.team_a < match.team_b ? 2 : 1;
    match.score_b = match.team_a < match.team_b ? 1 : 2;
  }
  event.match_standings = matchStandings(3, event.schedule);
  const a = await app({ data });
  const results = a.form('results', { placement_1: '1', placement_2: '2', placement_3: '3' });
  await assert.rejects(a.api.submit(results), /Last Man Standing: save one \+1 BP winner and one \+0.5 BP runner-up/);
  for (const [gender, points, playerId] of [
    ['male', '1', 'p1'], ['male', '0.5', 'p2'], ['female', '1', 'p3'], ['female', '0.5', 'p4'],
  ]) {
    a.input(`al-finale-${gender}-${points.replace('.', '-')}`, playerId, { alFinale: `${gender}:${points}` });
  }
  assert.deepEqual(clone(a.api.state.bonusAwards), { p1: 1, p2: 0.5, p3: 1, p4: 0.5 });
  await a.api.submit(a.form('bonus'));
  assert.deepEqual(a.requests.find(request => request.body?.action === 'save_bonus_points').body.awards
    .sort((left, right) => left.player_id.localeCompare(right.player_id)), [
    { player_id: 'p1', points: 1 }, { player_id: 'p2', points: 0.5 },
    { player_id: 'p3', points: 1 }, { player_id: 'p4', points: 0.5 },
    { player_id: 'p5', points: 0 }, { player_id: 'p6', points: 0 },
  ]);
  await a.api.submit(results);
  assert.ok(a.requests.some(request => request.body?.action === 'results'));
});

test('invalid BP and finalized BP are rejected, conflicts freeze edits and do not automatically retry', async () => {
  const a = await app({ rejectAction: 'save_bonus_points' });
  a.input('al-bonus-p1', '2', { alBonus: 'p1' });
  await assert.rejects(a.api.submit(a.form('bonus')), /0–1 BP/);
  a.input('al-bonus-p1', '0.25', { alBonus: 'p1' });
  await assert.rejects(a.api.submit(a.form('bonus')), /0.5 steps/);
  a.input('al-bonus-p1', '1', { alBonus: 'p1' });
  await a.api.submit(a.form('bonus'));
  assert.equal(a.api.state.conflict, true);
  assert.equal(a.api.state.dirtyBonus, true);
  assert.equal(a.requests.filter(r => r.body).length, 1);
  await a.api.submit(a.form('bonus'));
  assert.equal(a.requests.filter(r => r.body).length, 1);
  const data = dataFixture();
  data.events[0].status = 'finalized';
  const finalized = await app({ data });
  assert.match(finalized.html(), /Reopen results to correct BP/);
  await assert.rejects(finalized.api.submit(finalized.form('bonus')), /Reopen finalized/);
});

test('season BP settings submit only the exact existing season and validate cap/step', async () => {
  const a = await app();
  const fields = {
    id: 's2', name: 'Unwanted rename', start_date: '2026-09-14', end_date: '2027-07-02',
    placement_points: '3, 2, 1', scoring_mode: 'fixed', points_step: '0.5', bonus_points_max: '1', bonus_points_step: '0.25',
    k_factor: '24', default_rating: '1000', rookie_rating: '800'
  };
  await a.api.submit(a.form('season', fields));
  const body = a.requests.find(r => r.body?.action === 'save_season').body;
  assert.equal(body.name, 'Season 2');
  assert.equal(body.id, 's2');
  assert.equal(body.bonus_points_max, 1);
  assert.equal(body.bonus_points_step, 0.25);
  await assert.rejects(a.api.submit(a.form('season', { ...fields, id: '' })), /existing Season 2/);
  await assert.rejects(a.api.submit(a.form('season', { ...fields, bonus_points_max: '0.3' })), /multiple/);
});

test('permanent Head Ref role only lists eligible members, never guest profiles, and preserves unsaved draft', async () => {
  const data = dataFixture();
  data.members.push({ id: 'pending', display_name: 'Pending', status: 'pending', is_active: true });
  data.members.push({ id: 'inactive', display_name: 'Inactive', status: 'approved', is_active: false });
  const a = await app({ data });
  assert.match(a.html(), /Account access · Head Refs/);
  assert.match(a.html(), /same normal website login/);
  assert.match(a.html(), /operate the live timer/);
  assert.ok(a.html().indexOf('Account access · Head Refs') < a.html().indexOf('Confirm everyone playing'));
  assert.doesNotMatch(a.html(), /Spielleiter/);
  assert.match(a.html(), /data-al-scorekeeper="u1"/);
  assert.doesNotMatch(a.html(), /data-al-scorekeeper="(?:pending|inactive|p6)"/);
  await a.action('remove-player:p1');
  const role = node('al-role-u2', { alScorekeeper: 'u2' });
  role.checked = true;
  a.emit('change', role);
  await flush();
  assert.deepEqual(a.requests.find(r => r.body?.action === 'set_scorekeeper').body, { action: 'set_scorekeeper', user_id: 'u2', enabled: true });
  assert.deepEqual(ids(a.api.state), [['p2'], ['p3', 'p4']]);
  assert.equal(a.api.state.dirtyRoster, true);
});

test('admin assets cache-busted, role management title preserved, touch targets avoid HTML5-only dragging', () => {
  const html = fs.readFileSync(path.join(rootPath, 'admin.html'), 'utf8');
  const css = fs.readFileSync(path.join(rootPath, 'admin-league.css'), 'utf8');
  assert.match(html, /admin-league\.js\?v=20260914e/);
  assert.match(html, /admin-league\.css\?v=20260912b/);
  assert.match(html, /\/league\.css\?v=20260915/);
  assert.match(html, /\/js\/league-ui\.js\?v=20260915/);
  assert.ok(html.indexOf('admin-auth.js') < html.indexOf('league-ui.js'));
  assert.ok(html.indexOf('league-scoring.js') < html.indexOf('league-ui.js'));
  assert.ok(html.indexOf('league-ui.js') < html.indexOf('admin-league.js'));
  assert.match(source, /href="\/timer\?event=/);
  assert.match(source, /data-al-poster="itinerary" href="\/spieltag\?event=.*&export=itinerary"/);
  assert.match(source, /data-al-poster="results" href="\/spieltag\?event=.*&export=results"/);
  assert.match(source, /data-al-finale="\$\{gender\}:\$\{points\}"/);
  assert.match(source, /one assigned ref team/);
  assert.match(source, /external Head Ref required/);
  assert.match(source, /Last Man \/ Last Woman Standing · max 10 minutes/);
  assert.match(html, /data-tab="members"[^>]+>Members<\/button>/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 96px/);
  assert.doesNotMatch(source, /draggable=|addEventListener\('dragstart'/);
});
