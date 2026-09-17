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
      usage: 'node scripts\\migrate-matchday-controls.js --apply --expected-host EXACT_DB_HOST',
      note: 'Default is an offline dry run. Apply adds reversible league-matchday cancellation metadata.',
    };
  }

  const statements = migrationStatements(
    fs.readFileSync(path.join(__dirname, 'matchday-controls-schema.sql'), 'utf8'),
  );
  if (!options.apply) {
    return {
      mode: 'DRY_RUN',
      database_checked: false,
      statements: statements.length,
      note: 'No database access. The additive migration preserves every lineup, fixture, score and result row.',
    };
  }

  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(618204751)`,
    sql`SET LOCAL lock_timeout = '10s'`,
    sql`SET LOCAL statement_timeout = '60s'`,
    ...statements.map(statement => sql.query(statement)),
  ], { isolationLevel: 'ReadCommitted' });
  return { mode: 'APPLY', migration: 'matchday-controls', statements: statements.length };
}

function safeError(error) {
  if (error instanceof CalendarError) return error.message;
  if (error && error.code === '42P01') {
    return 'The league_events or users table is missing. Apply the member and league schemas first.';
  }
  if (error && ['55P03', '40P01', '40001', '57014'].includes(error.code)) {
    return 'Database lock or concurrency timeout. The migration was rolled back; retry when other writers are idle.';
  }
  return 'Matchday-controls migration failed. The transaction was rolled back; verify the selected database.';
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

module.exports = { migrationStatements, main, safeError };
