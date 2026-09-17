const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  migrationStatements, main, safeError,
} = require('../scripts/migrate-matchday-controls');

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'matchday-controls-schema.sql'),
  'utf8',
);

function harness(failure) {
  const calls = { urls: [], transactions: [], options: [] };
  const sql = (strings, ...values) => ({ text: strings.join('?'), values });
  sql.query = text => ({ text });
  sql.transaction = async (queries, options) => {
    calls.transactions.push(queries);
    calls.options.push(options);
    if (failure) throw failure;
    return queries.map(() => []);
  };
  return {
    calls,
    factory(url) {
      calls.urls.push(url);
      return sql;
    },
  };
}

test('matchday-controls migration is additive and defaults to an offline dry run', async () => {
  const statements = migrationStatements(schema);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^ALTER TABLE league_events/);
  assert.match(statements[0], /cancelled_at TIMESTAMPTZ/);
  assert.match(statements[1], /cancelled_by UUID REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(schema.replace(/ON DELETE SET NULL/gi, ''), /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  const db = harness();
  assert.deepEqual(await main([], {}, db.factory), {
    mode: 'DRY_RUN',
    database_checked: false,
    statements: 2,
    note: 'No database access. The additive migration preserves every lineup, fixture, score and result row.',
  });
  assert.equal(db.calls.urls.length, 0);
  assert.equal(db.calls.transactions.length, 0);
});

test('matchday-controls migration validates its host and runs once in a bounded transaction', async () => {
  const db = harness();
  const result = await main(
    ['--apply', '--expected-host', 'db.example.test'],
    { DATABASE_URL: 'postgresql://user:secret@db.example.test/app?sslmode=require' },
    db.factory,
  );
  assert.deepEqual(result, { mode: 'APPLY', migration: 'matchday-controls', statements: 2 });
  assert.equal(db.calls.transactions.length, 1);
  assert.equal(db.calls.transactions[0].length, 5);
  assert.match(db.calls.transactions[0][0].text, /pg_advisory_xact_lock/);
  assert.match(db.calls.transactions[0][1].text, /lock_timeout/);
  assert.match(db.calls.transactions[0][2].text, /statement_timeout/);
  assert.deepEqual(db.calls.options[0], { isolationLevel: 'ReadCommitted' });
  assert.equal(db.calls.urls.length, 1);

  const wrong = harness();
  await assert.rejects(main(
    ['--apply', '--expected-host', 'wrong.example.test'],
    { POSTGRES_URL: 'postgresql://user:secret@db.example.test/app' },
    wrong.factory,
  ), /hostname does not match/);
  assert.equal(wrong.calls.urls.length, 0);
});

test('matchday-controls migration reports safe dependency and timeout errors', () => {
  assert.match(safeError({ code: '42P01' }), /league_events or users table is missing/);
  assert.match(safeError({ code: '55P03' }), /rolled back/);
  assert.doesNotMatch(safeError(new Error('postgresql://secret-host/private')), /secret-host|private/);
});
