const test = require('node:test');
const assert = require('node:assert/strict');
const { issueLoginSession, rotateRefreshSession } = require('../lib/auth-sessions');

function database(rows = []) {
  const transactions = [];
  const sql = (strings, ...values) => ({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
  sql.transaction = async (queries, options) => {
    transactions.push({ queries, options });
    return [[], rows];
  };
  return { sql, transactions };
}

test('login locks the same user as reset, then revalidates the observed bcrypt hash in a fresh statement', async () => {
  const user = { id: 'user-id', is_active: true };
  const db = database([user]);
  assert.equal(await issueLoginSession(db.sql, 'user-id', 'observed-bcrypt', 'refresh-digest', 'expiry'), user);
  const { queries, options } = db.transactions[0];
  assert.deepEqual(options, { isolationLevel: 'ReadCommitted' });
  assert.equal(queries.length, 2);
  assert.equal(queries[0].text, 'SELECT id FROM users WHERE id = ? FOR UPDATE');
  assert.deepEqual(queries[0].values, ['user-id']);
  assert.match(queries[1].text, /FROM users WHERE id = \? AND password_hash = \?/);
  assert.match(queries[1].text, /UPDATE users u SET last_login = clock_timestamp\(\)/);
  assert.match(queries[1].text, /FROM authenticated a WHERE u.id = a.id AND a.is_active = true/);
  assert.match(queries[1].text, /INSERT INTO refresh_tokens/);
  assert.match(queries[1].text, /SELECT id, \?, \?::timestamptz FROM updated WHERE \?::text IS NOT NULL/);
  assert.doesNotMatch(queries[1].text, /SET (?:password_hash|status|is_active|is_email_verified)/);
  assert.deepEqual(queries[1].values, ['user-id', 'observed-bcrypt', 'refresh-digest', 'expiry', 'refresh-digest']);
});

test('non-remembered login still revalidates under lock but binds null refresh credentials', async () => {
  const db = database([{ id: 'user-id' }]);
  await issueLoginSession(db.sql, 'user-id', 'observed-bcrypt', null, null);
  assert.deepEqual(db.transactions[0].queries[1].values, ['user-id', 'observed-bcrypt', null, null, null]);
});

test('refresh locks the user before tokens, rechecks expiry, and issues only from a successfully consumed token', async () => {
  const user = { user_id: 'user-id', is_active: true };
  const db = database([user]);
  assert.equal(await rotateRefreshSession(db.sql, 'old-digest', 'new-digest', 'expiry'), user);
  const { queries, options } = db.transactions[0];
  assert.deepEqual(options, { isolationLevel: 'ReadCommitted' });
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /SELECT u.id FROM users u JOIN refresh_tokens rt ON rt.user_id = u.id/);
  assert.match(queries[0].text, /WHERE rt.token_hash = \? FOR UPDATE OF u$/);
  assert.deepEqual(queries[0].values, ['old-digest']);
  assert.match(queries[1].text, /rt.token_hash = \? AND rt.expires_at > clock_timestamp\(\)/);
  assert.match(queries[1].text, /DELETE FROM refresh_tokens rt USING candidate c/);
  assert.match(queries[1].text, /c.is_active = true AND rt.id = c.token_id/);
  assert.match(queries[1].text, /c.is_active IS NOT TRUE AND rt.user_id = c.user_id/);
  assert.match(queries[1].text, /FROM candidate c JOIN consumed d ON d.id = c.token_id WHERE c.is_active = true/);
  assert.match(queries[1].text, /EXISTS \(SELECT 1 FROM issued i WHERE i.user_id = c.user_id\)/);
  assert.doesNotMatch(queries[1].text, /UPDATE users/);
  assert.deepEqual(queries[1].values, ['old-digest', 'new-digest', 'expiry']);
});

test('missing revalidation/consumption rows and failed transactions cannot report successful session issuance', async () => {
  const db = database();
  assert.equal(await issueLoginSession(db.sql, 'user-id', 'old-bcrypt', null, null), null);
  assert.equal(await rotateRefreshSession(db.sql, 'old-digest', 'new-digest', 'expiry'), null);
  db.sql.transaction = async () => { throw new Error('transaction rolled back'); };
  await assert.rejects(issueLoginSession(db.sql, 'user-id', 'old-bcrypt', null, null), /rolled back/);
  await assert.rejects(rotateRefreshSession(db.sql, 'old-digest', 'new-digest', 'expiry'), /rolled back/);
});
