const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSchedule, matchStandings } = require('../../lib/league-matches');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'matchday.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'spieltag.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'matchday.css'), 'utf8');
const context = vm.createContext({
  window: {}, document: { readyState: 'loading', addEventListener() {} },
  URLSearchParams, AbortController, setTimeout, clearTimeout
});
vm.runInContext(source, context);
const ui = context.window.Matchday;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const clone = value => JSON.parse(JSON.stringify(value));
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, async json() { return clone(data); } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(id = A, canScore = true) {
  const event = {
    id, version: 3, title: 'Thursday league', session_date: '2026-09-10',
    start_time: '19:00:00', end_time: '21:00:00', location: 'Vienna', status: 'published', team_size: 6,
    teams: [1, 2, 3].map(number => ({ number, name: 'Team ' + number, players: [{ display_name: 'Player ' + number }] })),
    schedule: buildSchedule(3)
  };
  event.match_standings = matchStandings(3, event.schedule);
  return {
    events: [event], event,
    season: { name: 'Saison 2', scoring_mode: 'relative', placement_points: [3, 0.5], points_step: 0.5, bonus_points_max: 1, bonus_points_step: 0.5 },
    standings: [{ rank: 1, display_name: 'Player 1', played: 2, points: 7, bonus_points: 1 }],
    comparison_event: null,
    permissions: { is_admin: false, is_scorekeeper: canScore, can_score: canScore }
  };
}

function setup(data = fixture(), custom, extra = {}) {
  const requests = [];
  let current = data;
  const base = (url, options) => {
    if (url === '/api/auth/refresh') return reply(401, { code: 'NO_REFRESH_TOKEN' });
    if (url === '/api/member/stats?view=account') return reply(401, {});
    if (url.startsWith('/api/league?')) return reply(200, current);
    if (url === '/api/league' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      const match = current.event.schedule.rounds.flatMap(round => round.matches).find(match => match.number === body.match_number);
      match.score_a = body.score_a;
      match.score_b = body.score_b;
      current.event.version++;
      return reply(200, { success: true, event_id: current.event.id });
    }
    throw new Error('Unexpected endpoint: ' + url);
  };
  const controller = ui.createController({
    eventId: current.event.id,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return custom ? custom(url, options, base) : base(url, options);
    },
    ...extra
  });
  return { controller, requests, setData(value) { current = value; } };
}
const writes = requests => requests.filter(request => request.url === '/api/league' && request.method === 'POST');
function enter(controller, number = 1, a = '0', b = '4') {
  controller.edit(number, 'a', a);
  controller.edit(number, 'b', b);
}

function fixtureApp(data = fixture(), options = {}) {
  const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function node() {
    const classes = new Set();
    return {
      value: '', innerHTML: '', textContent: '', dataset: {}, listeners: {}, hidden: false, disabled: false, readOnly: false,
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      querySelectorAll() { return []; }, contains() { return false; }
    };
  }
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], { ...node(), id: match[1] }]));
  const host = elements.get('matchdayMatches');
  let forms = new Map();
  let markup = '';
  Object.defineProperty(host, 'innerHTML', {
    get: () => markup,
    set(value) {
      markup = value;
      forms = new Map();
      for (const match of value.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
        const form = node();
        const number = Number(/data-match-number="(\d+)"/.exec(match[1])[1]);
        form.dataset.matchNumber = String(number);
        form.dataset.fixtureIdentity = decode(/data-fixture-identity="([^"]+)"/.exec(match[1])[1]);
        const children = new Map();
        const child = selector => {
          if (!children.has(selector)) {
            const element = node();
            element.ownerForm = form;
            element.closest = selector => selector === '[data-review]' && element.dataset.review ? element : form;
            children.set(selector, element);
          }
          return children.get(selector);
        };
        const labels = [...match[2].matchAll(/class="matchday-team-name">([^<]*)<\/span>/g)].map(match => {
          const label = node();
          label.textContent = decode(match[1]);
          return label;
        });
        const inputs = ['a', 'b'].map(side => {
          const input = node();
          input.dataset.side = side;
          input.ownerForm = form;
          input.closest = selector => selector === 'input[data-side]' ? input : form;
          input.matches = selector => selector === 'input[data-side]';
          return input;
        });
        child('.matchday-game-label').dataset.court = /data-court="(\d+)"/.exec(match[2])[1];
        for (const review of ['current', 'keep', 'reload']) child('[data-review="' + review + '"]').dataset.review = review;
        form.querySelector = child;
        form.querySelectorAll = selector => selector === 'input[data-side]' ? inputs
          : selector === '.matchday-team-name' ? labels : [];
        form.closest = () => form;
        form.contains = element => !!element && element.ownerForm === form;
        forms.set(number, form);
      }
    }
  });
  host.querySelectorAll = selector => selector === '[data-match-number]' ? [...forms.values()] : [];
  host.contains = element => !!element && [...forms.values()].some(form => form.contains(element));
  const document = {
    readyState: 'loading', activeElement: null, hidden: false,
    getElementById: id => elements.get(id), querySelectorAll: () => [], addEventListener() {}
  };
  const requests = [];
  const redirects = [];
  const opened = [];
  const windowEvents = {};
  const storage = options.storage || new Map();
  const window = {
    location: { search: '?event=' + data.event.id, assign: target => redirects.push(target) },
    history: { replaceState() {}, pushState() {} }, addEventListener(type, listener) { windowEvents[type] = listener; },
    open: (...args) => opened.push(args),
    SiteLanguage: { get: () => 'en' },
    LeagueUI: { date: value => value, standings: () => '', rules: () => '', matchTable: () => '' },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (url === '/api/member/stats?view=account') return reply(401, {});
      if (url === '/api/auth/refresh') return reply(401, {});
      if (url === '/api/league' && options.method === 'POST') {
        const body = JSON.parse(options.body);
        const match = data.event.schedule.rounds.flatMap(round => round.matches).find(match => match.number === body.match_number);
        match.score_a = body.score_a;
        match.score_b = body.score_b;
        data.event.version++;
        return reply(200, { success: true, event_id: data.event.id });
      }
      return reply(200, data);
    }
  };
  const appContext = vm.createContext({
    window, document, URLSearchParams, AbortController,
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem(key, value) { if (options.blockStorage) throw new Error('Storage blocked'); storage.set(key, value); },
      removeItem(key) { if (options.blockStorage) throw new Error('Storage blocked'); storage.delete(key); }
    },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  });
  vm.runInContext(source, appContext);
  window.Matchday.start();
  return {
    requests, document, elements, redirects, opened, storage, windowEvents,
    form: number => forms.get(number),
    async refresh() { elements.get('matchdayRefresh').listeners.click(); await tick(); },
    async select(nextData) {
      data = nextData;
      elements.get('matchdaySelect').value = data.event.id;
      elements.get('matchdaySelect').listeners.change();
      await tick();
    },
    edit(number, a, b) {
      const inputs = forms.get(number).querySelectorAll('input[data-side]');
      [a, b].forEach((value, index) => { inputs[index].value = value; host.listeners.input({ target: inputs[index] }); });
    },
    async save(number) {
      host.listeners.submit({ target: forms.get(number), preventDefault() {} });
      await tick();
    },
    review(number, keep) {
      host.listeners.click({ target: forms.get(number).querySelector('[data-review="' + (keep ? 'keep' : 'current') + '"]') });
    },
    async login() {
      const link = elements.get('matchdayLoginLink');
      let prevented = false;
      await link.listeners.click({ button: 0, currentTarget: link, preventDefault() { prevented = true; } });
      if (!prevented && link.target === '_blank') opened.push([link.href, link.target, link.rel]);
    }
  };
}

function regenerate(data, count) {
  data.event.teams = Array.from({ length: count }, (_, index) => ({
    number: index + 1, name: 'Team ' + (index + 1), players: [{ display_name: 'Player ' + (index + 1) }]
  }));
  data.event.schedule = buildSchedule(count);
  data.event.match_standings = matchStandings(count, data.event.schedule);
  data.event.version++;
}

test('standalone page uses versioned local assets, external scripts, rewrite, and large touch controls', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some(rule => rule.source === '/spieltag' && rule.destination === '/spieltag.html'));
  assert.match(html, /viewport/);
  assert.match(html, /fonts\/fonts.css\?v=20260912c/);
  assert.match(html, /league.css\?v=20260915/);
  assert.match(html, /matchday.css\?v=20260914e/);
  assert.match(html, /league-poster\.js\?v=20260914e/);
  assert.match(html, /matchday\.js\?v=20260914e/);
  assert.match(html, /id="matchdayPoster"/);
  assert.match(html, /id="matchdayResultsPoster"/);
  assert.doesNotMatch(html, /publicsite.css|admin-auth.js|member-auth.js|\son[a-z]+=/);
  for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(script[1], /src="\/js\/[^"]+\?v=202609(?:12[cd]|14e|15[a-z]?)"/);
    assert.equal(script[2].trim(), '');
  }
  assert.match(html, /id="matchdayLoginLink" href="\/member\?return_to=/);
  assert.doesNotMatch(html, /<form|type="password"|matchdayLoginMode|matchdayEmail|Spielleiter|scorekeepers?/i);
  assert.match(html, /Head Refs/);
  assert.doesNotMatch(source, /\/api\/auth\/login|\/api\/admin-login|\/api\/auth\/logout|matchdayPassword/);
  assert.match(html, /data-site-language="de"/);
  assert.match(html, /data-site-language="en"/);
  assert.match(css, /min-height: 62px/);
  assert.match(css, /min-height: 50px/);
  assert.match(css, /matchday-poster/);
  assert.match(source, /15000/);
  assert.match(source, /document.hidden/);
  assert.match(source, /beforeunload/);
});

test('event query accepts only a single UUID and never forwards URL authentication or arbitrary query text', () => {
  assert.equal(ui.readEvent('?event=' + A).id, A);
  assert.equal(ui.readEvent('?event=' + A.toUpperCase()).id, A);
  for (const query of ['?event=<script>', '?event=../admin', '?event=' + A + '&event=' + B, '?event=']) {
    assert.equal(ui.readEvent(query).id, '');
    assert.equal(ui.readEvent(query).invalid, true);
  }
  assert.equal(ui.readEvent('?token=secret').id, '');
  assert.equal(ui.readEvent('').invalid, false);
});

test('selector admits only published/finalized Thursday events', () => {
  const event = fixture().event;
  assert.equal(ui.publishedThursday(event), true);
  assert.equal(ui.publishedThursday({ ...event, status: 'finalized' }), true);
  assert.equal(ui.publishedThursday({ ...event, status: 'draft' }), false);
  assert.equal(ui.publishedThursday({ ...event, session_date: '2026-09-11' }), false);
  assert.equal(ui.publishedThursday({ ...event, id: '<bad>' }), false);
});

test('public itinerary shows meetup, game window, finale awards and safely projected winners', () => {
  const event = fixture().event;
  assert.equal(ui.scheduleClock(event, 15), '18:15');
  const copy = {
    program: 'Itinerary', meetWarmup: 'Meet & warm-up', gamesWindow: 'League games',
    externalRef: 'External Head Ref / admin',
    finale: 'Last Man / Last Woman Standing', finaleAwards: 'Winner +1 BP · runner-up +0.5 BP',
    finaleResults: 'Finale results', winner: 'Winner', runnerUp: 'Runner-up',
    men: 'Last Man Standing', women: 'Last Woman Standing',
  };
  const itinerary = ui.programMarkup(event, copy);
  assert.match(itinerary, /18:00/);
  assert.match(itinerary, /18:15/);
  assert.match(itinerary, /20:00/);
  assert.match(itinerary, /20:10/);
  assert.match(itinerary, /\+1 BP/);
  event.finale_results = {
    men: {
      winner: { display_name: '<Winner>', bonus_points: 1 },
      runner_up: { display_name: 'Runner', bonus_points: 0.5 },
    },
    women: null,
  };
  const finale = ui.finaleMarkup(event, copy);
  assert.match(finale, /&lt;Winner&gt;/);
  assert.doesNotMatch(finale, /<Winner>/);
});

test('two-team fixtures and itinerary clearly require an external Head Ref', () => {
  const event = fixture().event;
  event.teams = event.teams.slice(0, 2);
  event.schedule = buildSchedule(2);
  const copy = {
    program: 'Itinerary', meetWarmup: 'Meet & warm-up', gamesWindow: 'League games',
    externalRef: 'External Head Ref / admin',
    finale: 'Last Man / Last Woman Standing', finaleAwards: 'Winner +1 BP · runner-up +0.5 BP',
  };
  assert.match(ui.programMarkup(event, copy), /External Head Ref \/ admin/);
  const markup = ui.fixtures(event, 'en');
  assert.match(markup, /External Head Ref \/ admin/);
  assert.equal((markup.match(/data-match-number=/g) || []).length, 1);
  assert.doesNotMatch(markup, /Ref team not assigned/);
});

test('real schedule match numbers map to two labeled numeric controls, escaped team names, and explicit submit', () => {
  const event = fixture().event;
  event.teams[0].name = '<img src=x onerror="bad()">';
  const markup = ui.fixtures(event, 'en');
  assert.equal((markup.match(/data-match-number=/g) || []).length, 3);
  assert.equal((markup.match(/type="number"/g) || []).length, 6);
  assert.equal((markup.match(/type="submit"/g) || []).length, 3);
  assert.match(markup, /data-match-number="1"/);
  assert.match(markup, /inputmode="numeric" min="0" max="999" step="1"/);
  assert.match(markup, /for="matchday-score-1-a"/);
  assert.match(markup, /aria-describedby="matchday-message-1"/);
  assert.match(markup, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /18:15/);
  assert.equal((markup.match(/class="league-btn matchday-timer-link"/g) || []).length, 3);
  assert.match(markup, new RegExp('/timer\\?event=' + A + '&amp;match=1'));
  assert.equal(ui.timerPath(A, 1), '/timer?event=' + A + '&match=1');
  assert.equal(ui.timerPath('bad', 1), '');
  assert.match(ui.fixtures(event, 'de'), /Runde 1/);
});

test('anonymous visitors get all tables, server BP-inclusive totals, and the API-selected permanent event URL', async () => {
  let selected = '';
  const { controller, requests } = setup(fixture(A, false), null, { eventId: '', onDefaultEvent: id => { selected = id; } });
  await controller.load();
  assert.equal(controller.state.data.standings[0].points, 7);
  assert.equal(controller.state.data.standings[0].bonus_points, 1);
  assert.equal(controller.state.data.event.id, A);
  assert.equal(selected, A);
  assert.equal(controller.state.requested, A);
  assert.equal(requests[0].url, '/api/league?view=scoring');
  assert.equal(controller.canScore(), false);
  enter(controller);
  assert.equal(await controller.save(1), false);
  assert.equal(writes(requests).length, 0);
});

test('zero scores save as integers with exact event version and real match number, then reload', async () => {
  const data = fixture();
  data.permissions.is_admin = true;
  const { controller, requests } = setup(data, null, { token: 'admin-session' });
  await controller.load();
  enter(controller);
  assert.equal(await controller.save(1), true);
  const request = writes(requests)[0];
  assert.deepEqual(JSON.parse(request.body), { action: 'save_match', event_id: A, version: 3, match_number: 1, score_a: 0, score_b: 4 });
  assert.equal(request.headers.Authorization, 'Bearer admin-session');
  assert.equal(request.credentials, 'include');
  assert.equal(request.cache, 'no-store');
  assert.equal(controller.draftFor(1).dirty, false);
  assert.equal(controller.draftFor(1).message, 'saved');
  assert.equal(controller.draftFor(1).version, 4);
  assert.ok(requests.at(-1).url.startsWith('/api/league?view=scoring&event_id='));
});

test('empty, fractional, exponent, negative and out-of-range entries never write', async () => {
  for (const value of ['', '-1', '1.5', '1e2', '1000', 'NaN']) {
    const { controller, requests } = setup();
    await controller.load();
    enter(controller, 1, value, '0');
    assert.equal(await controller.save(1), false);
    assert.equal(controller.draftFor(1).message, 'invalidScore');
    assert.equal(writes(requests).length, 0);
  }
  assert.equal(ui.validScore('999'), true);
});

test('readonly future, finalized, unscheduled and unassigned states cannot write', async () => {
  for (const change of [{ session_date: '2099-09-10' }, { status: 'finalized' }, { schedule: null }, {}]) {
    const data = fixture(A, false);
    Object.assign(data.event, change);
    // A future date with the same Thursday weekday is required by the public selector.
    if (change.session_date) data.event.session_date = '2099-09-17';
    const { controller, requests } = setup(data);
    await controller.load();
    assert.ok(controller.state.data);
    enter(controller);
    assert.equal(await controller.save(1), false);
    assert.equal(writes(requests).length, 0);
  }
});

test('overlapping polls share one read; navigation discards the old event response', async () => {
  const pending = deferred();
  const first = fixture(A);
  const second = fixture(B);
  let count = 0;
  const { controller, requests } = setup(first, url => {
    if (!url.startsWith('/api/league?')) return reply(401, {});
    count++;
    return count === 1 ? pending.promise : reply(200, second);
  });
  const loading = controller.load();
  void controller.load();
  controller.select(B);
  assert.equal(count, 1);
  pending.resolve(reply(200, first));
  await loading;
  await tick();
  assert.equal(controller.state.data.event.id, B);
  assert.equal(controller.state.requested, B);
  assert.equal(count, 2);
  assert.equal(writes(requests).length, 0);
});

test('polling retains both unsaved values, original versions, and never submits', async () => {
  const data = fixture();
  const { controller, requests } = setup(data);
  await controller.load();
  enter(controller, 1, '8', '2');
  data.event.version++;
  data.event.schedule.rounds[0].matches[0].score_a = 9;
  data.event.schedule.rounds[0].matches[0].score_b = 1;
  await controller.load();
  assert.equal(controller.draftFor(1).a, '8');
  assert.equal(controller.draftFor(1).b, '2');
  assert.equal(controller.draftFor(1).version, 3);
  assert.equal(controller.draftFor(1).conflict, true);
  assert.equal(writes(requests).length, 0);
});

test('focused inputs retain their baseline even before typing, so a poll cannot silently rebase an edit', async () => {
  const data = fixture();
  const { controller } = setup(data);
  await controller.load();
  controller.focus(1, true);
  data.event.version++;
  data.event.schedule.rounds[0].matches[0].score_a = 5;
  data.event.schedule.rounds[0].matches[0].score_b = 3;
  await controller.load();
  assert.equal(controller.draftFor(1).a, '');
  assert.equal(controller.draftFor(1).b, '');
  assert.equal(controller.draftFor(1).conflict, true);
  assert.equal(controller.draftFor(1).dirty, true);
  assert.equal(controller.draftFor(1).version, 3);
});

test('three-to-four-team regeneration blocks retained stale cards, preserving the independent dirty game', async () => {
  const data = fixture();
  const app = fixtureApp(data);
  await tick();
  app.edit(1, '7', '2');
  const dirtyCard = app.form(1);
  const untouchedCard = app.form(2);
  const oldInputs = untouchedCard.querySelectorAll('input[data-side]');
  assert.deepEqual(untouchedCard.querySelectorAll('.matchday-team-name').slice(0, 2).map(label => label.textContent), ['Team 1', 'Team 3']);
  assert.equal(oldInputs[0].readOnly, false);
  regenerate(data, 4);
  const currentMatch = data.event.schedule.rounds.flatMap(round => round.matches).find(match => match.number === 2);
  assert.deepEqual([currentMatch.team_a, currentMatch.team_b], [2, 3]);
  await app.refresh();
  assert.equal(app.form(1), dirtyCard);
  assert.equal(app.form(2), untouchedCard);
  assert.deepEqual(dirtyCard.querySelectorAll('input[data-side]').map(input => input.value), ['7', '2']);
  assert.equal(dirtyCard.classList.contains('is-conflict'), true);
  assert.equal(dirtyCard.querySelector('[data-review="keep"]').disabled, true);
  assert.deepEqual(untouchedCard.querySelectorAll('.matchday-team-name').slice(0, 2).map(label => label.textContent), ['Team 1', 'Team 3']);
  assert.equal(oldInputs.every(input => input.readOnly), true);
  assert.equal(untouchedCard.querySelector('.matchday-save').disabled, true);
  assert.match(untouchedCard.querySelector('.matchday-game-message').textContent, /Fixture changed/);
  assert.equal(untouchedCard.querySelector('.matchday-read-scores strong').textContent, '– : –');
  app.edit(2, '8', '1'); // Even a late input/submit event from this retained card must not bind to the new match.
  await app.save(2);
  assert.equal(writes(app.requests).length, 0);
  assert.equal(currentMatch.score_a, null);
  assert.deepEqual(dirtyCard.querySelectorAll('input[data-side]').map(input => input.value), ['7', '2']);

  app.review(1, false);
  assert.notEqual(app.form(2), untouchedCard);
  assert.deepEqual(app.form(2).querySelectorAll('.matchday-team-name').slice(0, 2).map(label => label.textContent), ['Team 2', 'Team 3']);
  assert.equal(app.form(2).querySelectorAll('input[data-side]').every(input => !input.readOnly), true);
  app.edit(2, '8', '1');
  await app.save(2);
  assert.equal(writes(app.requests).length, 1);
  assert.equal(JSON.parse(writes(app.requests)[0].body).version, 4);
  assert.equal(currentMatch.score_a, 8);
  assert.equal(currentMatch.score_b, 1);
});

test('a retained draft never adopts a different fixture, even if a rebuilt card has the new identity', async () => {
  const data = fixture();
  const { controller, requests } = setup(data);
  await controller.load();
  const oldMatch = data.event.schedule.rounds.flatMap(round => round.matches).find(match => match.number === 2);
  const oldIdentity = ui.fixtureIdentity(data.event, oldMatch);
  enter(controller, 2, '4', '1');
  regenerate(data, 4);
  await controller.load();
  const newMatch = data.event.schedule.rounds.flatMap(round => round.matches).find(match => match.number === 2);
  const newIdentity = ui.fixtureIdentity(data.event, newMatch);
  assert.notEqual(oldIdentity, newIdentity);
  assert.equal(controller.draftFor(2).identity, oldIdentity);
  assert.equal(controller.canEditMatch(2, oldIdentity), false);
  assert.equal(controller.canEditMatch(2, newIdentity), false);
  controller.review(2, true, newIdentity);
  assert.equal(controller.draftFor(2).conflict, true);
  controller.edit(2, 'a', '9', newIdentity);
  assert.equal(controller.draftFor(2).a, '4');
  assert.equal(await controller.save(2, newIdentity), false);
  assert.equal(writes(requests).length, 0);
  controller.review(2, false, oldIdentity);
  assert.equal(controller.draftFor(2).dirty, false);
  assert.equal(controller.canEditMatch(2, oldIdentity), false);
  assert.equal(controller.canEditMatch(2, newIdentity), true);
});

test('returning to a regenerated matchday keeps original draft labels until explicit discard, then unlocks current fixtures', async () => {
  const data = fixture();
  const app = fixtureApp(data);
  await tick();
  app.edit(1, '5', '1');
  const originalNames = app.form(1).querySelectorAll('.matchday-team-name').map(label => label.textContent);
  regenerate(data, 4);
  await app.refresh();
  await app.select(fixture(B));
  await app.select(data);
  const originalDraft = app.form(1);
  assert.deepEqual(originalDraft.querySelectorAll('.matchday-team-name').map(label => label.textContent), originalNames);
  assert.deepEqual(originalDraft.querySelectorAll('input[data-side]').map(input => input.value), ['5', '1']);
  assert.equal(originalDraft.querySelectorAll('input[data-side]').every(input => input.readOnly), true);
  app.review(1, false);
  assert.notEqual(app.form(1), originalDraft);
  assert.deepEqual(app.form(1).querySelectorAll('.matchday-team-name').slice(0, 2).map(label => label.textContent), ['Team 1', 'Team 4']);
  assert.equal(app.form(1).querySelectorAll('input[data-side]').every(input => !input.readOnly), true);
});

test('score-only polling keeps unchanged fixture cards editable while another game has a draft', async () => {
  const data = fixture();
  const app = fixtureApp(data);
  await tick();
  app.edit(1, '6', '2');
  const untouchedCard = app.form(2);
  data.event.version++;
  await app.refresh();
  assert.equal(app.form(2), untouchedCard);
  assert.equal(untouchedCard.querySelectorAll('input[data-side]').every(input => !input.readOnly), true);
  app.edit(2, '3', '1');
  await app.save(2);
  assert.equal(writes(app.requests).length, 1);
  assert.equal(JSON.parse(writes(app.requests)[0].body).version, 4);
  assert.deepEqual(app.form(1).querySelectorAll('input[data-side]').map(input => input.value), ['6', '2']);
});

test('409 requires explicit review, retains inputs, and never blindly retries or overwrites', async () => {
  const data = fixture();
  let conflict = true;
  const { controller, requests } = setup(data, (url, options, base) => {
    if (url === '/api/league' && conflict) {
      data.event.version++;
      data.event.schedule.rounds[0].matches[0].score_a = 1;
      data.event.schedule.rounds[0].matches[0].score_b = 1;
      return reply(409, { code: 'CONFLICT' });
    }
    return base(url, options);
  });
  await controller.load();
  enter(controller, 1, '5', '2');
  assert.equal(await controller.save(1), false);
  assert.equal(writes(requests).length, 1);
  assert.equal(controller.draftFor(1).a, '5');
  assert.equal(controller.draftFor(1).conflict, true);
  assert.equal(controller.draftFor(1).reviewReady, true);
  assert.equal(await controller.save(1), false);
  controller.review(1, true);
  assert.equal(writes(requests).length, 1);
  assert.equal(controller.draftFor(1).version, 4);
  assert.equal(controller.draftFor(1).dirty, true);
  conflict = false;
  assert.equal(await controller.save(1), true);
  assert.equal(writes(requests).length, 2);
});

test('review cannot keep an entry for a changed pairing; discarding one draft preserves the other', async () => {
  const data = fixture();
  const { controller } = setup(data);
  await controller.load();
  enter(controller, 1, '6', '2');
  enter(controller, 2, '7', '1');
  data.event.version++;
  data.event.schedule.rounds[0].matches[0].team_a = 99;
  await controller.load();
  controller.review(1, true);
  assert.equal(controller.draftFor(1).conflict, true);
  controller.review(1, false);
  assert.equal(controller.draftFor(1).dirty, false);
  assert.equal(controller.draftFor(2).a, '7');
  assert.equal(controller.draftFor(2).dirty, true);
});

test('lost save response is not labeled Saved and requires review of a possibly committed write', async () => {
  const { controller, requests } = setup(fixture(), (url, options, base) => {
    if (url === '/api/league') { base(url, options); throw new Error('Connection lost after commit'); }
    return base(url, options);
  });
  await controller.load();
  enter(controller, 1, '6', '0');
  assert.equal(await controller.save(1), false);
  assert.equal(controller.draftFor(1).message, 'unknownSave');
  assert.equal(controller.draftFor(1).a, '6');
  assert.equal(controller.draftFor(1).conflict, true);
  assert.equal(writes(requests).length, 1);
  controller.review(1, false);
  assert.equal(controller.draftFor(1).dirty, false);
});

test('403 revokes write controls without discarding a draft or claiming success', async () => {
  const data = fixture();
  const { controller, requests } = setup(data, (url, options, base) => {
    if (url === '/api/league') {
      data.permissions.can_score = false;
      data.permissions.is_scorekeeper = false;
      return reply(403, { code: 'FORBIDDEN' });
    }
    return base(url, options);
  });
  await controller.load();
  enter(controller);
  assert.equal(await controller.save(1), false);
  assert.equal(controller.canScore(), false);
  assert.equal(controller.state.authNotice, 'forbidden');
  assert.equal(controller.draftFor(1).dirty, true);
  assert.notEqual(controller.draftFor(1).message, 'saved');
  assert.equal(writes(requests).length, 1);
});

test('expired admin token is cleared, with public results still available', async () => {
  const removed = [];
  const { controller, requests } = setup(fixture(A, false), (url, options, base) => {
    if (options.headers && options.headers.Authorization) return reply(401, { code: 'INVALID_TOKEN' });
    return base(url, options);
  }, { token: 'expired', storeToken: value => removed.push(value) });
  await controller.load();
  assert.deepEqual(removed, ['']);
  assert.equal(controller.state.authNotice, 'expired');
  assert.equal(controller.state.data.event.id, A);
  assert.equal(requests.filter(request => request.headers && request.headers.Authorization).length, 1);
});

test('member access expiry refreshes cookies once but never silently resubmits a score', async () => {
  let refreshed = false;
  const data = fixture();
  const { controller, requests } = setup(data, (url, options, base) => {
    if (url === '/api/league') return reply(401, { code: 'INVALID_TOKEN' });
    if (url === '/api/auth/refresh') { refreshed = true; return reply(200, { user: { id: 'member' } }); }
    return base(url, options);
  });
  await controller.load();
  enter(controller);
  assert.equal(await controller.save(1), false);
  assert.equal(refreshed, true);
  assert.equal(controller.state.authNotice, 'restored');
  assert.equal(controller.draftFor(1).dirty, true);
  assert.equal(writes(requests).length, 1);
  const refresh = requests.find(request => request.url === '/api/auth/refresh');
  assert.equal(refresh.credentials, 'include');
  assert.equal(refresh.method, 'POST');
});

test('failed member renewal is attempted only once after a 401 save', async () => {
  const data = fixture();
  let expired = false;
  const { controller, requests } = setup(data, (url, options, base) => {
    if (url === '/api/league') {
      expired = true;
      data.permissions = { is_admin: false, is_scorekeeper: false, can_score: false };
      return reply(401, { code: 'INVALID_TOKEN' });
    }
    if (expired && url.startsWith('/api/league?') && options.credentials !== 'omit') return reply(401, {});
    return base(url, options);
  });
  await controller.load();
  enter(controller);
  assert.equal(await controller.save(1), false);
  assert.equal(requests.filter(request => request.url === '/api/auth/refresh').length, 1);
  assert.equal(controller.draftFor(1).dirty, true);
  assert.equal(controller.state.authNotice, 'expired');
});

test('global write guard prevents double submits and waits for an active poll before checking version', async () => {
  const pending = deferred();
  let writesStarted = 0;
  const { controller } = setup(fixture(), (url, options, base) => {
    if (url === '/api/league') { writesStarted++; return pending.promise; }
    return base(url, options);
  });
  await controller.load();
  enter(controller, 1);
  enter(controller, 2);
  const saving = controller.save(1);
  assert.equal(await controller.save(1), false);
  assert.equal(await controller.save(2), false);
  await controller.load();
  assert.equal(writesStarted, 1);
  pending.resolve(reply(409, { code: 'CONFLICT' }));
  await saving;
  assert.equal(controller.state.saving, null);
});

test('drafts survive changing event and returning through history selection', async () => {
  const a = fixture(A);
  const b = fixture(B);
  const { controller } = setup(a, url => reply(200, url.includes(B) ? b : a));
  await controller.load();
  enter(controller, 1, '9', '1');
  controller.select(B);
  await tick();
  assert.equal(controller.state.data.event.id, B);
  controller.select(A);
  await tick();
  assert.equal(controller.draftFor(1).a, '9');
  assert.equal(controller.draftFor(1).dirty, true);
});

test('rate-limited scores honor retry_after without overwriting the draft or retrying in the background', async () => {
  let now = 10000;
  const { controller, requests } = setup(fixture(), (url, options, base) => url === '/api/league'
    ? reply(429, { retry_after: 7 }) : base(url, options), { now: () => now });
  await controller.load();
  enter(controller);
  assert.equal(await controller.save(1), false);
  assert.equal(controller.state.retryUntil, 17000);
  assert.equal(controller.draftFor(1).dirty, true);
  assert.equal(await controller.save(1), false);
  assert.equal(writes(requests).length, 1);
  now = 17001;
  assert.equal(await controller.save(1), false);
  assert.equal(writes(requests).length, 2);
  assert.equal(ui.retrySeconds({ retryAfter: 8 }), 8);
  assert.equal(ui.retrySeconds({ retry_after: -100 }), 1);
  assert.equal(ui.retrySeconds({ retry_after: Infinity }), 86400);
});

test('member login links contain only the allowlisted matchday and safe event identifier', () => {
  assert.equal(ui.memberLoginHref(A), '/member?return_to=' + encodeURIComponent('/spieltag?event=' + A));
  assert.equal(ui.memberLoginHref(A.toUpperCase()), ui.memberLoginHref(A));
  for (const input of ['', undefined, 'https://evil.example', A + '&token=secret', '../admin']) {
    assert.equal(ui.memberLoginHref(input), '/member?return_to=%2Fspieltag');
  }
});

test('already signed-in ordinary members are recognized without refresh loops or another login', async () => {
  const data = fixture(A, false);
  const { controller, requests } = setup(data, (url, options, base) => {
    if (url === '/api/member/stats?view=account') return reply(200, { user: { id: 'member' } });
    return base(url, options);
  });
  await controller.load();
  await controller.load();
  assert.equal(controller.state.memberKnown, true);
  assert.equal(controller.canScore(), false);
  assert.equal(requests.filter(request => request.url === '/api/auth/refresh').length, 0);
  assert.equal(controller.login, undefined);
});

test('Head Ref is only a display label and existing permission responses activate scoring immediately', async () => {
  const app = fixtureApp();
  await tick();
  assert.equal(app.elements.get('matchdayAuthSummary').textContent, 'Head Ref · signed in');
  assert.equal(app.elements.get('matchdayLoginLink').hidden, true);
  assert.equal(app.form(1).querySelectorAll('input[data-side]').every(input => !input.readOnly), true);
  assert.equal(app.requests.some(request => request.url.startsWith('/api/auth/')), false);
  assert.match(source, /permissions\.is_scorekeeper/);
  assert.doesNotMatch(source, /set_scorekeeper|league_head_ref|is_head_ref/);
});

test('central navigation can drain a pending refresh before the normal login engine starts', async () => {
  const pending = deferred();
  const order = [];
  const data = fixture(A, false);
  const { controller } = setup(data, async (url, options, base) => {
    if (url === '/api/auth/refresh') {
      order.push('refresh start');
      const response = await pending.promise;
      order.push('refresh end');
      return response;
    }
    return base(url, options);
  });
  const loading = controller.load();
  await tick();
  let ready = false;
  const navigation = controller.waitForRead().then(() => { ready = true; });
  await tick();
  assert.equal(ready, false);
  assert.deepEqual(order, ['refresh start']);
  pending.resolve(reply(200, { user: { id: 'old-member' } }));
  await loading;
  await navigation;
  assert.equal(ready, true);
  assert.deepEqual(order, ['refresh start', 'refresh end']);
});

test('central sign-in preserves local drafts and requires review after returning to the same event', async () => {
  const data = fixture();
  const app = fixtureApp(data);
  await tick();
  app.edit(1, '7', '2');
  data.permissions = { is_admin: false, is_scorekeeper: false, can_score: false };
  await app.refresh();
  assert.equal(app.elements.get('matchdayLoginLink').hidden, false);
  await app.login();
  assert.deepEqual(app.redirects, [ui.memberLoginHref(A)]);
  assert.equal(app.storage.has('vi_matchday_drafts'), true);
  let warned = false;
  app.windowEvents.beforeunload({ preventDefault() { warned = true; } });
  assert.equal(warned, false);

  const restored = fixtureApp(fixture(), { storage: app.storage });
  await tick();
  assert.deepEqual(restored.form(1).querySelectorAll('input[data-side]').map(input => input.value), ['7', '2']);
  assert.equal(restored.form(1).querySelector('.matchday-save').disabled, true);
  assert.match(restored.form(1).querySelector('.matchday-game-message').textContent, /restored/i);
  assert.equal(writes(restored.requests).length, 0);
  restored.review(1, true);
  await restored.save(1);
  assert.equal(writes(restored.requests).length, 1);
  assert.equal(app.storage.has('vi_matchday_drafts'), false);
});

test('unavailable draft storage opens central sign-in separately without abandoning the original drafts', async () => {
  const app = fixtureApp(fixture(), { blockStorage: true });
  await tick();
  app.edit(1, '5', '1');
  await app.login();
  assert.deepEqual(app.redirects, []);
  assert.deepEqual(app.opened, [[ui.memberLoginHref(A), '_blank', 'noopener']]);
  assert.deepEqual(app.form(1).querySelectorAll('input[data-side]').map(input => input.value), ['5', '1']);
  let warned = false;
  app.windowEvents.beforeunload({ preventDefault() { warned = true; } });
  assert.equal(warned, true);
});

test('login retains its clicked link when storage becomes unavailable after the pending read', async () => {
  const options = {};
  const app = fixtureApp(fixture(), options);
  await tick();
  app.edit(1, '5', '1');
  const link = app.elements.get('matchdayLoginLink');
  const event = { button: 0, currentTarget: link, preventDefault() {} };
  const navigation = link.listeners.click(event);
  event.currentTarget = null;
  options.blockStorage = true;
  await navigation;
  assert.equal(link.target, '_blank');
  assert.deepEqual(app.redirects, []);
  assert.deepEqual(app.form(1).querySelectorAll('input[data-side]').map(input => input.value), ['5', '1']);
  await app.login();
  assert.deepEqual(app.opened, [[ui.memberLoginHref(A), '_blank', 'noopener']]);
});

test('draft serialization excludes authentication data and restored revoked members remain read-only', async () => {
  const { controller } = setup();
  await controller.load();
  enter(controller, 1, '9', '3');
  controller.draftFor(1).token = 'never-store-this';
  controller.draftFor(1).password = 'never-store-this';
  const saved = ui.draftSnapshot(controller.state);
  assert.doesNotMatch(saved, /never-store-this|password|token/);
  const { controller: returned, requests } = setup(fixture(A, false), null, { drafts: saved });
  await returned.load();
  assert.equal(returned.canScore(), false);
  assert.equal(returned.draftFor(1).a, '9');
  assert.equal(returned.draftFor(1).conflict, true);
  returned.review(1, true);
  assert.equal(await returned.save(1), false);
  assert.equal(writes(requests).length, 0);
  for (const invalid of ['not-json', '{}', JSON.stringify([['__proto__', { a: '1' }]]), 'x'.repeat(100001)]) {
    assert.equal(ui.restoreDrafts(invalid).size, 0);
  }
  const valid = JSON.parse(saved)[0];
  const corrupt = [valid[0], { ...valid[1], identity: '{broken' }];
  const recovered = ui.restoreDrafts(JSON.stringify([corrupt, valid]));
  assert.equal(recovered.size, 1);
  assert.equal(recovered.get(valid[0]).a, '9');
});

test('invalid member cookies never prevent the cookie-free public table fallback', async () => {
  const { controller, requests } = setup(fixture(A, false), (url, options, base) => {
    if (url.startsWith('/api/league?') && options.credentials !== 'omit') return reply(401, {});
    return base(url, options);
  });
  await controller.load();
  assert.equal(controller.state.data.event.id, A);
  assert.equal(controller.canScore(), false);
  assert.equal(requests.filter(request => request.url === '/api/auth/refresh').length, 1);
  assert.ok(requests.some(request => request.url.startsWith('/api/league?') && request.credentials === 'omit'));
});

test('a bad or wrong-event response is never applied to the selected matchday', async () => {
  const { controller } = setup(fixture(), () => reply(200, fixture(B)));
  await controller.load();
  assert.equal(controller.state.data, null);
  assert.equal(controller.state.error, 'network');
});
