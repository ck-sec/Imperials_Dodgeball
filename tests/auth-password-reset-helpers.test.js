const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const reset = require('../lib/password-reset');
const { loadModule } = require('./auth-test-helpers');

const token = 'ab'.repeat(32);
const digest = reset.hashResetToken(token);

function database(rows = []) {
  const calls = [];
  const transactions = [];
  const sql = (strings, ...values) => {
    const query = { text: strings.join('?').replace(/\s+/g, ' ').trim(), values };
    calls.push(query);
    return { ...query, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) };
  };
  sql.transaction = async (queries, options) => {
    transactions.push({ queries, options });
    return [[], rows];
  };
  return { sql, calls, transactions };
}

test('reset tokens are 32 cryptographically random bytes encoded as lowercase hex64', () => {
  const sizes = [];
  const loaded = loadModule('lib\\password-reset.js', {
    crypto: {
      ...crypto,
      randomBytes(size) { sizes.push(size); return Buffer.alloc(size, 0xab); },
    },
  });
  assert.equal(loaded.exports.generateResetToken(), token);
  assert.deepEqual(sizes, [32]);
  const generated = new Set(Array.from({ length: 100 }, () => reset.generateResetToken()));
  assert.equal(generated.size, 100);
  for (const value of generated) {
    assert.equal(value.length, 64);
    assert(reset.TOKEN_RE.test(value));
  }
});

test('token hashes are exactly SHA256 hex digests, not reversible or raw token data', () => {
  assert.equal(digest, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(digest, token);
  assert.notEqual(digest, reset.hashResetToken('cd'.repeat(32)));
  assert.equal(digest.length, 64);
});

test('rate limiter atomically records/checks attempts in a hashed namespace with a bounded 15-minute window', async () => {
  const db = database([{ attempt_count: 5, retry_after: 123 }]);
  const key = 'request:identity:member@example.test';
  assert.deepEqual(await reset.consumeRateLimit(db.sql, key, 5), { limited: false, retryAfter: 123 });
  assert.equal(db.calls.length, 1);
  const query = db.calls[0];
  assert.deepEqual(query.values, [reset.hashResetToken(`password-reset:${key}`), 6]);
  assert(!query.text.includes('member@example.test'));
  assert.match(query.text, /^INSERT INTO login_attempts/);
  assert.match(query.text, /ON CONFLICT \(email_hash\) DO UPDATE/);
  assert.match(query.text, /window_start <= NOW\(\) - INTERVAL '15 minutes' THEN 1/);
  assert.match(query.text, /LEAST\(login_attempts.attempt_count \+ 1, \?\)/);
  assert.match(query.text, /THEN NOW\(\) ELSE login_attempts.window_start/);
  assert.match(query.text, /GREATEST\(1, CEIL\(EXTRACT\(EPOCH/);
  assert.match(query.text, /RETURNING attempt_count/);
  const limited = database([{ attempt_count: 6, retry_after: 1 }]);
  assert.deepEqual(await reset.consumeRateLimit(limited.sql, key, 5), { limited: true, retryAfter: 1 });
  await assert.rejects(reset.consumeRateLimit(database().sql, key, 5), /rate limit unavailable/);
});

test('issuance locks eligible users and replaces the single outstanding digest with a 30-minute expiry', async () => {
  const user = { email: 'member@example.test', display_name: 'Member' };
  const db = database([user]);
  assert.equal(await reset.issueResetToken(db.sql, user.email, digest), user);
  const query = db.calls[0];
  assert.deepEqual(query.values, [user.email, digest]);
  assert(!query.values.includes(token));
  assert.match(query.text, /status = 'pending' OR \(status = 'approved' AND is_active = true\)/);
  assert(query.text.indexOf('FOR UPDATE') < query.text.indexOf('INSERT INTO password_reset_tokens'));
  assert.match(query.text, /clock_timestamp\(\) \+ INTERVAL '30 minutes'/);
  assert.match(query.text, /ON CONFLICT \(user_id\) DO UPDATE SET token_hash = EXCLUDED.token_hash/);
  assert.match(query.text, /expires_at = EXCLUDED.expires_at, created_at = clock_timestamp\(\)/);
  assert.doesNotMatch(query.text, /UPDATE users|SET (?:status|is_active|is_email_verified)/);
  assert.equal(await reset.issueResetToken(database().sql, user.email, digest), null);
});

test('failed delivery cleanup deletes by exact digest, never by user, so newer tokens survive', async () => {
  const db = database();
  await reset.discardResetToken(db.sql, digest);
  assert.deepEqual(db.calls, [{
    text: 'DELETE FROM password_reset_tokens WHERE token_hash = ?',
    values: [digest],
  }]);
});

test('consumption locks user before token, then atomically changes password and revokes refresh tokens', async () => {
  const db = database([{ id: 'member-id' }]);
  assert.equal(await reset.consumeResetToken(db.sql, digest, 'bcrypt-password'), true);
  assert.equal(db.transactions.length, 1);
  const transaction = db.transactions[0];
  assert.deepEqual(transaction.options, { isolationLevel: 'ReadCommitted' });
  assert.equal(transaction.queries.length, 2);
  const [lock, consume] = transaction.queries;
  assert.match(lock.text, /SELECT u.id FROM users u JOIN password_reset_tokens t ON t.user_id = u.id/);
  assert.match(lock.text, /WHERE t.token_hash = \? FOR UPDATE OF u$/);
  assert.deepEqual(lock.values, [digest]);
  assert.match(consume.text, /WITH consumed AS \( DELETE FROM password_reset_tokens t USING users u/);
  assert.match(consume.text, /t.token_hash = \? AND t.user_id = u.id/);
  assert.match(consume.text, /t.expires_at > clock_timestamp\(\)/);
  assert.match(consume.text, /u.status = 'pending' OR \(u.status = 'approved' AND u.is_active = true\)/);
  assert.match(consume.text, /UPDATE users u SET password_hash = \? FROM consumed c WHERE u.id = c.user_id/);
  assert.match(consume.text, /DELETE FROM refresh_tokens r USING updated u WHERE r.user_id = u.id/);
  assert.match(consume.text, /SELECT id FROM updated$/);
  assert.deepEqual(consume.values, [digest, 'bcrypt-password']);
  assert.doesNotMatch(consume.text, /SET (?:status|is_active|is_email_verified)|INSERT INTO refresh_tokens/);
});

test('missing or already-consumed rows fail closed and transaction failures cannot report success', async () => {
  assert.equal(await reset.consumeResetToken(database().sql, digest, 'bcrypt-password'), false);
  const db = database([{ id: 'member-id' }]);
  db.sql.transaction = async () => { throw new Error('rollback'); };
  await assert.rejects(reset.consumeResetToken(db.sql, digest, 'bcrypt-password'), /rollback/);
});
