const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const youth = read('jugendtraining-wien.html');
const home = read('index.html');
const config = JSON.parse(read('vercel.json'));

test('youth training preserves the supplied ages, venue, time and free trial', () => {
  assert.match(youth, /12&ndash;18 Jahre/);
  assert.match(youth, /Jeden Freitag/);
  assert.match(youth, /17:00&ndash;19:00 Uhr/);
  assert.match(youth, /Am Kaiserm&uuml;hlendamm 2/);
  assert.match(youth, /1220 Wien/);
  assert.match(youth, /Kostenloses Probetraining/);
  assert.match(youth, /Dodgeball-Schulcup/);
  assert.match(youth, /mailto:imperialsdodgeball@gmail\.com\?subject=Jugendtraining/);
  assert.doesNotMatch(youth, /<form\b|<iframe\b|<embed\b|<object\b/);
});

test('the youth page is routed, discoverable and has valid structured metadata', () => {
  assert.ok(config.rewrites.some(route => route.source === '/jugendtraining-wien' && route.destination === '/jugendtraining-wien.html'));
  assert.match(youth, /<html lang="de">/);
  assert.match(youth, /rel="canonical" href="https:\/\/www\.imperialsdodgeball\.com\/jugendtraining-wien"/);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/www\.imperialsdodgeball\.com\/jugendtraining-wien<\/loc>/);
  const metadata = JSON.parse(youth.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(metadata.inLanguage, 'de-AT');
  assert.equal(metadata.about.name, 'ASK\u00d6 Vienna Imperials');
  assert.match(home, /href="\/jugendtraining-wien"/);
  assert.match(read('dodgeball-wien.html'), /href="\/jugendtraining-wien"/);
});

test('sponsorship PDF is byte-for-byte the supplied original, never embedded or prefetched', () => {
  const pdf = fs.readFileSync(path.join(root, 'downloads', 'imperials-sponsorenmappe.pdf'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdf.length, 27658974);
  assert.equal(createHash('sha256').update(pdf).digest('hex'), '9170b3f53aa4d25b9fde2d7c4d516b5a6c5a237eb4c65c7a5ccfbda9d486f875');
  assert.match(home, /href="\/downloads\/imperials-sponsorenmappe\.pdf" download/);
  assert.match(home, /id="partners"/);
  assert.doesNotMatch(home, /<(?:iframe|embed|object|link)\b[^>]*(?:imperials-sponsorenmappe|application\/pdf)/);
});

test('new youth-page assets and internal destinations all exist in the release', () => {
  const urls = [...youth.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map(match => match[1]);
  for (const url of urls) {
    const pathname = url.split(/[?#]/)[0];
    const route = config.rewrites.find(item => item.source === pathname);
    const file = pathname === '/' ? 'index.html' : (route ? route.destination : pathname).slice(1);
    assert.ok(fs.existsSync(path.join(root, file)), `Missing local link target: ${url}`);
  }
  assert.match(youth, /href="\/fonts\/fonts\.css"/);
  assert.doesNotMatch(youth, /fonts\.googleapis\.com/);
  assert.match(youth, /src="\/js\/site-language\.js\?v=20260912"/);
});

test('the sitemap lists only canonical indexable content, not authentication or operational URLs', () => {
  const origin = 'https://www.imperialsdodgeball.com';
  const pages = [
    ['/', 'index.html'], ['/dodgeball-wien', 'dodgeball-wien.html'],
    ['/jugendtraining-wien', 'jugendtraining-wien.html'],
    ['/impressum.html', 'impressum.html'], ['/datenschutz.html', 'datenschutz.html']
  ];
  const sitemap = read('sitemap.xml');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, pages.map(([url]) => origin + url));
  assert.equal((sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length, pages.length);
  for (const [url, file] of pages) {
    const html = read(file);
    assert.ok(html.includes(`rel="canonical" href="${origin + url}"`), file);
    assert.doesNotMatch(html, /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i, file);
  }
  for (const file of ['member.html', 'admin.html']) assert.match(read(file), /name="robots" content="[^"]*noindex/);
  assert.match(read('robots.txt'), /Sitemap: https:\/\/www\.imperialsdodgeball\.com\/sitemap\.xml/);
  assert.doesNotMatch(read('robots.txt'), /Disallow:\s*\/(?:js|fonts|league)/);
});

test('content pages have distinct search descriptions and do not advertise nonexistent language URLs', () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const file of ['index.html', 'dodgeball-wien.html', 'jugendtraining-wien.html', 'impressum.html', 'datenschutz.html']) {
    const html = read(file);
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const description = html.match(/name="description" content="([^"]+)"/)[1];
    assert.ok(!titles.has(title), file);
    assert.ok(!descriptions.has(description), file);
    titles.add(title);
    descriptions.add(description);
    assert.doesNotMatch(html, /hreflang=/, file);
  }
});

test('public marketing pages have complete social previews and consistent club identity', async () => {
  const clubId = 'https://www.imperialsdodgeball.com/#club';
  for (const file of ['index.html', 'dodgeball-wien.html', 'jugendtraining-wien.html']) {
    const html = read(file);
    for (const field of ['title', 'description', 'image', 'image:alt']) {
      assert.match(html, new RegExp(`property="og:${field}" content="[^"]+"`), file);
      assert.match(html, new RegExp(`name="twitter:${field}" content="[^"]+"`), file);
    }
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const club = data['@type'] === 'SportsClub' ? data : data.about;
    assert.equal(club['@id'], clubId, file);
    assert.equal(club.sport, 'Dodgeball', file);
    assert.equal(club.url, 'https://www.imperialsdodgeball.com/', file);
  }
  const image = await require('sharp')(path.join(root, 'og-image.jpg')).metadata();
  assert.deepEqual([image.width, image.height], [1200, 630]);
});
