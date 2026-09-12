-- Additive league-only migration. Never rerun schema.sql to install this feature.
-- Settings and ratings freeze at GENERATION; regenerate a draft to adopt changes.
-- Corrections replace one event's ledger using its frozen ratings, never later snapshots.
-- API numeric inputs have six-decimal precision; points 0..10000, seeds 0..10000, K 0..200.
-- Guest links preserve the guest ID/seed and retain merged aliases; overlapping events reject merging.
-- roster_ids use league IDs; rsvp_user_ids independently freeze source registrations even for manual squads.
-- Relative scoring interpolates over placement_points, then rounds to points_step.
-- Fixed mode repeats the last value. Legacy frozen snapshots without a mode remain fixed.
CREATE TABLE IF NOT EXISTS league_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  placement_points JSONB NOT NULL DEFAULT '[3,2.5,2,1,0.5]'::jsonb,
  scoring_mode VARCHAR(8) NOT NULL DEFAULT 'relative' CHECK (scoring_mode IN ('relative', 'fixed')),
  points_step NUMERIC NOT NULL DEFAULT 0.5 CHECK (points_step IN (0.1, 0.25, 0.5, 1)),
  k_factor NUMERIC NOT NULL DEFAULT 24 CHECK (k_factor >= 0 AND k_factor <= 200),
  default_rating NUMERIC NOT NULL DEFAULT 1000 CHECK (default_rating >= 0 AND default_rating <= 10000),
  rookie_rating NUMERIC NOT NULL DEFAULT 800 CHECK (rookie_rating >= 0 AND rookie_rating <= 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(placement_points) = 'array' AND jsonb_array_length(placement_points) BETWEEN 1 AND 100)
);
-- statement-breakpoint
-- Existing seasons keep their fixed rules; new seasons default to relative.
-- No event snapshots or result ledgers are rewritten by this upgrade.
ALTER TABLE league_seasons ADD COLUMN IF NOT EXISTS scoring_mode VARCHAR(8) NOT NULL DEFAULT 'fixed'
  CHECK (scoring_mode IN ('relative', 'fixed'));
-- statement-breakpoint
ALTER TABLE league_seasons ADD COLUMN IF NOT EXISTS points_step NUMERIC NOT NULL DEFAULT 0.5
  CHECK (points_step IN (0.1, 0.25, 0.5, 1));
-- statement-breakpoint
ALTER TABLE league_seasons ALTER COLUMN scoring_mode SET DEFAULT 'relative',
  ALTER COLUMN placement_points SET DEFAULT '[3,2.5,2,1,0.5]'::jsonb;
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS league_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  display_name VARCHAR(100) NOT NULL,
  gender VARCHAR(11) NOT NULL DEFAULT 'unspecified' CHECK (gender IN ('male','female','unspecified')),
  is_rookie BOOLEAN NOT NULL DEFAULT FALSE,
  initial_rating NUMERIC CHECK (initial_rating >= 0 AND initial_rating <= 10000),
  merged_into UUID REFERENCES league_players(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (merged_into IS NULL OR (merged_into <> id AND user_id IS NULL))
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS league_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES league_seasons(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL UNIQUE REFERENCES training_sessions(id) ON DELETE RESTRICT,
  team_size INTEGER NOT NULL CHECK (team_size IN (4,5,6)),
  max_teams INTEGER NOT NULL DEFAULT 5 CHECK (max_teams BETWEEN 2 AND 5),
  schedule JSONB CHECK (schedule IS NULL OR jsonb_typeof(schedule) = 'object'),
  roster_locked BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','finalized')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  settings JSONB NOT NULL,
  teams JSONB NOT NULL,
  roster_ids JSONB NOT NULL,
  rsvp_user_ids JSONB NOT NULL,
  roster_source VARCHAR(6) NOT NULL CHECK (roster_source IN ('rsvp', 'manual')),
  session_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(teams) = 'array' AND jsonb_array_length(teams) >= 2),
  CHECK (jsonb_typeof(roster_ids) = 'array'),
  CHECK (jsonb_typeof(rsvp_user_ids) = 'array')
);
-- statement-breakpoint
ALTER TABLE league_events ADD COLUMN IF NOT EXISTS max_teams INTEGER NOT NULL DEFAULT 5 CHECK (max_teams BETWEEN 2 AND 5);
-- statement-breakpoint
ALTER TABLE league_events ADD COLUMN IF NOT EXISTS schedule JSONB CHECK (schedule IS NULL OR jsonb_typeof(schedule) = 'object');
-- statement-breakpoint
-- Set on first recorded match or finalization; reopening results never unlocks the roster.
ALTER TABLE league_events ADD COLUMN IF NOT EXISTS roster_locked BOOLEAN NOT NULL DEFAULT FALSE;
-- statement-breakpoint
-- Durable league identities retain guest points and survive account deletion.
-- Linking merges into the guest identity, preserving its seed and all event deltas.
CREATE TABLE IF NOT EXISTS league_results (
  event_id UUID NOT NULL REFERENCES league_events(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES league_players(id) ON DELETE RESTRICT,
  display_name VARCHAR(100) NOT NULL,
  team_number INTEGER NOT NULL CHECK (team_number > 0),
  placement INTEGER NOT NULL CHECK (placement > 0),
  points NUMERIC NOT NULL CHECK (points >= 0 AND points <= 10000),
  rating_delta NUMERIC NOT NULL CHECK (rating_delta >= -200 AND rating_delta <= 200),
  PRIMARY KEY (event_id, player_id)
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_league_events_season ON league_events(season_id, status);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_league_results_player ON league_results(player_id);
-- statement-breakpoint
CREATE OR REPLACE FUNCTION league_assert(ok BOOLEAN, http_status INTEGER, reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $league$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = reason,
      DETAIL = 'LEAGUE_' || http_status::text;
  END IF;
  RETURN TRUE;
END;
$league$;
