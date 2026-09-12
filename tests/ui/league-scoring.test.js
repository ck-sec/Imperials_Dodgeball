const test = require('node:test');
const assert = require('node:assert/strict');
const { placementPoints } = require('../../js/league-scoring');
const settings = { placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative', points_step: 0.5 };

test('relative awards match the approved two-to-six-team scales', () => {
  const scales = [
    [3, 0.5],
    [3, 2, 0.5],
    [3, 2.5, 1.5, 0.5],
    [3, 2.5, 2, 1, 0.5],
    [3, 2.5, 2, 1.5, 1, 0.5]
  ];
  scales.forEach((scale, index) => assert.deepEqual(placementPoints(settings, index + 2), scale));
});

test('field size does not inflate first and last place awards', () => {
  for (let count = 2; count <= 30; count++) {
    const points = placementPoints(settings, count);
    assert.equal(points[0], 3);
    assert.equal(points[count - 1], 0.5);
    assert.equal(points.length, count);
    points.forEach((value, index) => {
      assert.equal(value * 2, Math.round(value * 2));
      if (index) assert.ok(value <= points[index - 1]);
    });
  }
});

test('fixed scoring remains available and keeps exact configured points', () => {
  assert.deepEqual(placementPoints({ ...settings, scoring_mode: 'fixed' }, 3), [3, 2.5, 2]);
  assert.deepEqual(placementPoints({ ...settings, scoring_mode: 'fixed' }, 6), [3, 2.5, 2, 1, 0.5, 0.5]);
});

test('admins can choose another curve and rounding step', () => {
  assert.deepEqual(placementPoints({ placement_points: [2, 0.5], points_step: 0.25 }, 5), [2, 1.75, 1.25, 1, 0.5]);
  assert.deepEqual(placementPoints({ ...settings, points_step: 0.1 }, 6), [3, 2.6, 2.2, 1.6, 0.9, 0.5]);
});

test('invalid count and scale inputs are rejected, never silently scored', () => {
  assert.throws(() => placementPoints(settings, 1), RangeError);
  assert.throws(() => placementPoints({ placement_points: [] }, 3), TypeError);
  assert.throws(() => placementPoints({ ...settings, points_step: 0 }, 3), TypeError);
  assert.throws(() => placementPoints({ ...settings, scoring_mode: 'invalid' }, 3), TypeError);
});

test('half-step ties round consistently at both small and large point values', () => {
  assert.deepEqual(placementPoints({ placement_points: [1000.1, 1000], points_step: 0.1 }, 3), [1000.1, 1000.1, 1000]);
  assert.deepEqual(placementPoints({ placement_points: [0.3, 0.2], points_step: 0.1 }, 3), [0.3, 0.3, 0.2]);
});
