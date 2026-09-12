// Offline calendar preview (default): node tools/initialize-season-two.js
// Read-only DB preflight: node tools/initialize-season-two.js --expected-host EXACT_DB_HOST
// Apply: node tools/initialize-season-two.js --apply --expected-host EXACT_DB_HOST
// Requires the existing schema plus the additive scripts/league-schema.sql migration.
// Credentials must be supplied by the operator's environment. Never loads .env or creates members/events.
const {
  CalendarError, buildCalendar, validateTarget, initializeSeasonTwo,
} = require('../lib/season-two-calendar');

function parseArgs(argv) {
  const options = { apply: false, expectedHost: undefined, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!['--apply', '--dry-run', '--expected-host', '--help'].includes(arg)) {
      throw new CalendarError('Unknown argument. Use --help for supported options.');
    }
    if (seen.has(arg)) throw new CalendarError('Repeated command-line option. Use each option only once.');
    seen.add(arg);
    if (arg === '--apply') options.apply = true;
    if (arg === '--help') options.help = true;
    if (arg === '--expected-host') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new CalendarError('--expected-host requires the exact database hostname.');
      options.expectedHost = value;
    }
  }
  if (seen.has('--apply') && seen.has('--dry-run')) throw new CalendarError('Choose either --apply or --dry-run, not both.');
  if (options.apply && !options.expectedHost) throw new CalendarError('--apply requires --expected-host. No database access attempted.');
  return options;
}

async function main(argv = process.argv.slice(2), env = process.env, dbFactory) {
  const options = parseArgs(argv);
  if (options.help) {
    return {
      usage: [
        'node tools\\initialize-season-two.js',
        'node tools\\initialize-season-two.js --expected-host EXACT_DB_HOST',
        'node tools\\initialize-season-two.js --apply --expected-host EXACT_DB_HOST',
      ],
      notes: [
        'Default: offline DRY_RUN; does not read credentials or contact the database.',
        '--expected-host without --apply: read-only database preflight and conflict checks.',
        '--apply: one guarded, locked transaction; insert missing sessions and Season 2 only.',
        'Set DATABASE_URL or POSTGRES_URL externally; .env files are never loaded.',
        'Apply scripts\\league-schema.sql separately first. Do not rerun the destructive base schema.',
        'Exact existing sessions (including cancellations) and configured season settings are preserved.',
        'Ambiguous identities, duplicates, active holiday sessions and incompatible season dates fail closed.',
        'School-autonomous closures are unknown; they are not inferred from bridge days.',
      ],
    };
  }
  const calendar = buildCalendar();
  if (!options.expectedHost) {
    return {
      mode: 'DRY_RUN', database_checked: false, calendar: calendar.summary,
      new_season_defaults: calendar.season,
      note: 'Offline preview only. Supply --expected-host for read-only conflict checks against your chosen database.',
    };
  }
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  // Construct the existing Neon client from exactly the URL whose hostname was confirmed.
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  return initializeSeasonTwo({ sql, apply: options.apply, expectedHost: options.expectedHost, databaseUrl });
}

function safeError(error) {
  if (error instanceof CalendarError) return error.message;
  if (error.code === 'P0001' && error.detail === 'LEAGUE_409') {
    return 'Calendar safety check failed (changed preflight or failed postcondition). The guarded transaction was rolled back; inspect a new read-only preflight.';
  }
  if (['42P01', '42703', '42883'].includes(error.code)) {
    return 'Required calendar/league schema is missing. Apply the additive scripts\\league-schema.sql migration separately; never rerun the base schema.';
  }
  if (['55P03', '40P01', '40001', '57014'].includes(error.code)) {
    return 'Database lock/concurrency timeout. No changes from the failed transaction were committed; rerun when other writers are idle.';
  }
  if (['23505', '23503', '23514', '23502'].includes(error.code)) {
    return 'Database constraint conflict. The insert transaction was rolled back; review existing calendar rows and schema.';
  }
  // Transport errors may contain connection URLs or leave commit acknowledgement uncertain.
  return 'Calendar database operation failed. Verify the selected database and rerun a read-only preflight before retrying. Raw connection errors are not printed.';
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main, safeError };
