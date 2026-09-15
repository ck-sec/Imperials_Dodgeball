const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { migrationStatements } = require('../scripts/migrate-league');
const { TARGET, validateSeasonRows, readState, main } = require('../tools/update-season-two-scoring');

const schema = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'league-teams-beaten-schema.sql'), 'utf8');

test('teams-beaten migration is additive, guarded and updates only editable event snapshots', () => {
  const statements = migrationStatements(schema);
  assert.equal(statements.length, 9);
  assert.match(schema, /scoring_mode IN \('beaten', 'relative', 'fixed'\)/);
  assert.match(schema, /ALTER COLUMN scoring_mode SET DEFAULT 'beaten'/);
  assert.match(schema, /placement_points SET DEFAULT '\[1,0\.5\]'/);
  assert.match(schema, /start_date IN \(DATE '2026-09-12', DATE '2026-09-14'\)/);
  assert.match(schema, /UPDATE league_events[\s\S]*AND status = 'draft'/);
  assert.doesNotMatch(schema, /status\s+IN\s+\('published',\s*'finalized'\)/);
  assert.match(schema, /version = version \+ 1/);
  assert.match(schema, /settings->'placement_points' IS DISTINCT FROM '\[1,0\.5\]'/);
  assert.match(schema, /Expected exactly one Season 2 row/);
});

test('migration target accepts only the confirmed Season 2 identity and dates', () => {
  const valid = {
    id: 'season-2', name: 'Season 2', start_date: '2026-09-14', end_date: TARGET.end_date,
    placement_points: [3, 0.5], scoring_mode: 'relative', points_step: '0.5',
  };
  assert.equal(validateSeasonRows([valid]), valid);
  assert.equal(validateSeasonRows([{ ...valid, start_date: '2026-09-12' }]).start_date, '2026-09-12');
  assert.equal(validateSeasonRows([{
    ...valid, start_date: new Date('2026-09-12T00:00:00.000Z'), end_date: new Date('2027-07-02T00:00:00.000Z'),
  }]).id, 'season-2');
  assert.equal(validateSeasonRows([{
    ...valid,
    start_date: { toString: () => 'Sat Sep 12 2026 02:00:00 GMT+0200' },
    end_date: { toString: () => 'Fri Jul 02 2027 02:00:00 GMT+0200' },
  }]).id, 'season-2');
  assert.throws(() => validateSeasonRows([]), /exactly one Season 2/);
  assert.throws(() => validateSeasonRows([valid, valid]), /exactly one Season 2/);
  assert.throws(() => validateSeasonRows([{ ...valid, name: 'Season 3' }]), /not the guarded Season 2 dates/);
  assert.throws(() => validateSeasonRows([{ ...valid, end_date: '2027-06-30' }]), /not the guarded Season 2 dates/);
});

test('migration defaults to an offline preview without reading database credentials', async () => {
  const result = await main([], {}, () => {
    throw new Error('Database factory must not run during offline preview');
  });
  assert.equal(result.mode, 'DRY_RUN');
  assert.equal(result.database_checked, false);
  assert.deepEqual(result.target.placement_points, [1, 0.5]);
  assert.equal(result.target.scoring_mode, 'beaten');
  assert.equal(result.statements, 9);
});

test('database preflight reads SQL dates as timezone-safe text', async () => {
  const queries = [];
  const sql = async (strings) => {
    const text = strings.join('?');
    queries.push(text);
    if (text.includes('FROM league_seasons')) {
      return [{
        id: 'season-2', name: 'Season 2', start_date: '2026-09-12', end_date: '2027-07-02',
        placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative', points_step: '0.5',
      }];
    }
    return [{ drafts: 2, published: 0, finalized: 0 }];
  };
  const state = await readState(sql);
  assert.match(queries[0], /start_date::text AS start_date, end_date::text AS end_date/);
  assert.deepEqual(state.events, { drafts: 2, published: 0, finalized: 0 });
  assert.equal(state.season.start_date, '2026-09-12');
});
