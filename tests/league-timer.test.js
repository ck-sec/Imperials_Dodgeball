const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS, balanceTeams } = require('../lib/league');
const { buildSchedule } = require('../lib/league-matches');
const {
  MAX_TIMER_SECONDS,
  validateTimerQuery,
  validateTimerCommand,
  timerDefaults,
  timerSnapshot,
  applyTimerCommand,
  timerView,
} = require('../lib/league-timer');
const { main: migrateTimer } = require('../scripts/migrate-match-timer');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT_DATE = '2026-09-10';
const AT = new Date('2026-09-10T17:00:00.000Z');

function fixture() {
  const players = Array.from({ length: 6 }, (_, index) => ({
    id: id(index + 1),
    user_id: id(index + 101),
    display_name: `Player ${index + 1}`,
    gender: 'unspecified',
    is_rookie: false,
    rating: 1000,
    initial_rating: 1000,
    merged_into: null,
  }));
  const teams = balanceTeams(players.map(({ user_id, ...player }) => player), 2, 3, true).teams;
  const session = {
    id: id(201),
    title: 'Thursday League',
    session_date: EVENT_DATE,
    start_time: '19:00:00',
    end_time: '21:00:00',
    location: 'ASKÖ Halle',
    is_cancelled: false,
  };
  const event = {
    id: id(301),
    season_id: id(401),
    session_id: session.id,
    session_date: EVENT_DATE,
    status: 'published',
    version: 4,
    settings: structuredClone(DEFAULTS),
    bonus_points: [],
    team_size: 2,
    max_teams: 3,
    roster_locked: false,
    roster_ids: players.map(player => player.id),
    rsvp_user_ids: players.map(player => player.user_id),
    roster_source: 'rsvp',
    teams,
    schedule: buildSchedule(3),
  };
  return {
    users: players.map((player, index) => ({
      id: player.user_id,
      display_name: player.display_name,
      status: 'approved',
      is_active: true,
      league_scorekeeper: index === 0,
    })),
    profiles: players,
    seasons: [{
      id: event.season_id,
      name: 'Season 2',
      start_date: '2026-09-01',
      end_date: '2027-07-01',
      ...DEFAULTS,
    }],
    sessions: [session],
    events: [event],
    results: [],
    attendance: [],
  };
}

function command(action, revision, extra = {}) {
  return validateTimerCommand({
    action,
    event_id: id(301),
    match_number: 1,
    revision,
    ...extra,
  });
}

test('timer requests strictly identify one real fixture and allow only supported controls', () => {
  assert.deepEqual(validateTimerQuery({ event_id: id(301).toUpperCase(), match_number: '1' }), {
    event_id: id(301),
    match_number: 1,
  });
  for (const query of [
    {},
    { event_id: 'bad', match_number: '1' },
    { event_id: id(301), match_number: '0' },
    { event_id: id(301), match_number: '11' },
    { event_id: [id(301)], match_number: '1' },
  ]) assert.throws(() => validateTimerQuery(query));
  assert.equal(validateTimerCommand({
    action: 'adjust', event_id: id(301), match_number: 1, revision: 0, clock: 'set', delta_seconds: -5,
  }).delta_seconds, -5);
  assert.deepEqual(validateTimerCommand({
    action: 'configure', event_id: id(301), match_number: 1, revision: 0,
    clock: 'match', default_seconds: 600,
  }), {
    action: 'configure', event_id: id(301), match_number: 1, revision: 0,
    clock: 'match', default_seconds: 600,
  });
  for (const input of [
    { action: 'delete' },
    { action: 'adjust', clock: 'set', delta_seconds: 6 },
    { action: 'reset', clock: 'both' },
    { action: 'configure', clock: 'both', default_seconds: 600 },
    { action: 'configure', clock: 'set', default_seconds: MAX_TIMER_SECONDS + 1 },
    { action: 'configure', clock: 'set', default_seconds: 60, match_default_seconds: 60, set_default_seconds: 60 },
    { action: 'configure', match_default_seconds: MAX_TIMER_SECONDS + 1, set_default_seconds: 180 },
  ]) assert.throws(() => validateTimerCommand({
    event_id: id(301), match_number: 1, revision: 0, ...input,
  }));
});

test('match and set clocks share one start, pause accurately, expire independently and reset safely', () => {
  const defaults = { match_default_seconds: 20 * 60, set_default_seconds: 3 * 60 };
  const ready = timerSnapshot(null, defaults, AT);
  assert.deepEqual([ready.phase, ready.status, ready.match_remaining_seconds, ready.set_remaining_seconds],
    ['ready', 'ready', 1200, 180]);
  const running = applyTimerCommand(null, defaults, command('start', 0), AT);
  assert.equal(running.phase, 'running');
  assert.equal(running.revision, 1);

  const afterSet = timerSnapshot(running, defaults, new Date(AT.getTime() + 181250));
  assert.equal(afterSet.status, 'set_expired');
  assert.equal(afterSet.set_remaining_ms, 0);
  assert.equal(afterSet.match_remaining_seconds, 1019);

  const paused = applyTimerCommand(running, defaults, command('pause', 1),
    new Date(AT.getTime() + 10400));
  assert.deepEqual([paused.phase, paused.status, paused.match_remaining_seconds, paused.set_remaining_seconds],
    ['paused', 'paused', 1190, 170]);
  assert.equal(timerSnapshot(paused, defaults, new Date(AT.getTime() + 60000)).match_remaining_seconds, 1190);

  const expired = timerSnapshot(running, defaults, new Date(AT.getTime() + 1200000));
  assert.deepEqual([expired.phase, expired.status, expired.match_remaining_ms, expired.set_remaining_ms],
    ['paused', 'expired', 0, 0]);
  const reset = applyTimerCommand(expired, defaults, command('reset', 1, { clock: 'match' }),
    new Date(AT.getTime() + 1200000));
  assert.deepEqual([reset.phase, reset.status, reset.match_remaining_seconds, reset.set_remaining_seconds],
    ['paused', 'set_expired', 1200, 0]);
});

test('adjustments clamp, configuration follows reference behavior, and stale revisions never overwrite', () => {
  const defaults = { match_default_seconds: 20 * 60, set_default_seconds: 3 * 60 };
  const adjusted = applyTimerCommand(null, defaults, command('adjust', 0, {
    clock: 'set', delta_seconds: -60,
  }), AT);
  assert.equal(adjusted.set_remaining_seconds, 120);
  const matchConfigured = applyTimerCommand(adjusted, defaults, command('configure', 1, {
    clock: 'match',
    default_seconds: 600,
  }), AT);
  assert.deepEqual([
    matchConfigured.match_default_seconds,
    matchConfigured.set_default_seconds,
    matchConfigured.match_remaining_seconds,
    matchConfigured.set_remaining_seconds,
  ], [600, 180, 600, 120]);
  const configured = applyTimerCommand(matchConfigured, defaults, command('configure', 2, {
    clock: 'set',
    default_seconds: 120,
  }), AT);
  assert.deepEqual([
    configured.match_default_seconds,
    configured.set_default_seconds,
    configured.match_remaining_seconds,
    configured.set_remaining_seconds,
  ], [600, 120, 600, 120]);
  const zeroSet = applyTimerCommand(configured, defaults, command('configure', 3, {
    clock: 'set',
    default_seconds: 0,
  }), AT);
  assert.equal(zeroSet.status, 'set_expired');
  const running = applyTimerCommand(configured, defaults, command('start', 3), AT);
  const changedMatchDefault = applyTimerCommand(running, defaults, command('configure', 4, {
    clock: 'match',
    default_seconds: 300,
  }), new Date(AT.getTime() + 10000));
  const changedDefaults = applyTimerCommand(changedMatchDefault, defaults, command('configure', 5, {
    clock: 'set',
    default_seconds: 60,
  }), new Date(AT.getTime() + 10000));
  assert.deepEqual([
    changedDefaults.match_default_seconds,
    changedDefaults.set_default_seconds,
    changedDefaults.match_remaining_seconds,
    changedDefaults.set_remaining_seconds,
  ], [300, 60, 590, 110]);
  assert.throws(() => applyTimerCommand(changedDefaults, defaults, command('pause', 5), AT),
    error => error.status === 409);
});

test('timer view exposes public fixture details but controls only to current-day Head Refs and admins', () => {
  const world = fixture();
  const event = world.events[0];
  assert.deepEqual(timerDefaults(event), { match_default_seconds: 1800, set_default_seconds: 180 });
  const anonymous = timerView(world, event.id, 1, {}, null, AT, EVENT_DATE);
  assert.equal(anonymous.permissions.can_control, false);
  assert.equal(anonymous.permissions.signed_in, false);
  assert.equal(anonymous.match.team_a.players.length, 2);
  assert.equal(anonymous.match.referee_team.name,
    event.teams.find(team => team.number === event.schedule.rounds[0].referee_team).name);
  assert.doesNotMatch(JSON.stringify(anonymous), /"(user_id|rating|gender|is_rookie|league_scorekeeper)"/);

  const headRef = timerView(world, event.id, 1, { user_id: world.users[0].id }, null, AT, EVENT_DATE);
  assert.equal(headRef.permissions.is_scorekeeper, true);
  assert.equal(headRef.permissions.can_control, true);
  const admin = timerView(world, event.id, 1, { is_admin: true }, null, AT, EVENT_DATE);
  assert.equal(admin.permissions.can_control, true);
  assert.equal(timerView(world, event.id, 1, { is_admin: true }, null, AT, '2026-09-11').permissions.can_control, false);
  event.teams.forEach((team, index) => { team.placement = index + 1; });
  event.status = 'finalized';
  assert.equal(timerView(world, event.id, 1, { is_admin: true }, null, AT, EVENT_DATE).permissions.can_control, false);
  assert.throws(() => timerView(world, event.id, 99, {}, null, AT, EVENT_DATE), error => error.status === 404);
  const cancelled = fixture();
  cancelled.events[0].cancelled_at = '2026-09-10T18:30:00.000Z';
  assert.throws(() => timerView(
    cancelled, cancelled.events[0].id, 1, { is_admin: true }, null, AT, EVENT_DATE
  ), error => error.status === 404);

  const headToHead = fixture();
  headToHead.events[0].teams = balanceTeams(
    headToHead.profiles.map(({ user_id, ...player }) => player), 3, 2, true
  ).teams;
  headToHead.events[0].schedule = buildSchedule(2);
  const external = timerView(headToHead, headToHead.events[0].id, 1, {}, null, AT, EVENT_DATE);
  assert.equal(external.match.referee_team, null);
  assert.equal(external.match.external_referee, true);
});

test('timer schema is additive in fresh installs and has a guarded standalone migration', async () => {
  const root = path.resolve(__dirname, '..');
  const canonical = fs.readFileSync(path.join(root, 'scripts', 'league-schema.sql'), 'utf8');
  const additive = fs.readFileSync(path.join(root, 'scripts', 'match-timer-schema.sql'), 'utf8');
  for (const schema of [canonical, additive]) {
    assert.match(schema, /CREATE TABLE IF NOT EXISTS league_match_timers/);
    assert.match(schema, /PRIMARY KEY \(event_id, match_number\)/);
    assert.match(schema, /phase IN \('ready', 'running', 'paused'\)/);
    assert.match(schema, /ON DELETE CASCADE/);
  }
  assert.deepEqual(await migrateTimer([]), {
    mode: 'DRY_RUN',
    database_checked: false,
    statements: 1,
    note: 'No database access. Use --apply --expected-host EXACT_DB_HOST to install match timers.',
  });
  const calls = [];
  const sql = (strings, ...values) => ({ text: strings.join('?'), values });
  sql.query = text => ({ text, values: [] });
  sql.transaction = async (queries, options) => {
    calls.push({ queries, options });
    return queries.map(() => []);
  };
  const applied = await migrateTimer(
    ['--apply', '--expected-host', 'db.example.test'],
    { DATABASE_URL: 'postgres://user:password@db.example.test/database' },
    () => sql
  );
  assert.equal(applied.mode, 'APPLY');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.isolationLevel, 'ReadCommitted');
  assert(calls[0].queries.some(query => /CREATE TABLE IF NOT EXISTS league_match_timers/.test(query.text)));
});
