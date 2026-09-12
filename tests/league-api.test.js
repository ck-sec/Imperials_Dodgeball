const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const league = require('../lib/league');
const db = require('../lib/league-db');

const userId = '00000000-0000-4000-8000-000000000001';
const emptyWorld = () => ({ users: [], profiles: [], results: [], seasons: [], sessions: [], events: [], attendance: [] });
function harness(world = emptyWorld(), options = {}) {
  const calls = { admin: 0, member: 0, db: 0, transactions: [] };
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    return {
      text, values,
      then(resolve, reject) {
        if (options.readError) return Promise.reject(options.readError).then(resolve, reject);
        return Promise.resolve([{ world }]).then(resolve, reject);
      },
    };
  };
  sql.transaction = async queries => {
    calls.transactions.push(queries);
    if (options.writeError) throw options.writeError;
    return queries.map(() => []);
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'api', 'league.js'), 'utf8'), {
    module,
    console: { error() {}, log() {} },
    require(name) {
      if (name === '../lib/db') return { getDb: () => { calls.db++; return sql; } };
      if (name === '../lib/league-db') return db;
      if (name === '../lib/league') return league;
      if (name === '../lib/validation') return require('../lib/validation');
      if (name === '../lib/cors') return { setCors() {} };
      if (name === '../lib/auth') return {
        requireAdmin(req, res) {
          calls.admin++;
          if (req.testRole === 'admin') return { role: 'admin' };
          res.status(req.testRole ? 403 : 401).json({ error: 'Admin required' });
          return null;
        },
        requireMember(req, res) {
          calls.member++;
          if (req.testRole === 'member') return { sub: userId };
          res.status(401).json({ error: 'Member required' });
          return null;
        },
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  async function request(input = {}) {
    const req = { method: 'GET', query: {}, headers: { 'content-type': 'application/json' }, ...input };
    const res = { statusCode: 200, headers: {}, body: undefined,
      setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.statusCode = value; return this; },
      json(body) { this.body = body; return this; },
      end() { return this; },
    };
    await module.exports(req, res);
    return res;
  }
  return { request, calls };
}

test('public is anonymous, while admin GET and every POST require admin before accessing data', async () => {
  const app = harness();
  const pub = await app.request();
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.body.season, null);
  assert.equal(pub.headers['Cache-Control'], 'no-store');
  assert.equal(app.calls.admin, 0);
  const count = app.calls.db;
  assert.equal((await app.request({ query: { view: 'admin' } })).statusCode, 401);
  assert.equal((await app.request({ query: { view: 'admin' }, testRole: 'member' })).statusCode, 403);
  assert.equal((await app.request({ method: 'POST', body: { action: 'publish' } })).statusCode, 401);
  assert.equal((await app.request({ method: 'POST', testRole: 'member', body: {} })).statusCode, 403);
  assert.equal(app.calls.db, count);
});

test('me validates approved active membership from database even with a valid member token', async () => {
  const world = emptyWorld();
  world.users.push({ id: userId, status: 'pending', is_active: true });
  const app = harness(world);
  assert.equal((await app.request({ query: { view: 'me' } })).statusCode, 401);
  const denied = await app.request({ query: { view: 'me' }, testRole: 'member' });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'FORBIDDEN');
  world.users[0].status = 'approved';
  world.users[0].is_active = false;
  assert.equal((await app.request({ query: { view: 'me' }, testRole: 'member' })).statusCode, 403);
  world.users[0].is_active = true;
  const allowed = await app.request({ query: { view: 'me' }, testRole: 'member' });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body.stats, { rank: null, points: 0, played: 0, wins: 0 });
  assert.deepEqual(allowed.body.my_events, []);
  assert.equal(allowed.body.comparison_event, null);
});

test('bad views, UUIDs, JSON content types and missing versions are explicit validation errors', async () => {
  const app = harness();
  assert.equal((await app.request({ query: { view: 'secret' } })).statusCode, 400);
  assert.equal((await app.request({ query: { season_id: 'not-a-uuid' } })).statusCode, 400);
  assert.equal((await app.request({ query: { season_id: userId } })).statusCode, 404);
  assert.equal((await app.request({ method: 'POST', testRole: 'admin', headers: {}, body: {} })).statusCode, 400);
  assert.equal((await app.request({ method: 'POST', testRole: 'admin', body: {
    action: 'publish', event_id: userId,
  } })).statusCode, 400);
  assert.equal((await app.request({ method: 'DELETE' })).statusCode, 405);
});

test('successful settings save returns the agreed envelope and never executes a full-schema migration', async () => {
  const app = harness();
  const res = await app.request({ method: 'POST', testRole: 'admin', body: {
    action: 'save_season', name: 'Summer', start_date: '2026-01-01', end_date: '2026-12-31',
  } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.season_id, /^[0-9a-f-]{36}$/);
  assert.equal(app.calls.transactions.length, 1);
  assert(!app.calls.transactions[0].some(q => /UPDATE users|CREATE TABLE/.test(q.text)));
});

test('database conflicts become 409, while unexpected failures never expose database details', async () => {
  const request = { method: 'POST', testRole: 'admin', body: {
    action: 'save_player', user_id: userId, gender: 'unspecified', is_rookie: false, initial_rating: 1000,
  } };
  const conflict = harness(emptyWorld(), { writeError: {
    code: 'P0001', detail: 'LEAGUE_409', message: 'Roster changed',
  } });
  const rejected = await conflict.request(request);
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.body.error, 'Roster changed');
  const broken = harness(emptyWorld(), { readError: { code: '42P01', message: 'postgres://user:secret@private-host/db' } });
  const error = await broken.request();
  assert.equal(error.statusCode, 500);
  assert(!JSON.stringify(error.body).includes('secret'));
  assert(!JSON.stringify(error.body).includes('private-host'));
});

test('admin guest creation returns player_id and account linking remains explicitly admin-only', async () => {
  const app = harness();
  const body = { action: 'save_player', user_id: null, display_name: 'New Guest',
    gender: 'unspecified', is_rookie: true, initial_rating: 800 };
  const created = await app.request({ method: 'POST', testRole: 'admin', body });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.success, true);
  assert.match(created.body.player_id, /^[0-9a-f-]{36}$/);
  const link = { action: 'link_player', player_id: created.body.player_id, user_id: userId };
  assert.equal((await app.request({ method: 'POST', testRole: 'member', body: link })).statusCode, 403);
  assert.equal((await app.request({ method: 'POST', testRole: 'admin', body: link })).statusCode, 404);
});

test('admin exposes member-to-player mapping, while unpublished guests stay out of anonymous responses', async () => {
  const world = emptyWorld();
  const playerId = '00000000-0000-4000-8000-000000000050';
  world.users = [{ id: userId, display_name: 'Account Member', is_active: true, status: 'approved' }];
  world.profiles = [{ id: playerId, user_id: userId, display_name: 'Private League Name',
    gender: 'unspecified', is_rookie: false, initial_rating: 1000, merged_into: null }];
  const app = harness(world);
  const admin = await app.request({ query: { view: 'admin' }, testRole: 'admin' });
  assert.equal(admin.statusCode, 200);
  assert.deepEqual(admin.body.members, [{ id: userId, display_name: 'Account Member' }]);
  assert.equal(admin.body.players[0].id, playerId);
  assert.equal(admin.body.players[0].user_id, userId);
  const pub = await app.request();
  assert(!JSON.stringify(pub.body).includes('Private League Name'));
  assert(!JSON.stringify(pub.body).includes(userId));
  assert(!JSON.stringify(pub.body).includes(playerId));
});

test('authenticated me exposes safe cross-season fixtures and the same movement ledger as public GET', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const world = emptyWorld();
  const today = league.today();
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  world.users = [{ id: userId, display_name: 'Account Name', is_active: true, status: 'approved' }];
  world.profiles = [
    { id: id(50), user_id: userId, display_name: 'League Name', merged_into: null,
      gender: 'unspecified', is_rookie: true, initial_rating: 800, rating: 812 },
    { id: id(51), user_id: id(52), display_name: 'Other Member', merged_into: null,
      gender: 'female', is_rookie: false, initial_rating: 1000, rating: 988 },
  ];
  world.seasons = [100, 101].map(n => ({ id: id(n), name: `Season ${n}`,
    start_date: '2026-01-01', end_date: '2099-12-31', ...league.DEFAULTS }));
  for (let n = 1; n <= 4; n++) {
    const session = { id: id(200 + n), title: `Training ${n}`,
      session_date: n === 1 ? yesterday : n === 3 ? '2099-09-12' : today,
      start_time: '19:00:00', location: 'Vienna', is_cancelled: false };
    world.sessions.push(session);
    world.events.push({ id: id(300 + n), season_id: id(n === 3 ? 101 : 100), session_id: session.id,
      session_date: session.session_date, status: n === 1 ? 'finalized' : n === 4 ? 'draft' : 'published',
      settings: { ...league.DEFAULTS }, team_size: 4, schedule: league.buildSchedule(2),
      teams: [
        { number: 1, name: 'Opponent', placement: 2, players: [world.profiles[1]] },
        { number: 2, name: 'Own squad', placement: 1, players: [world.profiles[0]] },
      ] });
  }
  world.results = [
    { event_id: id(301), player_id: id(50), display_name: 'League Name', team_number: 2,
      placement: 1, points: 3, rating_delta: 12 },
    { event_id: id(301), player_id: id(51), display_name: 'Other Member', team_number: 1,
      placement: 2, points: 0.5, rating_delta: -12 },
  ];
  const app = harness(world);
  const publicResponse = await app.request({ query: { season_id: id(100) } });
  const memberResponse = await app.request({ query: { view: 'me', season_id: id(100), user_id: id(52) }, testRole: 'member' });
  assert.equal(memberResponse.statusCode, 200);
  assert.equal(memberResponse.headers['Cache-Control'], 'no-store');
  const pub = publicResponse.body, member = memberResponse.body;
  assert.deepEqual(member.standings, pub.standings);
  assert.deepEqual(member.comparison_event, pub.comparison_event);
  assert.equal(member.comparison_event.id, id(301));
  assert.deepEqual(member.stats, { rank: 1, points: 3, played: 1, wins: 1,
    points_gain: 3, previous_rank: null, rank_gain: null });
  assert.deepEqual(member.my_events.map(e => [e.id, e.my_team_number]), [[id(302), 2], [id(303), 2]]);
  assert.equal(member.my_events[0].end_time, '19:20:00');
  assert.equal(member.my_events[0].session_id, id(202));
  assert.equal(member.my_events[0].schedule.rounds[0].matches.length, 1);
  assert.doesNotMatch(JSON.stringify(pub), /"(stats|history|my_events|my_team_number)"/);
  for (const payload of [pub, member]) {
    assert.doesNotMatch(JSON.stringify(payload), /"(rating|rating_delta|initial_rating|gender|is_rookie|user_id|player_id|merged_into)"/);
    assert(!JSON.stringify(payload).includes(id(50)));
  }
  assert.equal(app.calls.transactions.length, 0, 'GET must not mutate shared state to track visitor movement');
});
