const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule, json } = require('./auth-test-helpers');

const schemaPath = path.join(__dirname, '..', 'scripts', 'password-reset-schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

function harness(options = {}) {
  const calls = { urls: [], transactions: [], files: [] };
  const sql = (strings, ...values) => ({ text: strings.join('?'), values });
  sql.query = text => ({ text });
  sql.transaction = async queries => {
    calls.transactions.push(queries);
    if (options.fail) throw new Error('mock migration failure');
    return queries.map(() => []);
  };
  const app = loadModule('scripts\\migrate-password-reset.js', {
    fs: { readFileSync: (filename, encoding) => {
      calls.files.push(filename);
      assert.equal(filename, schemaPath);
      assert.equal(encoding, 'utf8');
      return schema;
    } },
    path,
    '@neondatabase/serverless': { neon: url => {
      calls.urls.push(url);
      return sql;
    } },
  }, {
    process: { env: options.env || { DATABASE_URL: 'mock-database-url' } },
  });
  return { ...app, calls };
}

test('recovery migration is additive and structurally idempotent without changing existing users or approvals', () => {
  const app = harness();
  const statements = app.exports.migrationStatements(schema);
  const executable = statements.map(statement => statement.replace(/^--.*$/gm, '').trim());
  assert.equal(executable.length, 2);
  assert.match(executable[0], /^CREATE TABLE IF NOT EXISTS password_reset_tokens/);
  assert.match(executable[0], /user_id UUID PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(executable[0], /token_hash VARCHAR\(64\) NOT NULL UNIQUE CHECK/);
  assert(executable[0].includes("token_hash ~ '^[0-9a-f]{64}$'"));
  assert.match(executable[0], /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(executable[1], /^CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry/);
  assert.doesNotMatch(executable.join('\n'), /\b(?:UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b(?! CASCADE)/i);
  assert.doesNotMatch(executable.join('\n'), /\b(?:password_hash|status|is_active|raw_token)\b/i);
  assert.deepEqual(json(app.exports.migrationStatements(' \n-- statement-breakpoint\n \n')), []);
});

test('migration can be rerun unchanged and serializes all idempotent statements within a single transaction', async () => {
  const app = harness();
  assert.equal(app.calls.urls.length, 0, 'import must never run a migration');
  await app.exports.migrate();
  await app.exports.migrate();
  assert.equal(app.calls.transactions.length, 2);
  assert.deepEqual(json(app.calls.transactions[0]), json(app.calls.transactions[1]));
  const statements = app.calls.transactions[0];
  assert.equal(statements.length, 3);
  assert.match(statements[0].text, /SELECT pg_advisory_xact_lock\(\d+\)/);
  assert.match(statements[1].text, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
  assert.match(statements[2].text, /CREATE INDEX IF NOT EXISTS/);
  assert(app.calls.files.every(filename => filename === schemaPath));
  assert(!app.calls.files.some(filename => path.basename(filename) === 'schema.sql'));
});

test('migration reads only explicitly configured mocked URLs, handles missing config, and surfaces rollback', async () => {
  const missing = harness({ env: {} });
  await assert.rejects(missing.exports.migrate(), { code: 'MISSING_DATABASE_URL' });
  assert.equal(missing.calls.urls.length, 0);
  const fallback = harness({ env: { POSTGRES_URL: 'mock-fallback-url' } });
  await fallback.exports.migrate();
  assert.deepEqual(fallback.calls.urls, ['mock-fallback-url']);
  const failing = harness({ fail: true });
  await assert.rejects(failing.exports.migrate(), /mock migration failure/);
  assert.equal(failing.calls.transactions.length, 1);
  assert.equal(failing.logs.length, 0, 'must not log migration success after failure');
});
