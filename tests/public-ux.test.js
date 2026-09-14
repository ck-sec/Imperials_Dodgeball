const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const publicPages = ['index.html', 'dodgeball-wien.html', 'jugendtraining-wien.html', 'impressum.html', 'datenschutz.html'];

function element(dataset = {}) {
  const classes = new Set();
  return {
    dataset, attrs: {}, hidden: false, textContent: '', innerHTML: '',
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key] ?? null; },
    style: { removeProperty() {} },
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    }
  };
}

function languagePage(saved, failStorage = false) {
  const events = {};
  const windowEvents = {};
  const storage = new Map(saved ? [['vi_site_language', saved]] : []);
  const toggles = [element({ siteLanguage: 'de' }), element({ siteLanguage: 'en' })];
  const blocks = [element({ lang: 'de' }), element({ lang: 'en' })];
  const copy = element({ en: 'English content' });
  copy.textContent = 'Deutscher Inhalt';
  const input = element();
  input.attrs = { placeholder: 'Dein Name', 'data-en-placeholder': 'Your name' };
  const menu = element();
  menu.attrs = { 'aria-label': 'Menü öffnen oder schließen', 'data-en-aria-label': 'Open or close menu' };
  const warnings = [];
  const document = {
    readyState: 'complete', documentElement: {},
    querySelectorAll(selector) {
      if (selector === '[data-site-language]') return toggles;
      if (selector === '[data-en]') return [copy];
      if (selector === '[data-en-placeholder]') return [input];
      if (selector === '[data-en-aria-label]') return [menu];
      return blocks;
    },
    addEventListener(name, fn) { (events[name] ||= []).push(fn); },
    dispatchEvent(event) { (events[event.type] || []).forEach(fn => fn(event)); }
  };
  const window = { addEventListener(name, fn) { windowEvents[name] = fn; } };
  const context = vm.createContext({
    document, window,
    localStorage: {
      getItem(key) { if (failStorage) throw new Error('blocked'); return storage.get(key); },
      setItem(key, value) { if (failStorage) throw new Error('blocked'); storage.set(key, value); }
    },
    console: { warn(...args) { warnings.push(args); } },
    CustomEvent: function (type, options) { return { type, ...options }; }
  });
  for (const file of ['js/site-language.js', 'js/site-lang.js']) vm.runInContext(read(file), context);
  return { window, document, toggles, blocks, copy, input, menu, storage, warnings, windowEvents, context };
}

test('one shared DE/EN control replaces independent homepage toggles', () => {
  const home = read('index.html');
  assert.equal((home.match(/data-site-language="/g) || []).length, 2);
  assert.doesNotMatch(home, /faqBtnDe|faqBtnEn|data-league-lang|class="lang-btn/);
  assert.match(home, /id="faqDe"[^>]*data-public-language="de"/);
  assert.match(home, /id="faqEn"[^>]*data-public-language="en"/);
});

test('public scripts comply with self-only CSP without executable inline handlers', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.doesNotMatch(html, /\bon(?:focus|blur|load|click|error|submit|change)\s*=/i, file);
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/type="application\/ld\+json"/.test(script[1])) JSON.parse(script[2]);
      else {
        assert.match(script[1], /src="\/js\/[^"]+\?v=202609(?:12[b-d]?|14d)"/, file);
        assert.equal(script[2].trim(), '', file);
      }
    }
    assert.doesNotMatch(html, /(?:href|src)="https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com)/);
    assert.match(html, /(?:href="\/fonts\/fonts\.css"|src:url\(\/fonts\/)/, file);
    assert.match(html, /public-ui\.css\?v=20260912b"/);
    assert.match(html, /site-lang\.js\?v=20260912b"/);
  }
  assert.doesNotMatch(read('dodgeball-wien.html'), /<iframe\b|site-cookies\.js/);
  assert.doesNotMatch(read('index.html'), /cookieBanner|site-cookies\.js/);
});

test('default German and stored English update every section and active toggle', () => {
  const de = languagePage();
  assert.equal(de.window.SiteLanguage.get(), 'de');
  assert.equal(de.document.documentElement.lang, 'de');
  assert.equal(de.blocks[0].hidden, false);
  assert.equal(de.blocks[1].hidden, true);
  const en = languagePage('en');
  assert.equal(en.copy.textContent, 'English content');
  assert.equal(en.toggles[1].attrs['aria-pressed'], 'true');
  en.window.SiteLanguage.set('de');
  assert.equal(en.copy.textContent, 'Deutscher Inhalt');
  assert.equal(en.storage.get('vi_site_language'), 'de');
  assert.equal(en.blocks[0].hidden, false);
  assert.equal(en.blocks[1].hidden, true);
  en.window.SiteLanguage.set('fr');
  assert.equal(en.window.SiteLanguage.get(), 'de');
});

test('language persists across pages, supports document clicks and cross-tab changes', () => {
  const first = languagePage();
  first.document.dispatchEvent({ type: 'click', target: { closest: () => first.toggles[1] } });
  const second = languagePage(first.storage.get('vi_site_language'));
  assert.equal(second.window.SiteLanguage.get(), 'en');
  second.windowEvents.storage({ key: 'vi_site_language', newValue: 'de' });
  assert.equal(second.copy.textContent, 'Deutscher Inhalt');
  second.windowEvents.storage({ key: 'irrelevant', newValue: 'en' });
  assert.equal(second.window.SiteLanguage.get(), 'de');
  second.window.SiteLanguage.set('en');
  second.windowEvents.storage({ key: null, newValue: null });
  assert.equal(second.window.SiteLanguage.get(), 'de');
});

test('blocked storage keeps an in-memory preference and initialization is idempotent', () => {
  const page = languagePage(null, true);
  page.window.SiteLanguage.set('en');
  assert.equal(page.copy.textContent, 'English content');
  assert.equal(page.warnings.length, 1);
  const api = page.window.SiteLanguage;
  vm.runInContext(read('js/site-language.js'), page.context);
  assert.equal(page.window.SiteLanguage, api);
});

test('translated placeholders and accessible labels restore their German originals', () => {
  const page = languagePage('en');
  assert.equal(page.input.attrs.placeholder, 'Your name');
  assert.equal(page.menu.attrs['aria-label'], 'Open or close menu');
  page.window.SiteLanguage.set('de');
  assert.equal(page.input.attrs.placeholder, 'Dein Name');
  assert.equal(page.menu.attrs['aria-label'], 'Menü öffnen oder schließen');
});

test('public navigation says Login and Contact us without rewriting membership prose', () => {
  for (const file of publicPages) {
    const html = read(file);
    assert.match(html, /href="\/member" data-en="Login">Login<\/a>/, file);
    const links = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]).join('\n');
    assert.doesNotMatch(links, />(?:Mitglieder?|(?:Jetzt )?[Mm]itmachen[^<]*)<\/a>/, file);
    assert.doesNotMatch(links, /data-en="(?:Join us|Members)[^"]*"/, file);
  }
  assert.match(read('index.html'), /Wie kann ich mitmachen\?/);
  assert.match(read('index.html'), /Mitgliedschaft &amp; Kosten/);
  for (const file of ['index.html', 'dodgeball-wien.html']) {
    assert.match(read(file), /data-en="Contact us">Kontaktiere uns<\/a>/);
  }
});

test('homepage keeps focused offers, progressive FAQ detail and one permanent Hall of Fame entry', () => {
  const home = read('index.html');
  assert.equal((home.match(/class="league-card reveal/g) || []).length, 3);
  assert.doesNotMatch(home, /id="why"|about-stat-row/);
  assert.equal((home.match(/class="public-faq-more"/g) || []).length, 2);
  assert.equal((home.match(/id="publicLeague"/g) || []).length, 1);
  assert.match(home, /href="#hall-of-fame" data-league-hof/);
  assert.ok(home.indexOf('data-league-hof') < home.indexOf('data-league-content'));
  assert.match(home, /league-ui\.js\?v=20260914d"/);
  assert.match(home, /site-league\.js\?v=20260912c"/);
});

test('offer cards have a narrow-screen single-column override after existing site CSS', () => {
  const css = read('public-ui.css');
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.league-cards \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.ok(read('index.html').indexOf('/public-ui.css') > read('index.html').indexOf('/site.css'));
  assert.match(css, /\.site-language button \{[\s\S]*?min-height: 44px/);
});

test('public header reserves group gaps instead of shrinking the logo into navigation', () => {
  const css = read('public-ui.css');
  assert.match(css, /#navbar \{ gap: 1rem; \}/);
  assert.match(css, /#navbar > \* \{ flex-shrink: 0; \}/);
  assert.match(css, /#navbar \.nav-asko img \{ width: 64px; height: auto; \}/);
  assert.match(css, /@media \(max-width: 1280px\) \{[\s\S]*?#navbar \.nav-logo span \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?#navbar \.nav-toggle \{ display: flex;/);
});

test('public offers use factual prices without expired 2026 promotions', () => {
  const home = read('index.html');
  const landing = read('dodgeball-wien.html');
  for (const html of [home, landing]) {
    assert.doesNotMatch(html, /Jan\s*[–-]\s*Juni 2026|Sommer 2026|Summer 2026|Meisterschaft 2026|Saison 2026(?!\/27)/);
    assert.match(html, /10 € pro Einheit/);
    assert.match(html, /5 € pro Einheit/);
    assert.match(html, /100 €/);
    assert.match(html, /180 €/);
    assert.match(html, /reserviert keinen Trainingsplatz/);
  }
  assert.match(home, /Season-1-Archiv mit 125 Spielern/);
  assert.match(home, /Hall of Fame/);
});

test('confirmed 2026/27 timetable replaces old venues and unverified travel directions', () => {
  for (const file of ['index.html', 'dodgeball-wien.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /Stella-Klein|Stella-Klein-L%C3%B6w|Messe-Prater/);
    assert.match(html, /Monday[^"<]*19:00–21:00/);
    assert.match(html, /O-MS Max Winter Platz 12/);
    assert.match(html, /Thursday[^"<]*18:00–21:00/);
    assert.match(html, /Volksschule in der Krieau/);
    assert.match(html, /Friday[^"<]*19:00–21:00/);
    assert.match(html, /(?:Am Kaisermühlendamm 2|Am Kaiserm&uuml;hlendamm 2)/);
    assert.match(html, /14 September 2026–2 July 2027 inclusive/);
    assert.match(html, /Vienna school holidays or Austrian public holidays/);
    assert.match(html, /href="\/member(?:#training)?"/);
  }
});

test('youth timetable includes the confirmed season and holiday exceptions without enrollment', () => {
  const youth = read('jugendtraining-wien.html');
  assert.match(youth, /17:00&ndash;19:00 Uhr/);
  assert.match(youth, /14 September 2026–2 July 2027 inclusive/);
  assert.match(youth, /Vienna school holidays or Austrian public holidays/);
  assert.match(youth, /href="mailto:imperialsdodgeball@gmail\.com/);
  assert.doesNotMatch(youth, /<form/);
});

test('enquiry confirmation remains visible after its form is hidden', () => {
  for (const file of ['index.html', 'dodgeball-wien.html']) {
    const html = read(file);
    const form = html.match(/<form id="joinForm"[\s\S]*?<\/form>/)[0];
    assert.doesNotMatch(form, /id="joinSuccess"/);
    assert.match(html, /<\/form>\s*<div id="joinSuccess"[^>]*role="status"/);
    assert.match(html, /data-en="Thanks for your enquiry!/);
  }
  assert.doesNotMatch(read('js/site-forms.js'), /s\.textContent\s*=\s*data\.message/);
});

function leaguePage() {
  const events = {}, documentEvents = {};
  const nodes = {};
  const node = selector => nodes[selector] ||= element();
  const content = node('[data-league-content]');
  content.querySelector = node;
  content.querySelectorAll = () => [];
  const league = { querySelector: node, addEventListener(name, fn) { events[name] = fn; } };
  const requests = [];
  const window = {
    SiteLanguage: { get: () => 'en' },
    addEventListener() {}
  };
  const context = vm.createContext({
    window, console, location: { hash: '' }, history: { pushState() {} },
    document: {
      getElementById: id => id === 'publicLeague' ? league : { scrollIntoView() {} },
      addEventListener(name, fn) { documentEvents[name] = fn; }
    },
    fetch(url) {
      return new Promise(resolve => requests.push({ url, resolve: body => resolve({ ok: true, json: async () => body }) }));
    }
  });
  for (const file of ['site-utils', 'league-scoring', 'league-archive', 'league-ui', 'site-league']) {
    vm.runInContext(read(`js/${file}.js`), context);
  }
  function trigger(name, selector, value) {
    events[name]({
      target: {
        value,
        closest: candidate => candidate === selector ? element() : null,
        matches: candidate => candidate === selector
      }
    });
  }
  return { requests, content, nodes, trigger, documentEvents };
}

function currentLeague(points = 1.5, title = 'Latest <training>') {
  return {
    season: { id: 'current', name: 'Current season', start_date: '2026-09-01', end_date: '2027-01-31', placement_points: [3, 2, 1], scoring_mode: 'fixed' },
    seasons: [{ id: 'current', name: 'Current season' }],
    comparison_event: { id: 'last', session_date: '2026-09-10', title },
    standings: [{ rank: 1, display_name: 'Fixture', points: 8, played: 2, wins: 1, points_gain: points, previous_rank: 2, rank_gain: 1 }],
    events: []
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('public league uses shared language and renders refreshed comparison metadata and movement', async () => {
  const page = leaguePage();
  page.requests[0].resolve(currentLeague());
  page.requests[1].resolve(JSON.parse(read('data/season-1.json')));
  await settle();
  assert.match(page.content.innerHTML, /Movement from the latest scored training/);
  assert.match(page.content.innerHTML, /Latest &lt;training&gt;/);
  assert.match(page.nodes['[data-league-standings]'].innerHTML, /\+1.5 Points/);
  page.documentEvents['site-language-change']({ detail: { lang: 'de' } });
  assert.match(page.content.innerHTML, /Veränderung durch das letzte gewertete Training/);
  assert.match(page.nodes['[data-league-standings]'].innerHTML, /\+1,5 Punkte/);
  page.trigger('click', '[data-league-refresh]');
  assert.match(page.requests[2].url, /season_id=current/);
  page.requests[2].resolve(currentLeague(2, 'Updated training'));
  await settle();
  assert.match(page.content.innerHTML, /Updated training/);
  assert.match(page.nodes['[data-league-standings]'].innerHTML, /\+2 Punkte/);
});

test('one season selector opens frozen 125-player archive without current comparison deltas', async () => {
  const page = leaguePage();
  page.requests[0].resolve(currentLeague());
  page.requests[1].resolve(JSON.parse(read('data/season-1.json')));
  await settle();
  page.trigger('change', '[data-league-season]', 'season-1');
  assert.equal((page.content.innerHTML.match(/data-league-season/g) || []).length, 1);
  assert.match(page.content.innerHTML, /125 players/);
  assert.match(page.content.innerHTML, /Hall of Fame/);
  assert.doesNotMatch(page.content.innerHTML, /league-comparison|Latest &lt;training&gt;/);
  assert.doesNotMatch(page.nodes['[data-league-standings]'].innerHTML, /league-movement/);
});
