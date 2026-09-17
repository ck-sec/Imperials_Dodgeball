const { getDb } = require('../lib/db');
const { setCors } = require('../lib/cors');
const { requireJSON } = require('../lib/validation');
const { assert, today } = require('../lib/league');
const {
  dbError, writerLock, sessionLock, leagueTransaction,
} = require('../lib/league-db');
const { scoringIdentity, scoringPermissions } = require('../lib/league-scoring-access');
const {
  validateTimerQuery, validateTimerCommand, timerDefaults, applyTimerCommand, timerView,
} = require('../lib/league-timer');

async function readTimerContext(sql, eventId, matchNumber, userId) {
  const [row] = await sql`
    SELECT NOW() AS server_now,
      to_jsonb(event) AS event,
      to_jsonb(session) AS session,
      CASE WHEN actor.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', actor.id,
        'is_active', actor.is_active,
        'status', actor.status,
        'league_scorekeeper', actor.league_scorekeeper
      ) END AS actor,
      timer.event_id AS timer_event_id, timer.match_number, timer.revision, timer.phase,
      timer.match_default_seconds, timer.set_default_seconds,
      timer.match_remaining_ms, timer.set_remaining_ms,
      timer.started_at, timer.updated_at
    FROM (SELECT 1) seed
    LEFT JOIN league_events event ON event.id = ${eventId}
    LEFT JOIN training_sessions session ON session.id = event.session_id
    LEFT JOIN users actor ON actor.id = ${userId || null}::uuid
    LEFT JOIN league_match_timers timer
      ON timer.event_id = ${eventId} AND timer.match_number = ${matchNumber}
  `;
  return {
    world: {
      events: row.event ? [row.event] : [],
      sessions: row.session ? [row.session] : [],
      users: row.actor ? [row.actor] : [],
    },
    timer: row.timer_event_id ? {
      event_id: row.timer_event_id,
      match_number: row.match_number,
      revision: row.revision,
      phase: row.phase,
      match_default_seconds: row.match_default_seconds,
      set_default_seconds: row.set_default_seconds,
      match_remaining_ms: row.match_remaining_ms,
      set_remaining_ms: row.set_remaining_ms,
      started_at: row.started_at,
      updated_at: row.updated_at,
    } : null,
    now: new Date(row.server_now),
  };
}

module.exports = async (req, res) => {
  setCors(req, res, 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    assert(req.method === 'GET' || requireJSON(req), 'Content-Type must be application/json');
    const input = req.method === 'GET' ? validateTimerQuery(req.query) : validateTimerCommand(req.body);
    const identity = scoringIdentity(req);
    if (req.method === 'POST') assert(identity.is_admin || identity.user_id, 'Authentication required', 401);
    const sql = getDb();
    const context = await readTimerContext(sql, input.event_id, input.match_number, identity.user_id);
    const world = context.world;
    const event = world.events.find(item => item.id === input.event_id);
    const view = timerView(world, input.event_id, input.match_number, identity, context.timer, context.now);
    if (req.method === 'GET') return res.status(200).json(view);

    const permissions = scoringPermissions(world, identity, event, today());
    assert(permissions.is_admin || permissions.is_scorekeeper,
      'Designated Head Ref or admin required', 403);
    assert(view.permissions.can_control,
      'Match timer controls are available only on the published training date', 409);
    const defaults = timerDefaults(event);
    const next = applyTimerCommand(context.timer, defaults, input, context.now);
    const queries = [writerLock(sql), sessionLock(sql, event.session_id)];
    if (!identity.is_admin) {
      queries.push(sql`SELECT id FROM users WHERE id = ${identity.user_id} FOR SHARE`);
      queries.push(sql`SELECT league_assert(EXISTS(SELECT 1 FROM users WHERE id = ${identity.user_id}
        AND is_active = true AND status = 'approved' AND league_scorekeeper = true),
        403, 'Designated Head Ref or admin required')`);
    }
    queries.push(sql`SELECT league_assert(EXISTS(
      SELECT 1 FROM league_events event
      JOIN training_sessions session ON session.id = event.session_id
      WHERE event.id = ${event.id} AND event.status = 'published'
        AND event.cancelled_at IS NULL
        AND event.session_date = session.session_date AND session.is_cancelled = false
        AND event.session_date = (NOW() AT TIME ZONE 'Europe/Vienna')::date
        AND EXTRACT(ISODOW FROM event.session_date) = 4
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(event.schedule->'rounds') round_data,
            jsonb_array_elements(round_data->'matches') match_data
          WHERE (match_data->>'number')::integer = ${input.match_number}
        )
    ), 409, 'Match timer controls are no longer available for this fixture')`);
    queries.push(sql`
      INSERT INTO league_match_timers (
        event_id, match_number, revision, phase,
        match_default_seconds, set_default_seconds,
        match_remaining_ms, set_remaining_ms
      ) VALUES (
        ${event.id}, ${input.match_number}, 0, 'ready',
        ${defaults.match_default_seconds}, ${defaults.set_default_seconds},
        ${defaults.match_default_seconds * 1000}, ${defaults.set_default_seconds * 1000}
      )
      ON CONFLICT (event_id, match_number) DO NOTHING
    `);
    queries.push(sql`SELECT league_assert(EXISTS(
      SELECT 1 FROM league_match_timers
      WHERE event_id = ${event.id} AND match_number = ${input.match_number}
        AND revision = ${input.revision}
    ), 409, 'The timer changed. Reload before trying again.')`);
    queries.push(sql`
      UPDATE league_match_timers SET
        revision = ${next.revision},
        phase = ${next.phase},
        match_default_seconds = ${next.match_default_seconds},
        set_default_seconds = ${next.set_default_seconds},
        match_remaining_ms = ${next.match_remaining_ms},
        set_remaining_ms = ${next.set_remaining_ms},
        started_at = ${next.started_at}::timestamptz,
        updated_at = ${context.now.toISOString()}::timestamptz
      WHERE event_id = ${event.id} AND match_number = ${input.match_number}
    `);
    await leagueTransaction(sql, queries);
    console.log('[AUDIT]', {
      action: `league_timer_${input.action}`,
      event_id: event.id,
      match_number: input.match_number,
    });
    return res.status(200).json({
      success: true,
      ...timerView(world, input.event_id, input.match_number, identity, {
        ...next,
        event_id: event.id,
        match_number: input.match_number,
      }, context.now),
    });
  } catch (error) {
    const known = dbError(error);
    if (known) return res.status(known.status).json({ error: known.message, code: known.code });
    console.error('Match timer request failed:', { code: error.code || 'INTERNAL_ERROR', name: error.name });
    return res.status(500).json({ error: 'Match timer request failed', code: 'SERVER_ERROR' });
  }
};
