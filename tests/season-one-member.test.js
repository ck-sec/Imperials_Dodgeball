const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../lib/db');
const authPath = require.resolve('../lib/auth');
const originalDb = require.cache[dbPath];
const originalAuth = require.cache[authPath];
let rankingName = 'Ilvy L.';
const queries = [];
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    getDb: () => async function(strings) {
      const query = strings.join('?');
      queries.push(query);
      assert.doesNotMatch(query, /rankings_data/);
      return [{
        id: 'member-id', email: 'fixture@example.test', display_name: 'Fixture',
        ranking_player_name: rankingName, email_notifications: true, created_at: '2026-01-01'
      }];
    }
  }
};
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireMember: () => ({ sub: 'member-id' }) }
};
const handler = require('../api/member/stats');

test.after(() => {
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
  if (originalAuth) require.cache[authPath] = originalAuth;
  else delete require.cache[authPath];
});

function response() {
  return {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('member legacy stats use frozen Season 1 totals and shared ranks', async () => {
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stats.points, 58);
  assert.equal(res.body.stats.rank, 2);
  assert.equal(res.body.rankings.length, 125);
  assert.equal(res.body.rankings_season, 'Season 1');
  assert.equal(queries.length, 1);
});

test('unlinked members do not receive somebody else\'s archived stats', async () => {
  rankingName = null;
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stats, null);
  assert.equal(res.body.rankings.length, 125);
});

test('account view returns identity and preferences without loading the archive into the response', async () => {
  const res = response();
  await handler({ method: 'GET', query: { view: 'account' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.id, 'member-id');
  assert.equal(res.body.user.email_notifications, true);
  assert.deepEqual(Object.keys(res.body), ['user']);
});
