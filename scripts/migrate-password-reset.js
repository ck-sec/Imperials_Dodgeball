const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

function migrationStatements(schema) {
  return schema.split(/^-- statement-breakpoint\s*$/m).map(statement => statement.trim()).filter(Boolean);
}

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    throw Object.assign(new Error('Missing DATABASE_URL or POSTGRES_URL environment variable'), { code: 'MISSING_DATABASE_URL' });
  }
  const sql = neon(databaseUrl);
  const statements = migrationStatements(fs.readFileSync(path.join(__dirname, 'password-reset-schema.sql'), 'utf8'));
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(782146932)`,
    ...statements.map(statement => sql.query(statement)),
  ]);
  console.log('Password reset migration complete (transactional, additive, idempotent).');
}

if (require.main === module) {
  migrate().catch(() => {
    console.error('Password reset migration failed; transaction rolled back. Check database configuration and schema.');
    process.exitCode = 1;
  });
}

module.exports = { migrationStatements, migrate };
