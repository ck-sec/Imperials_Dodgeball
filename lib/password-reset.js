const crypto = require('crypto');

const TOKEN_RE = /^[0-9a-f]{64}$/;

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function consumeRateLimit(sql, key, maxAttempts) {
  const keyHash = hashResetToken(`password-reset:${key}`);
  // Reuse the login-attempt storage, but count/check atomically in an isolated namespace.
  const rows = await sql`
    INSERT INTO login_attempts (email_hash, attempt_count, window_start)
    VALUES (${keyHash}, 1, NOW())
    ON CONFLICT (email_hash) DO UPDATE
    SET attempt_count = CASE
      WHEN login_attempts.window_start <= NOW() - INTERVAL '15 minutes' THEN 1
      ELSE LEAST(login_attempts.attempt_count + 1, ${maxAttempts + 1})
    END,
    window_start = CASE
      WHEN login_attempts.window_start <= NOW() - INTERVAL '15 minutes' THEN NOW()
      ELSE login_attempts.window_start
    END
    RETURNING attempt_count,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + INTERVAL '15 minutes' - NOW()))))::int AS retry_after
  `;
  if (!rows[0]) throw new Error('Password reset rate limit unavailable');
  return { limited: rows[0].attempt_count > maxAttempts, retryAfter: rows[0].retry_after };
}

async function issueResetToken(sql, email, tokenHash) {
  // Pending members may recover credentials without approval; disabled/rejected members may not.
  const rows = await sql`
    WITH eligible_user AS (
      SELECT id, email, display_name FROM users
      WHERE email = ${email}
        AND (status = 'pending' OR (status = 'approved' AND is_active = true))
      FOR UPDATE
    ), issued AS (
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      SELECT id, ${tokenHash}, clock_timestamp() + INTERVAL '30 minutes' FROM eligible_user
      ON CONFLICT (user_id) DO UPDATE
      SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, created_at = clock_timestamp()
      RETURNING user_id
    )
    SELECT u.email, u.display_name FROM eligible_user u JOIN issued i ON i.user_id = u.id
  `;
  return rows[0] || null;
}

async function discardResetToken(sql, tokenHash) {
  await sql`DELETE FROM password_reset_tokens WHERE token_hash = ${tokenHash}`;
}

async function consumeResetToken(sql, tokenHash, passwordHash) {
  const results = await sql.transaction([
    // Share login/refresh's user-before-token lock order so issuance cannot escape revocation.
    sql`
      SELECT u.id FROM users u JOIN password_reset_tokens t ON t.user_id = u.id
      WHERE t.token_hash = ${tokenHash} FOR UPDATE OF u
    `,
    sql`
      WITH consumed AS (
        DELETE FROM password_reset_tokens t USING users u
        WHERE t.token_hash = ${tokenHash} AND t.user_id = u.id
          AND t.expires_at > clock_timestamp()
          AND (u.status = 'pending' OR (u.status = 'approved' AND u.is_active = true))
        RETURNING t.user_id
      ), updated AS (
        UPDATE users u SET password_hash = ${passwordHash}
        FROM consumed c WHERE u.id = c.user_id
        RETURNING u.id
      ), revoked AS (
        DELETE FROM refresh_tokens r USING updated u WHERE r.user_id = u.id
        RETURNING r.id
      )
      SELECT id FROM updated
    `,
  ], { isolationLevel: 'ReadCommitted' });
  return results[1].length === 1;
}

module.exports = {
  TOKEN_RE,
  generateResetToken,
  hashResetToken,
  consumeRateLimit,
  issueResetToken,
  discardResetToken,
  consumeResetToken,
};
