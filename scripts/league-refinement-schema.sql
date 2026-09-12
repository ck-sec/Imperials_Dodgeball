-- Upgrade already-deployed leagues only. Never execute the old base schema.
-- All statements run in one transaction under league advisory lock 782146931.
-- No season snapshots, existing results, roster assignments or member approval values are rewritten.
ALTER TABLE users ADD COLUMN IF NOT EXISTS league_scorekeeper BOOLEAN NOT NULL DEFAULT FALSE;
-- statement-breakpoint
ALTER TABLE league_seasons
  ADD COLUMN IF NOT EXISTS bonus_points_max NUMERIC NOT NULL DEFAULT 1 CHECK (bonus_points_max BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS bonus_points_step NUMERIC NOT NULL DEFAULT 0.5 CHECK (bonus_points_step > 0 AND bonus_points_step <= 10000);
-- statement-breakpoint
ALTER TABLE league_seasons DROP CONSTRAINT IF EXISTS league_seasons_bonus_increment_check;
-- statement-breakpoint
ALTER TABLE league_seasons ADD CONSTRAINT league_seasons_bonus_increment_check
  CHECK (mod(bonus_points_max, bonus_points_step) = 0);
-- statement-breakpoint
ALTER TABLE league_events ADD COLUMN IF NOT EXISTS bonus_points JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(bonus_points) = 'array');
-- statement-breakpoint
ALTER TABLE league_events DROP CONSTRAINT IF EXISTS league_events_team_size_check;
-- statement-breakpoint
ALTER TABLE league_events ADD CONSTRAINT league_events_team_size_check CHECK (team_size IN (2,3,4,5,6));
-- statement-breakpoint
ALTER TABLE league_results ADD COLUMN IF NOT EXISTS bonus_points NUMERIC NOT NULL DEFAULT 0
  CHECK (bonus_points >= 0 AND bonus_points <= 10000 AND bonus_points <= points);
-- statement-breakpoint
-- points remains the total award; the original 10000-point base maximum plus at most 10000 BP.
ALTER TABLE league_results DROP CONSTRAINT IF EXISTS league_results_points_check;
-- statement-breakpoint
ALTER TABLE league_results ADD CONSTRAINT league_results_points_check CHECK (points >= 0 AND points <= 20000);
