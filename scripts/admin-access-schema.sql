CREATE TABLE IF NOT EXISTS admin_users (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  admin_key   VARCHAR(32) NOT NULL UNIQUE
              CHECK (admin_key IN ('christoph-kopka', 'dominik-riedl')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- statement-breakpoint

DO $admin_bootstrap$
DECLARE
  matching_ids UUID[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE admin_key = 'christoph-kopka') THEN
    SELECT array_agg(id ORDER BY id)
      INTO matching_ids
      FROM users
     WHERE display_name = 'Christoph Kopka'
       AND status = 'approved'
       AND is_active = TRUE;

    IF COALESCE(cardinality(matching_ids), 0) <> 1 THEN
      RAISE EXCEPTION 'Admin bootstrap requires exactly one approved active account named Christoph Kopka; found %',
        COALESCE(cardinality(matching_ids), 0);
    END IF;

    INSERT INTO admin_users (user_id, admin_key)
    VALUES (matching_ids[1], 'christoph-kopka');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE admin_key = 'dominik-riedl') THEN
    SELECT array_agg(id ORDER BY id)
      INTO matching_ids
      FROM users
     WHERE display_name = 'Dominik Riedl'
       AND status = 'approved'
       AND is_active = TRUE;

    IF COALESCE(cardinality(matching_ids), 0) <> 1 THEN
      RAISE EXCEPTION 'Admin bootstrap requires exactly one approved active account named Dominik Riedl; found %',
        COALESCE(cardinality(matching_ids), 0);
    END IF;

    INSERT INTO admin_users (user_id, admin_key)
    VALUES (matching_ids[1], 'dominik-riedl');
  END IF;
END
$admin_bootstrap$;
