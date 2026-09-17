const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cli = require('../tools/initialize-season-two');
const calendar = require('../lib/season-two-calendar');
const { loadModule, json } = require('./auth-test-helpers');

const schemaPath = path.join(__dirname, '..', 'scripts', 'admin-access-schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

function harness(options = {}) {
  const calls = { urls: [], transactions: [], transactionOptions: [], files: [] };
  const sql = (strings, ...values) => ({ text: strings.join('?'), values });
  sql.query = text => ({ text });
  sql.transaction = async (queries, transactionOptions) => {
    calls.transactions.push(queries);
    calls.transactionOptions.push(transactionOptions);
    if (options.fail) throw options.fail;
    return queries.map(() => []);
  };
  const app = loadModule('scripts\\migrate-admin-access.js', {
    'node:fs': { readFileSync: (filename, encoding) => {
      calls.files.push(filename);
      assert.equal(filename, schemaPath);
      assert.equal(encoding, 'utf8');
      return schema;
    } },
    'node:path': path,
    '../tools/initialize-season-two': { parseArgs: cli.parseArgs },
    '../lib/season-two-calendar': {
      CalendarError: calendar.CalendarError,
      validateTarget: calendar.validateTarget,
    },
  });
  const dbFactory = url => {
    calls.urls.push(url);
    return sql;
  };
  return { ...app, calls, dbFactory };
}

test('admin migration creates an immutable two-account allowlist and fails closed during bootstrap', () => {
  const app = harness();
  const statements = app.exports.migrationStatements(schema);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS admin_users/);
  assert.match(statements[0], /user_id\s+UUID PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(statements[0], /admin_key\s+VARCHAR\(32\) NOT NULL UNIQUE/);
  assert.match(statements[0], /CHECK \(admin_key IN \('christoph-kopka', 'dominik-riedl'\)\)/);

  const bootstrap = statements[1];
  for (const name of ['Christoph Kopka', 'Dominik Riedl']) {
    assert.match(bootstrap, new RegExp(`display_name = '${name}'`));
    assert.match(bootstrap, new RegExp(`requires exactly one approved active account named ${name}`));
  }
  assert.equal((bootstrap.match(/status = 'approved'/g) || []).length, 2);
  assert.equal((bootstrap.match(/is_active = TRUE/g) || []).length, 2);
  assert.equal((bootstrap.match(/COALESCE\(cardinality\(matching_ids\), 0\) <> 1/g) || []).length, 2);
  assert.doesNotMatch(schema.replace(/ON DELETE CASCADE/gi, ''), /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});

test('admin migration defaults to an offline dry run and reports its guarded scope', async () => {
  const app = harness();
  const result = await app.exports.main([], {}, app.dbFactory);
  assert.deepEqual(json(result), {
    mode: 'DRY_RUN',
    database_checked: false,
    statements: 2,
    note: 'No database access. Apply aborts unless each unmapped administrator has exactly one approved active account with the expected name.',
  });
  assert.equal(app.calls.urls.length, 0);
  assert.equal(app.calls.transactions.length, 0);
});

test('admin migration validates the exact database host and serializes apply in one bounded transaction', async () => {
  const app = harness();
  const args = ['--apply', '--expected-host', 'db.example.test'];
  const env = { DATABASE_URL: 'postgres://user:password@db.example.test/app?sslmode=require' };
  const first = await app.exports.main(args, env, app.dbFactory);
  const second = await app.exports.main(args, env, app.dbFactory);
  assert.equal(first.mode, 'APPLY');
  assert.equal(first.statements, 2);
  assert.equal(app.calls.transactions.length, 2);
  assert.deepEqual(json(app.calls.transactions[0]), json(app.calls.transactions[1]));
  assert.deepEqual(json(app.calls.transactionOptions[0]), { isolationLevel: 'ReadCommitted' });
  assert.equal(app.calls.transactions[0].length, 5);
  assert.match(app.calls.transactions[0][0].text, /SELECT pg_advisory_xact_lock\(\d+\)/);
  assert.match(app.calls.transactions[0][1].text, /SET LOCAL lock_timeout/);
  assert.match(app.calls.transactions[0][2].text, /SET LOCAL statement_timeout/);
  assert.match(app.calls.transactions[0][4].text, /IF NOT EXISTS \(SELECT 1 FROM admin_users WHERE admin_key = 'christoph-kopka'\)/);
  assert(!app.calls.files.some(filename => path.basename(filename) === 'schema.sql'));
});

test('admin migration refuses unsafe targets and surfaces expected bootstrap failures', async () => {
  const app = harness();
  await assert.rejects(
    app.exports.main(['--apply', '--expected-host', 'wrong.example.test'], {
      POSTGRES_URL: 'postgres://user:password@db.example.test/app',
    }, app.dbFactory),
    /hostname does not match/
  );
  assert.equal(app.calls.urls.length, 0);

  const bootstrapError = Object.assign(
    new Error('Admin bootstrap requires exactly one approved active account named Christoph Kopka; found 0'),
    { code: 'P0001' }
  );
  const failing = harness({ fail: bootstrapError });
  await assert.rejects(
    failing.exports.main(
      ['--apply', '--expected-host', 'db.example.test'],
      { DATABASE_URL: 'postgres://user:password@db.example.test/app' },
      failing.dbFactory
    ),
    bootstrapError
  );
  assert.equal(failing.exports.safeError(bootstrapError), bootstrapError.message);
  assert.equal(failing.calls.transactions.length, 1);
  assert.equal(failing.logs.length, 0);
});
