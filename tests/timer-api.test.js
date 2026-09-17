const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModule, response } = require('./auth-test-helpers');
const league = require('../lib/league');
const timer = require('../lib/league-timer');
const scoring = require('../lib/league-scoring-access');
const { buildSchedule } = require('../lib/league-matches');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT_DATE = '2026-09-10';
const NOW = new Date('2026-09-10T17:00:00.000Z');

function worldFixture() {
  const users = [
    { id: id(1), display_name: 'Head Ref', is_active: true, status: 'approved', league_scorekeeper: true },
    { id: id(2), display_name: 'Member', is_active: true, status: 'approved', league_scorekeeper: false },
  ];
  const players = Array.from({ length: 6 }, (_, index) => ({
    id: id(index + 11),
    user_id: index < 2 ? users[index].id : null,
    display_name: `Player ${index + 1}`,
    rating: 1000,
    initial_rating: 1000,
    gender: 'unspecified',
    is_rookie: false,
  }));
  const eventId = id(31);
  return {
    users,
    profiles: players,
    seasons: [{ id: id(41), name: 'Season', start_date: '2026-01-01', end_date: '2026-12-31', ...league.DEFAULTS }],
    sessions: [{
      id: id(21), title: 'Thursday', session_date: EVENT_DATE, start_time: '19:00:00',
      end_time: '21:00:00', location: 'Gym', is_cancelled: false,
    }],
    events: [{
      id: eventId, season_id: id(41), session_id: id(21), session_date: EVENT_DATE,
      status: 'published', version: 3, settings: structuredClone(league.DEFAULTS),
      team_size: 2, max_teams: 3, roster_locked: false, schedule: buildSchedule(3),
      bonus_points: [], roster_ids: players.map(player => player.id), rsvp_user_ids: [],
      roster_source: 'manual',
      teams: [
        { number: 1, name: 'Gold', placement: null, players: players.slice(0, 2) },
        { number: 2, name: 'Navy', placement: null, players: players.slice(2, 4) },
        { number: 3, name: 'White', placement: null, players: players.slice(4) },
      ],
    }],
    results: [],
    attendance: [],
  };
}

function harness(options = {}) {
  const world = options.world || worldFixture();
  const calls = { db: 0, transactions: [], queries: [] };
  const sql = (strings, ...values) => {
    const query = { text: strings.join('?'), values };
    calls.queries.push(query);
    const actorId = values.find(value => value === id(1) || value === id(2));
    query.then = (resolve, reject) => Promise.resolve(query.text.includes('SELECT NOW() AS server_now')
      ? [{
        server_now: NOW,
        event: world.events[0] || null,
        session: world.sessions[0] || null,
        actor: world.users.find(user => user.id === actorId) || null,
        ...(options.timerRow ? { timer_event_id: world.events[0].id, ...options.timerRow } : {}),
      }]
      : []).then(resolve, reject);
    return query;
  };
  sql.transaction = async (queries, transactionOptions) => {
    calls.transactions.push({ queries, options: transactionOptions });
    if (options.writeError) throw options.writeError;
    return queries.map(() => []);
  };
  const db = {
    dbError(error) { return error instanceof league.LeagueError ? error : null; },
    writerLock: () => ({ text: 'writer lock', values: [] }),
    sessionLock: (_sql, sessionId) => ({ text: 'session lock', values: [sessionId] }),
    leagueTransaction: (client, queries) => client.transaction(queries, { isolationLevel: 'ReadCommitted' }),
  };
  const timerWithDate = {
    ...timer,
    timerView: (data, eventId, matchNumber, identity, row, now) =>
      timer.timerView(data, eventId, matchNumber, identity, row, now, EVENT_DATE),
  };
  const loaded = loadModule('api\\timer.js', {
    '../lib/db': { getDb: () => { calls.db++; return sql; } },
    '../lib/cors': { setCors() {} },
    '../lib/validation': require('../lib/validation'),
    '../lib/league': { ...league, today: () => EVENT_DATE },
    '../lib/league-db': db,
    '../lib/league-scoring-access': {
      ...scoring,
      scoringIdentity(req) {
        if (req.testRole === 'admin') return { is_admin: true, user_id: null };
        if (req.testRole === 'headref') return { is_admin: false, user_id: id(1) };
        if (req.testRole === 'member') return { is_admin: false, user_id: id(2) };
        return { is_admin: false, user_id: null };
      },
    },
    '../lib/league-timer': timerWithDate,
  });

  async function request(input = {}) {
    const req = {
      method: 'GET',
      query: { event_id: world.events[0].id, match_number: '1' },
      headers: { 'content-type': 'application/json' },
      ...input,
    };
    const res = response();
    await loaded.exports(req, res);
    return res;
  }
  return { world, calls, request, logs: loaded.logs };
}

test('public timer reads are anonymous, fixture-scoped and never cached', async () => {
  const app = harness();
  const result = await app.request();
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.event.id, app.world.events[0].id);
  assert.equal(result.body.match.number, 1);
  assert.equal(result.body.timer.phase, 'ready');
  assert.equal(result.body.permissions.can_control, false);
  assert.equal(app.calls.transactions.length, 0);
  assert.doesNotMatch(JSON.stringify(result.body), /"(user_id|rating|league_scorekeeper)"/);
});

test('Head Refs and admins start timers with transaction guards, separate revisions and no lineup mutation', async () => {
  for (const role of ['headref', 'admin']) {
    const app = harness();
    const result = await app.request({
      method: 'POST',
      testRole: role,
      body: {
        action: 'start',
        event_id: app.world.events[0].id,
        match_number: 1,
        revision: 0,
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.timer.revision, 1);
    assert.equal(result.body.timer.phase, 'running');
    assert.equal(app.calls.transactions.length, 1);
    const queries = app.calls.transactions[0].queries;
    assert(queries.some(query => /INSERT INTO league_match_timers/.test(query.text)));
    assert(queries.some(query => /revision = \?/.test(query.text)));
    assert(queries.some(query => /event\.cancelled_at IS NULL/.test(query.text)));
    assert(!queries.some(query => /UPDATE league_events SET roster_locked = true/.test(query.text)));
    assert(!queries.some(query => /UPDATE league_events SET schedule/.test(query.text)));
    if (role === 'headref') assert(queries.some(query => /league_scorekeeper = true/.test(query.text)));
  }
});

test('timer writes reject anonymous, ordinary members, wrong dates, malformed input and stale revisions', async () => {
  const body = app => ({
    action: 'start',
    event_id: app.world.events[0].id,
    match_number: 1,
    revision: 0,
  });
  let app = harness();
  assert.equal((await app.request({ method: 'POST', body: body(app) })).statusCode, 401);
  assert.equal(app.calls.db, 0);

  app = harness();
  assert.equal((await app.request({ method: 'POST', testRole: 'member', body: body(app) })).statusCode, 403);
  assert.equal(app.calls.transactions.length, 0);

  const cancelledWorld = worldFixture();
  cancelledWorld.events[0].cancelled_at = '2026-09-10T17:30:00.000Z';
  app = harness({ world: cancelledWorld });
  assert.equal((await app.request()).statusCode, 404);
  assert.equal((await app.request({ method: 'POST', testRole: 'admin', body: body(app) })).statusCode, 404);
  assert.equal(app.calls.transactions.length, 0);

  const pastWorld = worldFixture();
  pastWorld.events[0].session_date = '2026-09-03';
  pastWorld.sessions[0].session_date = '2026-09-03';
  app = harness({ world: pastWorld });
  assert.equal((await app.request({ method: 'POST', testRole: 'admin', body: body(app) })).statusCode, 409);
  assert.equal(app.calls.transactions.length, 0);

  app = harness();
  assert.equal((await app.request({
    method: 'POST',
    testRole: 'admin',
    body: { ...body(app), action: 'adjust', clock: 'match', delta_seconds: 6 },
  })).statusCode, 400);
  assert.equal(app.calls.db, 0);

  app = harness({ writeError: new league.LeagueError(409, 'Timer changed') });
  const conflict = await app.request({ method: 'POST', testRole: 'admin', body: body(app) });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, 'Timer changed');
});

test('unsupported methods and database failures return bounded errors', async () => {
  let app = harness();
  assert.equal((await app.request({ method: 'DELETE' })).statusCode, 405);
  app = harness({ writeError: Object.assign(new Error('postgres://secret@private/db'), { code: 'XX000' }) });
  const failed = await app.request({
    method: 'POST',
    testRole: 'admin',
    body: {
      action: 'start',
      event_id: app.world.events[0].id,
      match_number: 1,
      revision: 0,
    },
  });
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.stringify(failed.body), JSON.stringify({
    error: 'Match timer request failed',
    code: 'SERVER_ERROR',
  }));
  assert.doesNotMatch(JSON.stringify(failed.body), /secret|private/);
});
