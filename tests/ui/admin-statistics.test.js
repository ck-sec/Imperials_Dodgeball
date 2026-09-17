const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootPath = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(rootPath, 'js', 'admin-statistics.js'), 'utf8');
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function harness() {
  const root = {
    innerHTML: '',
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
  };
  const context = vm.createContext({
    console,
    esc: escape,
    adminFetch: async () => { throw new Error('Unexpected request'); },
    document: { getElementById: id => id === 'adminStatisticsContent' ? root : null },
  });
  vm.runInContext(source, context);
  return { context, root };
}

test('admin statistics can inspect finalized teammate frequency for each player', () => {
  const { context, root } = harness();
  context.fixture = {
    seasons: [{ id: 'season', name: 'Season 2' }],
    season: { id: 'season', name: 'Season 2' },
    finalized_event_count: 2,
    events: [],
    players: [
      {
        id: 'one', display_name: 'Player One', rank: 1, points: 5, played: 2, wins: 1,
        average_placement: 1.5, best_placement: 1, podiums: 2, placement_counts: { 1: 1, 2: 1 },
        teammates: [{ id: 'two', display_name: 'Player Two', played_together: 2, wins_together: 1 }],
      },
      {
        id: 'two', display_name: 'Player Two', rank: 2, points: 4, played: 2, wins: 0,
        average_placement: 2, best_placement: 2, podiums: 2, placement_counts: { 2: 2 }, teammates: [],
      },
    ],
  };
  vm.runInContext('adminStatisticsData = fixture; renderAdminStatistics();', context);
  assert.match(root.innerHTML, /Played together/);
  assert.match(root.innerHTML, /Player Two/);
  assert.match(root.innerHTML, /2\u00d7/);
  root.listeners.change({ target: { id: 'adminStatisticsPlayer', value: 'two' } });
  assert.match(root.innerHTML, /No shared finalized team lineups recorded for this player yet/);
});
