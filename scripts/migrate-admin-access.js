const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../tools/initialize-season-two');
const { CalendarError, validateTarget } = require('../lib/season-two-calendar');

function migrationStatements(schema) {
  return schema.split(/^-- statement-breakpoint\s*$/m).map(statement => statement.trim()).filter(Boolean);
}

async function main(argv = process.argv.slice(2), env = process.env, dbFactory) {
  const options = parseArgs(argv);
  if (options.help) {
    return {
      usage: 'node scripts\\migrate-admin-access.js --apply --expected-host EXACT_DB_HOST',
      note: 'Default is an offline dry run. Apply bootstraps only the exact approved active accounts for Christoph Kopka and Dominik Riedl.',
    };
  }

  const statements = migrationStatements(fs.readFileSync(path.join(__dirname, 'admin-access-schema.sql'), 'utf8'));
  if (!options.apply) {
    return {
      mode: 'DRY_RUN',
      database_checked: false,
      statements: statements.length,
      note: 'No database access. Apply aborts unless each unmapped administrator has exactly one approved active account with the expected name.',
    };
  }

  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(519774203)`,
    sql`SET LOCAL lock_timeout = '10s'`,
    sql`SET LOCAL statement_timeout = '60s'`,
    ...statements.map(statement => sql.query(statement)),
  ], { isolationLevel: 'ReadCommitted' });
  return { mode: 'APPLY', migration: 'admin-access', statements: statements.length };
}

function safeError(error) {
  if (error instanceof CalendarError) return error.message;
  if (error && error.code === 'P0001' && /^Admin bootstrap requires exactly one approved active account named /.test(error.message)) {
    return error.message;
  }
  if (error && error.code === '42P01') {
    return 'The users table is missing. Apply the member schema before the admin-access migration.';
  }
  if (error && ['55P03', '40P01', '40001', '57014'].includes(error.code)) {
    return 'Database lock or concurrency timeout. The migration was rolled back; retry when other writers are idle.';
  }
  return 'Admin-access migration failed. The transaction was rolled back; verify the selected database and approved accounts.';
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

module.exports = { migrationStatements, main, safeError };
