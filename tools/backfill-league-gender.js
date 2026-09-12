const { parseArgs, safeError } = require('./initialize-season-two');
const { validateTarget } = require('../lib/season-two-calendar');
const { genderBackfillPlan } = require('../lib/league-gender');
const { players: archivedPlayers } = require('../data/season-1.json');

async function main(argv = process.argv.slice(2), env = process.env, dbFactory) {
  const options = parseArgs(argv);
  if (options.help) return { usage: 'node tools\\backfill-league-gender.js [--apply] --expected-host EXACT_DB_HOST',
    note: 'Default DRY_RUN. Only unspecified linked profiles; archive exact matches only; no email or credential logs.' };
  if (!options.expectedHost) return { mode: 'DRY_RUN', database_checked: false,
    note: 'Offline preview. Add --expected-host for read-only matching, and --apply to persist verified matches.' };
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
  validateTarget(options.expectedHost, databaseUrl);
  const sql = dbFactory ? dbFactory(databaseUrl) : require('@neondatabase/serverless').neon(databaseUrl);
  const [snapshot] = await sql`SELECT jsonb_build_object(
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name,
      'ranking_player_name', ranking_player_name) ORDER BY id) FROM users), '[]'::jsonb),
    'profiles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'user_id', user_id, 'gender', gender)
      ORDER BY id) FROM league_players WHERE gender = 'unspecified' AND merged_into IS NULL AND user_id IS NOT NULL), '[]'::jsonb)
  ) AS snapshot`;
  const { users, profiles } = snapshot.snapshot;
  const awards = genderBackfillPlan(profiles, users, archivedPlayers);
  if (options.apply && awards.length) {
    await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(782146931)`,
      sql`SET LOCAL lock_timeout = '10s'`,
      sql`SELECT id FROM users ORDER BY id FOR SHARE`,
      sql`SELECT league_assert(
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name,
          'ranking_player_name', ranking_player_name) ORDER BY id), '[]'::jsonb) FROM users) = ${JSON.stringify(users)}::jsonb,
        409, 'Member names changed. Run a new dry-run.')`,
      sql`UPDATE league_players p SET gender = g.gender, updated_at = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(awards)}::jsonb) AS g(player_id uuid, user_id uuid, gender text)
        WHERE p.id = g.player_id AND p.user_id = g.user_id AND p.gender = 'unspecified' AND p.merged_into IS NULL`,
    ], { isolationLevel: 'ReadCommitted' });
  }
  return { mode: options.apply ? 'APPLY' : 'DRY_RUN', database_checked: true, eligible_profiles: profiles.length,
    verified_matches: awards.length, male: awards.filter(p => p.gender === 'male').length,
    female: awards.filter(p => p.gender === 'female').length };
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(safeError(error));
  process.exitCode = 1;
});

module.exports = { main };
