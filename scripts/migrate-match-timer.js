const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../tools/initialize-season-two');
const { CalendarError, validateTarget } = require('../lib/season-two-calendar');

async function main(argv = process.argv.slice(2), env = process.env, dbFactory) {
  const options = parseArgs(argv);
  if (options.help) {
    return {
      usage: 'node scripts\\migrate-match-timer.js --apply --expected-host EXACT_DB_HOST',
      note: 'Default is offline DRY_RUN. This additive migration never reads .env files.',
    };
  }
  const statement = fs.readFileSync(path.join(__dirname, 'match-timer-schema.sql'), 'utf8').trim();
  if (!options.apply) {
    return {
      mode: 'DRY_RUN',
      database_checked: false,
      statements: 1,
      note: 'No database access. Use --apply --expected-host EXACT_DB_HOST to install match timers.',
    };
  }
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(782146931)`,
    sql`SET LOCAL lock_timeout = '10s'`,
    sql`SET LOCAL statement_timeout = '60s'`,
    sql.query(statement),
  ], { isolationLevel: 'ReadCommitted' });
  return { mode: 'APPLY', migration: 'match-timer', statements: 1 };
}

function safeError(error) {
  if (error instanceof CalendarError) return error.message;
  if (['42P01', '42703', '42883'].includes(error.code)) {
    return 'Required league schema is missing. Apply scripts\\league-schema.sql before the match-timer migration.';
  }
  if (['55P03', '40P01', '40001', '57014'].includes(error.code)) {
    return 'Database lock or concurrency timeout. The migration was rolled back; retry when other writers are idle.';
  }
  return 'Match-timer migration failed. The transaction was rolled back; verify the selected database before retrying.';
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

module.exports = { main, safeError };
