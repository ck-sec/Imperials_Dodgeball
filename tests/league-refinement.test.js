const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULTS, validateAction, balanceTeams, playerView, bonusAwards, scoreEvent, publicView, adminView, adminStatisticsView,
  draftTeams, requirePublishableRoster, buildSchedule,
} = require('../lib/league');
const { applyAction, syncPlayers, dbError } = require('../lib/league-db');
const { scoringView, scoringPermissions, scoringIdentity } = require('../lib/league-scoring-access');
const { matchArchivedGender, genderBackfillPlan } = require('../lib/league-gender');
const { main: migrate } = require('../scripts/migrate-league-refinement');
const { main: backfill } = require('../tools/backfill-league-gender');
const { migrationStatements } = require('../scripts/migrate-league');
const archive = require('../data/season-1.json');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const users = Array.from({ length: 6 }, (_, i) => ({
    id: id(100 + i), display_name: `Player ${i}`, ranking_player_name: null,
    is_active: true, status: 'approved', league_scorekeeper: i === 0,
  }));
  const world = {
    users, profiles: users.map((u, i) => ({ id: id(i + 1), user_id: u.id, display_name: u.display_name,
      gender: 'unspecified', is_rookie: false, initial_rating: 1000, merged_into: null })),
    sessions: [{ id: id(200), title: 'Thursday', session_date: '2026-09-10', start_time: '19:00:00',
      end_time: '21:00:00', location: 'Gym', is_cancelled: false }],
    seasons: [{ id: id(300), name: 'Season', start_date: '2026-01-01', end_date: '2026-12-31', ...DEFAULTS }],
    results: [], attendance: [], events: [],
  };
  const generated = balanceTeams(playerView(world).slice(0, 4).map(({ user_id, ...p }) => p), 2);
  world.events = [{ id: id(400), season_id: id(300), session_id: id(200), session_date: '2026-09-10',
    version: 1, status: 'draft', settings: structuredClone(DEFAULTS), roster_locked: false, schedule: null,
    ...generated, roster_ids: world.profiles.slice(0, 4).map(p => p.id), rsvp_user_ids: [], roster_source: 'manual',
    bonus_points: [{ player_id: id(1), points: 0.5 }] }];
  return world;
}

function recorder(readRows = [], simulate) {
  const sql = (strings, ...values) => {
    const query = { text: strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''), values };
    query.then = (resolve, reject) => Promise.resolve(readRows).then(resolve, reject);
    return query;
  };
  sql.query = (text, values) => ({ text, values });
  sql.transactions = [];
  sql.transaction = async (queries, options) => {
    sql.transactions.push({ queries, options });
    return simulate ? simulate(queries) : queries.map(() => []);
  };
  return sql;
}
const request = (action, event, extra = {}) => validateAction({ action, event_id: event.id, version: event.version, ...extra });
const placement = event => event.teams.map(t => ({ team_number: t.number, placement: t.number }));
const inputTeams = event => event.teams.map(t => ({ number: t.number, name: t.name, player_ids: t.players.map(p => p.id) }));
const legacyTwoTeamSchedule = () => ({
  courts: 1, match_minutes: 20, break_minutes: 0, available_minutes: 120, duration_minutes: 20,
  rounds: [{
    number: 1, start_minute: 0, end_minute: 20, bye_teams: [],
    matches: [{ number: 1, team_a: 1, team_b: 2, court: 1, score_a: null, score_b: null }],
  }],
});
const finalized = (world, event) => {
  const result = scoreEvent(event, placement(event));
  event.teams = result.teams;
  event.status = 'finalized';
  world.results = world.results.filter(r => r.event_id !== event.id).concat(result.ledger.map(r => ({ ...r, event_id: event.id })));
};

test('generation requires a deliberate two-team maximum before using an external referee', () => {
  const people = playerView(fixture());
  for (const size of [2, 3]) {
    const result = balanceTeams(people.slice(0, size * 2), size);
    assert.deepEqual(result.teams.map(t => t.players.length), [size, size]);
  }
  assert.equal(balanceTeams(people.slice(0, 4), 'auto').team_size, 2);
  assert.equal(balanceTeams(people, 'auto').team_size, 3);
  assert.throws(() => balanceTeams(people.slice(0, 3), 'auto'));
  assert.throws(() => validateAction({ action: 'generate', season_id: id(300), session_id: id(200), team_size: 2,
    player_ids: people.slice(0, 4).map(p => p.id) }), /6–500/);
  assert.equal(validateAction({ action: 'generate', season_id: id(300), session_id: id(200), team_size: 2,
    player_ids: people.slice(0, 4).map(p => p.id), max_teams: 2 }).max_teams, 2);
  assert.equal(validateAction({ action: 'generate', season_id: id(300), session_id: id(200), team_size: 2,
    player_ids: people.map(p => p.id), max_teams: 3 }).team_size, 2);
});

test('bonus settings/awards use strict numeric range, frozen step and unique actual participants', () => {
  const event = fixture().events[0];
  for (const points of [-1, 0.25, 1.5, '0.5', NaN, Infinity]) {
    assert.throws(() => bonusAwards(event, [{ player_id: id(1), points }]));
  }
  assert.throws(() => bonusAwards(event, [{ player_id: id(5), points: 0.5 }]), /participants/);
  assert.throws(() => bonusAwards(event, [{ player_id: id(1), points: 0 }, { player_id: id(1), points: 0.5 }]), /Duplicate/);
  assert.deepEqual(bonusAwards(event, []), []);
  const season = { action: 'save_season', name: 'Custom', start_date: '2026-01-01', end_date: '2026-12-31',
    bonus_points_max: 2, bonus_points_step: 0.25 };
  assert.equal(validateAction(season).bonus_points_step, 0.25);
  for (const patch of [{ bonus_points_max: 1.1 }, { bonus_points_step: 0 }, { bonus_points_max: '2' }, { bonus_points_step: null }]) {
    assert.throws(() => validateAction({ ...season, ...patch }));
  }
});

test('bonus awards add to total but never Elo; admin/public/member expose the same frozen breakdown', () => {
  const world = fixture(), event = world.events[0];
  const before = scoreEvent({ ...event, bonus_points: [] }, placement(event)).ledger;
  finalized(world, event);
  const own = world.results.find(r => r.player_id === id(1));
  assert.equal(own.points, before.find(r => r.player_id === id(1)).points + 0.5);
  assert.deepEqual(world.results.map(r => r.rating_delta), before.map(r => r.rating_delta));
  world.seasons[0].bonus_points_max = 5;
  world.seasons[0].bonus_points_step = 1;
  assert.equal(adminView(world).events[0].bonus_points_max, 1);
  assert.deepEqual(adminView(world).events[0].bonus_points, { [id(1)]: 0.5 });
  const pub = publicView(world, id(300)), member = publicView(world, id(300), id(100));
  assert.deepEqual(pub.standings, member.standings);
  const standing = pub.standings.find(p => p.display_name === 'Player 0');
  assert.equal(standing.points, standing.base_points + standing.bonus_points);
  assert.equal(standing.bonus_points, 0.5);
  assert.equal(member.history[0].bonus_points, 0.5);
  assert.equal(member.stats.points, member.history[0].points);
  const safePlayer = pub.events[0].teams.flatMap(t => t.players).find(p => p.display_name === 'Player 0');
  assert.equal(safePlayer.points, own.points);
  assert.doesNotMatch(JSON.stringify(pub), /"(player_id|user_id|gender|rating|initial_rating|rating_delta|league_scorekeeper)"/);
});

test('chronology movement includes BP exactly once after old correction, reopen and refinalization', () => {
  const world = fixture(), older = world.events[0];
  finalized(world, older);
  const recent = structuredClone(older);
  Object.assign(recent, { id: id(401), session_id: id(201), session_date: '2026-09-17',
    bonus_points: [{ player_id: id(1), points: 1 }] });
  world.sessions.push({ ...world.sessions[0], id: id(201), session_date: recent.session_date });
  world.events.unshift(recent);
  finalized(world, recent);
  const project = () => publicView(world, id(300), id(100));
  let result = project();
  assert.equal(result.comparison_event.id, recent.id);
  assert.equal(result.stats.points_gain, scoreEvent(recent, placement(recent)).ledger.find(r => r.player_id === id(1)).points);
  const gain = result.stats.points_gain;
  older.bonus_points = [];
  finalized(world, older);
  assert.equal(project().stats.points_gain, gain, 'An older correction changes baseline, not latest gain');
  recent.status = 'published';
  world.results = world.results.filter(r => r.event_id !== recent.id);
  assert.equal(project().comparison_event.id, older.id);
  assert.equal(project().stats.bonus_points, 0);
  finalized(world, recent);
  result = project();
  assert.equal(result.stats.bonus_points, 1);
  finalized(world, recent);
  assert.deepEqual(project(), result, 'Replacement ledger cannot double-count BP or Elo');
});

test('bonus persistence is versioned, admin-only, independent of scores and survives reopen', async () => {
  const world = fixture(), event = world.events[0], sql = recorder();
  await assert.rejects(applyAction(sql, request('save_bonus_points', event, { awards: [] }), world,
    { is_admin: false, user_id: id(100) }), error => error.status === 403);
  await applyAction(sql, request('save_bonus_points', event, { awards: [{ player_id: id(1), points: 1 }] }), world);
  assert(sql.transactions[0].queries.some(q => /SET bonus_points/.test(q.text)));
  assert(!sql.transactions[0].queries.some(q => /league_results|SET settings/.test(q.text)));
  await assert.rejects(applyAction(sql, { action: 'save_bonus_points', event_id: event.id, version: 9, awards: [] }, world),
    error => error.status === 409);
  finalized(world, event);
  await assert.rejects(applyAction(sql, request('save_bonus_points', event, { awards: [] }), world), /Reopen/);
  await applyAction(sql, request('reopen_results', event), world);
  const reopen = sql.transactions.at(-1).queries;
  assert(reopen.some(q => /DELETE FROM league_results/.test(q.text)));
  assert(!reopen.some(q => /SET bonus_points|bonus_points =/.test(q.text)));
  event.status = 'published';
  await applyAction(sql, request('results', event, { placements: placement(event) }), world);
  const queries = sql.transactions.at(-1).queries;
  assert(queries.findIndex(q => /DELETE FROM league_results/.test(q.text)) < queries.findIndex(q => /INSERT INTO league_results/.test(q.text)));
  assert(queries.find(q => /INSERT INTO league_results/.test(q.text)).text.includes('bonus_points'));
});

test('exact draft editing retains names/order/frozen survivors, prunes awards and validates new players', async () => {
  const world = fixture(), event = world.events[0], sql = recorder();
  const teams = inputTeams(event);
  const removed = id(1);
  teams.forEach(t => { t.player_ids = t.player_ids.filter(p => p !== removed); });
  teams[1].player_ids.push(id(5));
  teams[0].name = 'Keep exact custom name';
  const survivor = event.teams.flatMap(t => t.players).find(p => p.id === teams[1].player_ids[0]);
  world.profiles.find(p => p.id === survivor.id).initial_rating = 4321;
  world.seasons[0].k_factor = 99;
  const input = request('save_draft', event, { teams, team_size: 2 });
  await applyAction(sql, input, world);
  const queries = sql.transactions[0].queries;
  const update = queries.find(q => /UPDATE league_events SET teams/.test(q.text));
  const saved = JSON.parse(update.values[0]);
  assert.deepEqual(saved.map(t => t.players.map(p => p.id)), teams.map(t => t.player_ids));
  assert.equal(saved[0].name, teams[0].name);
  assert.equal(saved.flatMap(t => t.players).find(p => p.id === survivor.id).rating, survivor.rating);
  assert(!saved.flatMap(t => t.players).some(p => 'user_id' in p));
  assert.equal(JSON.parse(update.values[3]).length, 0, 'Removed participant BP is pruned');
  assert(!update.text.includes('settings ='));
  assert(queries.some(q => q.text.includes('Added players or ratings changed')));
  assert(queries.some(q => q.text.includes('Eligible attendance changed')));
  assert(queries.some(q => /FOR SHARE/.test(q.text)));
  const direct = draftTeams(event, teams, 2, playerView(world));
  assert.equal(direct.team_size, 2);
  for (const bad of [id(999), id(6)]) {
    world.users[5].is_active = false;
    const invalid = structuredClone(teams);
    invalid[1].player_ids[invalid[1].player_ids.length - 1] = bad;
    await assert.rejects(applyAction(recorder(), request('save_draft', event, { teams: invalid, team_size: 2 }), world), /Unknown/);
  }
});

test('draft swaps require no shuffle; duplicates/missing references reject, understrength saves but cannot publish', async () => {
  const world = fixture(), event = world.events[0];
  let teams = inputTeams(event);
  [teams[0].player_ids[0], teams[1].player_ids[0]] = [teams[1].player_ids[0], teams[0].player_ids[0]];
  assert.deepEqual(draftTeams(event, teams, 2).teams.map(t => t.players.map(p => p.id)), teams.map(t => t.player_ids));
  const duplicate = structuredClone(teams);
  duplicate[0].player_ids[0] = duplicate[1].player_ids[0];
  assert.throws(() => draftTeams(event, duplicate, 2), /duplicate/);
  assert.throws(() => draftTeams(event, [{ ...teams[0], number: 2 }, teams[1]], 2), /consecutive/);
  teams = inputTeams(event);
  teams[0].player_ids = [];
  const edited = draftTeams(event, teams, 6);
  await applyAction(recorder(), request('save_draft', event, { teams, team_size: 6 }), world);
  Object.assign(event, edited);
  assert.throws(() => requirePublishableRoster(event), error => error.status === 409);
  await assert.rejects(applyAction(recorder(), request('publish', event), world), /on-court/);
  for (const changed of [{ status: 'published' }, { status: 'finalized' }, { status: 'draft', roster_locked: true }]) {
    Object.assign(event, changed);
    await assert.rejects(applyAction(recorder(), request('save_draft', event, { teams, team_size: 2 }), world),
      error => error.status === 409);
  }
});

test('uneven and incomplete drafts save exactly, but publication requires squad sizes to differ by at most one', async () => {
  for (const sizes of [[2, 4], [2, 3], [0, 3]]) {
    const world = fixture(), event = world.events[0], sql = recorder();
    const ids = world.profiles.map(player => player.id);
    const teams = [
      { number: 1, name: 'First squad', player_ids: ids.slice(0, sizes[0]) },
      { number: 2, name: 'Second squad', player_ids: ids.slice(sizes[0], sizes[0] + sizes[1]) },
    ];
    await applyAction(sql, request('save_draft', event, { teams, team_size: 2 }), world);
    const update = sql.transactions[0].queries.find(query => /UPDATE league_events SET teams/.test(query.text));
    assert.deepEqual(JSON.parse(update.values[0]).map(team => team.players.length), sizes);
    assert(!sql.transactions[0].queries.some(query => query.text.includes("status = 'published'")));
    Object.assign(event, draftTeams(event, teams, 2, playerView(world)));
    if (sizes[0] === 2 && sizes[1] === 3) {
      assert.doesNotThrow(() => requirePublishableRoster(event));
      await applyAction(sql, request('publish', event), world);
      assert(sql.transactions[1].queries.some(query => query.text.includes("status = 'published'")));
    } else {
      const error = sizes[0] === 0 ? /on-court/ : /at most one rotating substitute/;
      assert.throws(() => requirePublishableRoster(event), error);
      await assert.rejects(applyAction(sql, request('publish', event), world), error);
      assert.equal(sql.transactions.length, 1);
    }
  }
});

test('unscheduled manual placements remain publishable and correctable without booking times', async () => {
  const world = fixture(), event = world.events[0], sql = recorder();
  Object.assign(world.sessions[0], { start_time: null, end_time: null });
  await applyAction(sql, request('publish', event), world);
  event.status = 'published';
  await applyAction(sql, request('results', event, { placements: placement(event) }), world);
  finalized(world, event);
  const corrected = placement(event).map(team => ({ ...team, placement: 3 - team.placement }));
  await applyAction(sql, request('results', event, { placements: corrected }), world);
  for (const { queries } of sql.transactions) {
    assert(!queries.some(query => query.text.includes('Training booking changed')));
  }
  const results = sql.transactions[2].queries.find(query => /INSERT INTO league_results/.test(query.text));
  assert.deepEqual(JSON.parse(results.values[1]), scoreEvent(event, corrected).ledger);
});

test('late players append to published teams and atomically replace finalized awards', async () => {
  const publishedWorld = fixture(), publishedEvent = publishedWorld.events[0], publishedSql = recorder();
  publishedEvent.status = 'published';
  const originalTeamIds = publishedEvent.teams.find(team => team.number === 2).players.map(player => player.id);
  const publishedResult = await applyAction(publishedSql, request('add_late_player', publishedEvent, {
    player_id: id(5), team_number: 2,
  }), publishedWorld);
  assert.deepEqual(publishedResult, { event_id: publishedEvent.id, player_id: id(5), team_number: 2 });
  const publishedQueries = publishedSql.transactions[0].queries;
  const publishedUpdate = publishedQueries.find(query => /UPDATE league_events SET teams/.test(query.text));
  const publishedTeams = JSON.parse(publishedUpdate.values[0]);
  assert.deepEqual(publishedTeams[1].players.map(player => player.id), [...originalTeamIds, id(5)]);
  assert.deepEqual(JSON.parse(publishedUpdate.values[1]).sort(), [...publishedEvent.roster_ids, id(5)].sort());
  assert(!publishedUpdate.text.includes('schedule ='), 'A late arrival must not rebuild or clear saved fixtures');
  assert(!publishedQueries.some(query => /(?:DELETE FROM|INSERT INTO) league_results/.test(query.text)));
  assert(publishedQueries.some(query => query.text.includes('The late player or their rating changed')));

  const finalizedWorld = fixture(), finalizedEvent = finalizedWorld.events[0], finalizedSql = recorder();
  finalized(finalizedWorld, finalizedEvent);
  const finalizedTeammateId = finalizedEvent.teams.find(team => team.number === 2).players[0].id;
  finalizedWorld.sessions.push({
    ...finalizedWorld.sessions[0], id: id(201), session_date: '2026-09-17',
  });

  finalizedWorld.events.push({
    ...structuredClone(finalizedEvent), id: id(401), session_id: id(201), session_date: '2026-09-17',
  });
  finalizedWorld.results.push({
    event_id: id(401), player_id: id(5), display_name: 'Player 4', team_number: 1,
    placement: 1, points: 1.5, bonus_points: 0, rating_delta: 50,
  });
  await applyAction(finalizedSql, request('add_late_player', finalizedEvent, {
    player_id: id(5), team_number: 2,
  }), finalizedWorld);
  const finalizedQueries = finalizedSql.transactions[0].queries;
  const deletion = finalizedQueries.findIndex(query => query.text.includes('DELETE FROM league_results'));
  const insertion = finalizedQueries.findIndex(query => query.text.includes('INSERT INTO league_results'));
  const update = finalizedQueries.findIndex(query => /UPDATE league_events SET teams/.test(query.text));
  assert(deletion >= 0 && deletion < insertion && insertion < update);
  const ledger = JSON.parse(finalizedQueries[insertion].values[1]);
  const lateResult = ledger.find(result => result.player_id === id(5));
  const teammateResult = ledger.find(result => result.player_id === finalizedTeammateId);
  assert.deepEqual(
    { team_number: lateResult.team_number, placement: lateResult.placement, points: lateResult.points },
    { team_number: teammateResult.team_number, placement: teammateResult.placement, points: teammateResult.points }
  );
  assert.equal(ledger.length, 5, 'The replacement ledger includes every original player and the late arrival once');
  const finalizedTeams = JSON.parse(finalizedQueries[update].values[0]);
  assert.equal(finalizedTeams.flatMap(team => team.players).find(player => player.id === id(5)).rating, 1000,
    'A historical correction snapshots the late player before, not after, later finalized trainings');

  await assert.rejects(applyAction(recorder(), request('add_late_player', publishedEvent, {
    player_id: id(1), team_number: 2,
  }), publishedWorld), /already assigned/);
  await assert.rejects(applyAction(recorder(), request('add_late_player', publishedEvent, {
    player_id: id(5), team_number: 99,
  }), publishedWorld), /Team not found/);
  publishedEvent.status = 'draft';
  await assert.rejects(applyAction(recorder(), request('add_late_player', publishedEvent, {
    player_id: id(5), team_number: 2,
  }), publishedWorld), /only be added after teams are published/);
});

test('live lineup corrections move and remove players without changing fixtures or accumulating results', async () => {
  const publishedWorld = fixture(), publishedEvent = publishedWorld.events[0], publishedSql = recorder();
  publishedEvent.status = 'published';
  publishedEvent.schedule = legacyTwoTeamSchedule();
  publishedEvent.schedule.rounds[0].matches[0].score_a = 7;
  publishedEvent.schedule.rounds[0].matches[0].score_b = 5;
  const movedId = publishedEvent.teams[0].players[0].id;
  const moved = inputTeams(publishedEvent);
  moved[0].player_ids = moved[0].player_ids.filter(playerId => playerId !== movedId);
  moved[1].player_ids.push(movedId);
  await applyAction(publishedSql, request('correct_lineup', publishedEvent, {
    teams: moved.map(({ number, player_ids }) => ({ number, player_ids })),
  }), publishedWorld);
  const publishedQueries = publishedSql.transactions[0].queries;
  const publishedUpdate = publishedQueries.find(query => /UPDATE league_events SET teams/.test(query.text));
  const publishedTeams = JSON.parse(publishedUpdate.values[0]);
  assert.equal(publishedTeams[0].players.some(player => player.id === movedId), false);
  assert.equal(publishedTeams[1].players.some(player => player.id === movedId), true);
  assert(!publishedUpdate.text.includes('schedule ='));
  assert.deepEqual(publishedEvent.schedule.rounds[0].matches[0], {
    number: 1, team_a: 1, team_b: 2, court: 1, score_a: 7, score_b: 5,
  });
  assert(!publishedQueries.some(query => /(?:DELETE FROM|INSERT INTO) league_results/.test(query.text)));

  const finalizedWorld = fixture(), finalizedEvent = finalizedWorld.events[0], finalizedSql = recorder();
  finalized(finalizedWorld, finalizedEvent);
  const removedId = id(1);
  const source = finalizedEvent.teams.find(team => team.players.some(player => player.id === removedId));
  assert(source.players.length > 1);
  finalizedEvent.bonus_points = [{ player_id: removedId, points: 0.5 }];
  const corrected = inputTeams(finalizedEvent).map(team => ({
    number: team.number,
    player_ids: team.player_ids.filter(playerId => playerId !== removedId),
  }));
  await applyAction(finalizedSql, request('correct_lineup', finalizedEvent, { teams: corrected }), finalizedWorld);
  const finalizedQueries = finalizedSql.transactions[0].queries;
  const deletion = finalizedQueries.findIndex(query => query.text.includes('DELETE FROM league_results'));
  const insertion = finalizedQueries.findIndex(query => query.text.includes('INSERT INTO league_results'));
  const update = finalizedQueries.findIndex(query => /UPDATE league_events SET teams/.test(query.text));
  assert(deletion >= 0 && deletion < insertion && insertion < update);
  const ledger = JSON.parse(finalizedQueries[insertion].values[1]);
  assert.equal(ledger.length, 3);
  assert.equal(ledger.some(result => result.player_id === removedId), false);
  assert.equal(ledger.every(result => Number.isInteger(result.placement)), true);
  assert.deepEqual(JSON.parse(finalizedQueries[update].values[2]), [],
    'Removing a player also prunes their event bonus award');
  assert(!finalizedQueries[update].text.includes('schedule ='));

  const duplicate = inputTeams(publishedEvent).map(team => ({ number: team.number, player_ids: [...team.player_ids] }));
  duplicate[1].player_ids.push(duplicate[0].player_ids[0]);
  assert.throws(() => validateAction({
    action: 'correct_lineup', event_id: publishedEvent.id, version: publishedEvent.version, teams: duplicate,
  }), /exactly one team/);
  const wrongNumbers = moved.map(({ number, player_ids }, index) => ({
    number: index === 1 ? 3 : number,
    player_ids,
  }));
  await assert.rejects(applyAction(recorder(), request('correct_lineup', publishedEvent, {
    teams: wrongNumbers,
  }), publishedWorld), /retain every existing team number/);
});

test('whole-matchday cancellation is reversible and excluded from every projected statistic', async () => {
  const world = fixture(), event = world.events[0], cancelSql = recorder();
  finalized(world, event);
  const saved = structuredClone({
    teams: event.teams,
    schedule: event.schedule,
    results: world.results,
  });
  await applyAction(cancelSql, request('cancel_matchday', event), world, {
    is_admin: true, user_id: id(100),
  });
  const cancelQueries = cancelSql.transactions[0].queries;
  assert(cancelQueries.some(query => /DELETE FROM league_match_timers/.test(query.text)));
  assert(cancelQueries.some(query => /SET cancelled_at = NOW\(\), cancelled_by/.test(query.text)));
  assert(!cancelQueries.some(query => /(?:DELETE FROM|INSERT INTO) league_results/.test(query.text)));

  event.cancelled_at = '2026-09-10T21:00:00.000Z';
  event.version++;
  assert.deepEqual(event.teams, saved.teams);
  assert.deepEqual(event.schedule, saved.schedule);
  assert.deepEqual(world.results, saved.results);
  const publicPayload = publicView(world, undefined, id(100));
  assert.deepEqual(publicPayload.events, []);
  assert.deepEqual(publicPayload.standings, []);
  assert.deepEqual(publicPayload.history, []);
  assert.deepEqual(publicPayload.my_events, []);
  assert.equal(adminView(world).events[0].is_cancelled, true);
  assert.deepEqual(adminStatisticsView(world, event.season_id).players, []);
  assert(playerView(world).every(player => player.rating === 1000));
  assert.throws(() => scoringView(world, event.id, { is_admin: true }), /not found/);
  await assert.rejects(applyAction(recorder(), request('correct_lineup', event, {
    teams: inputTeams(event).map(({ number, player_ids }) => ({ number, player_ids })),
  }), world), /read-only until restored/);

  const restoreSql = recorder();
  await applyAction(restoreSql, request('restore_matchday', event), world, {
    is_admin: true, user_id: id(100),
  });
  const restoreQueries = restoreSql.transactions[0].queries;
  assert(restoreQueries.some(query => /SET cancelled_at = NULL, cancelled_by = NULL/.test(query.text)));
  assert(!restoreQueries.some(query => /league_results|SET teams|SET schedule/.test(query.text)));
});

test('legacy schedules remain correctable with changed bookings but cannot be republished', async () => {
  const world = fixture(), event = world.events[0], sql = recorder();
  event.schedule = legacyTwoTeamSchedule();
  await assert.rejects(applyAction(sql, request('publish', event), world), /Regenerate the schedule before publishing/);
  Object.assign(world.sessions[0], { start_time: '23:00:00', end_time: '01:00:00' });
  event.status = 'published';
  event.schedule.rounds[0].matches[0].score_a = 2;
  event.schedule.rounds[0].matches[0].score_b = 1;
  await applyAction(sql, request('results', event), world);
  finalized(world, event);
  event.schedule.rounds[0].matches[0].score_b = 3;
  await applyAction(sql, request('results', event), world);
  assert(sql.transactions.every(({ queries }) => !queries.some(query => query.text.includes('Training booking changed'))));
  const corrected = sql.transactions[1].queries.find(query => /INSERT INTO league_results/.test(query.text));
  const ledger = JSON.parse(corrected.values[1]);
  assert(ledger.filter(row => row.team_number === 2).every(row => row.placement === 1));
});

test('exact draft save reconciles changed RSVP deliberately without regeneration or reshuffling', async () => {
  const world = fixture(), event = world.events[0];
  world.attendance.push({ session_id: event.session_id, user_id: id(104) });
  assert.deepEqual(event.rsvp_user_ids, []);
  const teams = inputTeams(event), sql = recorder();
  teams[1].player_ids.push(id(5));
  await applyAction(sql, request('save_draft', event, { teams, team_size: 2 }), world);
  const queries = sql.transactions[0].queries;
  const guard = queries.find(q => /Eligible attendance changed/.test(q.text));
  assert.deepEqual(JSON.parse(guard.values[0]), [id(104)]);
  const update = queries.find(q => /UPDATE league_events SET teams/.test(q.text));
  assert.deepEqual(JSON.parse(update.values[5]), [id(104)]);
  assert.deepEqual(JSON.parse(update.values[0]).map(t => t.players.map(p => p.id)), teams.map(t => t.player_ids));
});

test('draft and scorekeeper guards fail safely under concurrent RSVP edits and role revocation', async () => {
  const world = fixture(), event = world.events[0];
  const raced = recorder([], queries => {
    assert(queries.some(q => q.text.includes('Eligible attendance changed')));
    throw { code: 'P0001', detail: 'LEAGUE_409', message: 'Eligible attendance changed' };
  });
  await assert.rejects(applyAction(raced, request('save_draft', event, { teams: inputTeams(event), team_size: 2 }), world),
    error => dbError(error).status === 409);
  event.status = 'published';
  event.schedule = legacyTwoTeamSchedule();
  const revoked = recorder([], queries => {
    const lock = queries.findIndex(q => /FROM users WHERE id = .* FOR SHARE/.test(q.text));
    const guard = queries.findIndex(q => /league_scorekeeper = true/.test(q.text));
    const write = queries.findIndex(q => /UPDATE league_events SET schedule/.test(q.text));
    assert(lock >= 0 && lock < guard && guard < write);
    throw { code: 'P0001', detail: 'LEAGUE_403', message: 'Designated scorekeeper or admin required' };
  });
  await assert.rejects(applyAction(revoked, request('save_match', event, { match_number: 1, score_a: 3, score_b: 2 }),
    world, { user_id: id(100), is_admin: false }), error => dbError(error).status === 403);
});

test('only approved active assigned members may score; permanent role cannot change rosters/BP/settings', async () => {
  const world = fixture(), event = world.events[0], actor = { is_admin: false, user_id: id(100) };
  event.status = 'published';
  event.schedule = legacyTwoTeamSchedule();
  const input = request('save_match', event, { match_number: 1, score_a: 0, score_b: 0 });
  const sql = recorder();
  await applyAction(sql, input, world, actor);
  assert(sql.transactions[0].queries.some(q => /EXTRACT\(ISODOW FROM session_date\) = 4/.test(q.text)));
  for (const patch of [{ status: 'pending' }, { status: 'approved', is_active: false },
    { is_active: true, league_scorekeeper: false }]) {
    Object.assign(world.users[0], patch);
    await assert.rejects(applyAction(recorder(), input, world, actor), error => error.status === 403);
  }
  Object.assign(world.users[0], { status: 'approved', is_active: true, league_scorekeeper: true });
  for (const action of ['save_draft', 'save_teams', 'save_bonus_points', 'set_bonus', 'save_season', 'publish', 'results', 'set_scorekeeper', 'reopen_results']) {
    await assert.rejects(applyAction(recorder(), { action }, world, actor), error => error.status === 403);
  }
  world.sessions[0].session_date = event.session_date = '2026-09-11';
  await assert.rejects(applyAction(recorder(), input, world, actor), /Thursday/);
});

test('scorekeeper assignment is admin-only, row-locked, strict boolean and limited to active approved members', async () => {
  const world = fixture(), sql = recorder();
  await applyAction(sql, validateAction({ action: 'set_scorekeeper', user_id: id(100), enabled: true }), world);
  assert(sql.transactions[0].queries.some(q => /FROM users.*FOR UPDATE/.test(q.text)));
  assert(sql.transactions[0].queries.some(q => /SET league_scorekeeper/.test(q.text)));
  assert(!sql.transactions[0].queries.some(q => /updated_at/.test(q.text)), 'users has no updated_at column');
  for (const enabled of ['true', 1, null]) assert.throws(() => validateAction({ action: 'set_scorekeeper', user_id: id(100), enabled }));
  world.users[0].status = 'pending';
  await assert.rejects(applyAction(recorder(), { action: 'set_scorekeeper', user_id: id(100), enabled: true }, world),
    error => error.status === 404);
  await applyAction(recorder(), { action: 'set_scorekeeper', user_id: id(100), enabled: false }, world);
});

test('scoring GET excludes unpublished/cancelled/non-Thursday events and all private player fields', () => {
  const world = fixture(), event = world.events[0];
  event.status = 'published';
  event.schedule = legacyTwoTeamSchedule();
  for (const [offset, date, status, cancelled] of [
    [1, '2026-09-17', 'draft', false], [2, '2026-09-17', 'published', true],
    [3, '2026-09-11', 'published', false], [4, '2026-09-17', 'published', false],
  ]) {
    world.sessions.push({ ...world.sessions[0], id: id(200 + offset), session_date: date, is_cancelled: cancelled });
    world.events.push({ ...structuredClone(event), id: id(400 + offset), session_id: id(200 + offset), session_date: date, status });
  }
  const anonymous = scoringView(world, undefined, {}, '2026-09-12');
  assert.deepEqual(anonymous.events.map(e => e.id), [id(404), id(400)]);
  assert.equal(anonymous.event.id, id(404));
  assert.equal(anonymous.event.version, 1);
  assert.deepEqual(anonymous.permissions, { is_admin: false, is_scorekeeper: false, can_score: false });
  const authorized = scoringView(world, id(400), { user_id: id(100) }, '2026-09-12');
  assert.deepEqual(authorized.permissions, { is_admin: false, is_scorekeeper: true, can_score: true });
  assert.equal(scoringView(world, id(404), { is_admin: true }, '2026-09-12').permissions.can_score, false);
  for (const n of [401, 402, 403, 999]) assert.throws(() => scoringView(world, id(n), {}, '2026-09-12'), error => error.status === 404);
  assert.doesNotMatch(JSON.stringify(authorized), /"(player_id|user_id|rating|initial_rating|gender|is_rookie|ranking_player_name|league_scorekeeper)"/);
  for (const p of world.profiles) assert(!JSON.stringify(authorized).includes(p.id));
  event.status = 'finalized'; event.teams.forEach(t => { t.placement = t.number; });
  assert.equal(scoringPermissions(world, { user_id: id(100) }, event, '2026-09-12').can_score, false);
  event.status = 'published'; event.schedule = null;
  assert.equal(scoringPermissions(world, { is_admin: true }, event, '2026-09-12').can_score, false);
});

test('scoring default selects today, otherwise nearest future, otherwise most recent past, including readonly unscheduled events', () => {
  const world = fixture(), event = world.events[0];
  event.status = 'published';
  event.schedule = legacyTwoTeamSchedule();
  for (const [offset, date] of [[1, '2026-09-17'], [2, '2026-09-24']]) {
    world.sessions.push({ ...world.sessions[0], id: id(200 + offset), session_date: date });
    world.events.push({ ...structuredClone(event), id: id(400 + offset), session_id: id(200 + offset), session_date: date });
  }
  const selected = date => scoringView(world, undefined, { user_id: id(100) }, date);
  assert.equal(selected('2026-09-10').event.id, id(400));
  assert.equal(selected('2026-09-11').event.id, id(401));
  assert.equal(selected('2026-09-17').event.id, id(401));
  assert.equal(selected('2026-09-25').event.id, id(402));
  world.events[1].schedule = null;
  assert.equal(selected('2026-09-17').event.id, id(401));
  assert.equal(selected('2026-09-17').permissions.can_score, false);
  assert.equal(selected('2026-09-11').permissions.can_score, false);
});

test('scoring identity requires verified auth, not body/query/JWT scorekeeper claims', () => {
  const req = { headers: {}, body: { role: 'admin', league_scorekeeper: true }, query: { user_id: id(100) } };
  assert.deepEqual(scoringIdentity(req), { is_admin: false, user_id: null });
  const world = fixture();
  assert.equal(scoringPermissions(world, { user_id: id(101), league_scorekeeper: true }).is_scorekeeper, false);
});

test('archived gender uses ranking link first or unique normalized exact display name, never first-name guesses', () => {
  const rows = [{ name: 'Anna A.', gender: 'female' }, { name: 'Alex B.', gender: 'male' }];
  assert.equal(matchArchivedGender({ display_name: 'Alex B.', ranking_player_name: ' ANNA A. ' }, rows), 'female');
  assert.equal(matchArchivedGender({ display_name: ' Ａlex   B. ' }, rows), 'male');
  assert.equal(matchArchivedGender({ display_name: 'Anna' }, rows), 'unspecified');
  assert.equal(matchArchivedGender({ display_name: 'Alex B.', ranking_player_name: 'Missing Name' }, rows), 'unspecified');
  const user = { display_name: 'Anna A.' };
  assert.equal(matchArchivedGender(user, rows, [user, { display_name: ' ANNA A. ' }]), 'unspecified');
  assert.equal(matchArchivedGender(user, [...rows, rows[0]]), 'unspecified');
  assert.equal(matchArchivedGender(user, [{ name: 'Anna A.', gender: 'unknown' }]), 'unspecified');
  const world = fixture();
  world.users[0].ranking_player_name = archive.players[0].name;
  world.profiles[0].gender = 'female';
  assert.deepEqual(genderBackfillPlan(world.profiles, world.users, archive.players), []);
  world.profiles[0].gender = 'unspecified';
  assert.deepEqual(genderBackfillPlan(world.profiles, world.users, archive.players),
    [{ player_id: id(1), user_id: id(100), gender: archive.players[0].gender }]);
});

test('new profile sync uses verified archived matches only and never overwrites existing manual demographics', async () => {
  const users = [{ id: id(100), display_name: 'Unrelated label', ranking_player_name: archive.players[0].name }];
  const sql = recorder(users);
  await syncPlayers(sql);
  const queries = sql.transactions[0].queries;
  const insert = queries.find(q => /INSERT INTO league_players/.test(q.text));
  assert.equal(JSON.parse(insert.values[0])[0].gender, archive.players[0].gender);
  assert.match(insert.text, /ON CONFLICT \(user_id\) DO NOTHING/);
  assert(!queries.some(q => /UPDATE league_players/.test(q.text)));
  assert(queries.some(q => /Member names changed/.test(q.text)));
});

test('guest identity merge remaps stored BP and result identities without changing frozen awards or empty teams', async () => {
  const world = fixture(), event = world.events[0];
  world.profiles.push({ ...world.profiles[0], id: id(50), user_id: null, display_name: 'Durable guest' });
  const sql = recorder();
  await applyAction(sql, validateAction({ action: 'link_player', player_id: id(50), user_id: id(100) }), world);
  const update = sql.transactions[0].queries.find(q => /UPDATE league_events e SET/.test(q.text));
  assert.match(update.text, /bonus_points = .*SELECT COALESCE/s);
  assert.match(update.text, /jsonb_set\(award, '\{player_id\}'/);
  assert.match(update.text, /jsonb_array_elements\(e.bonus_points\)/);
  assert.match(update.text, /COALESCE\(jsonb_agg\(CASE WHEN p.player/s, 'Empty draft squads stay arrays during linking');
  assert(!update.text.includes('settings ='));
  event.teams[1].players.push({ ...world.profiles.at(-1) });
  event.roster_ids.push(id(50));
  await assert.rejects(applyAction(recorder(), validateAction({ action: 'link_player', player_id: id(50), user_id: id(100) }), world),
    /Both identities/);
});

test('refinement migration is idempotent/additive and defaults offline, requires explicit confirmed host to apply', async () => {
  const noCredentials = new Proxy({}, { get() { throw new Error('Unexpected credential read'); } });
  assert.equal((await migrate([], noCredentials)).mode, 'DRY_RUN');
  await assert.rejects(migrate(['--apply'], noCredentials), /expected-host/);
  let calls = 0;
  const env = { DATABASE_URL: 'postgresql://example:dummy@selected.example.invalid/test' };
  await assert.rejects(migrate(['--apply', '--expected-host', 'wrong.example.invalid'], env, () => { calls++; }), /match|hostname/i);
  assert.equal(calls, 0);
  const sql = recorder();
  const args = ['--apply', '--expected-host', 'selected.example.invalid'];
  await migrate(args, env, () => sql);
  await migrate(args, env, () => sql);
  assert.equal(sql.transactions.length, 2);
  assert.match(sql.transactions[0].queries[0].text, /782146931/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'league-refinement-schema.sql'), 'utf8');
  assert(migrationStatements(schema).length >= 8);
  assert.match(schema, /team_size IN \(2,3,4,5,6\)/);
  assert.match(schema, /DROP CONSTRAINT IF EXISTS league_events_team_size_check/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS league_scorekeeper BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.doesNotMatch(schema, /UPDATE\s|DELETE\s|TRUNCATE\s|DROP TABLE/i);
});

test('gender backfill defaults offline; confirmed-host dry run is read-only and apply guards unspecified profiles', async () => {
  const noCredentials = new Proxy({}, { get() { throw new Error('Unexpected credential read'); } });
  assert.equal((await backfill([], noCredentials)).mode, 'DRY_RUN');
  const world = fixture();
  world.users[0].ranking_player_name = archive.players[0].name;
  const snapshot = { users: world.users.map(({ id, display_name, ranking_player_name }) => ({ id, display_name, ranking_player_name })),
    profiles: world.profiles };
  const sql = recorder([{ snapshot }]);
  const env = { DATABASE_URL: 'postgresql://example:dummy@selected.example.invalid/test' };
  const args = ['--expected-host', 'selected.example.invalid'];
  const dry = await backfill(args, env, () => sql);
  assert.equal(dry.verified_matches, 1);
  assert.equal(sql.transactions.length, 0);
  await backfill([...args, '--apply'], env, () => sql);
  const update = sql.transactions[0].queries.find(q => /UPDATE league_players/.test(q.text));
  assert.match(update.text, /p.gender = 'unspecified' AND p.merged_into IS NULL/);
  assert.match(update.text, /p.user_id = g.user_id/);
  assert.doesNotMatch(JSON.stringify(dry), /Player|password|postgres|email/);
});
