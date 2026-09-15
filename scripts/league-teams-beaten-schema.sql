-- Guarded Season 2 scoring upgrade. Run only through tools/update-season-two-scoring.js.
-- Published and finalized event snapshots are intentionally preserved.
-- Production starts on 12 September; fresh calendar installs start at the first session on 14 September.
ALTER TABLE league_seasons DROP CONSTRAINT IF EXISTS league_seasons_scoring_mode_check;
-- statement-breakpoint
ALTER TABLE league_seasons ADD CONSTRAINT league_seasons_scoring_mode_check
  CHECK (scoring_mode IN ('beaten', 'relative', 'fixed'));
-- statement-breakpoint
ALTER TABLE league_seasons ALTER COLUMN scoring_mode SET DEFAULT 'beaten',
  ALTER COLUMN placement_points SET DEFAULT '[1,0.5]'::jsonb;
-- statement-breakpoint
SELECT league_assert((
  SELECT COUNT(*) = 1 FROM league_seasons
  WHERE LOWER(REGEXP_REPLACE(name, '\s+', '', 'g')) = 'season2'
    AND start_date IN (DATE '2026-09-12', DATE '2026-09-14') AND end_date = DATE '2027-07-02'
), 409, 'Expected exactly one Season 2 row with the confirmed dates');
-- statement-breakpoint
SELECT id FROM league_seasons
WHERE LOWER(REGEXP_REPLACE(name, '\s+', '', 'g')) = 'season2'
  AND start_date IN (DATE '2026-09-12', DATE '2026-09-14') AND end_date = DATE '2027-07-02'
FOR UPDATE;
-- statement-breakpoint
UPDATE league_seasons
SET placement_points = '[1,0.5]'::jsonb, scoring_mode = 'beaten', points_step = 0.5, updated_at = NOW()
WHERE LOWER(REGEXP_REPLACE(name, '\s+', '', 'g')) = 'season2'
  AND start_date IN (DATE '2026-09-12', DATE '2026-09-14') AND end_date = DATE '2027-07-02'
  AND (placement_points IS DISTINCT FROM '[1,0.5]'::jsonb
    OR scoring_mode IS DISTINCT FROM 'beaten' OR points_step IS DISTINCT FROM 0.5);
-- statement-breakpoint
UPDATE league_events
SET settings = settings || '{"placement_points":[1,0.5],"scoring_mode":"beaten","points_step":0.5}'::jsonb,
  version = version + 1, updated_at = NOW()
WHERE season_id = (
  SELECT id FROM league_seasons
  WHERE LOWER(REGEXP_REPLACE(name, '\s+', '', 'g')) = 'season2'
    AND start_date IN (DATE '2026-09-12', DATE '2026-09-14') AND end_date = DATE '2027-07-02'
)
  AND status = 'draft'
  AND (settings->'placement_points' IS DISTINCT FROM '[1,0.5]'::jsonb
    OR settings->>'scoring_mode' IS DISTINCT FROM 'beaten'
    OR settings->>'points_step' IS DISTINCT FROM '0.5');
-- statement-breakpoint
SELECT league_assert(EXISTS(
  SELECT 1 FROM league_seasons
  WHERE LOWER(REGEXP_REPLACE(name, '\s+', '', 'g')) = 'season2'
    AND start_date IN (DATE '2026-09-12', DATE '2026-09-14') AND end_date = DATE '2027-07-02'
    AND placement_points = '[1,0.5]'::jsonb AND scoring_mode = 'beaten' AND points_step = 0.5
), 409, 'Season 2 teams-beaten scoring was not saved');
-- statement-breakpoint
SELECT league_assert(NOT EXISTS(
  SELECT 1 FROM league_events e JOIN league_seasons s ON s.id = e.season_id
  WHERE LOWER(REGEXP_REPLACE(s.name, '\s+', '', 'g')) = 'season2'
    AND s.start_date IN (DATE '2026-09-12', DATE '2026-09-14') AND s.end_date = DATE '2027-07-02'
    AND e.status = 'draft' AND (
      e.settings->'placement_points' IS DISTINCT FROM '[1,0.5]'::jsonb
      OR e.settings->>'scoring_mode' IS DISTINCT FROM 'beaten'
      OR e.settings->>'points_step' IS DISTINCT FROM '0.5'
    )
), 409, 'An editable Season 2 draft kept stale scoring');
