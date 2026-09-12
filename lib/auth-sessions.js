async function issueLoginSession(sql, userId, observedPasswordHash, refreshHash, expiresAt) {
  const results = await sql.transaction([
    sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`,
    // A new statement after the lock sees a reset that committed while bcrypt or the lock was pending.
    sql`
      WITH authenticated AS (
        SELECT id, email, display_name, ranking_player_name, is_active, status
        FROM users WHERE id = ${userId} AND password_hash = ${observedPasswordHash}
      ), updated AS (
        UPDATE users u SET last_login = clock_timestamp()
        FROM authenticated a WHERE u.id = a.id AND a.is_active = true
        RETURNING u.id
      ), issued AS (
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        SELECT id, ${refreshHash}, ${expiresAt}::timestamptz FROM updated
        WHERE ${refreshHash}::text IS NOT NULL
        RETURNING user_id
      )
      SELECT id, email, display_name, ranking_player_name, is_active, status FROM authenticated
    `,
  ], { isolationLevel: 'ReadCommitted' });
  return results[1][0] || null;
}

async function rotateRefreshSession(sql, oldTokenHash, newTokenHash, expiresAt) {
  const results = await sql.transaction([
    // Match password-reset's user-before-token lock order, including concurrent rotations.
    sql`
      SELECT u.id FROM users u JOIN refresh_tokens rt ON rt.user_id = u.id
      WHERE rt.token_hash = ${oldTokenHash} FOR UPDATE OF u
    `,
    sql`
      WITH candidate AS (
        SELECT rt.id AS token_id, rt.user_id, u.email, u.display_name,
          u.ranking_player_name, u.is_active
        FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = ${oldTokenHash} AND rt.expires_at > clock_timestamp()
      ), consumed AS (
        DELETE FROM refresh_tokens rt USING candidate c
        WHERE (c.is_active = true AND rt.id = c.token_id)
          OR (c.is_active IS NOT TRUE AND rt.user_id = c.user_id)
        RETURNING rt.id
      ), issued AS (
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        SELECT c.user_id, ${newTokenHash}, ${expiresAt}::timestamptz
        FROM candidate c JOIN consumed d ON d.id = c.token_id
        WHERE c.is_active = true
        RETURNING user_id
      )
      SELECT c.user_id, c.email, c.display_name, c.ranking_player_name, c.is_active
      FROM candidate c
      WHERE c.is_active IS NOT TRUE
        OR EXISTS (SELECT 1 FROM issued i WHERE i.user_id = c.user_id)
    `,
  ], { isolationLevel: 'ReadCommitted' });
  return results[1][0] || null;
}

module.exports = { issueLoginSession, rotateRefreshSession };
