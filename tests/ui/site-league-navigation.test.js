const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const frozenArchive = read('data/season-1.json');
const settle = () => new Promise(resolve => setImmediate(resolve));
const current = () => ({
  season: { id: 'current', name: 'Season 2', start_date: '2026-09-14', end_date: '2027-07-02', placement_points: [3, 2, 1], scoring_mode: 'fixed' },
  seasons: [{ id: 'current', name: 'Season 2' }, { id: 'season-1', name: 'Season 1' }],
  standings: [{ rank: 1, display_name: 'Test player', points: 3, played: 1, wins: 1 }],
  events: []
});

function page(hash = '') {
  const listeners = {}, documentListeners = {}, windowListeners = {};
  const document = { activeElement: null, addEventListener: (name, fn) => { documentListeners[name] = fn; } };
  function element(attrs = {}) {
    return {
      attrs, dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) =>
        [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      hidden: false, innerHTML: '', textContent: '',
      getAttribute: key => attrs[key] ?? null,
      hasAttribute: key => key in attrs,
      setAttribute: (key, value) => { attrs[key] = value; },
      matches(selector) {
        const [, key, value] = selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/) || [];
        return key in attrs && (value === undefined || attrs[key] === value);
      },
      closest(selector) { return this.matches(selector) ? this : null; },
      focus() { document.activeElement = this; }
    };
  }
  let html = '', nodes = [];
  const content = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      nodes = [...value.matchAll(/<\w+\b([^>]*)>/g)].map(match => element(Object.fromEntries(
        [...match[1].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g)].map(attr => [attr[1], attr[2] || ''])
      )));
    },
    querySelector: selector => nodes.find(node => node.matches(selector)) || null,
    querySelectorAll: selector => nodes.filter(node => node.matches(selector)),
    contains: node => nodes.includes(node)
  };
  const honours = element({ 'data-league-hof': '', href: '#hall-of-fame' });
  const intro = element();
  const league = {
    querySelector: selector => selector === '[data-league-content]' ? content : selector === '[data-league-hof]' ? honours : intro,
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  let scrolls = 0;
  document.getElementById = id => id === 'publicLeague' ? league : { scrollIntoView() { scrolls++; } };
  const location = { hash };
  const entries = [hash];
  let position = 0;
  const history = {
    pushState(state, title, next) { entries.splice(++position); entries.push(next); location.hash = next; },
    back() { if (position) { location.hash = entries[--position]; windowListeners.hashchange(); } },
    forward() { if (position < entries.length - 1) { location.hash = entries[++position]; windowListeners.hashchange(); } }
  };
  const requests = [];
  const window = { SiteLanguage: { get: () => 'en' }, addEventListener: (name, fn) => { windowListeners[name] = fn; } };
  const context = vm.createContext({
    window, document, location, history, console: { error() {} },
    fetch: url => new Promise(resolve => requests.push({
      url, resolve: (body, ok = true) => resolve({ ok, status: ok ? 200 : 503, json: async () => body })
    }))
  });
  for (const file of ['site-utils', 'league-scoring', 'league-archive', 'league-ui', 'site-league']) {
    vm.runInContext(read(`js/${file}.js`), context);
  }
  const find = selector => content.querySelector(selector);
  function trigger(type, selector, value) {
    const target = selector === '[data-league-hof]' ? honours : find(selector);
    assert.ok(target, `Missing control: ${selector}`);
    if (type === 'change') target.value = value;
    const event = { target, key: type === 'keydown' ? value : undefined, prevented: false, preventDefault() { this.prevented = true; } };
    listeners[type](event);
    return event;
  }
  return {
    content, honours, find, trigger, history, location, requests, document,
    language: lang => documentListeners['site-language-change']({ detail: { lang } }),
    hash(next) { location.hash = next; windowListeners.hashchange(); },
    get scrolls() { return scrolls; }
  };
}

async function ready(hash) {
  const result = page(hash);
  result.requests[0].resolve(current());
  result.requests[1].resolve(JSON.parse(frozenArchive));
  await settle();
  return result;
}

function active(page, panel) {
  assert.equal(page.find(`[data-league-tab="${panel}"]`).attrs['aria-selected'], 'true');
  assert.equal(page.find(`[data-league-panel="${panel}"]`).hidden, false);
  assert.equal(page.find(`[data-league-panel="${panel}"]`).attrs.tabindex, '0');
  for (const node of page.content.querySelectorAll('[data-league-panel]')) {
    assert.equal(node.hidden, node.dataset.leaguePanel !== panel);
  }
}

test('one season selector and a permanent Hall of Fame link work while either season is loading', async () => {
  const home = read('index.html');
  assert.ok(home.indexOf('data-league-hof') < home.indexOf('data-league-content'));
  const result = page();
  result.trigger('click', '[data-league-hof]');
  assert.equal(result.location.hash, '#hall-of-fame');
  assert.equal(result.honours.attrs['aria-current'], 'location');
  assert.match(result.content.innerHTML, /role="status"/);
  result.requests[0].resolve(current());
  result.requests[1].resolve(JSON.parse(frozenArchive));
  await settle();
  active(result, 'honours');
  assert.equal((result.content.innerHTML.match(/data-league-season/g) || []).length, 1);
  assert.equal((result.content.innerHTML.match(/option value="season-1"/g) || []).length, 1);
  result.trigger('click', '[data-league-tab="standings"]');
  active(result, 'standings');
  result.trigger('click', '[data-league-hof]');
  active(result, 'honours');
  assert.equal(result.requests.length, 2);
});

test('Hall of Fame remains usable when the public API fails; archive failure has a working retry', async () => {
  const result = page();
  result.requests[0].resolve({}, false);
  result.requests[1].resolve({}, false);
  await settle();
  result.trigger('click', '[data-league-hof]');
  assert.match(result.content.innerHTML, /role="alert"/);
  assert.equal(result.honours.attrs['aria-current'], 'location');
  result.trigger('click', '[data-league-refresh]');
  assert.equal(result.requests[2].url, '/data/season-1.json');
  result.requests[2].resolve(JSON.parse(frozenArchive));
  await settle();
  active(result, 'honours');
  assert.match(result.content.innerHTML, /125 players/);
});

test('direct hashes select the correct panel, including frozen archive routes', async () => {
  for (const [hash, panel] of [
    ['#hall-of-fame', 'honours'], ['#season-1', 'standings'],
    ['#training-league-standings', 'standings'], ['#training-league-schedule', 'schedule'],
    ['#training-league', 'standings'], ['#rankings', 'standings'], ['#training-league-teams', 'teams']
  ]) {
    const result = await ready(hash);
    active(result, panel);
    assert.ok(result.scrolls > 0);
    assert.equal(result.honours.attrs['aria-current'], panel === 'honours' ? 'location' : 'false');
  }
});

test('Back and Forward restore current panels, Hall of Fame, and the original hashless homepage', async () => {
  const result = await ready();
  active(result, 'standings');
  result.trigger('click', '[data-league-tab="teams"]');
  assert.equal(result.location.hash, '#training-league-teams');
  result.trigger('click', '[data-league-hof]');
  result.trigger('change', '[data-league-season]', 'current');
  result.requests[2].resolve(current());
  await settle();
  active(result, 'standings');
  result.history.back();
  active(result, 'honours');
  result.history.back();
  active(result, 'teams');
  result.history.back();
  assert.equal(result.location.hash, '');
  active(result, 'standings');
  result.history.forward();
  active(result, 'teams');
  result.hash('#about');
  assert.equal(result.location.hash, '#about');
  active(result, 'teams');
});

test('keyboard tabs wrap with arrows and support Home/End; focus survives language and season changes', async () => {
  const result = await ready();
  result.find('[data-league-tab="standings"]').focus();
  assert.equal(result.trigger('keydown', '[data-league-tab="standings"]', 'ArrowLeft').prevented, true);
  active(result, 'schedule');
  assert.equal(result.document.activeElement.dataset.leagueTab, 'schedule');
  result.trigger('keydown', '[data-league-tab="schedule"]', 'Home');
  active(result, 'standings');
  result.trigger('keydown', '[data-league-tab="standings"]', 'End');
  active(result, 'schedule');
  result.language('de');
  assert.equal(result.document.activeElement.dataset.leagueTab, 'schedule');
  active(result, 'schedule');
  result.find('[data-league-season]').focus();
  result.trigger('change', '[data-league-season]', 'season-1');
  assert.equal(result.document.activeElement.hasAttribute('data-league-season'), true);
  result.trigger('keydown', '[data-league-tab="standings"]', 'ArrowRight');
  active(result, 'honours');
  result.language('en');
  active(result, 'honours');
  assert.match(result.content.innerHTML, /Honouring our top three/);
  assert.equal(read('data/season-1.json'), frozenArchive);
});

test('Season 2 standings are the homepage default and stay selected after refresh and language changes', async () => {
  const result = await ready();
  active(result, 'standings');
  assert.match(result.content.innerHTML, /option value="current" selected>Season 2/);
  assert.equal(result.content.querySelectorAll('[data-league-tab]')[0].dataset.leagueTab, 'standings');
  result.language('de');
  active(result, 'standings');
  result.trigger('click', '[data-league-refresh]');
  assert.equal(result.requests[2].url, '/api/league?view=public&season_id=current');
  result.requests[2].resolve(current());
  await settle();
  active(result, 'standings');
});
