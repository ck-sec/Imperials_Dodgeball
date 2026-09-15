// Offline preview: node tools/update-season-two-scoring.js
// Read-only preflight: node tools/update-season-two-scoring.js --expected-host EXACT_DB_HOST
// Apply: node tools/update-season-two-scoring.js --apply --expected-host EXACT_DB_HOST
// Credentials must be supplied by the operator environment. This tool never loads .env files.
const fs = require('node:fs');
const path = require('node:path');
const { migrationStatements } = require('../scripts/migrate-league');
const { CalendarError, validateTarget } = require('../lib/season-two-calendar');
const { parseArgs, safeError } = require('./initialize-season-two');

// Production predates the first calendar slot by two days; fresh calendar installs start on that slot.
const TARGET = Object.freeze({
  name: 'Season 2',
  start_dates: Object.freeze(['2026-09-12', '2026-09-14']),
  end_date: '2027-07-02',
  placement_points: Object.freeze([1, 0.5]),
  scoring_mode: 'beaten',
  points_step: 0.5,
});

function day(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoDate) return isoDate[0];
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : text;
}

function validateSeasonRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new CalendarError('Expected exactly one Season 2 row with the confirmed dates. No scoring was changed.');
  }
  const season = rows[0];
  const normalizedName = String(season.name).toLowerCase().replace(/\s+/g, '');
  const startDate = day(season.start_date);
  const endDate = day(season.end_date);
  if (normalizedName !== 'season2' || !TARGET.start_dates.includes(startDate) || endDate !== TARGET.end_date) {
    throw new CalendarError(
      `Found ${JSON.stringify(String(season.name))} (${startDate} through ${endDate}), not the guarded Season 2 dates. No scoring was changed.`,
    );
  }
  return season;
}

async function readState(sql) {
  const rows = await sql`
    SELECT id, name, start_date::text AS start_date, end_date::text AS end_date,
      placement_points, scoring_mode, points_step
    FROM league_seasons
    WHERE LOWER(REGEXP_REPLACE(name, '\s+', '', 'g')) = 'season2'
      OR (start_date <= ${TARGET.end_date}::date AND end_date >= ${TARGET.start_dates[0]}::date)
    ORDER BY start_date, id
  `;
  const season = validateSeasonRows(rows);
  const [events] = await sql`
    SELECT COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
      COUNT(*) FILTER (WHERE status = 'published')::int AS published,
      COUNT(*) FILTER (WHERE status = 'finalized')::int AS finalized
    FROM league_events WHERE season_id = ${season.id}
  `;
  return {
    season: {
      id: season.id, name: season.name, start_date: day(season.start_date), end_date: day(season.end_date),
      placement_points: season.placement_points.map(Number), scoring_mode: season.scoring_mode,
      points_step: Number(season.points_step),
    },
    events: {
      drafts: Number(events.drafts), published: Number(events.published), finalized: Number(events.finalized),
    },
  };
}

async function main(argv = process.argv.slice(2), env = process.env, dbFactory) {
  const options = parseArgs(argv);
  const statements = migrationStatements(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'league-teams-beaten-schema.sql'), 'utf8'));
  if (options.help) {
    return {
      usage: [
        'node tools\\update-season-two-scoring.js',
        'node tools\\update-season-two-scoring.js --expected-host EXACT_DB_HOST',
        'node tools\\update-season-two-scoring.js --apply --expected-host EXACT_DB_HOST',
      ],
      rule: '1 participation point + 0.5 points per team beaten',
    };
  }
  if (!options.expectedHost) {
    return { mode: 'DRY_RUN', database_checked: false, target: TARGET, statements: statements.length };
  }
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  const before = await readState(sql);
  if (!options.apply) return { mode: 'PREFLIGHT', database_checked: true, before, target: TARGET };
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(782146931)`,
    sql`SET LOCAL lock_timeout = '10s'`,
    sql`SET LOCAL statement_timeout = '60s'`,
    ...statements.map(statement => sql.query(statement)),
  ], { isolationLevel: 'ReadCommitted' });
  const after = await readState(sql);
  if (after.season.scoring_mode !== TARGET.scoring_mode
    || JSON.stringify(after.season.placement_points) !== JSON.stringify(TARGET.placement_points)
    || after.season.points_step !== TARGET.points_step) {
    throw new CalendarError('Post-migration verification did not find the selected Season 2 scoring rule.');
  }
  return { mode: 'APPLY', migration: 'season-two-teams-beaten', before, after };
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(safeError(error));
  process.exitCode = 1;
});

module.exports = { TARGET, validateSeasonRows, readState, main };
