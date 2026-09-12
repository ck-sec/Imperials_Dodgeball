const { getDb } = require('../lib/db');
const { setCors } = require('../lib/cors');
const { requireMember } = require('../lib/auth');
const { isValidUuid } = require('../lib/validation');
const { sessionLock, leagueTransaction, trainingError } = require('../lib/league-db');

module.exports = async (req, res) => {
  setCors(req, res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = requireMember(req, res);
  if (!payload) return;

  const sql = getDb();
  const userId = payload.sub;

  try {
    const members = await sql`SELECT id FROM users WHERE id = ${userId} AND is_active = true AND status = 'approved'`;
    if (!members.length) return res.status(403).json({ error: 'Approved active membership required', code: 'FORBIDDEN' });
  } catch (err) {
    console.error('Training membership validation failed:', { code: err.code });
    return res.status(500).json({ error: 'Failed to validate membership', code: 'SERVER_ERROR' });
  }

  // ── GET: read operations ──
  if (req.method === 'GET') {
    const view = req.query.view || 'upcoming';

    // Upcoming sessions (next 4 weeks) with user's RSVP status
    if (view === 'upcoming') {
      try {
        const sessions = await sql`
          SELECT
            s.id, s.title, s.description, s.location,
            s.session_date::text AS session_date, s.start_time, s.end_time,
            s.max_capacity, s.is_cancelled,
            (SELECT e.status FROM league_events e WHERE e.session_id = s.id) AS league_status,
            (SELECT e.id FROM league_events e WHERE e.session_id = s.id) AS league_event_id,
            EXISTS(SELECT 1 FROM league_events e WHERE e.session_id = s.id
              AND e.status IN ('published', 'finalized')) AS rsvp_locked,
            MAX(CASE WHEN ta.user_id = ${userId} THEN ta.status END) AS my_status,
            COUNT(*) FILTER (WHERE ta.status = 'attending') AS attending_count,
            COUNT(*) FILTER (WHERE ta.status = 'not_attending') AS not_attending_count
          FROM training_sessions s
          LEFT JOIN training_attendance ta ON ta.session_id = s.id
          WHERE s.session_date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date
            AND s.session_date <= (NOW() AT TIME ZONE 'Europe/Vienna')::date + INTERVAL '28 days'
          GROUP BY s.id
          ORDER BY s.session_date ASC, s.start_time ASC
        `;
        return res.status(200).json({ sessions });
      } catch (err) {
        console.error('Failed to load sessions:', err);
        return res.status(500).json({ error: 'Failed to load sessions', code: 'SERVER_ERROR' });
      }
    }

    // Single session detail with attendee list
    if (view === 'session') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Session id required', code: 'VALIDATION_ERROR' });
      if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid session id format', code: 'VALIDATION_ERROR' });

      try {
        const sessions = await sql`
          SELECT
            s.id, s.title, s.description, s.location,
            s.session_date::text AS session_date, s.start_time, s.end_time,
            s.max_capacity, s.is_cancelled,
            (SELECT e.status FROM league_events e WHERE e.session_id = s.id) AS league_status,
            (SELECT e.id FROM league_events e WHERE e.session_id = s.id) AS league_event_id,
            EXISTS(SELECT 1 FROM league_events e WHERE e.session_id = s.id
              AND e.status IN ('published', 'finalized')) AS rsvp_locked,
            a.status AS my_status
          FROM training_sessions s
          LEFT JOIN training_attendance a ON a.session_id = s.id AND a.user_id = ${userId}
          WHERE s.id = ${id}
        `;
        if (sessions.length === 0) {
          return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
        }

        const attendees = await sql`
          SELECT u.display_name, ta.status
          FROM training_attendance ta
          JOIN users u ON u.id = ta.user_id
          WHERE ta.session_id = ${id} AND ta.status IN ('attending', 'not_attending')
          ORDER BY ta.status ASC, u.display_name ASC
        `;

        return res.status(200).json({ session: sessions[0], attendees });
      } catch (err) {
        console.error('Failed to load session:', err);
        return res.status(500).json({ error: 'Failed to load session', code: 'SERVER_ERROR' });
      }
    }

    return res.status(400).json({ error: 'Invalid view parameter', code: 'VALIDATION_ERROR' });
  }

  // ── POST: RSVP ──
  if (req.method === 'POST') {
    const { action, session_id, status } = req.body || {};

    if (action !== 'rsvp') {
      return res.status(400).json({ error: 'Invalid action', code: 'VALIDATION_ERROR' });
    }
    if (!session_id || !['attending', 'not_attending'].includes(status)) {
      return res.status(400).json({ error: 'session_id and status (attending/not_attending) required', code: 'VALIDATION_ERROR' });
    }
    if (!isValidUuid(session_id)) {
      return res.status(400).json({ error: 'Invalid session_id format', code: 'VALIDATION_ERROR' });
    }

    try {
      // Separate statements after FOR UPDATE see commits that occurred while waiting.
      // This is the same session lock used by publication, including the capacity check.
      const result = await leagueTransaction(sql, [
        sessionLock(sql, session_id),
        sql`SELECT id FROM users WHERE id = ${userId} FOR SHARE`,
        sql`SELECT league_assert(EXISTS(SELECT 1 FROM users WHERE id = ${userId}
          AND is_active = true AND status = 'approved'), 403, 'Approved active membership required')`,
        sql`SELECT league_assert(EXISTS(SELECT 1 FROM training_sessions WHERE id = ${session_id}),
          404, 'Session not found')`,
        sql`SELECT league_assert(NOT EXISTS(SELECT 1 FROM league_events
          WHERE session_id = ${session_id} AND status IN ('published', 'finalized')),
          409, 'Registration is frozen for published or finalized league teams. Contact an admin for last-minute changes.')`,
        sql`SELECT league_assert((SELECT is_cancelled = false FROM training_sessions WHERE id = ${session_id}),
          400, 'Cannot RSVP to a cancelled session. Contact an admin for last-minute changes.')`,
        sql`SELECT league_assert((SELECT session_date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date
          FROM training_sessions WHERE id = ${session_id}), 400, 'Cannot RSVP to a past session. Contact an admin for last-minute changes.')`,
        sql`SELECT league_assert(
          ${status} <> 'attending' OR (SELECT max_capacity IS NULL OR max_capacity > (
            SELECT COUNT(*) FROM training_attendance a JOIN users u ON u.id = a.user_id
            WHERE a.session_id = ${session_id} AND a.status = 'attending' AND a.user_id <> ${userId}
              AND u.is_active = true AND u.status = 'approved'
          ) FROM training_sessions WHERE id = ${session_id}), 400, 'Session is full. Contact an admin for last-minute changes.')`,
        sql`
          INSERT INTO training_attendance (session_id, user_id, status, responded_at)
          VALUES (${session_id}, ${userId}, ${status}, NOW())
          ON CONFLICT (session_id, user_id)
          DO UPDATE SET status = ${status}, responded_at = NOW()
        `,
        sql`SELECT
          COUNT(*) FILTER (WHERE status = 'attending') AS attending_count,
          COUNT(*) FILTER (WHERE status = 'not_attending') AS not_attending_count
          FROM training_attendance WHERE session_id = ${session_id}`,
      ]);
      const counts = result[result.length - 1];

      return res.status(200).json({
        success: true,
        my_status: status,
        attending_count: parseInt(counts[0].attending_count) || 0,
        not_attending_count: parseInt(counts[0].not_attending_count) || 0
      });
    } catch (err) {
      if (trainingError(err, res)) return;
      console.error('RSVP failed:', err);
      return res.status(500).json({ error: 'RSVP failed. Please retry or contact an admin for last-minute changes.', code: 'SERVER_ERROR' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
};
