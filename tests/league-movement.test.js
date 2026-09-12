const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, publicView } = require('../lib/league');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const names = ['Ada', 'Bea', 'Cy', 'Dee', 'Eva', 'NewZero'];
function fixture() {
  const world = {
    users: names.map((display_name, i) => ({ id: id(1001 + i), display_name, is_active: true, status: 'approved' })),
    profiles: names.map((display_name, i) => ({ id: id(i + 1), user_id: id(1001 + i), display_name,
      gender: 'unspecified', is_rookie: true, initial_rating: 800, merged_into: null })),
    seasons: [{ id: id(100), name: 'Current', start_date: '2026-01-01', end_date: '2026-12-31', ...DEFAULTS }],
    sessions: [], events: [], results: [], attendance: [],
  };
  addTraining(world, 1, '2026-09-01', { Ada: 3, Bea: 2, Cy: 1, Dee: 0 });
  addTraining(world, 2, '2026-09-08', { Ada: 0, Bea: 3, Cy: 3, Eva: 2, NewZero: 0 });
  return world;
}

function addTraining(world, n, sessionDate, awards, extra = {}) {
  const values = [...new Set(Object.values(awards).map(Number))].sort((a, b) => b - a);
  if (values.length < 2) values.push(0);
  const teams = values.map((points, i) => ({
    number: i + 1, name: `Team ${i + 1}`, placement: i + 1,
    players: Object.entries(awards).filter(([, value]) => Number(value) === points)
      .map(([name]) => ({ ...world.profiles.find(p => p.display_name === name), rating: 1234 })),
  }));
  const event = { id: id(300 + n), session_id: id(200 + n), season_id: id(100),
    session_date: sessionDate, status: 'finalized', team_size: 4, teams,
    settings: { ...DEFAULTS, scoring_mode: 'fixed', placement_points: values }, ...extra };
  world.sessions.push({ id: event.session_id, title: `Training ${n}`, session_date: sessionDate,
    start_time: '19:00:00', location: 'Vienna', is_cancelled: false });
  world.events.push(event);
  for (const [name, points] of Object.entries(awards)) {
    const profile = world.profiles.find(p => p.display_name === name);
    const team = teams.find(t => t.players.some(p => p.id === profile.id));
    world.results.push({ event_id: event.id, player_id: profile.id, display_name: name,
      team_number: team.number, placement: team.placement, points, rating_delta: 12 });
  }
  return event;
}

const view = (world, userId) => publicView(world, id(100), userId, '2026-09-08');
const movements = payload => Object.fromEntries(payload.standings.map(p => [
  p.display_name, [p.points, p.rank, p.points_gain, p.previous_rank, p.rank_gain],
]));

test('latest training movements include nonparticipants, new entrants and zero-point entries', () => {
  const world = fixture();
  const before = structuredClone(world);
  const payload = view(world);
  assert.deepEqual(movements(payload), {
    Bea: [5, 1, 3, 2, 1],
    Cy: [4, 2, 3, 3, 1],
    Ada: [3, 3, 0, 1, -2],
    Eva: [2, 4, 2, null, null],
    Dee: [0, 5, 0, 4, -1],
    NewZero: [0, 5, 0, null, null],
  });
  assert.deepEqual(payload.comparison_event, {
    id: id(302), season_id: id(100), session_id: id(202), title: 'Training 2',
    session_date: '2026-09-08', start_time: '19:00:00',
  });
  assert.deepEqual(world, before, 'Projection must not alter the ledger or frozen snapshots');
});

test('every visitor, refresh and member sees identical standings and comparison events', () => {
  const world = fixture();
  const anonymous = view(world);
  for (const profile of world.profiles) {
    const own = view(world, profile.user_id);
    assert.deepEqual(own.standings, anonymous.standings);
    assert.deepEqual(own.comparison_event, anonymous.comparison_event);
    const { display_name, ...standing } = own.standings.find(p => p.display_name === profile.display_name);
    assert.deepEqual(own.stats, standing);
  }
  assert.deepEqual(view(world), anonymous);
  assert.deepEqual(publicView(world, id(100), undefined, '2027-04-01').standings, anonymous.standings);
  const serialized = JSON.stringify(anonymous);
  assert.doesNotMatch(serialized, /"(stats|history|my_events|my_team_number|rating|rating_delta|initial_rating|gender|is_rookie|user_id|player_id)"/);
  world.profiles.forEach(p => assert(!serialized.includes(p.id)));
});

test('competition ranks, rather than alphabetical positions, determine tied rank movements', () => {
  const world = fixture();
  world.events = []; world.sessions = []; world.results = [];
  addTraining(world, 1, '2026-09-01', { Ada: 3, Bea: 1, Cy: 1, Dee: 0 });
  addTraining(world, 2, '2026-09-08', { Bea: 2, Cy: 2, Dee: 0 });
  assert.deepEqual(movements(view(world)), {
    Ada: [3, 1, 0, 1, 0], Bea: [3, 1, 2, 2, 1], Cy: [3, 1, 2, 2, 1], Dee: [0, 4, 0, 4, 0],
  });
});

test('event chronology uses session date/time, not write order, stale snapshots or finalization timestamp', () => {
  const world = fixture();
  const latest = world.events[1];
  latest.finalized_at = '2026-09-08T19:30:00Z';
  latest.session_date = '2020-01-01';
  world.events[0].finalized_at = '2026-10-01T20:30:00Z';
  addTraining(world, 9, '2026-09-08', { Ada: 1, Bea: 0 });
  world.sessions.at(-1).start_time = '09:00:00';
  world.results.reverse(); world.events.reverse(); world.sessions.reverse();
  const expected = view(world);
  assert.equal(expected.comparison_event.id, latest.id);
  assert.deepEqual(expected.events.map(e => e.id), [id(302), id(309), id(301)]);
  world.results.reverse(); world.events.reverse(); world.sessions.reverse();
  assert.deepEqual(view(world), expected);
  world.sessions.find(s => s.id === id(209)).start_time = '19:00:00';
  assert.equal(view(world).comparison_event.id, id(309), 'Equal date/time uses stable event ID ordering');
});

test('other seasons and unpublished ledgers cannot change the selected-season baseline', () => {
  const world = fixture();
  const expected = view(world);
  world.seasons.push({ ...world.seasons[0], id: id(101), name: 'Other season' });
  addTraining(world, 3, '2026-09-09', { Ada: 100, Bea: 10 }, { season_id: id(101) });
  addTraining(world, 4, '2026-09-10', { Ada: 100, Bea: 10 }, { status: 'published' });
  addTraining(world, 5, '2026-09-11', { Ada: 100, Bea: 10 }, { status: 'draft' });
  const actual = view(world);
  assert.deepEqual(actual.standings, expected.standings);
  assert.deepEqual(actual.comparison_event, expected.comparison_event);
  assert.deepEqual(publicView(world, id(101), undefined, '2026-09-08').standings.map(p => p.previous_rank), [null, null]);
});

test('correcting older results recomputes the baseline without changing the chronological comparison', () => {
  const world = fixture();
  world.results.find(r => r.event_id === id(301) && r.display_name === 'Bea').points = 10;
  const payload = view(world);
  assert.equal(payload.comparison_event.id, id(302));
  assert.deepEqual(movements(payload).Bea, [13, 1, 3, 1, 0]);
  assert.deepEqual(movements(payload).Ada, [3, 3, 0, 2, -1]);
});

test('correction, reopening, and refinalizing recompute movements without stale or compounded awards', () => {
  const world = fixture();
  const original = structuredClone(world);
  world.results.find(r => r.event_id === id(302) && r.display_name === 'Bea').points = 0;
  let payload = view(world);
  assert.deepEqual(movements(payload).Bea, [2, 3, 0, 2, -1]);
  assert.equal(payload.comparison_event.id, id(302));
  world.events[1].status = 'published';
  payload = view(world);
  assert.equal(payload.comparison_event.id, id(301));
  assert(payload.standings.every(p => p.previous_rank === null && p.rank_gain === null));
  assert.equal(payload.standings.find(p => p.display_name === 'Bea').points_gain, 2);
  assert(!payload.standings.some(p => p.display_name === 'Eva'));
  world.results = original.results;
  world.events[1].status = 'finalized';
  assert.deepEqual(view(world), view(original));
});

test('empty and unfinalized seasons have no fabricated comparison or movement fields', () => {
  const world = fixture();
  world.events.forEach(e => { e.status = 'published'; });
  let payload = view(world, id(1001));
  assert.equal(payload.comparison_event, null);
  assert.deepEqual(payload.standings, []);
  assert.deepEqual(payload.stats, { rank: null, points: 0, played: 0, wins: 0 });
  world.events = [];
  payload = publicView(world, undefined, id(1001), '2026-09-08');
  assert.equal(payload.season, null);
  assert.equal(payload.comparison_event, null);
  assert.deepEqual(payload.my_events, []);
});

test('a finalized event with no ledger rows still defines the latest chronological comparison', () => {
  const world = fixture();
  world.results = world.results.filter(r => r.event_id !== id(302));
  const payload = view(world);
  assert.equal(payload.comparison_event.id, id(302));
  assert(payload.standings.every(p => p.points_gain === 0 && p.previous_rank === p.rank && p.rank_gain === 0));
});

test('fractional ledger totals round consistently, including numeric database strings and negative zero', () => {
  const world = fixture();
  world.events = []; world.sessions = []; world.results = [];
  addTraining(world, 1, '2026-09-01', { Ada: '0.1', Bea: '0.3' });
  addTraining(world, 2, '2026-09-08', { Ada: '0.2', Bea: '0.0' });
  assert.deepEqual(movements(view(world)), { Ada: [0.3, 1, 0.2, 2, 1], Bea: [0.3, 1, 0, 1, 0] });
});

test('duplicate display names remain separate identities and use latest chronological snapshot names', () => {
  const world = fixture();
  world.results.forEach(r => { if ([id(1), id(2)].includes(r.player_id)) r.display_name = 'Same name'; });
  world.results.reverse();
  const payload = view(world);
  assert.equal(payload.standings.filter(p => p.display_name === 'Same name').length, 2);
  assert.deepEqual(view(world, id(1001)).stats, { rank: 3, points: 3, played: 2, wins: 1,
    points_gain: 0, previous_rank: 1, rank_gain: -2 });
  world.results.find(r => r.event_id === id(302) && r.player_id === id(1)).display_name = 'Latest nickname';
  world.results.reverse();
  assert(view(world).standings.some(p => p.display_name === 'Latest nickname' && p.points === 3));
});
