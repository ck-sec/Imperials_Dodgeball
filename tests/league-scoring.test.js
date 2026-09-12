const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULTS, settings, validateAction, pointsForPlacement, scoreEvent, publicView, adminView,
} = require('../lib/league');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const table = (config, count) => Array.from({ length: count }, (_, i) => pointsForPlacement(config, i + 1, count));
const expected = [
  [3, 0.5],
  [3, 2, 0.5],
  [3, 2.5, 1.5, 0.5],
  [3, 2.5, 2, 1, 0.5],
  [3, 2.5, 2, 1.5, 1, 0.5],
];
function event(count, config = settings({})) {
  return {
    id: id(200), season_id: id(100), session_id: id(300), session_date: '2026-09-01',
    team_size: 4, version: 1, status: 'finalized', settings: structuredClone(config),
    roster_source: 'manual', rsvp_user_ids: [],
    roster_ids: Array.from({ length: count * 4 }, (_, i) => id(i + 1)),
    teams: Array.from({ length: count }, (_, i) => ({
      number: i + 1, name: `Team ${i + 1}`, placement: i + 1,
      players: Array.from({ length: 4 }, (_, j) => ({
        id: id(i * 4 + j + 1), display_name: `Player ${i * 4 + j + 1}`, rating: 1000,
        gender: 'unspecified', is_rookie: false,
      })),
    })),
  };
}

test('relative defaults exactly match the approved placement tables for two through six teams', () => {
  const config = settings({});
  assert.deepEqual(config.placement_points, [3, 2.5, 2, 1, 0.5]);
  assert.equal(config.scoring_mode, 'relative');
  assert.equal(config.points_step, 0.5);
  for (let count = 2; count <= 6; count++) {
    assert.deepEqual(table(config, count), expected[count - 2], `${count}-team table`);
    const scored = scoreEvent(event(count), Array.from({ length: count }, (_, i) =>
      ({ team_number: i + 1, placement: i + 1 })));
    assert.equal(scored.ledger.length, count * 4);
    for (const row of scored.ledger) assert.equal(row.points, expected[count - 2][row.placement - 1]);
  }
});

test('relative interpolation handles custom scales, all supported steps, half ties and constant arrays', () => {
  assert.deepEqual(table(settings({ placement_points: [2, 0.5], points_step: 0.25 }), 5),
    [2, 1.75, 1.25, 1, 0.5]);
  assert.deepEqual(table(settings({ placement_points: [0.5, 0.2], points_step: 0.1 }), 3),
    [0.5, 0.4, 0.2], 'Exact half ties round upward despite binary floating-point representation');
  assert.deepEqual(table(settings({ placement_points: [4, 2, 0], points_step: 1 }), 4), [4, 3, 1, 0]);
  assert.deepEqual(table(settings({ placement_points: [1.5], points_step: 0.5 }), 6), [1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
  for (let count = 2; count <= 125; count++) {
    const points = table(settings({}), count);
    assert.equal(points[0], 3);
    assert.equal(points.at(-1), 0.5);
    assert(points.every((p, i) => Number.isInteger(p * 2) && (i === 0 || p <= points[i - 1])));
  }
});

test('relative baseline alignment and scoring-mode/step validation return clear errors', () => {
  assert.throws(() => settings({ placement_points: [3, 2.3, 0.5], points_step: 0.5 }),
    error => error.status === 400 && /multiples of points_step/.test(error.message));
  assert.throws(() => settings({ points_step: 1 }), /multiples of points_step/);
  for (const step of [0, 0.2, 2, '0.5', NaN, Infinity, null]) {
    assert.throws(() => settings({ points_step: step }), /points_step must/);
  }
  for (const mode of ['best-n', '', null, true]) {
    assert.throws(() => settings({ scoring_mode: mode }), /scoring_mode must/);
  }
  const saved = validateAction({ action: 'save_season', name: 'Season 2',
    start_date: '2026-09-14', end_date: '2027-07-02', scoring_mode: 'relative', points_step: 0.25,
    placement_points: [3, 2.25, 0.5] });
  assert.equal(saved.scoring_mode, 'relative');
  assert.equal(saved.points_step, 0.25);
});

test('fixed mode and pre-mode legacy snapshots preserve exact repeated-last awards without rounding', () => {
  const fixed = settings({ scoring_mode: 'fixed', points_step: 1, placement_points: [3, 2.3, 0.1] });
  assert.deepEqual(table(fixed, 6), [3, 2.3, 0.1, 0.1, 0.1, 0.1]);
  const legacy = { placement_points: [5, 4, 3, 2, 1], k_factor: 24 };
  assert.deepEqual(table(legacy, 6), [5, 4, 3, 2, 1, 1]);
  const scored = scoreEvent(event(6, legacy), Array.from({ length: 6 }, (_, i) =>
    ({ team_number: i + 1, placement: i + 1 })));
  assert.equal(scored.ledger.find(r => r.placement === 1).points, 5);
  assert.equal(scored.ledger.find(r => r.placement === 6).points, 1);
});

test('frozen relative config survives season changes and corrections recompute from that snapshot only', () => {
  const seasonSettings = settings({});
  const frozen = event(4, seasonSettings);
  const placements = frozen.teams.map(t => ({ team_number: t.number, placement: t.number }));
  const original = scoreEvent(frozen, placements);
  Object.assign(seasonSettings, { placement_points: [100, 0], scoring_mode: 'fixed', points_step: 1, k_factor: 80 });
  assert.deepEqual(scoreEvent(frozen, placements), original);
  const correctedPlacements = placements.map(p => ({ ...p, placement: 5 - p.placement }));
  const corrected = scoreEvent({ ...frozen, teams: original.teams }, correctedPlacements);
  assert.deepEqual(corrected, scoreEvent(frozen, correctedPlacements));
  assert.equal(corrected.ledger.find(r => r.team_number === 1).points, 0.5);
  assert.equal(corrected.ledger.find(r => r.team_number === 2).points, 1.5);
  assert.equal(corrected.ledger.find(r => r.team_number === 4).points, 3);
  assert.deepEqual(scoreEvent({ ...frozen, teams: corrected.teams }, placements), original);
});

test('public season rules and frozen event awards remain separate, including legacy result corrections', () => {
  const frozen = event(6, { placement_points: [5, 4, 3, 2, 1], k_factor: 24 });
  const scored = scoreEvent(frozen, frozen.teams.map(t => ({ team_number: t.number, placement: t.number })));
  frozen.teams = scored.teams;
  const world = {
    users: [], profiles: [], attendance: [],
    seasons: [{ id: id(100), name: 'Season 2', start_date: '2026-01-01', end_date: '2027-12-31', ...DEFAULTS }],
    sessions: [{ id: id(300), title: 'Training', session_date: '2026-09-01', start_time: '19:00:00', location: 'Vienna', is_cancelled: false }],
    events: [frozen], results: scored.ledger.map(r => ({ ...r, event_id: frozen.id })),
  };
  const publicResult = publicView(world, id(100));
  assert.equal(publicResult.season.scoring_mode, 'relative');
  assert.equal(publicResult.season.points_step, 0.5);
  assert.equal(publicResult.seasons[0].scoring_mode, 'relative');
  assert.deepEqual(publicResult.events[0].teams.map(t => t.points), [5, 4, 3, 2, 1, 1]);
  const admin = adminView(world);
  assert.equal(admin.events[0].scoring_mode, 'fixed');
  assert.equal(admin.events[0].points_step, 0.5);
  assert.deepEqual(admin.events[0].placement_points, [5, 4, 3, 2, 1]);
  assert.equal(admin.seasons[0].scoring_mode, 'relative');
});
