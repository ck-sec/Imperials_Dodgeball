const test = require('node:test');
const assert = require('node:assert/strict');
const { placementPoints, seasonTiers, seasonTier } = require('../../js/league-scoring');
const { buildCalendar } = require('../../lib/season-two-calendar');
const settings = { placement_points: [1, 0.5], scoring_mode: 'beaten', points_step: 0.5 };
const relative = { placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative', points_step: 0.5 };

test('teams-beaten awards give one participation point plus 0.5 per team beaten', () => {
  const scales = [
    [1.5, 1],
    [2, 1.5, 1],
    [2.5, 2, 1.5, 1],
    [3, 2.5, 2, 1.5, 1],
    [3.5, 3, 2.5, 2, 1.5, 1]
  ];
  scales.forEach((scale, index) => assert.deepEqual(placementPoints(settings, index + 2), scale));
});

test('larger fields increase the winner award while participation stays worth one point', () => {
  for (let count = 2; count <= 30; count++) {
    const points = placementPoints(settings, count);
    assert.equal(points[0], 1 + 0.5 * (count - 1));
    assert.equal(points[count - 1], 1);
    assert.equal(points.length, count);
    points.forEach((value, index) => {
      assert.equal(value * 2, Math.round(value * 2));
      if (index) assert.equal(points[index - 1] - value, 0.5);
    });
  }
});

test('fixed scoring remains available and keeps exact configured points', () => {
  assert.deepEqual(placementPoints({ ...relative, scoring_mode: 'fixed' }, 3), [3, 2.5, 2]);
  assert.deepEqual(placementPoints({ ...relative, scoring_mode: 'fixed' }, 6), [3, 2.5, 2, 1, 0.5, 0.5]);
});

test('admins can choose another curve and rounding step', () => {
  assert.deepEqual(placementPoints({ placement_points: [2, 0.5], scoring_mode: 'relative', points_step: 0.25 }, 5), [2, 1.75, 1.25, 1, 0.5]);
  assert.deepEqual(placementPoints({ ...relative, points_step: 0.1 }, 6), [3, 2.6, 2.2, 1.6, 0.9, 0.5]);
});

test('invalid count and scale inputs are rejected, never silently scored', () => {
  assert.throws(() => placementPoints(settings, 1), RangeError);
  assert.throws(() => placementPoints({ placement_points: [] }, 3), TypeError);
  assert.throws(() => placementPoints({ ...settings, points_step: 0 }, 3), TypeError);
  assert.throws(() => placementPoints({ ...settings, placement_points: [1] }, 3), TypeError);
  assert.throws(() => placementPoints({ ...settings, scoring_mode: 'invalid' }, 3), TypeError);
});

test('half-step ties round consistently at both small and large point values', () => {
  assert.deepEqual(placementPoints({ placement_points: [1000.1, 1000], scoring_mode: 'relative', points_step: 0.1 }, 3), [1000.1, 1000.1, 1000]);
  assert.deepEqual(placementPoints({ placement_points: [0.3, 0.2], scoring_mode: 'relative', points_step: 0.1 }, 3), [0.3, 0.3, 0.2]);
});

test('season tiers use the approved thresholds and retain exact boundary behaviour', () => {
  assert.deepEqual(seasonTiers.map(tier => [tier.id, tier.minimum]), [
    ['bronze', 0], ['silver', 10], ['gold', 25], ['platinum', 45], ['diamond', 70]
  ]);
  for (const [index, tier] of seasonTiers.entries()) {
    assert.equal(seasonTier(tier.minimum), tier);
    assert.equal(seasonTier(tier.minimum + 0.5), tier);
    if (index) assert.equal(seasonTier(tier.minimum - 0.5), seasonTiers[index - 1]);
  }
  assert.equal(seasonTier(140).id, 'diamond');
  assert.ok(Object.isFrozen(seasonTiers));
  assert.ok(seasonTiers.every(Object.isFrozen));
  for (const value of [-1, NaN, Infinity, '70', null, undefined]) {
    assert.throws(() => seasonTier(value), RangeError);
  }
});

test('Diamond is attainable within the confirmed season without requiring bonus points or all wins', () => {
  const thursdays = buildCalendar().sessions.filter(session => session.recurring_day === 4);
  assert.equal(thursdays.length, 35);
  const awards = placementPoints(settings, 5);
  assert.equal(seasonTier(thursdays.length * awards[2]).id, 'diamond');
  const regularPlayer = Array.from({ length: 28 }, (_, i) => awards[i % 2 === 0 ? 0 : 2]);
  assert.equal(regularPlayer.reduce((sum, points) => sum + points, 0), 70);
  assert.equal(seasonTier(regularPlayer.reduce((sum, points) => sum + points, 0)).id, 'diamond');
  assert.ok(regularPlayer.length <= thursdays.length - 7);
  assert.equal(seasonTier(28 * (awards[2] + 0.5)).id, 'diamond');
});
