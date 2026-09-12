const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULTS, LeagueError, validateAction, settings, chooseTeamSize, balanceTeams, editTeams,
  scoreEvent, selectSeason, publicView, playerView, adminView,
} = require('../lib/league');
const { migrationStatements } = require('../scripts/migrate-league');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const players = n => Array.from({ length: n }, (_, i) => ({
  id: id(i + 1), display_name: `Player ${i + 1}`, gender: ['male', 'female', 'unspecified'][i % 3],
  is_rookie: i % 4 === 0, rating: 800 + (i % 9) * 50, initial_rating: 1000,
}));
const season = (n, extra = {}) => ({
  id: id(100 + n), name: `Season ${n}`, start_date: '2026-01-01', end_date: '2026-12-31', ...DEFAULTS, ...extra,
});
function fixture() {
  const roster = players(12);
  const generated = balanceTeams(roster, 6);
  const seasons = [season(1), season(2, { start_date: '2027-01-01', end_date: '2027-12-31' })];
  const sessions = [1, 2, 3].map(n => ({
    id: id(200 + n), title: `Training ${n}`, session_date: `2026-01-0${n}`, start_time: '19:00:00',
    location: 'Vienna', is_cancelled: false,
  }));
  const events = sessions.map((s, i) => ({
    id: id(300 + i), session_id: s.id, season_id: i === 2 ? seasons[1].id : seasons[0].id,
    session_date: s.session_date, status: i === 2 ? 'draft' : 'finalized', version: 1,
    roster_ids: roster.map(p => p.id).sort(), rsvp_user_ids: roster.map((_, i) => id(1001 + i)).sort(), roster_source: 'rsvp',
    settings: { ...DEFAULTS }, ...structuredClone(generated),
  }));
  const results = events.slice(0, 2).flatMap((event, i) => {
    const scored = scoreEvent(event, [{ team_number: 1, placement: i === 0 ? 1 : 2 }, { team_number: 2, placement: i === 0 ? 2 : 1 }]);
    event.teams = scored.teams;
    return scored.ledger.map(r => ({ ...r, event_id: event.id }));
  });
  return { users: roster.map((p, i) => ({ id: id(1001 + i), display_name: p.display_name, is_active: true, status: 'approved' })),
    profiles: roster.map((p, i) => ({ ...p, user_id: id(1001 + i), initial_rating: 1000, merged_into: null })),
    seasons, sessions, events, results, attendance: roster.map((p, i) => ({ user_id: id(1001 + i), session_id: sessions[0].id })) };
}

test('30 attendees at six-a-side form exactly five squads without substitutes', () => {
  const result = balanceTeams(players(30), 6);
  assert.equal(result.teams.length, 5);
  assert.deepEqual(result.teams.map(t => t.players.length), [6, 6, 6, 6, 6]);
});

test('auto prioritizes largest equal 4/5/6 squads, then distributes every substitute', () => {
  for (const [count, size] of [[8, 4], [9, 4], [10, 5], [11, 5], [12, 6], [13, 6], [16, 4], [20, 5], [24, 6], [30, 6]]) {
    assert.equal(chooseTeamSize(count, 'auto'), size);
  }
  for (let count = 8; count <= 65; count++) {
    const roster = players(count);
    const result = balanceTeams(roster, 'auto');
    assert(result.teams.length >= 2);
    const sizes = result.teams.map(t => t.players.length);
    assert(Math.min(...sizes) >= result.team_size);
    assert(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.deepEqual(result.teams.flatMap(t => t.players.map(p => p.id)).sort(), roster.map(p => p.id).sort());
  }
  assert.throws(() => balanceTeams(players(7), 'auto'), LeagueError);
  assert.throws(() => balanceTeams(players(11), 6), LeagueError);
});

test('balancing preserves all private tags, balances demographics, and is deterministic', () => {
  const roster = players(30);
  const first = balanceTeams(roster, 6);
  assert.deepEqual(first, balanceTeams([...roster].reverse(), 6));
  assert.deepEqual(first.teams.map(t => t.players.filter(p => p.gender === 'female').length), [2, 2, 2, 2, 2]);
  assert.deepEqual(first.teams.map(t => t.players.filter(p => p.gender === 'male').length), [2, 2, 2, 2, 2]);
  const rookieCounts = first.teams.map(t => t.players.filter(p => p.is_rookie).length);
  assert(Math.max(...rookieCounts) - Math.min(...rookieCounts) <= 1);
  const means = first.teams.map(t => t.players.reduce((sum, p) => sum + p.rating, 0) / t.players.length);
  assert(Math.max(...means) - Math.min(...means) <= 50);
  assert.deepEqual(roster, players(30));
});

function balanceMetrics(teams, roster) {
  const overallMean = roster.reduce((sum, p) => sum + p.rating, 0) / roster.length;
  const means = teams.map(t => t.players.reduce((sum, p) => sum + p.rating, 0) / t.players.length);
  const counts = predicate => teams.map(t => t.players.filter(predicate).length);
  return {
    spread: Math.max(...means) - Math.min(...means),
    variance: means.reduce((sum, mean) => sum + (mean - overallMean) ** 2, 0) / means.length,
    female: counts(p => p.gender === 'female'), male: counts(p => p.gender === 'male'),
    unspecified: counts(p => p.gender === 'unspecified'), rookie: counts(p => p.is_rookie),
  };
}

function assertCompleteRoster(result, roster) {
  const assigned = result.teams.flatMap(t => t.players.map(p => p.id));
  assert.equal(assigned.length, roster.length);
  assert.equal(new Set(assigned).size, roster.length, 'No participant can occur twice');
  assert.deepEqual([...assigned].sort(), roster.map(p => p.id).sort(), 'No participant can be missing');
}

test('30-player acceptance fixture gives five six-player squads, exactly two women and one rookie each', () => {
  const roster = players(30).map((p, i) => ({
    ...p, gender: i < 10 ? 'female' : 'male', is_rookie: i % 6 === 0,
    rating: 600 + (i * 73 % 900),
  }));
  const result = balanceTeams(roster, 6);
  const metrics = balanceMetrics(result.teams, roster);
  assert.deepEqual(result.teams.map(t => t.players.length), [6, 6, 6, 6, 6]);
  assert.deepEqual(metrics.female, [2, 2, 2, 2, 2]);
  assert.deepEqual(metrics.male, [4, 4, 4, 4, 4]);
  assert.deepEqual(metrics.rookie, [1, 1, 1, 1, 1]);
  assert(metrics.spread <= 75, `Squad mean-rating spread ${metrics.spread} should be <=75`);
  assertCompleteRoster(result, roster);
  assert.deepEqual(result, balanceTeams([...roster].reverse(), 6));
  const bySkill = [...roster].sort((a, b) => b.rating - a.rating);
  const baseline = Array.from({ length: 5 }, (_, i) => ({ players: bySkill.slice(i * 6, (i + 1) * 6) }));
  assert(metrics.variance <= balanceMetrics(baseline, roster).variance * 0.05,
    'Balancing should reduce mean-rating variance by at least 95% versus skill-clustered squads');
});

test('31-player acceptance fixture distributes the extra substitute without sacrificing gender/rookie balance', () => {
  const roster = players(31).map((p, i) => ({
    ...p, gender: i < 10 ? 'female' : 'male', is_rookie: i < 5,
    rating: 650 + (i * 71 % 850),
  }));
  const result = balanceTeams(roster, 6);
  const metrics = balanceMetrics(result.teams, roster);
  assert.deepEqual(result.teams.map(t => t.players.length), [7, 6, 6, 6, 6]);
  assert.deepEqual(metrics.female, [2, 2, 2, 2, 2]);
  assert.deepEqual(metrics.rookie, [1, 1, 1, 1, 1]);
  assert.deepEqual([...metrics.male].sort(), [4, 4, 4, 4, 5]);
  assert(metrics.spread <= 75, `Squad mean-rating spread ${metrics.spread} should be <=75 with substitutes`);
  assertCompleteRoster(result, roster);
  assert.deepEqual(result, balanceTeams([...roster.slice(11), ...roster.slice(0, 11)], 6));
});

test('small and odd mixed rosters keep demographic counts within one and reproduce exact assignments', () => {
  const scenarios = [
    { count: 8, female: 3, rookie: 3, unspecified: 0 },
    { count: 9, female: 4, rookie: 2, unspecified: 1 },
    { count: 11, female: 5, rookie: 3, unspecified: 0 },
    { count: 13, female: 4, rookie: 3, unspecified: 3 },
    { count: 17, female: 7, rookie: 4, unspecified: 2 },
    { count: 23, female: 9, rookie: 5, unspecified: 4 },
    { count: 29, female: 11, rookie: 6, unspecified: 3 },
    { count: 31, female: 10, rookie: 7, unspecified: 4 },
    { count: 35, female: 13, rookie: 8, unspecified: 5 },
  ];
  for (const scenario of scenarios) {
    for (const correlated of [true, false]) {
      const order = Array.from({ length: scenario.count }, (_, i) => i);
      if (!correlated) order.sort((a, b) => (a * 17 % scenario.count) - (b * 17 % scenario.count) || a - b);
      const rookies = new Set(order.slice(0, scenario.rookie));
      const roster = players(scenario.count).map((p, i) => ({
        ...p, gender: i < scenario.female ? 'female' : i >= scenario.count - scenario.unspecified ? 'unspecified' : 'male',
        is_rookie: rookies.has(i), rating: 800 + (i * 47 % 401),
      }));
      const result = balanceTeams(roster, 'auto');
      const metrics = balanceMetrics(result.teams, roster);
      for (const label of ['female', 'male', 'unspecified', 'rookie']) {
        const counts = metrics[label];
        assert(Math.max(...counts) - Math.min(...counts) <= 1,
          `${scenario.count} players (${correlated ? 'correlated' : 'mixed'} tags): ${label} counts ${counts} differ by more than one`);
      }
      assert(metrics.spread <= 100,
        `${scenario.count} players: mean-rating spread ${metrics.spread} should be <=100`);
      const sizes = result.teams.map(t => t.players.length);
      assert(Math.min(...sizes) >= result.team_size && Math.max(...sizes) - Math.min(...sizes) <= 1);
      assertCompleteRoster(result, roster);
      assert.deepEqual(result, balanceTeams([...roster].reverse(), 'auto'));
    }
  }
  assert.throws(() => balanceTeams(players(7), 'auto'), /Attendee count/);
  assert.deepEqual(balanceTeams(players(8), 'auto').teams.map(t => t.players.length), [4, 4]);
});

test('manual squads permit swaps and names but reject missing/duplicate players and uneven squads', () => {
  const event = { ...balanceTeams(players(13), 6) };
  const input = event.teams.map(t => ({ number: t.number, name: `Squad ${t.number}`, player_ids: t.players.map(p => p.id) }));
  [input[0].player_ids[0], input[1].player_ids[0]] = [input[1].player_ids[0], input[0].player_ids[0]];
  const edited = editTeams(event, input);
  assert.equal(edited[0].name, 'Squad 1');
  assert.equal(edited.flatMap(t => t.players).length, 13);
  assert.deepEqual(edited[0].players[0], event.teams[1].players[0]);
  const duplicate = structuredClone(input);
  duplicate[0].player_ids[0] = duplicate[1].player_ids[0];
  assert.throws(() => editTeams(event, duplicate), /exactly once/);
  const uneven = structuredClone(input);
  uneven[0].player_ids.push(uneven[1].player_ids.pop());
  assert.throws(() => editTeams(event, uneven), /Squads must/);
});

test('finite numeric validation, real dates, bounds, booleans, UUIDs and versions', () => {
  const valid = { action: 'save_season', name: 'Season', start_date: '2026-01-01', end_date: '2026-12-31' };
  assert.deepEqual(validateAction(valid).placement_points, [3, 2.5, 2, 1, 0.5]);
  for (const bad of [Infinity, NaN, '24', null, -1, 201]) {
    assert.throws(() => validateAction({ ...valid, k_factor: bad }), LeagueError);
  }
  for (const date of ['2026-02-30', '2026-13-01', '2026-2-02']) {
    assert.throws(() => validateAction({ ...valid, start_date: date }), LeagueError);
  }
  for (const points of [[], [1, 2], [NaN], [-1], [10001]]) {
    assert.throws(() => settings({ placement_points: points }), LeagueError);
  }
  assert.throws(() => validateAction({ action: 'publish', event_id: id(1), version: '1' }), LeagueError);
  assert.throws(() => validateAction({ action: 'publish', event_id: 'bad', version: 1 }), LeagueError);
  assert.throws(() => validateAction({ action: 'save_player', user_id: id(1), gender: 'male', is_rookie: 'false', initial_rating: 1000 }), LeagueError);
  assert.throws(() => validateAction({ action: 'generate', season_id: id(1), session_id: id(2), team_size: '6' }), LeagueError);
  assert.equal(validateAction({ action: 'generate', season_id: id(1), session_id: id(2), team_size: 'auto' }).team_size, 'auto');
});

test('pairwise Elo is normalized, uses frozen squad means, and awards every substitute', () => {
  const roster = players(31).map(p => ({ ...p, rating: 1000 }));
  const event = { ...balanceTeams(roster, 6), settings: { ...DEFAULTS } };
  const placements = event.teams.map(t => ({ team_number: t.number, placement: t.number }));
  const result = scoreEvent(event, placements);
  assert.equal(result.ledger.length, 31);
  const first = result.ledger.find(r => r.team_number === 1);
  const last = result.ledger.find(r => r.team_number === 5);
  assert.equal(first.rating_delta, 12);
  assert.equal(last.rating_delta, -12);
  assert.equal(first.points, 3);
  for (const team of event.teams) {
    assert.equal(new Set(result.ledger.filter(r => r.team_number === team.number).map(r => r.rating_delta)).size, 1);
  }
  const sixPlayers = players(36).map(p => ({ ...p, rating: 1000 }));
  const six = { team_size: 6, settings: { ...DEFAULTS }, teams: Array.from({ length: 6 }, (_, i) => ({
    number: i + 1, name: `Legacy Team ${i + 1}`, placement: null, players: sixPlayers.slice(i * 6, (i + 1) * 6),
  })) };
  const sixResult = scoreEvent(six, six.teams.map(t => ({ team_number: t.number, placement: t.number })));
  assert.equal(sixResult.ledger.find(r => r.placement === 6).points, 0.5);
  assert(sixResult.ledger.every(r => Math.abs(r.rating_delta) <= 12));
});

test('result corrections replace scoring from the frozen snapshot, without compounding', () => {
  const event = { ...balanceTeams(players(12), 6), settings: { ...DEFAULTS } };
  const original = [{ team_number: 1, placement: 1 }, { team_number: 2, placement: 2 }];
  const corrected = [{ team_number: 1, placement: 2 }, { team_number: 2, placement: 1 }];
  const first = scoreEvent(event, original);
  const second = scoreEvent({ ...event, teams: first.teams }, corrected);
  assert.deepEqual(second, scoreEvent(event, corrected));
  assert.deepEqual(scoreEvent({ ...event, teams: second.teams }, original), first);
  assert.throws(() => scoreEvent(event, [{ team_number: 1, placement: 1 }, { team_number: 2, placement: 1 }]), /unique/);
  assert.throws(() => scoreEvent(event, [{ team_number: 1, placement: 1 }, { team_number: 1, placement: 2 }]), /exactly once/);
});

test('public release filters seasons and drafts; equal ALL-training totals share competition rank', () => {
  const world = fixture();
  const result = publicView(world, world.seasons[0].id);
  assert.equal(result.seasons.length, 1);
  assert.equal(result.events.length, 2);
  assert.equal(result.standings.length, 12);
  assert(result.standings.every(p => p.points === 3.5 && p.played === 2 && p.wins === 1 && p.rank === 1));
  assert.throws(() => publicView(world, world.seasons[1].id), error => error.status === 404);
  const forbidden = /"(rating|initial_rating|gender|is_rookie|user_id|player_id|email|version|roster_ids|settings)"/;
  assert(!forbidden.test(JSON.stringify(result)));
  world.profiles[0].display_name = 'Unreleased draft nickname';
  assert(!JSON.stringify(publicView(world, world.seasons[0].id)).includes('Unreleased draft nickname'));
  for (const event of result.events) {
    for (const team of event.teams) for (const player of team.players) {
      assert.deepEqual(Object.keys(player), ['display_name']);
    }
  }
  const withPublished = structuredClone(world);
  withPublished.events[0].status = 'published';
  const publicOnly = publicView(withPublished, world.seasons[0].id);
  assert(publicOnly.standings.every(p => p.played === 1));
  assert(publicOnly.events.find(e => e.id === world.events[0].id).teams.every(t => t.points === 0 && t.placement === null));
});

test('personal history contains only personal released placements, never private balancing fields', () => {
  const world = fixture();
  const result = publicView(world, world.seasons[0].id, id(1001));
  assert.deepEqual(result.stats, { rank: 1, points: 3.5, played: 2, wins: 1,
    points_gain: 0.5, previous_rank: 1, rank_gain: 0 });
  assert.equal(result.history.length, 2);
  assert(!/"(rating|initial_rating|gender|is_rookie|user_id|player_id|email)"/.test(JSON.stringify(result)));
  assert.deepEqual(publicView(world, world.seasons[0].id, id(999)).stats, { rank: null, points: 0, played: 0, wins: 0,
    points_gain: 0, previous_rank: null, rank_gain: null });
  const empty = { ...world, events: [], results: [] };
  assert.deepEqual(publicView(empty, undefined, id(1)).stats, { rank: null, points: 0, played: 0, wins: 0 });
  assert.equal(publicView(empty).season, null);
});

test('season selection uses current dates, otherwise latest starting published season', () => {
  const seasons = [season(1), season(2, { start_date: '2027-01-01', end_date: '2027-12-31' })];
  assert.equal(selectSeason(seasons, undefined, '2026-06-01').id, seasons[0].id);
  assert.equal(selectSeason(seasons, undefined, '2028-01-01').id, seasons[1].id);
});

test('editable seeds change current rating by baseline only; ledger and past snapshots remain unchanged', () => {
  const world = fixture();
  const before = JSON.stringify(world.results);
  const past = JSON.stringify(world.events);
  const original = playerView(world).find(p => p.id === id(1));
  Object.assign(world.profiles[0], { gender: 'unspecified', is_rookie: true, initial_rating: 800 });
  const current = playerView(world).find(p => p.id === id(1));
  assert.equal(current.rating, original.rating - 200);
  assert.equal(JSON.stringify(world.results), before);
  assert.equal(JSON.stringify(world.events), past);
  world.users[1].status = 'pending';
  world.users[2].is_active = false;
  assert.equal(playerView(world).length, 10);
  const admin = adminView(world);
  assert.equal(admin.events.length, 3);
  assert.equal(admin.sessions.length, 3);
  assert.equal(admin.players.find(p => p.id === id(1)).is_rookie, true);
});

test('admin results preview exposes frozen event points and K despite later season setting changes', () => {
  const world = fixture();
  world.seasons[0].placement_points = [100, 50];
  world.seasons[0].k_factor = 80;
  world.seasons[0].scoring_mode = 'fixed';
  world.seasons[0].points_step = 1;
  const admin = adminView(world);
  const event = admin.events.find(e => e.id === world.events[0].id);
  assert.deepEqual(event.placement_points, [3, 2.5, 2, 1, 0.5]);
  assert.equal(event.k_factor, 24);
  assert.equal(event.scoring_mode, 'relative');
  assert.equal(event.points_step, 0.5);
  event.placement_points[0] = 999;
  assert.equal(world.events[0].settings.placement_points[0], 3, 'Projection must not mutate the frozen snapshot');
  assert.deepEqual(admin.seasons[0].placement_points, [100, 50]);
});

test('migration is additive, idempotent and preserves PL/pgSQL statement bodies', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'league-schema.sql'), 'utf8');
  const statements = migrationStatements(schema);
  assert.equal(statements.length, 13);
  assert(statements.every(s => /CREATE (TABLE IF NOT EXISTS|INDEX IF NOT EXISTS|OR REPLACE FUNCTION)|ALTER TABLE league_(seasons|events)/.test(s)));
  assert(!/UPDATE\s+users|DROP\s|TRUNCATE\s/i.test(schema));
  assert(!/UPDATE\s+league_(events|results)/i.test(schema));
  assert(statements.at(-1).includes("DETAIL = 'LEAGUE_'"));
  assert.match(statements.at(-1), /END;\r?\n\$league\$;/);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-league.js'), 'utf8');
  assert(migration.includes('sql.transaction('));
  assert(migration.includes('process.env.DATABASE_URL || process.env.POSTGRES_URL'));
});
