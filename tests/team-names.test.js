const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTeamNames } = require('../lib/league-team-names');

test('a generated training has distinct club-themed team names', () => {
  const names = generateTeamNames(5);
  assert.equal(names.length, 5);
  assert.equal(new Set(names).size, 5);
  names.forEach(name => {
    assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.ok(name.length <= 100);
    assert.doesNotMatch(name, /^Team \d/);
  });
});

test('sampling without replacement never produces duplicate team names', () => {
  const names = generateTeamNames(340);
  assert.equal(new Set(names).size, 340);
  assert.ok(names.includes('Royal Ricochets'));
  assert.ok(names.includes('Golden Griffins'));
  assert.ok(names.includes('Vienna Voltage'));
  assert.ok(names.includes('Foam Phantoms'));
});

test('random selection changes the generated names without mutating the pool', () => {
  const first = generateTeamNames(5, minimum => minimum);
  const second = generateTeamNames(5, (minimum, maximum) => maximum - 1);
  assert.notDeepEqual(first, second);
  assert.deepEqual(generateTeamNames(5, minimum => minimum), first);
  assert.equal(new Set(second).size, second.length);
});

test('invalid counts and random indices are rejected', () => {
  for (const count of [0, -1, 1.5, 341, NaN]) assert.throws(() => generateTeamNames(count), RangeError);
  assert.throws(() => generateTeamNames(5, () => -1), RangeError);
});
