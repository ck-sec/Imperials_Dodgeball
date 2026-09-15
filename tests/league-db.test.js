const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS, balanceTeams, playerView, validateAction, adminView, publicView, scoreEvent, buildSchedule } = require('../lib/league');
const { readWorld, applyAction, dbError, trainingMutationGuards } = require('../lib/league-db');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function worldFixture() {
  const users = Array.from({ length: 12 }, (_, i) => ({
    id: id(i + 1001), display_name: `Player ${i + 1}`, is_active: true, status: 'approved',
  }));
  return {
    users, profiles: users.map((u, i) => ({ id: id(i + 1), user_id: u.id, display_name: u.display_name,
      gender: 'unspecified', is_rookie: false, initial_rating: null, merged_into: null })), events: [], results: [],
    seasons: [{ id: id(100), name: 'Season', start_date: '2020-01-01', end_date: '2099-12-31', ...DEFAULTS }],
    sessions: [{ id: id(200), title: 'Training', session_date: '2026-01-01', start_time: '19:00:00', is_cancelled: false }],
    attendance: users.map(u => ({ session_id: id(200), user_id: u.id })),
  };
}

function recorder(transaction) {
  const sql = (strings, ...values) => ({
    text: strings.reduce((out, segment, i) => out + (i ? `$${i}` : '') + segment, ''),
    values,
  });
  sql.query = (text, values) => ({ text, values });
  sql.transactions = [];
  sql.transaction = async (queries, options) => {
    sql.transactions.push({ queries, options });
    return transaction ? transaction(queries, options) : queries.map(() => []);
  };
  return sql;
}

function eventFixture(world, status = 'published') {
  const generated = balanceTeams(playerView(world), 4);
  const event = { id: id(300), season_id: id(100), session_id: id(200), session_date: '2026-01-01',
    status, version: 1, settings: structuredClone(DEFAULTS), ...generated,
    roster_ids: world.profiles.map(p => p.id).sort(), rsvp_user_ids: world.users.map(u => u.id).sort(), roster_source: 'rsvp' };
  world.events = [event];
  return event;
}

test('referee-safe program times override the generic training end while unscheduled events retain it', async () => {
  const world = worldFixture();
  world.profiles = Array.from({ length: 30 }, (_, i) => ({
    ...world.profiles[0], id: id(i + 1), user_id: id(i + 1001), display_name: `Player ${i + 1}`,
  }));
  world.users = world.profiles.map(p => ({
    id: p.user_id, display_name: p.display_name, is_active: true, status: 'approved',
  }));
  Object.assign(world.sessions[0], { start_time: '18:00:00', end_time: '21:00:00' });
  const event = eventFixture(world);
  event.schedule = buildSchedule(5);
  assert.equal(event.schedule.duration_minutes, 120);
  let reads = 0;
  const sql = async strings => {
    reads++;
    assert.match(strings.join('?'), /'end_time',\s*s\.end_time/,
      'The database snapshot must include the stored training end, not only match timing');
    return [{ world }];
  };
  const loaded = await readWorld(sql);
  assert.equal(reads, 1);
  const project = userId => publicView(loaded, id(100), userId, '2026-01-01');
  assert.equal(project().events[0].end_time, '20:10:00');
  assert.equal(project(id(1001)).my_events[0].end_time, '20:10:00');
  loaded.sessions[0].end_time = null;
  assert.equal(project(id(1001)).my_events[0].end_time, '20:10:00',
    'The published league program includes the ten-minute finale');
  loaded.sessions[0].end_time = '21:00:00';
  event.schedule = null;
  assert.equal(project(id(1001)).my_events[0].end_time, '21:00:00',
    'Unscheduled published teams still retain their actual training end');
});

test('generation snapshots server players and settings, locks session, and checks live roster before persistence', async () => {
  const world = worldFixture();
  world.users[11].status = 'pending';
  world.attendance = world.attendance.filter(a => a.user_id !== world.users[11].id);
  const sql = recorder();
  await applyAction(sql, validateAction({ action: 'generate', season_id: id(100), session_id: id(200), team_size: 'auto' }), world);
  const { queries, options } = sql.transactions[0];
  assert.equal(options.isolationLevel, 'ReadCommitted');
  assert.match(queries[0].text, /pg_advisory_xact_lock/);
  assert.match(queries[1].text, /training_sessions.*FOR UPDATE/);
  assert.match(queries[2].text, /FOR SHARE/);
  const guardIndex = queries.findIndex(q => q.text.includes('Attendees or player ratings changed'));
  const insertIndex = queries.findIndex(q => q.text.includes('INSERT INTO league_events'));
  assert(guardIndex > 1 && guardIndex < insertIndex);
  const snapshot = JSON.parse(queries[guardIndex].values[2]);
  assert.equal(snapshot.length, 11);
  assert(snapshot.every(p => p.gender === 'unspecified' && p.rating === 1000));
  assert.match(queries[guardIndex].text, /u\.is_active = true AND u\.status = 'approved'/);
  assert.match(queries[guardIndex].text, /SUM\(r\.rating_delta\)/);
  assert(queries.some(q => q.text.includes('Season 2 scoring is being updated')));
  assert(queries.some(q => q.text.includes('Season settings changed')));
  const settingsGuard = queries.find(q => q.text.includes('Season settings changed'));
  assert.match(settingsGuard.text, /'scoring_mode', scoring_mode, 'points_step', points_step/);
  assert(queries.some(q => q.text.includes('UPDATE league_players p SET initial_rating')));
  assert.match(queries[insertIndex].text, /roster_ids, session_date/);
  const teamNames = JSON.parse(queries[insertIndex].values[4]).map(t => t.name);
  assert.equal(teamNames.length, 5, 'The real generation path should prefer five referee-safe teams');
  assert.equal(new Set(teamNames).size, teamNames.length);
  assert(teamNames.every(name => typeof name === 'string' && name.length > 0 && !/^Team \d+$/.test(name)));
});

test('Season 2 old-rule drafts cannot cross the code-first migration window', async () => {
  const world = worldFixture();
  Object.assign(world.seasons[0], {
    name: 'Season 2', start_date: '2026-09-12', end_date: '2027-07-02',
    placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative',
  });
  world.sessions[0].session_date = '2026-09-12';
  const generation = validateAction({
    action: 'generate', season_id: id(100), session_id: id(200), team_size: 4,
  });
  await assert.rejects(applyAction(recorder(), generation, world), /scoring is being updated/);
  const seasonUpdate = validateAction({
    action: 'save_season', id: id(100), name: 'Season 2',
    start_date: '2026-09-12', end_date: '2027-07-02',
    placement_points: [1, 0.5], scoring_mode: 'beaten',
  });
  await assert.rejects(applyAction(recorder(), seasonUpdate, world), /scoring is being updated/);

  const event = eventFixture(world, 'draft');
  event.session_date = world.sessions[0].session_date;
  event.settings = { ...structuredClone(DEFAULTS), placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative' };
  await assert.rejects(applyAction(recorder(), { action: 'publish', event_id: event.id, version: 1 }, world),
    /scoring is being updated/);
  event.status = 'published';
  await assert.rejects(applyAction(recorder(), {
    action: 'results', event_id: event.id, version: 1,
    placements: event.teams.map(team => ({ team_number: team.number, placement: team.number })),
  }, world), /scoring is being updated/);

  Object.assign(world.seasons[0], { placement_points: [1, 0.5], scoring_mode: 'beaten' });
  event.status = 'draft';
  await assert.rejects(applyAction(recorder(), { action: 'publish', event_id: event.id, version: 1 }, world),
    /scoring is being updated/);
  event.status = 'published';
  const sql = recorder();
  await applyAction(sql, {
    action: 'results', event_id: event.id, version: 1,
    placements: event.teams.map(team => ({ team_number: team.number, placement: team.number })),
  }, world);
  assert(sql.transactions[0].queries.some(query => query.text.includes('INSERT INTO league_results')),
    'Frozen historical relative results remain correctable after the season migration');
});

test('generated names persist through reads/publication/scoring and remain manually editable', async () => {
  const world = worldFixture();
  const sql = recorder();
  await applyAction(sql, validateAction({ action: 'generate', season_id: id(100), session_id: id(200), team_size: 4 }), world);
  const insert = sql.transactions[0].queries.find(q => q.text.includes('INSERT INTO league_events'));
  const teams = JSON.parse(insert.values[4]);
  const names = teams.map(t => t.name);
  const event = eventFixture(world, 'draft');
  event.teams = teams;
  assert.deepEqual(adminView(world).events[0].teams.map(t => t.name), names);
  assert.deepEqual(adminView(world).events[0].teams.map(t => t.name), names);
  await applyAction(sql, { action: 'publish', event_id: event.id, version: 1 }, world);
  assert(!sql.transactions[1].queries.some(q => /SET teams|team\.name/.test(q.text)));
  event.status = 'published';
  const scored = scoreEvent(event, event.teams.map(t => ({ team_number: t.number, placement: t.number })));
  assert.deepEqual(scored.teams.map(t => t.name), names);
  event.status = 'draft';
  const custom = event.teams.map(t => ({ number: t.number, name: `Admin Name ${t.number}`, player_ids: t.players.map(p => p.id) }));
  await applyAction(sql, validateAction({ action: 'save_teams', event_id: event.id, version: 1, teams: custom }), world);
  const update = sql.transactions[2].queries.find(q => q.text.includes('UPDATE league_events SET teams'));
  assert.deepEqual(JSON.parse(update.values[0]).map(t => t.name), custom.map(t => t.name));
  assert.deepEqual(balanceTeams(playerView(world), 4).teams.map(t => t.name), ['Team 1', 'Team 2', 'Team 3'],
    'Pure balancing must stay deterministic and independent of the random name generator');
});

test('published reads, match-score saves and final result writes retain generated team names exactly', async () => {
  const world = worldFixture();
  const sql = recorder();
  await applyAction(sql, validateAction({ action: 'generate', season_id: id(100), session_id: id(200), team_size: 4 }), world);
  const generated = sql.transactions[0].queries.find(q => q.text.includes('INSERT INTO league_events'));
  const event = eventFixture(world, 'draft');
  event.teams = JSON.parse(generated.values[4]);
  event.schedule = buildSchedule(event.teams.length);
  const names = event.teams.map(t => t.name);
  await applyAction(sql, { action: 'publish', event_id: event.id, version: event.version }, world);
  event.status = 'published';
  event.version++;
  assert.deepEqual(publicView(world, event.season_id).events[0].teams.map(t => t.name), names);
  await applyAction(sql, validateAction({ action: 'save_match', event_id: event.id, version: event.version,
    match_number: 1, score_a: 2, score_b: 1 }), world);
  const scoreQueries = sql.transactions[2].queries;
  assert(!scoreQueries.some(q => q.text.includes('SET teams')));
  event.schedule = JSON.parse(scoreQueries.find(q => q.text.includes('UPDATE league_events SET schedule')).values[0]);
  event.schedule.rounds.flatMap(round => round.matches).forEach(match => {
    if (match.score_a === null) { match.score_a = 2; match.score_b = 1; }
  });
  event.roster_locked = true;
  event.version++;
  assert.deepEqual(adminView(world).events[0].teams.map(t => t.name), names);
  await applyAction(sql, validateAction({ action: 'results', event_id: event.id, version: event.version }), world);
  const result = sql.transactions[3].queries.find(q => q.text.includes('UPDATE league_events SET teams'));
  event.teams = JSON.parse(result.values[0]);
  event.status = 'finalized';
  assert.deepEqual(event.teams.map(t => t.name), names);
  assert.deepEqual(publicView(world, event.season_id).events[0].teams.map(t => t.name), names);
});

test('regeneration requires existing draft version and may not move event to another season', async () => {
  const world = worldFixture();
  const event = eventFixture(world, 'draft');
  const input = { action: 'generate', season_id: event.season_id, session_id: event.session_id, team_size: 4 };
  await assert.rejects(applyAction(recorder(), input, world), error => error.status === 409);
  event.status = 'published';
  await assert.rejects(applyAction(recorder(), { ...input, version: 1 }, world), error => error.status === 409);
  event.status = 'draft';
  const sql = recorder();
  await applyAction(sql, { ...input, version: 1 }, world);
  assert(sql.transactions[0].queries.some(q => q.text.includes('UPDATE league_events SET team_size')));
});

test('publish verifies eligible attendance and unchanged date after obtaining the shared RSVP session lock', async () => {
  const world = worldFixture();
  const event = eventFixture(world, 'draft');
  const sql = recorder();
  await applyAction(sql, { action: 'publish', event_id: event.id, version: 1 }, world);
  const queries = sql.transactions[0].queries;
  const rowLock = queries.findIndex(q => /training_sessions.*FOR UPDATE/.test(q.text));
  const attendanceGuard = queries.findIndex(q => q.text.includes('Eligible attendance changed'));
  const mutation = queries.findIndex(q => q.text.includes("SET status = 'published'"));
  assert(rowLock >= 0 && attendanceGuard > rowLock && mutation > attendanceGuard);
  assert(queries.some(q => q.text.includes('Season 2 scoring is being updated')));
  assert.deepEqual(JSON.parse(queries[attendanceGuard].values[0]), event.rsvp_user_ids);
  assert.match(queries[attendanceGuard].text, /u\.is_active = true AND u\.status = 'approved'/);
  assert(queries.some(q => q.text.includes('t.session_date =')));
  assert(queries.some(q => q.text.includes('version =') && q.text.includes('status = ANY')));
});

test('result write is one guarded transaction replacing the ledger, never incrementing previous totals', async () => {
  const world = worldFixture();
  const event = eventFixture(world);
  const sql = recorder();
  const input = { action: 'results', event_id: event.id, version: 1,
    placements: [{ team_number: 1, placement: 1 }, { team_number: 2, placement: 2 }, { team_number: 3, placement: 3 }] };
  await applyAction(sql, input, world);
  const { queries, options } = sql.transactions[0];
  assert.equal(options.isolationLevel, 'ReadCommitted');
  const guard = queries.findIndex(q => q.text.includes('status = ANY'));
  const deletion = queries.findIndex(q => q.text.includes('DELETE FROM league_results'));
  const insertion = queries.findIndex(q => q.text.includes('INSERT INTO league_results'));
  const update = queries.findIndex(q => q.text.includes("status = 'finalized'"));
  assert(guard > 0 && deletion > guard && insertion > deletion && update > insertion);
  assert(queries.some(q => q.text.includes('Season 2 scoring is being updated')));
  assert(queries.some(q => q.text.includes("AT TIME ZONE 'Europe/Vienna'")));
  const ledger = JSON.parse(queries[insertion].values[1]);
  assert.equal(ledger.length, 12);
  assert(ledger.every(r => [2, 1.5, 1].includes(r.points)));
  assert(!queries.some(q => /UPDATE league_players|rating_delta\s*=\s*rating_delta\s*\+/.test(q.text)));
  await assert.rejects(applyAction(recorder(), { ...input, version: 0 }, world), error => error.status === 409);
  event.session_date = '2099-01-01';
  await assert.rejects(applyAction(recorder(), input, world), error => error.status === 409);
});

test('concurrent duplicate result requests reach the database version guard before ledger replacement', async () => {
  const world = worldFixture();
  const event = eventFixture(world);
  let version = 1, replacements = 0, serialized = Promise.resolve();
  // Transactional fake: verifies query ordering and stale-write behavior without a live database.
  const sql = recorder(queries => {
    const operation = serialized.then(() => {
      for (const q of queries) {
        if (q.text.includes('status = ANY') && q.values[1] !== version) {
          throw Object.assign(new Error('The event changed'), { code: 'P0001', detail: 'LEAGUE_409' });
        }
        if (q.text.includes('DELETE FROM league_results')) replacements++;
        if (q.text.includes("status = 'finalized'")) version++;
      }
      return queries.map(() => []);
    });
    serialized = operation.catch(() => {});
    return operation;
  });
  const input = { action: 'results', event_id: event.id, version: 1,
    placements: [{ team_number: 1, placement: 1 }, { team_number: 2, placement: 2 }, { team_number: 3, placement: 3 }] };
  const outcomes = await Promise.allSettled([applyAction(sql, input, world), applyAction(sql, input, world)]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(dbError(outcomes.find(o => o.status === 'rejected').reason).status, 409);
  assert.equal(replacements, 1);
  assert.equal(version, 2);
});

test('season/settings writes guard assigned dates and player edits never touch the results ledger', async () => {
  const world = worldFixture();
  const sql = recorder();
  await applyAction(sql, validateAction({ action: 'save_season', ...world.seasons[0] }), null);
  let queries = sql.transactions[0].queries;
  assert.match(queries[0].text, /pg_advisory_xact_lock/);
  assert(queries.some(q => q.text.includes('Season 2 scoring is being updated')));
  assert(queries.some(q => q.text.includes('Season dates cannot exclude assigned training events')));
  assert(!queries.some(q => /UPDATE league_events|DELETE FROM league_results/.test(q.text)));
  await applyAction(sql, validateAction({
    action: 'save_player', user_id: id(1001), gender: 'female', is_rookie: true, initial_rating: 750,
  }), world);
  queries = sql.transactions[1].queries;
  assert(queries.some(q => q.text.includes('Approved active player not found')));
  assert(!queries.some(q => /league_results|league_events/.test(q.text)));
});

test('training cancel/delete/date guards retain league history and use writer-before-session lock order', () => {
  const sql = recorder();
  for (const args of [[undefined, true, false], [undefined, false, true], ['2026-10-01', false, false]]) {
    const queries = trainingMutationGuards(sql, id(200), ...args);
    assert.match(queries[0].text, /pg_advisory_xact_lock/);
    assert.match(queries[1].text, /training_sessions.*FOR UPDATE/);
    assert(queries.some(q => q.text.includes('league_events')));
  }
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'admin', 'training.js'), 'utf8');
  const readSection = adminSource.split('// ── POST:')[0];
  assert(!/DELETE FROM training_sessions/.test(readSection));
  const rsvpSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'training.js'), 'utf8');
  assert.match(rsvpSource, /leagueTransaction\(sql, \[\s*sessionLock\(sql, session_id\)/);
  assert.match(rsvpSource, /Registration is frozen/);
  assert.match(rsvpSource, /AS rsvp_locked/);
});

test('only known database errors become safe actionable HTTP errors', () => {
  assert.equal(dbError({ code: 'P0001', detail: 'LEAGUE_409', message: 'Roster stale' }).status, 409);
  assert.equal(dbError({ code: '40001', message: 'database connection details' }).status, 409);
  assert.equal(dbError({ code: 'P0001', detail: 'NOT_OURS', message: 'secret' }), null);
  assert.equal(dbError({ code: '42P01', message: 'secret' }), null);
});
