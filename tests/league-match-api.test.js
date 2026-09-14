const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULTS, balanceTeams, validateAction, matchData, hasMatchScores, eventPlacements,
  publicView, adminView, scoreEvent,
} = require('../lib/league');
const { buildSchedule, matchStandings, MatchError } = require('../lib/league-matches');
const { applyAction, dbError } = require('../lib/league-db');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(teamCount = 5) {
  const players = Array.from({ length: teamCount * 6 }, (_, i) => ({
    id: id(i + 1), user_id: id(i + 1001), display_name: `Player ${i + 1}`,
    gender: i % 2 ? 'female' : 'male', is_rookie: false, rating: 1000, initial_rating: 1000, merged_into: null,
  }));
  const session = { id: id(3000), title: 'Training', session_date: '2026-01-01',
    start_time: '19:00:00', location: 'Vienna', is_cancelled: false };
  const event = {
    id: id(2000), season_id: id(4000), session_id: session.id, session_date: session.session_date,
    status: 'draft', version: 1, settings: structuredClone(DEFAULTS), roster_locked: false, schedule: null,
    ...balanceTeams(players.map(({ user_id, ...p }) => p), 6, teamCount, true),
    roster_ids: players.map(p => p.id).sort(), rsvp_user_ids: players.map(p => p.user_id).sort(), roster_source: 'rsvp',
  };
  return {
    profiles: players,
    users: players.map(p => ({ id: p.user_id, display_name: p.display_name, is_active: true, status: 'approved' })),
    seasons: [{ id: event.season_id, name: 'Season 2', start_date: '2020-01-01', end_date: '2099-12-31', ...DEFAULTS }],
    sessions: [session], events: [event], results: [],
    attendance: players.map(p => ({ user_id: p.user_id, session_id: session.id })),
  };
}

function recorder(transaction) {
  const sql = (strings, ...values) => ({
    text: strings.reduce((out, segment, i) => out + (i ? `$${i}` : '') + segment, ''), values,
  });
  sql.query = (text, values) => ({ text, values });
  sql.transactions = [];
  sql.transaction = async (queries, options) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    sql.transactions.push(queries);
    return transaction ? transaction(queries) : queries.map(() => []);
  };
  return sql;
}

function scheduled(world, score) {
  const event = world.events[0];
  event.schedule = buildSchedule(event.teams.length);
  if (score) {
    for (const match of event.schedule.rounds.flatMap(r => r.matches)) {
      [match.score_a, match.score_b] = score(match);
    }
  }
  return event;
}
const decisive = match => match.team_a < match.team_b ? [5, 1] : [1, 5];
const request = (action, event, extra = {}) => validateAction({ action, event_id: event.id, version: event.version, ...extra });
const awardFinale = event => {
  event.bonus_points = [
    { player_id: id(1), points: 1 }, { player_id: id(3), points: 0.5 },
    { player_id: id(2), points: 1 }, { player_id: id(4), points: 0.5 },
  ];
};

test('generation prefers five or three referee-safe squads and never excludes selected players', () => {
  const players = fixture(5).profiles.concat(Array.from({ length: 6 }, (_, i) =>
    ({ ...fixture(3).profiles[0], id: id(31 + i) })));
  const result = balanceTeams(players, 6, 5, true);
  assert.deepEqual(result.teams.map(t => t.players.length), [8, 7, 7, 7, 7]);
  assert.equal(result.max_teams, 5);
  for (const max of [3, 4, 5]) {
    const squads = balanceTeams(players, 6, max, true);
    assert.equal(squads.teams.length, max === 5 ? 5 : 3);
    const ids = squads.teams.flatMap(t => t.players.map(p => p.id));
    assert.deepEqual([...ids].sort(), players.map(p => p.id).sort());
    assert.equal(new Set(ids).size, 36);
  }
  const valid = { action: 'generate', season_id: id(1), session_id: id(2), team_size: 6 };
  assert.equal(validateAction(valid).max_teams, 5);
  for (const max of [1, 2, 6, '5', 2.5, null]) assert.throws(() => validateAction({ ...valid, max_teams: max }), /max_teams/);
});

test('schedule creation is versioned and draft-only; five teams fit ten matches in 120 minutes', async () => {
  const world = fixture();
  const event = world.events[0];
  const sql = recorder();
  const input = request('generate_schedule', event);
  assert.deepEqual(
    [input.courts, input.match_minutes, input.break_minutes, input.meetup_time,
      input.warmup_minutes, input.available_minutes, input.finale_minutes],
    [2, undefined, undefined, '18:00', 15, 120, 10]
  );
  await applyAction(sql, input, world);
  const queries = sql.transactions[0];
  const mutation = queries.find(q => q.text.includes('UPDATE league_events SET schedule'));
  const schedule = JSON.parse(mutation.values[0]);
  assert.equal(schedule.duration_minutes, 120);
  assert.equal(schedule.rounds.length, 5);
  assert.equal(schedule.rounds.flatMap(r => r.matches).length, 10);
  assert.equal(schedule.rounds.at(-1).end_minute, 120, 'No final changeover is added');
  assert(queries.findIndex(q => q.text.includes('status = ANY')) < queries.indexOf(mutation));
  assert(!queries.some(q => q.text.includes('league_results')));
  event.status = 'published';
  await assert.rejects(applyAction(recorder(), input, world), error => error.status === 409);
  event.status = 'draft';
  await assert.rejects(applyAction(recorder(), { ...input, courts: 1 }, world), /needs 230 minutes/);
});

test('unscored draft squad changes and regeneration clear the schedule for explicit regeneration', async () => {
  const world = fixture();
  const event = scheduled(world);
  const sql = recorder();
  await applyAction(sql, request('save_teams', event, { teams: event.teams.map(t => ({
    number: t.number, name: `Renamed ${t.number}`, player_ids: t.players.map(p => p.id),
  })) }), world);
  assert(sql.transactions[0].some(q => q.text.includes('schedule = NULL')));
  const generate = validateAction({ action: 'generate', season_id: event.season_id, session_id: event.session_id,
    team_size: 6, max_teams: 4, version: event.version, player_ids: event.roster_ids });
  await applyAction(sql, generate, world);
  const mutation = sql.transactions[1].find(q => q.text.includes('UPDATE league_events SET team_size'));
  assert(mutation.text.includes('schedule = NULL'));
  assert.equal(mutation.values[1], 4);
});

test('match score entry validates real integers, published status, date and version without awarding season points', async () => {
  const world = fixture();
  const event = scheduled(world);
  event.status = 'published';
  for (const bad of [-1, 1000, 1.5, '2', null, NaN, Infinity]) {
    assert.throws(() => request('save_match', event, { match_number: 1, score_a: bad, score_b: 0 }), /score_a/);
  }
  const sql = recorder();
  await applyAction(sql, request('save_match', event, { match_number: 1, score_a: 0, score_b: 999 }), world);
  const queries = sql.transactions[0];
  assert(queries.some(q => q.text.includes("AT TIME ZONE 'Europe/Vienna'")));
  assert(!queries.some(q => q.text.includes('league_results')));
  const mutation = queries.find(q => q.text.includes('UPDATE league_events SET schedule'));
  assert(mutation.text.includes('roster_locked = true'));
  const edited = JSON.parse(mutation.values[0]).rounds.flatMap(r => r.matches).find(m => m.number === 1);
  assert.deepEqual([edited.score_a, edited.score_b], [0, 999]);
  event.session_date = '2099-01-01';
  await assert.rejects(applyAction(recorder(), request('save_match', event, { match_number: 1, score_a: 0, score_b: 0 }), world),
    error => error.status === 409);
  event.session_date = '2026-01-01';
  event.status = 'finalized';
  await assert.rejects(applyAction(recorder(), request('save_match', event, { match_number: 1, score_a: 0, score_b: 0 }), world),
    /Reopen finalized results first/);
});

test('every recorded score, including zero-zero draws, locks unpublishing and draft roster edits', async () => {
  const world = fixture();
  const event = scheduled(world);
  const first = event.schedule.rounds[0].matches[0];
  first.score_a = first.score_b = 0;
  assert.equal(hasMatchScores(event), true);
  event.status = 'published';
  await assert.rejects(applyAction(recorder(), request('unpublish', event), world), /Teams are locked/);
  event.status = 'draft';
  await assert.rejects(applyAction(recorder(), request('generate_schedule', event), world), /Teams are locked/);
  await assert.rejects(applyAction(recorder(), request('save_teams', event, { teams: event.teams.map(t => ({
    number: t.number, name: t.name, player_ids: t.players.map(p => p.id),
  })) }), world), /Teams are locked/);
  assert.equal(adminView(world).events[0].roster_locked, true);
});

test('scheduled results require all scores and automatically use the match table, not arbitrary client placements', async () => {
  const world = fixture();
  const event = scheduled(world);
  event.status = 'published';
  await assert.rejects(applyAction(recorder(), request('results', event), world), /every match/);
  scheduled(world, decisive);
  await assert.rejects(applyAction(recorder(), request('results', event), world),
    /Last Man Standing: save exactly one \+1 BP winner and one \+0.5 BP runner-up/);
  awardFinale(event);
  const sql = recorder();
  await applyAction(sql, request('results', event, { placements: event.teams.map(t =>
    ({ team_number: t.number, placement: 6 - t.number })) }), world);
  const queries = sql.transactions[0];
  const ledger = JSON.parse(queries.find(q => q.text.includes('INSERT INTO league_results')).values[1]);
  assert(ledger.filter(r => r.team_number === 1).every(r =>
    r.placement === 1 && r.points === 3 + r.bonus_points));
  assert(ledger.filter(r => r.team_number === 5).every(r =>
    r.placement === 5 && r.points === 0.5 + r.bonus_points));
  assert(queries.some(q => q.text.includes("status = 'finalized', roster_locked = true")));
  assert.equal(matchStandings(5, event.schedule).standings[0].table_points, 8, 'Match-table points are separate from season points');
});

test('exact residual ties require explicit resolution only inside equal table/difference/for groups', async () => {
  const world = fixture(3);
  const event = scheduled(world, match => {
    if (match.team_a === 1) return [2, 0];
    if (match.team_b === 1) return [0, 2];
    return [1, 1];
  });
  event.status = 'published';
  assert.equal(matchData(event).match_standings.has_ties, true);
  assert.throws(() => eventPlacements(event), /explicit admin placement/);
  assert.deepEqual(eventPlacements(event, [
    { team_number: 1, placement: 1 }, { team_number: 2, placement: 3 }, { team_number: 3, placement: 2 },
  ]).map(p => p.placement), [1, 3, 2]);
  const sql = recorder();
  await assert.rejects(applyAction(sql, request('results', event, { placements: [
    { team_number: 1, placement: 3 }, { team_number: 2, placement: 1 }, { team_number: 3, placement: 2 },
  ] }), world), error => error instanceof MatchError && dbError(error).status === 400);
  assert.equal(sql.transactions.length, 0);
});

test('public match data is safe, drafts remain hidden, and scores alone never create season points', () => {
  const world = fixture();
  const event = scheduled(world, decisive);
  event.status = 'published';
  event.schedule.user_id = id(9999);
  event.schedule.rating = 9999;
  event.schedule.rounds[0].matches[0].email = 'private@example.test';
  const visible = publicView(world, event.season_id);
  assert.equal(visible.events[0].schedule.rounds.length, 5);
  assert.equal(visible.events[0].match_standings.complete, true);
  assert.equal(visible.events[0].match_standings.placements[0].team_number, 1);
  assert.deepEqual(visible.standings, []);
  assert(visible.events[0].teams.every(t => t.points === 0 && t.placement === null));
  assert(!/"(rating|user_id|email|gender|is_rookie)"/.test(JSON.stringify(visible)));
  event.status = 'draft';
  assert.deepEqual(publicView(world).events, []);
});

test('finalized Last Man and Last Woman awards expose only winner names and fixed public BP', () => {
  const world = fixture();
  const event = scheduled(world);
  event.status = 'finalized';
  event.teams.forEach(team => { team.placement = team.number; });
  awardFinale(event);
  const visible = publicView(world, event.season_id).events[0];
  assert.deepEqual(visible.finale_results, {
    men: {
      winner: { display_name: 'Player 1', bonus_points: 1 },
      runner_up: { display_name: 'Player 3', bonus_points: 0.5 },
    },
    women: {
      winner: { display_name: 'Player 2', bonus_points: 1 },
      runner_up: { display_name: 'Player 4', bonus_points: 0.5 },
    },
  });
  assert.doesNotMatch(JSON.stringify(visible.finale_results), /gender|player_id|user_id/);
});

test('persisted scores and schedule timing are revalidated rather than trusted on read/finalization', () => {
  const world = fixture();
  const event = scheduled(world);
  const match = event.schedule.rounds[0].matches[0];
  match.score_a = 1;
  match.score_b = null;
  assert.throws(() => matchData(event), /Match score/);
  match.score_b = -1;
  assert.throws(() => matchData(event), /Match score/);
  match.score_a = match.score_b = 0;
  event.schedule.rounds[0].start_minute = '0';
  assert.throws(() => matchData(event), /round timing/);
});

test('reopening removes previous awards, retains scores, and a corrected match replaces points and rating deltas', async () => {
  const world = fixture(3);
  const event = scheduled(world, decisive);
  awardFinale(event);
  const initial = scoreEvent(event, eventPlacements(event));
  event.teams = initial.teams;
  event.status = 'finalized';
  world.results = initial.ledger.map(r => ({ ...r, event_id: event.id }));
  const originalAwards = structuredClone(world.results);
  const originalScores = JSON.stringify(event.schedule);
  const sql = recorder(queries => {
    for (const q of queries) {
      if (q.text.includes('DELETE FROM league_results')) world.results = [];
      else if (q.text.includes('INSERT INTO league_results')) {
        world.results = JSON.parse(q.values[1]).map(r => ({ ...r, event_id: event.id }));
      } else if (q.text.includes('UPDATE league_events SET schedule')) {
        event.schedule = JSON.parse(q.values[0]);
        event.roster_locked = true;
        event.version++;
      } else if (q.text.includes('UPDATE league_events SET teams')) {
        event.teams = JSON.parse(q.values[0]);
        event.status = q.text.includes("status = 'finalized'") ? 'finalized' : 'published';
        event.roster_locked = true;
        event.version++;
      }
    }
    return queries.map(() => []);
  });
  await applyAction(sql, request('reopen_results', event), world);
  const queries = sql.transactions[0];
  assert(queries.findIndex(q => q.text.includes('status = ANY')) < queries.findIndex(q => q.text.includes('DELETE FROM league_results')));
  assert.equal(event.status, 'published');
  assert.equal(world.results.length, 0);
  assert(event.teams.every(t => t.placement === null));
  assert.equal(JSON.stringify(event.schedule), originalScores);
  assert.deepEqual(publicView(world, event.season_id).standings, []);
  await assert.rejects(applyAction(recorder(), request('unpublish', event), world), /Teams are locked/);
  const match = event.schedule.rounds[0].matches[0];
  await applyAction(sql, request('save_match', event, {
    match_number: match.number, score_a: match.team_a === 3 ? 2 : 0, score_b: match.team_b === 3 ? 2 : 0,
  }), world);
  assert.equal(world.results.length, 0, 'Editing the reopened score must not award season points early');
  await applyAction(sql, request('results', event), world);
  assert.notDeepEqual(world.results, originalAwards);
  assert(world.results.filter(r => r.team_number === 1).every(r =>
    r.points === 3 + r.bonus_points && r.rating_delta === 12));
  assert(world.results.filter(r => r.team_number === 3).every(r =>
    r.points === 2 + r.bonus_points && r.rating_delta === 0));
  assert(world.results.filter(r => r.team_number === 2).every(r =>
    r.points === 0.5 + r.bonus_points && r.rating_delta === -12));
  assert.equal(world.results.length, 18);
  assert.equal(event.status, 'finalized');
  assert.equal(event.version, 4);
});

test('concurrent match submissions cannot overwrite a newer score or award points', async () => {
  const world = fixture();
  const event = scheduled(world);
  event.status = 'published';
  let version = 1, updates = 0, serialized = Promise.resolve();
  const sql = recorder(queries => {
    const operation = serialized.then(() => {
      for (const q of queries) {
        if (q.text.includes('status = ANY') && q.values[1] !== version) {
          throw Object.assign(new Error('Event changed'), { code: 'P0001', detail: 'LEAGUE_409' });
        }
        if (q.text.includes('UPDATE league_events SET schedule')) { updates++; version++; }
        assert(!q.text.includes('league_results'));
      }
      return queries.map(() => []);
    });
    serialized = operation.catch(() => {});
    return operation;
  });
  const outcomes = await Promise.allSettled([1, 2].map(match_number =>
    applyAction(sql, request('save_match', event, { match_number, score_a: 2, score_b: 1 }), world)));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(dbError(outcomes.find(o => o.status === 'rejected').reason).status, 409);
  assert.equal(updates, 1);
});
