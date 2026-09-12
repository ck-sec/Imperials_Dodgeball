const test = require('node:test');
const assert = require('node:assert/strict');
const { rankPlayers, hallOfFame } = require('../../js/league-archive');
const archive = require('../../data/season-1.json');

test('Season 1 preserves the full public snapshot separately from new seasons', () => {
  assert.equal(archive.name, 'Season 1');
  assert.equal(archive.league, 'Imperials Social League');
  assert.equal(archive.players.length, 125);
  assert.equal(new Set(archive.players.map(player => player.id)).size, 125);
  assert.match(archive.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(archive.players.find(player => player.name === 'Dominik R.').points, 70);
});

test('Season 1 Hall of Fame honors the actual top men and women with shared places', () => {
  const winners = hallOfFame(archive.players);
  assert.deepEqual(winners[0].players.map(player => [player.name, player.rank]), [
    ['Dominik R.', 1], ['Flo K.', 2], ['Heinrich W.', 3]
  ]);
  assert.deepEqual(winners[1].players.map(player => [player.name, player.rank]), [
    ['Ilvy L.', 1], ['Magdalena M.', 1], ['Silke K.', 3]
  ]);
});

test('all tied third-place finishers enter Hall of Fame', () => {
  const players = [10, 9, 8, 8, 7].map((points, i) => ({ name: 'Player ' + i, gender: 'female', points }));
  assert.deepEqual(hallOfFame(players)[1].players.map(player => player.rank), [1, 2, 3, 3]);
});

test('separate gender podiums use shared competition ranks without mutating records', () => {
  const players = [
    { name: 'A', gender: 'male', points: 3 },
    { name: 'B', gender: 'female', points: 3 },
    { name: 'C', gender: 'male', points: 2 },
    { name: 'D', gender: '', points: 100 }
  ];
  const before = JSON.stringify(players);
  assert.deepEqual(hallOfFame(players).map(group => group.players.length), [2, 1]);
  assert.equal(rankPlayers(players)[0].name, 'D');
  assert.equal(JSON.stringify(players), before);
});
