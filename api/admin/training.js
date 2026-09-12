const { getDb } = require('../../lib/db');
const { setCors } = require('../../lib/cors');
const { requireAdmin } = require('../../lib/auth');
const { isValidUuid } = require('../../lib/validation');
const { trainingMutationGuards, leagueTransaction, trainingError } = require('../../lib/league-db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

module.exports = async (req, res) => {
  setCors(req, res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const sql = getDb();

  // ── GET: read operations ──
  if (req.method === 'GET') {
    const view = req.query.view || 'overview';

    // Overview: all sessions with attendance counts
    if (view === 'overview') {
      const range = req.query.range || 'month';
      const interval = range === 'week' ? '7 days' : '30 days';
      try {
        // GET must not delete sessions: league seasons need persistent training history.
        const sessions = await sql`
          WITH active_count AS (
            SELECT COUNT(*) AS cnt FROM users WHERE is_active = true AND status = 'approved'
          )
          SELECT
            s.id, s.title, s.description, s.location,
            s.session_date::text AS session_date, s.start_time, s.end_time,
            s.max_capacity, s.is_cancelled, s.recurring_day,
            s.created_at, s.updated_at,
            COUNT(*) FILTER (WHERE ta.status = 'attending') AS attending_count,
            COUNT(*) FILTER (WHERE ta.status = 'not_attending') AS not_attending_count,
            ac.cnt - COUNT(DISTINCT ta.user_id) FILTER (WHERE ta.status IN ('attending', 'not_attending')
              AND ta.user_id IN (SELECT id FROM users WHERE is_active = true AND status = 'approved'))
              AS no_response_count
          FROM training_sessions s
          CROSS JOIN active_count ac
          LEFT JOIN training_attendance ta ON ta.session_id = s.id
          WHERE s.session_date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date - ${interval}::interval
          GROUP BY s.id, ac.cnt
          ORDER BY s.session_date ASC, s.start_time ASC
        `;
        return res.status(200).json({ sessions });
      } catch (err) {
        console.error('Failed to load sessions:', err);
        return res.status(500).json({ error: 'Failed to load sessions', code: 'SERVER_ERROR' });
      }
    }

    // Detail: single session with full attendee breakdown
    if (view === 'detail') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Session id required', code: 'VALIDATION_ERROR' });
      if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid session id format', code: 'VALIDATION_ERROR' });

      try {
        const sessions = await sql`
          SELECT id, title, description, location, session_date::text AS session_date, start_time, end_time,
                 max_capacity, is_cancelled, recurring_day, created_at, updated_at
          FROM training_sessions WHERE id = ${id}
        `;
        if (sessions.length === 0) {
          return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
        }

        const attendees = await sql`
          SELECT u.id, u.display_name, u.email, COALESCE(ta.status, 'pending') AS status, ta.responded_at
          FROM users u
          LEFT JOIN training_attendance ta ON ta.user_id = u.id AND ta.session_id = ${id}
          WHERE u.is_active = true AND u.status = 'approved'
          ORDER BY
            CASE COALESCE(ta.status, 'pending')
              WHEN 'attending' THEN 1
              WHEN 'not_attending' THEN 2
              ELSE 3
            END,
            u.display_name ASC
        `;

        return res.status(200).json({ session: sessions[0], attendees });
      } catch (err) {
        console.error('Failed to load session detail:', err);
        return res.status(500).json({ error: 'Failed to load session detail', code: 'SERVER_ERROR' });
      }
    }

    // Attendance matrix: members x sessions
    if (view === 'matrix') {
      try {
        const sessions = await sql`
          SELECT id, title, session_date::text AS session_date
          FROM training_sessions
          WHERE session_date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date - INTERVAL '60 days'
          ORDER BY session_date ASC
        `;

        const members = await sql`
          SELECT u.id, u.display_name
          FROM users u
          WHERE u.is_active = true AND u.status = 'approved'
          ORDER BY u.display_name ASC
        `;

        const attendance = await sql`
          SELECT session_id, user_id, status
          FROM training_attendance
          WHERE session_id IN (
            SELECT id FROM training_sessions
            WHERE session_date >= (NOW() AT TIME ZONE 'Europe/Vienna')::date - INTERVAL '60 days'
          )
        `;

        // Build lookup
        const lookup = {};
        for (const a of attendance) {
          lookup[`${a.user_id}_${a.session_id}`] = a.status;
        }

        const matrix = members.map(m => ({
          id: m.id,
          display_name: m.display_name,
          sessions: sessions.map(s => ({
            session_id: s.id,
            status: lookup[`${m.id}_${s.id}`] || 'pending'
          }))
        }));

        // Calculate overall attendance rate
        const totalSlots = members.length * sessions.length;
        const attendingCount = attendance.filter(a => a.status === 'attending').length;
        const attendance_rate = totalSlots > 0 ? Math.round((attendingCount / totalSlots) * 100) : 0;

        return res.status(200).json({ sessions, matrix, attendance_rate });
      } catch (err) {
        console.error('Failed to load attendance matrix:', err);
        return res.status(500).json({ error: 'Failed to load attendance matrix', code: 'SERVER_ERROR' });
      }
    }

    return res.status(400).json({ error: 'Invalid view parameter', code: 'VALIDATION_ERROR' });
  }

  // ── POST: create / update / cancel / generate ──
  if (req.method === 'POST') {
    const { action } = req.body || {};

    // Create session
    if (action === 'create') {
      const { title, description, location, session_date, start_time, end_time, max_capacity } = req.body;
      if (!title || !session_date || !start_time || !end_time) {
        return res.status(400).json({ error: 'title, session_date, start_time, and end_time are required', code: 'VALIDATION_ERROR' });
      }
      if (title.length > 200) return res.status(400).json({ error: 'Title must be at most 200 characters', code: 'VALIDATION_ERROR' });
      if (description && description.length > 2000) return res.status(400).json({ error: 'Description must be at most 2000 characters', code: 'VALIDATION_ERROR' });
      if (location && location.length > 200) return res.status(400).json({ error: 'Location must be at most 200 characters', code: 'VALIDATION_ERROR' });
      if (!DATE_RE.test(session_date)) return res.status(400).json({ error: 'session_date must be YYYY-MM-DD format', code: 'VALIDATION_ERROR' });
      if (!TIME_RE.test(start_time)) return res.status(400).json({ error: 'start_time must be HH:MM format', code: 'VALIDATION_ERROR' });
      if (!TIME_RE.test(end_time)) return res.status(400).json({ error: 'end_time must be HH:MM format', code: 'VALIDATION_ERROR' });
      try {
        const result = await sql`
          INSERT INTO training_sessions (title, description, location, session_date, start_time, end_time, max_capacity)
          VALUES (${title}, ${description || null}, ${location || null}, ${session_date}, ${start_time}, ${end_time}, ${max_capacity || null})
          RETURNING id, title, description, location, session_date::text AS session_date, start_time, end_time, max_capacity, is_cancelled, recurring_day, created_at, updated_at
        `;
        console.log('[AUDIT]', { action: 'create_session', resourceId: result[0].id, timestamp: new Date().toISOString() });
        return res.status(201).json({ session: result[0] });
      } catch (err) {
        console.error('Failed to create session:', err);
        return res.status(500).json({ error: 'Failed to create session', code: 'SERVER_ERROR' });
      }
    }

    // Update session
    if (action === 'update') {
      const { id, title, description, location, session_date, start_time, end_time, max_capacity } = req.body;
      if (!id) return res.status(400).json({ error: 'Session id required', code: 'VALIDATION_ERROR' });
      if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid session id format', code: 'VALIDATION_ERROR' });
      if (session_date !== undefined && !DATE_RE.test(session_date)) return res.status(400).json({ error: 'session_date must be YYYY-MM-DD format', code: 'VALIDATION_ERROR' });
      if (start_time !== undefined && !TIME_RE.test(start_time)) return res.status(400).json({ error: 'start_time must be HH:MM format', code: 'VALIDATION_ERROR' });
      if (end_time !== undefined && !TIME_RE.test(end_time)) return res.status(400).json({ error: 'end_time must be HH:MM format', code: 'VALIDATION_ERROR' });
      try {
        const transaction = await leagueTransaction(sql, [
          ...trainingMutationGuards(sql, id, session_date),
          sql`
          UPDATE training_sessions SET
            title = COALESCE(${title !== undefined ? title : null}, title),
            description = COALESCE(${description !== undefined ? description : null}, description),
            location = COALESCE(${location !== undefined ? location : null}, location),
            session_date = COALESCE(${session_date !== undefined ? session_date : null}, session_date),
            start_time = COALESCE(${start_time !== undefined ? start_time : null}, start_time),
            end_time = COALESCE(${end_time !== undefined ? end_time : null}, end_time),
            max_capacity = COALESCE(${max_capacity !== undefined ? max_capacity : null}, max_capacity),
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, title, description, location, session_date::text AS session_date, start_time, end_time, max_capacity, is_cancelled, recurring_day, created_at, updated_at
        `]);
        const result = transaction[transaction.length - 1];
        if (result.length === 0) return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
        console.log('[AUDIT]', { action: 'update_session', resourceId: result[0].id, timestamp: new Date().toISOString() });
        return res.status(200).json({ session: result[0] });
      } catch (err) {
        if (trainingError(err, res)) return;
        console.error('Failed to update session:', err);
        return res.status(500).json({ error: 'Failed to update session', code: 'SERVER_ERROR' });
      }
    }

    // Cancel session
    if (action === 'cancel') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Session id required', code: 'VALIDATION_ERROR' });
      if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid session id format', code: 'VALIDATION_ERROR' });
      try {
        const transaction = await leagueTransaction(sql, [
          ...trainingMutationGuards(sql, id, undefined, true),
          sql`
          UPDATE training_sessions SET is_cancelled = true, updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, title, description, location, session_date::text AS session_date, start_time, end_time, max_capacity, is_cancelled, recurring_day, created_at, updated_at
        `]);
        const result = transaction[transaction.length - 1];
        if (result.length === 0) return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
        console.log('[AUDIT]', { action: 'cancel_session', resourceId: result[0].id, timestamp: new Date().toISOString() });
        return res.status(200).json({ session: result[0] });
      } catch (err) {
        if (trainingError(err, res)) return;
        console.error('Failed to cancel session:', err);
        return res.status(500).json({ error: 'Failed to cancel session', code: 'SERVER_ERROR' });
      }
    }

    // Generate recurring sessions
    if (action === 'generate') {
      const { title, description, location, recurring_day, start_time, end_time, weeks, max_capacity } = req.body;
      if (recurring_day === undefined || !start_time || !end_time || !weeks) {
        return res.status(400).json({ error: 'recurring_day, start_time, end_time, and weeks are required', code: 'VALIDATION_ERROR' });
      }
      const day = parseInt(recurring_day);
      if (isNaN(day) || day < 0 || day > 6) {
        return res.status(400).json({ error: 'recurring_day must be between 0 (Sunday) and 6 (Saturday)', code: 'VALIDATION_ERROR' });
      }
      if (weeks < 1 || weeks > 52) {
        return res.status(400).json({ error: 'weeks must be between 1 and 52', code: 'VALIDATION_ERROR' });
      }
      if (title && title.length > 200) return res.status(400).json({ error: 'Title must be at most 200 characters', code: 'VALIDATION_ERROR' });
      if (description && description.length > 2000) return res.status(400).json({ error: 'Description must be at most 2000 characters', code: 'VALIDATION_ERROR' });
      if (location && location.length > 200) return res.status(400).json({ error: 'Location must be at most 200 characters', code: 'VALIDATION_ERROR' });

      try {
        // Find the next occurrence of the recurring_day (0=Sun..6=Sat)
        const viennaDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
        const todayDay = viennaDate.getDay();
        let daysUntilNext = (day - todayDay + 7) % 7;
        if (daysUntilNext === 0) daysUntilNext = 7; // start from next week

        const sessionTitle = title || (['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] + ' Training');
        const datesToInsert = [];
        for (let w = 0; w < weeks; w++) {
          const d = new Date(viennaDate);
          d.setDate(d.getDate() + daysUntilNext + (w * 7));
          datesToInsert.push(d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }));
        }

        // Batch insert using a single query with generate_series to iterate over a JSON array
        const sessions = await sql`
          INSERT INTO training_sessions (title, description, location, session_date, start_time, end_time, recurring_day, max_capacity)
          SELECT
            ${sessionTitle},
            ${description || null},
            ${location || null},
            d::date,
            ${start_time}::time,
            ${end_time}::time,
            ${day}::int,
            ${max_capacity || null}::int
          FROM unnest(${datesToInsert}::text[]) AS d
          RETURNING id, title, description, location, session_date::text AS session_date, start_time, end_time, max_capacity, is_cancelled, recurring_day, created_at, updated_at
        `;

        console.log('[AUDIT]', { action: 'generate_sessions', resourceId: sessions.map(s => s.id), timestamp: new Date().toISOString() });
        return res.status(201).json({ sessions, count: sessions.length });
      } catch (err) {
        console.error('Failed to generate sessions:', err);
        return res.status(500).json({ error: 'Failed to generate sessions', code: 'SERVER_ERROR' });
      }
    }

    return res.status(400).json({ error: 'Invalid action', code: 'VALIDATION_ERROR' });
  }

  // ── DELETE: remove session ──
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Session id required', code: 'VALIDATION_ERROR' });
    if (!isValidUuid(id)) return res.status(400).json({ error: 'Invalid session id format', code: 'VALIDATION_ERROR' });

    try {
      const transaction = await leagueTransaction(sql, [
        ...trainingMutationGuards(sql, id, undefined, false, true),
        sql`DELETE FROM training_sessions WHERE id = ${id} RETURNING id`,
      ]);
      const result = transaction[transaction.length - 1];
      if (result.length === 0) return res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
      console.log('[AUDIT]', { action: 'delete_session', resourceId: id, timestamp: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (err) {
      if (trainingError(err, res)) return;
      console.error('Failed to delete session:', err);
      return res.status(500).json({ error: 'Failed to delete session', code: 'SERVER_ERROR' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
};
