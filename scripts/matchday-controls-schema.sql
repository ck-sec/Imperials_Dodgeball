ALTER TABLE league_events
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
-- statement-breakpoint
ALTER TABLE league_events
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;
