const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  CALENDAR_CONFIG, CalendarError, buildCalendar, sameIdentity, planExisting,
  validateTarget, initializeSeasonTwo,
} = require('../lib/season-two-calendar');
const { parseArgs, main, safeError } = require('../tools/initialize-season-two');

const calendar = buildCalendar();
const host = 'calendar-test.invalid';
const databaseUrl = `postgresql://test:placeholder@${host}/unit_test`;
const target = { expectedHost: host, databaseUrl };
const skippedDates = [
  '2026-10-26', '2026-10-29', '2026-10-30', '2026-11-02',
  '2026-12-24', '2026-12-25', '2026-12-28', '2026-12-31',
  '2027-01-01', '2027-01-04', '2027-02-01', '2027-02-04', '2027-02-05',
  '2027-03-22', '2027-03-25', '2027-03-26', '2027-03-29',
  '2027-05-06', '2027-05-17', '2027-05-27',
];

function completeState() {
  return {
    seasons: [{ id: 'season-two-test', ...structuredClone(calendar.season) }],
    sessions: calendar.sessions.map((session, index) => ({
      id: `session-${index}`, ...session,
      start_time: `${session.start_time}:00`, end_time: `${session.end_time}:00`,
    })),
  };
}

function recorder(initialState = { seasons: [], sessions: [] }, failApply) {
  let state = structuredClone(initialState);
  const sql = { transactions: [], query: (text, values) => ({ text, values }) };
  sql.transaction = async (queries, options) => {
    sql.transactions.push({ queries, options });
    if (options.readOnly) return [[{ state: structuredClone(state) }]];
    if (failApply) throw failApply;
    const next = structuredClone(state);
    for (const query of queries) {
      if (/INSERT INTO league_seasons/.test(query.text)) {
        next.seasons.push({ id: 'new-season', ...JSON.parse(query.values[0]) });
      }
      if (/INSERT INTO training_sessions/.test(query.text)) {
        next.sessions.push(...JSON.parse(query.values[0]).map((session, index) => ({ id: `new-session-${index}`, ...session })));
      }
    }
    state = next;
    return queries.map((query, index) => index === queries.length - 1 ? [{ state: structuredClone(state) }] : []);
  };
  sql.state = () => structuredClone(state);
  return sql;
}

test('confirmed weekly calendar has 143 sessions from 168 candidates, excluding 25 sessions on 20 dates', () => {
  assert.deepEqual([calendar.summary.candidates, calendar.summary.included, calendar.summary.excluded], [168, 143, 25]);
  assert.deepEqual(calendar.summary.by_slot.map(slot => [slot.candidates, slot.included, slot.excluded]),
    [[42, 34, 8], [42, 35, 7], [42, 37, 5], [42, 37, 5]]);
  assert.deepEqual(calendar.summary.skipped_dates.map(day => day.date), skippedDates);
  assert.equal(calendar.summary.skipped_dates.reduce((sum, day) => sum + day.sessions, 0), 25);
  assert.deepEqual(calendar.season, {
    name: 'Season 2', placement_points: [1, 0.5], scoring_mode: 'beaten',
    points_step: 0.5, default_rating: 1000, rookie_rating: 800, k_factor: 24,
    start_date: '2026-09-14', end_date: '2027-07-02',
  });
});

test('inclusive boundaries, weekdays, exact titles/locations and local wall-clock times match confirmation', () => {
  assert.equal(calendar.sessions[0].session_date, '2026-09-14');
  assert.deepEqual(calendar.sessions.filter(session => session.session_date === '2027-07-02').map(session => session.title),
    ['Jugendtraining (12-18 Jahre)', 'Erwachsenentraining']);
  const expected = {
    'Basic Skill Training': [1, '19:00', '21:00', 'O-MS Max Winter Platz 12'],
    'Imperials Social League': [4, '18:00', '21:00', 'Volksschule in der Krieau'],
    'Jugendtraining (12-18 Jahre)': [5, '17:00', '19:00', 'Am Kaisermuehlendamm 2'],
    Erwachsenentraining: [5, '19:00', '21:00', 'Am Kaisermuehlendamm 2'],
  };
  const identities = new Set();
  for (const session of calendar.sessions) {
    assert(session.session_date >= '2026-09-14' && session.session_date <= '2027-07-02');
    assert.equal(new Date(`${session.session_date}T00:00:00Z`).getUTCDay(), session.recurring_day);
    assert.deepEqual([session.recurring_day, session.start_time, session.end_time, session.location], expected[session.title]);
    assert.equal(session.description, null);
    assert.equal(session.max_capacity, null);
    assert.equal(session.is_cancelled, false);
    const identity = JSON.stringify([session.session_date, session.start_time, session.end_time, session.title, session.location]);
    assert(!identities.has(identity));
    identities.add(identity);
  }
});

test('official ranges and statutory school-free days apply to every slot without double-counting overlaps', () => {
  for (const holiday of CALENDAR_CONFIG.school_holidays) {
    assert(!calendar.sessions.some(session => session.session_date >= holiday.start_date && session.session_date <= holiday.end_date));
  }
  for (const holiday of [...CALENDAR_CONFIG.public_holidays, ...CALENDAR_CONFIG.school_free_days]) {
    assert(!calendar.sessions.some(session => session.session_date === holiday.date));
  }
  const allSouls = calendar.summary.skipped_dates.find(day => day.date === '2026-11-02');
  assert.deepEqual(allSouls.reasons.map(reason => reason.kind), ['school_free_day']);
  for (const date of ['2026-12-25', '2027-01-01', '2027-03-29', '2027-05-17']) {
    const entry = calendar.summary.skipped_dates.find(day => day.date === date);
    assert(entry.reasons.some(reason => reason.kind === 'school_holiday'));
    assert(entry.reasons.some(reason => reason.kind === 'public_holiday'));
    assert.equal(entry.sessions, date === '2026-12-25' || date === '2027-01-01' ? 2 : 1);
  }
  assert(CALENDAR_CONFIG.school_free_days.some(day => day.date === '2026-11-15' && day.name === 'Hl. Leopold'));
  assert(CALENDAR_CONFIG.notes.some(note => /autonomous.*unknown/i.test(note)));
  assert.equal(calendar.sessions.filter(session => session.session_date === '2027-01-07').length, 1,
    'A 7 January closure requires a school-specific declaration, not an assumption.');
  for (const date of ['2027-05-07', '2027-05-28']) {
    assert.equal(calendar.sessions.filter(session => session.session_date === date).length, 2, 'Do not guess school-autonomous bridge days.');
  }
  for (const item of calendar.skipped) {
    for (const reason of item.reasons) {
      for (const source of reason.sources) {
        assert.match(CALENDAR_CONFIG.sources[source].url, /^https:\/\/(?:www\.)?(?:bildung-wien|bmb|ris\.bka)\.gv\.at\//);
      }
    }
  }
});

test('calendar output is deterministic regardless of host timezone or DST', () => {
  const code = "process.stdout.write(JSON.stringify(require('./lib/season-two-calendar').buildCalendar().sessions))";
  for (const timezone of ['UTC', 'Europe/Vienna', 'America/Los_Angeles', 'Pacific/Auckland']) {
    const output = execFileSync(process.execPath, ['-e', code], {
      cwd: path.join(__dirname, '..'), env: { TZ: timezone }, encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(output), calendar.sessions);
  }
});

test('calendar validation rejects invalid civil dates, time ranges, duplicate slots and unsourced holidays', () => {
  for (const mutate of [
    config => { config.start_date = '2026-02-30'; },
    config => { config.end_date = '2026-09-13'; },
    config => { config.slots[0].recurring_day = 7; },
    config => { config.slots[0].end_time = '19:00'; },
    config => { config.slots[0].start_time = '25:00'; },
    config => { config.slots.push({ ...config.slots[0] }); },
    config => { config.slots.push({ ...config.slots[0], id: 'duplicate-time' }); },
    config => { config.school_holidays[0].sources = ['unverified']; },
    config => { config.timezone = 'UTC'; },
  ]) {
    const config = structuredClone(CALENDAR_CONFIG);
    mutate(config);
    assert.throws(() => buildCalendar(config), CalendarError);
  }
});

test('empty database plan inserts only a season and missing sessions without mutating its inputs', () => {
  const state = { seasons: [], sessions: [] };
  const plan = planExisting(calendar, state);
  assert.equal(plan.season.action, 'create');
  assert.equal(plan.missing.length, 143);
  assert.equal(plan.preserved.length, 0);
  assert.deepEqual(state, { seasons: [], sessions: [] });
});

test('rerun preserves existing IDs, configured settings, descriptions, capacities and cancelled sessions', () => {
  const state = completeState();
  Object.assign(state.seasons[0], {
    placement_points: [10, 4, 1], scoring_mode: 'fixed', points_step: 1,
    default_rating: 1500, rookie_rating: 1200, k_factor: 16, start_date: '2026-09-01',
  });
  Object.assign(state.sessions[0], { is_cancelled: true, description: 'Admin note', max_capacity: 17, recurring_day: null });
  const before = structuredClone(state);
  const plan = planExisting(calendar, state);
  assert.equal(plan.missing.length, 0);
  assert.equal(plan.preserved.length, 143);
  assert.equal(plan.season.action, 'preserve');
  assert.deepEqual(plan.season.values, state.seasons[0]);
  assert.deepEqual(plan.summary.preserved_cancelled_ids, ['session-0']);
  assert.deepEqual(state, before);
  assert(sameIdentity(calendar.sessions[0], state.sessions[0]), 'Postgres HH:MM:SS and confirmed HH:MM are the same local time.');
});

test('existing exact-boundary season aliases are preserved; incompatible or ambiguous seasons fail', () => {
  const state = completeState();
  state.seasons[0].name = 'Imperials 2026/27';
  assert.equal(planExisting(calendar, state).season.action, 'preserve');
  for (const seasons of [
    [{ ...calendar.season, id: 'narrow', start_date: '2026-09-15' }],
    [{ ...calendar.season, id: 'unrelated', name: 'Other league', start_date: '2026-09-15' }],
    [{ ...calendar.season, id: 'old-name', start_date: '2025-09-01', end_date: '2026-07-01' }],
    [{ ...calendar.season, id: 'a' }, { ...calendar.season, id: 'b' }],
  ]) {
    assert.throws(() => planExisting(calendar, { seasons, sessions: [] }), /season/i);
  }
  assert.equal(planExisting(calendar, {
    seasons: [{ ...calendar.season, id: 'season-1', name: 'Season 1', start_date: '2025-09-01', end_date: '2026-07-01' }],
    sessions: [],
  }).season.action, 'create');
});

test('duplicate identities, renamed/moved slots and venue overlaps fail with IDs instead of overwriting', () => {
  for (const mutate of [
    state => { state.sessions.push({ ...state.sessions[0], id: 'duplicate' }); },
    state => { state.sessions[0].title = 'Renamed training'; },
    state => { state.sessions[0].location = 'Moved venue'; },
    state => { state.sessions[0].start_time = '18:30'; },
    state => { state.sessions[0].title = 'Another training'; state.sessions[0].start_time = '20:00'; },
    state => { state.sessions.push({ ...state.sessions[0], id: 'cancelled-duplicate', is_cancelled: true }); },
  ]) {
    const state = completeState();
    mutate(state);
    assert.throws(() => planExisting(calendar, state), error =>
      error instanceof CalendarError && /Calendar conflicts/.test(error.message)
      && /2026-09-14/.test(error.message) && /session-0/.test(error.message));
  }
});

test('unrelated sessions are left alone and adjacent Friday sessions do not overlap', () => {
  const state = completeState();
  state.sessions.push({
    ...state.sessions[0], id: 'other', title: 'Independent morning event', start_time: '09:00', end_time: '10:00',
  });
  assert.equal(planExisting(calendar, state).preserved.length, 143);
  assert.equal(planExisting(calendar, state).missing.length, 0);
});

test('active sessions on excluded holidays fail; already-cancelled holiday rows are not touched', () => {
  const holiday = { id: 'holiday-row', ...calendar.skipped[0].session };
  assert.throws(() => planExisting(calendar, { seasons: [], sessions: [holiday] }),
    /Excluded holiday.*2026-10-26.*Nationalfeiertag.*holiday-row/);
  const cancelled = { ...holiday, is_cancelled: true };
  const state = { seasons: [], sessions: [cancelled] };
  assert.equal(planExisting(calendar, state).missing.length, 143);
  assert.equal(state.sessions[0], cancelled);
});

test('target guard requires exact PostgreSQL hostname and never exposes URL credentials', () => {
  assert.equal(validateTarget(host.toUpperCase(), databaseUrl), host);
  for (const expectedHost of [undefined, '', 'other.invalid', 'invalid', `${host}:5432`, `https://${host}`, `${host}/db`, '*']) {
    assert.throws(() => validateTarget(expectedHost, databaseUrl), error =>
      error instanceof CalendarError && !error.message.includes('placeholder'));
  }
  for (const url of [undefined, 'not a URL', `https://${host}/db`, `postgresql://test:placeholder@other.${host}/db`]) {
    assert.throws(() => validateTarget(host, url), CalendarError);
  }
});

test('default CLI preview is completely offline and does not even inspect the environment', async () => {
  const env = new Proxy({}, { get() { throw new Error('Must not read credentials for offline mode'); } });
  const result = await main([], env, () => { throw new Error('Must not construct a database client'); });
  assert.equal(result.mode, 'DRY_RUN');
  assert.equal(result.database_checked, false);
  assert.equal(result.calendar.included, 143);
});

test('CLI parsing fails closed for missing confirmation, unknown/duplicate options and conflicting modes', () => {
  assert.deepEqual(parseArgs([]), { apply: false, expectedHost: undefined, help: false });
  assert.equal(parseArgs(['--expected-host', host]).apply, false);
  assert.equal(parseArgs(['--apply', '--expected-host', host]).apply, true);
  for (const args of [
    ['--apply'], ['--expected-host'], ['--expected-host', '--apply'], ['--apply=true'],
    ['--apply', '--dry-run', '--expected-host', host], ['--apply', '--apply', '--expected-host', host],
    ['--expected-host', host, '--expected-host', host], ['--force'],
  ]) assert.throws(() => parseArgs(args), CalendarError);
});

test('CLI uses the validated URL, supports POSTGRES_URL fallback and refuses mismatches before client construction', async () => {
  let selectedUrl;
  const sql = recorder();
  const result = await main(['--expected-host', host], { POSTGRES_URL: databaseUrl }, url => {
    selectedUrl = url;
    return sql;
  });
  assert.equal(selectedUrl, databaseUrl);
  assert.equal(result.mode, 'DRY_RUN');
  assert.equal(sql.transactions.length, 1);
  await assert.rejects(main(['--apply', '--expected-host', host], { DATABASE_URL: databaseUrl.replace(host, 'other.invalid') },
    () => { throw new Error('Must not construct client'); }), /hostname does not match/);
});

test('database dry run is a read-only snapshot and never sends writes or writer locks', async () => {
  const sql = recorder();
  const result = await initializeSeasonTwo({ sql, ...target });
  assert.equal(result.mode, 'DRY_RUN');
  assert.equal(result.plan.sessions_to_create, 143);
  assert.equal(sql.transactions.length, 1);
  assert.deepEqual(sql.transactions[0].options, { isolationLevel: 'RepeatableRead', readOnly: true });
  assert(sql.transactions[0].queries.every(query => !/\b(?:INSERT|UPDATE|DELETE|LOCK)\b/i.test(query.text)));
});

test('apply is atomic, serialized against other writers, snapshot-guarded, insert-only and postcondition-verified', async () => {
  const sql = recorder();
  const result = await initializeSeasonTwo({ sql, ...target, apply: true });
  assert.equal(result.mode, 'APPLIED');
  assert.equal(result.verified.sessions_preserved, 143);
  assert.equal(result.verified.sessions_to_create, 0);
  const transaction = sql.transactions[1];
  assert.deepEqual(transaction.options, { isolationLevel: 'ReadCommitted' });
  const text = transaction.queries.map(query => query.text).join('\n');
  assert.match(transaction.queries[0].text, /lock_timeout.*statement_timeout/);
  assert.match(transaction.queries[1].text, /pg_advisory_xact_lock\(782146931\)/);
  assert.match(transaction.queries[2].text, /LOCK TABLE league_seasons, training_sessions IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(transaction.queries[3].text, /league_assert\(state = \$3::jsonb/);
  assert.deepEqual(JSON.parse(transaction.queries[3].values[2]), { seasons: [], sessions: [] });
  assert.equal(transaction.queries.filter(query => /INSERT INTO league_seasons/.test(query.text)).length, 1);
  assert.equal(transaction.queries.filter(query => /INSERT INTO training_sessions/.test(query.text)).length, 1);
  assert.match(transaction.queries.at(-2).text, /Calendar postcondition failed/);
  assert.match(transaction.queries.at(-2).text, /COUNT\(\*\).*training_sessions/);
  assert.match(transaction.queries.at(-1).text, /AS state/);
  assert(!/\b(?:UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(text));
  assert(!/\b(?:users|training_attendance|league_players|league_events|league_results)\b/.test(text));
  assert.equal(sql.state().seasons.length, 1);
  assert.equal(sql.state().sessions.length, 143);
  const rerun = await initializeSeasonTwo({ sql, ...target, apply: true });
  assert.equal(rerun.plan.sessions_to_create, 0);
  assert.equal(rerun.plan.season_action, 'preserve');
  assert(!sql.transactions[3].queries.some(query => /\bINSERT\b/.test(query.text)));
  assert.equal(sql.state().sessions.length, 143);
});

test('partial calendars insert only missing identities and preserve configured season fields', async () => {
  const state = completeState();
  state.sessions = state.sessions.slice(0, 8);
  state.seasons[0].k_factor = 32;
  const sql = recorder(state);
  const result = await initializeSeasonTwo({ sql, ...target, apply: true });
  assert.equal(result.plan.sessions_to_create, 135);
  assert.equal(result.plan.sessions_preserved, 8);
  assert(!sql.transactions[1].queries.some(query => /INSERT INTO league_seasons/.test(query.text)));
  assert.equal(sql.state().seasons[0].k_factor, 32);
  assert.deepEqual(sql.state().sessions.slice(0, 8), state.sessions);
});

test('conflicts and target mismatch stop before any write transaction; concurrent failure propagates', async () => {
  const state = completeState();
  state.sessions[0].title = 'Renamed';
  const sql = recorder(state);
  await assert.rejects(initializeSeasonTwo({ sql, ...target, apply: true }), /Calendar conflicts/);
  assert.equal(sql.transactions.length, 1);
  const unused = recorder();
  await assert.rejects(initializeSeasonTwo({ sql: unused, databaseUrl, expectedHost: 'wrong.invalid', apply: true }), /hostname/);
  assert.equal(unused.transactions.length, 0);
  const concurrent = Object.assign(new Error('State changed'), { code: 'P0001', detail: 'LEAGUE_409' });
  const failed = recorder({ seasons: [], sessions: [] }, concurrent);
  await assert.rejects(initializeSeasonTwo({ sql: failed, ...target, apply: true }), error => error === concurrent);
  assert.deepEqual(failed.state(), { seasons: [], sessions: [] });
});

test('connection failures are redacted while schema and concurrency failures remain actionable', () => {
  assert(!safeError(new Error(`Cannot connect to ${databaseUrl}`)).includes('placeholder'));
  assert.match(safeError({ code: '42P01' }), /additive.*league-schema\.sql/);
  assert.match(safeError({ code: 'P0001', detail: 'LEAGUE_409' }), /rolled back/);
  assert.match(safeError({ code: '55P03' }), /timeout/);
  assert.match(safeError(new CalendarError('A specific calendar conflict')), /specific calendar conflict/);
});
