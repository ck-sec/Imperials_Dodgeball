-- Additive, idempotent migration for synchronized per-fixture match timers.
-- Apply with scripts/migrate-match-timer.js after the league schema exists.
CREATE TABLE IF NOT EXISTS league_match_timers (
  event_id UUID NOT NULL REFERENCES league_events(id) ON DELETE CASCADE,
  match_number INTEGER NOT NULL CHECK (match_number BETWEEN 1 AND 10),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  phase VARCHAR(7) NOT NULL DEFAULT 'ready' CHECK (phase IN ('ready', 'running', 'paused')),
  match_default_seconds INTEGER NOT NULL CHECK (match_default_seconds BETWEEN 0 AND 5999),
  set_default_seconds INTEGER NOT NULL CHECK (set_default_seconds BETWEEN 0 AND 5999),
  match_remaining_ms INTEGER NOT NULL CHECK (match_remaining_ms BETWEEN 0 AND 5999000),
  set_remaining_ms INTEGER NOT NULL CHECK (set_remaining_ms BETWEEN 0 AND 5999000),
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, match_number),
  CHECK ((phase = 'running') = (started_at IS NOT NULL))
);
