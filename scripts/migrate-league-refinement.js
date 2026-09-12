const fs = require('node:fs');
const path = require('node:path');
const { migrationStatements } = require('./migrate-league');
const { parseArgs, safeError } = require('../tools/initialize-season-two');
const { validateTarget } = require('../lib/season-two-calendar');

async function main(argv = process.argv.slice(2), env = process.env, dbFactory) {
  const options = parseArgs(argv);
  if (options.help) return { usage: 'node scripts\\migrate-league-refinement.js --apply --expected-host EXACT_DB_HOST',
    note: 'Default is offline DRY_RUN. Never loads .env or runs the original schema.' };
  const statements = migrationStatements(fs.readFileSync(path.join(__dirname, 'league-refinement-schema.sql'), 'utf8'));
  if (!options.apply) return { mode: 'DRY_RUN', database_checked: false, statements: statements.length,
    note: 'No database access. Use --apply --expected-host EXACT_DB_HOST to apply the additive upgrade.' };
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(782146931)`,
    sql`SET LOCAL lock_timeout = '10s'`,
    sql`SET LOCAL statement_timeout = '60s'`,
    ...statements.map(statement => sql.query(statement)),
  ], { isolationLevel: 'ReadCommitted' });
  return { mode: 'APPLY', migration: 'league-refinement', statements: statements.length };
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(safeError(error));
  process.exitCode = 1;
});

module.exports = { main };
