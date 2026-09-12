const { randomUUID } = require('crypto');
const {
  LeagueError, assert, today, settings, playerView, balanceTeams, editTeams, scoreEvent,
  rsvpUserIds, leagueIdsForUsers, linkPlan,
  matchData, requireEditableRoster, eventPlacements, buildSchedule,
} = require('./league');
const { MatchError, updateMatchScore } = require('./league-matches');
const { generateTeamNames } = require('./league-team-names');

// A short global writer lock also serializes seed/settings changes with rating corrections.
// Acquire it BEFORE any session row lock; RSVP needs only the session row lock.
function writerLock(sql) {
  return sql`SELECT pg_advisory_xact_lock(782146931)`;
}

function sessionLock(sql, sessionId) {
  return sql`SELECT id FROM training_sessions WHERE id = ${sessionId} FOR UPDATE`;
}

function leagueTransaction(sql, queries) {
  return sql.transaction(queries, { isolationLevel: 'ReadCommitted' });
}

function dbError(error) {
  if (error instanceof LeagueError) return error;
  if (error instanceof MatchError) return new LeagueError(400, error.message);
  if (error.code === 'P0001' && /^LEAGUE_(400|401|403|404|409)$/.test(error.detail || '')) {
    const status = Number(error.detail.slice(7));
    const codes = { 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
    return new LeagueError(status, error.message, codes[status] || 'VALIDATION_ERROR');
  }
  if (['40001', '40P01', '23505', '23503'].includes(error.code)) {
    return new LeagueError(409, 'The league changed concurrently. Reload and try again.', 'CONFLICT');
  }
  return null;
}

async function readWorld(sql) {
  // One SQL statement gives all derived views the same MVCC snapshot.
  const [row] = await sql`
    SELECT jsonb_build_object(
      'seasons', COALESCE((SELECT jsonb_agg(s ORDER BY s.start_date DESC, s.id) FROM league_seasons s), '[]'::jsonb),
      'profiles', COALESCE((SELECT jsonb_agg(p) FROM league_players p), '[]'::jsonb),
      'events', COALESCE((SELECT jsonb_agg(e ORDER BY e.session_date DESC, e.id) FROM league_events e), '[]'::jsonb),
      'results', COALESCE((SELECT jsonb_agg(r ORDER BY r.event_id, r.player_id) FROM league_results r), '[]'::jsonb),
      'users', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'display_name', u.display_name, 'is_active', u.is_active, 'status', u.status))
        FROM users u), '[]'::jsonb),
      'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'session_date', s.session_date, 'start_time', s.start_time,
        'end_time', s.end_time, 'location', s.location, 'is_cancelled', s.is_cancelled) ORDER BY s.session_date, s.start_time, s.id)
        FROM training_sessions s), '[]'::jsonb),
      'attendance', COALESCE((SELECT jsonb_agg(jsonb_build_object('session_id', a.session_id, 'user_id', a.user_id))
        FROM training_attendance a JOIN users u ON u.id = a.user_id
        WHERE a.status = 'attending' AND u.is_active = true AND u.status = 'approved'), '[]'::jsonb)
    ) AS world
  `;
  return row.world;
}

async function syncPlayers(sql) {
  await leagueTransaction(sql, [
    writerLock(sql),
    sql`SELECT id FROM users WHERE is_active = true AND status = 'approved' ORDER BY id FOR SHARE`,
    sql`INSERT INTO league_players (user_id, display_name)
      SELECT id, display_name FROM users WHERE is_active = true AND status = 'approved'
      ON CONFLICT (user_id) DO NOTHING`,
  ]);
}

const ROSTER_SQL = `
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'user_id', p.user_id, 'display_name', p.display_name,
    'gender', p.gender, 'is_rookie', p.is_rookie,
    'initial_rating', COALESCE(p.initial_rating, CASE WHEN p.is_rookie THEN s.rookie_rating ELSE s.default_rating END),
    'rating', ROUND(COALESCE(p.initial_rating, CASE WHEN p.is_rookie THEN s.rookie_rating ELSE s.default_rating END)
      + COALESCE((SELECT SUM(r.rating_delta) FROM league_results r WHERE r.player_id = p.id), 0), 6)
  ) ORDER BY p.id), '[]'::jsonb)
  FROM league_players p CROSS JOIN league_seasons s LEFT JOIN users u ON u.id = p.user_id
  WHERE p.id = ANY($1::uuid[]) AND s.id = $2::uuid AND p.merged_into IS NULL
    AND (p.user_id IS NULL OR (u.is_active = true AND u.status = 'approved'))
`;

function rosterLock(sql, sessionId, playerIds) {
  return sql`
    SELECT u.id FROM users u
    WHERE u.id IN (SELECT user_id FROM training_attendance WHERE session_id = ${sessionId})
      OR u.id IN (SELECT user_id FROM league_players WHERE id = ANY(${playerIds}::uuid[]))
    ORDER BY u.id FOR SHARE
  `;
}

function attendanceGuard(sql, sessionId, expected) {
  return sql`SELECT league_assert(
    ${JSON.stringify(expected)}::jsonb =
    (SELECT COALESCE(jsonb_agg(a.user_id ORDER BY a.user_id), '[]'::jsonb)
      FROM training_attendance a JOIN users u ON u.id = a.user_id
      WHERE a.session_id = ${sessionId} AND a.status = 'attending'
        AND u.is_active = true AND u.status = 'approved'),
    409, 'Eligible attendance changed. Regenerate the draft with the desired roster before publishing.')`;
}

function selectedPlayersGuard(sql, playerIds) {
  return sql`SELECT league_assert(
    (SELECT COUNT(*) FROM league_players p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ANY(${playerIds}::uuid[]) AND p.merged_into IS NULL
        AND (p.user_id IS NULL OR (u.is_active = true AND u.status = 'approved'))) = ${playerIds.length},
    409, 'A selected player was merged or is no longer eligible. Reload and regenerate.')`;
}

function eventGuard(sql, id, version, statuses) {
  return [
    sql`SELECT league_assert(EXISTS(SELECT 1 FROM league_events WHERE id = ${id}), 404, 'League event not found')`,
    sql`SELECT league_assert(EXISTS(
      SELECT 1 FROM league_events WHERE id = ${id} AND version = ${version}
        AND status = ANY(${statuses}::text[])
    ), 409, 'The event changed or this action is not allowed in its current state. Reload first.')`,
  ];
}

function seasonGuard(sql, id) {
  return sql`SELECT league_assert(EXISTS(SELECT 1 FROM league_seasons WHERE id = ${id}), 404, 'Season not found')`;
}

function sessionGuard(sql, sessionId, seasonId, sessionDate) {
  return [
    sql`SELECT league_assert(EXISTS(SELECT 1 FROM training_sessions WHERE id = ${sessionId}), 404, 'Training session not found')`,
    sql`SELECT league_assert(EXISTS(
      SELECT 1 FROM training_sessions t JOIN league_seasons s ON s.id = ${seasonId}
      WHERE t.id = ${sessionId} AND t.is_cancelled = false
        AND t.session_date BETWEEN s.start_date AND s.end_date AND t.session_date = ${sessionDate}::date
    ), 409, 'Session cancelled, moved, or outside the season. Correct the session and regenerate its draft.')`,
  ];
}

async function applyAction(sql, input, world) {
  if (input.action === 'save_season') {
    const id = input.id || randomUUID();
    const queries = [writerLock(sql)];
    if (input.id) {
      queries.push(seasonGuard(sql, id));
      queries.push(sql`SELECT league_assert(NOT EXISTS(
        SELECT 1 FROM league_events e JOIN training_sessions t ON t.id = e.session_id
        WHERE e.season_id = ${id} AND (
          t.session_date NOT BETWEEN ${input.start_date}::date AND ${input.end_date}::date
          OR e.session_date NOT BETWEEN ${input.start_date}::date AND ${input.end_date}::date)
      ), 409, 'Season dates cannot exclude assigned training events')`);
      queries.push(sql`
        UPDATE league_seasons SET name = ${input.name}, start_date = ${input.start_date}, end_date = ${input.end_date},
          placement_points = ${JSON.stringify(input.placement_points)}::jsonb, k_factor = ${input.k_factor},
          scoring_mode = ${input.scoring_mode}, points_step = ${input.points_step},
          default_rating = ${input.default_rating}, rookie_rating = ${input.rookie_rating}, updated_at = NOW()
        WHERE id = ${id}
      `);
    } else {
      queries.push(sql`
        INSERT INTO league_seasons (id, name, start_date, end_date, placement_points, k_factor, default_rating, rookie_rating, scoring_mode, points_step)
        VALUES (${id}, ${input.name}, ${input.start_date}, ${input.end_date}, ${JSON.stringify(input.placement_points)}::jsonb,
          ${input.k_factor}, ${input.default_rating}, ${input.rookie_rating}, ${input.scoring_mode}, ${input.points_step})
      `);
    }
    await leagueTransaction(sql, queries);
    return { season_id: id };
  }
  if (input.action === 'save_player') {
    const existing = input.player_id ? world.profiles.find(p => p.id === input.player_id && !p.merged_into)
      : input.user_id ? world.profiles.find(p => p.user_id === input.user_id && !p.merged_into) : null;
    assert(!input.player_id || existing, 'League player not found', 404);
    const userId = existing ? existing.user_id : input.user_id || null;
    assert(!existing || input.user_id === undefined || input.user_id === existing.user_id,
      'Use link_player to associate an account; unlinking is not supported', 409);
    const member = userId ? world.users.find(u => u.id === userId && u.is_active && u.status === 'approved') : null;
    assert(!userId || member, 'Approved active player not found', 404);
    const id = existing ? existing.id : randomUUID();
    const name = input.display_name || (existing ? existing.display_name : member ? member.display_name : null);
    assert(name, 'Guest display_name is required');
    const queries = [writerLock(sql)];
    if (userId) {
      queries.push(sql`SELECT id FROM users WHERE id = ${userId} FOR SHARE`);
      queries.push(sql`SELECT league_assert(EXISTS(SELECT 1 FROM users WHERE id = ${userId}
        AND is_active = true AND status = 'approved'), 404, 'Approved active player not found')`);
    }
    if (existing) {
      queries.push(sql`SELECT league_assert(EXISTS(SELECT 1 FROM league_players WHERE id = ${id}
        AND merged_into IS NULL AND user_id IS NOT DISTINCT FROM ${userId}::uuid),
        409, 'Player account link changed. Reload first.')`);
      queries.push(sql`UPDATE league_players SET display_name = ${name}, gender = ${input.gender},
        is_rookie = ${input.is_rookie}, initial_rating = ${input.initial_rating}, updated_at = NOW() WHERE id = ${id}`);
    } else {
      queries.push(sql`INSERT INTO league_players (id, user_id, display_name, gender, is_rookie, initial_rating)
        VALUES (${id}, ${userId}, ${name}, ${input.gender}, ${input.is_rookie}, ${input.initial_rating})`);
    }
    await leagueTransaction(sql, queries);
    return { player_id: id };
  }
  if (input.action === 'link_player') {
    const { target, source } = linkPlan(world, input.player_id, input.user_id);
    const queries = [writerLock(sql),
      sql`SELECT id FROM users WHERE id = ${input.user_id} FOR SHARE`,
      sql`SELECT league_assert(EXISTS(SELECT 1 FROM users WHERE id = ${input.user_id}
        AND is_active = true AND status = 'approved'), 404, 'Approved active member not found')`,
      sql`SELECT league_assert(EXISTS(SELECT 1 FROM league_players WHERE id = ${target.id} AND merged_into IS NULL
        AND (user_id IS NULL OR user_id = ${input.user_id})), 409, 'Player account link changed. Reload first.')`,
      sql`SELECT league_assert((SELECT id FROM league_players WHERE user_id = ${input.user_id} AND merged_into IS NULL)
        IS NOT DISTINCT FROM ${source ? source.id : null}::uuid, 409, 'Account player changed. Reload first.')`,
    ];
    if (source && source.id !== target.id) {
      queries.push(sql`SELECT league_assert(NOT EXISTS(
        SELECT 1 FROM league_events WHERE roster_ids @> ${JSON.stringify([source.id])}::jsonb
          AND roster_ids @> ${JSON.stringify([target.id])}::jsonb
      ) AND NOT EXISTS(
        SELECT 1 FROM league_results a JOIN league_results b ON a.event_id = b.event_id
        WHERE a.player_id = ${source.id} AND b.player_id = ${target.id}
      ), 409, 'Both identities appear in the same event. Resolve the duplicate roster before linking.')`);
      queries.push(sql`UPDATE league_results SET player_id = ${target.id} WHERE player_id = ${source.id}`);
      // Identity reconciliation changes IDs only: frozen names, ratings and placements remain intact.
      queries.push(sql`UPDATE league_events e SET
        teams = (SELECT jsonb_agg(jsonb_set(t.team, '{players}',
          (SELECT jsonb_agg(CASE WHEN p.player->>'id' = ${source.id}::text
            THEN jsonb_set(p.player, '{id}', to_jsonb(${target.id}::text)) ELSE p.player END ORDER BY p.ord)
           FROM jsonb_array_elements(t.team->'players') WITH ORDINALITY AS p(player, ord))) ORDER BY t.ord)
          FROM jsonb_array_elements(e.teams) WITH ORDINALITY AS t(team, ord)),
        roster_ids = (SELECT jsonb_agg(mapped.id ORDER BY mapped.id) FROM (
          SELECT CASE WHEN value = to_jsonb(${source.id}::text) THEN to_jsonb(${target.id}::text) ELSE value END AS id
          FROM jsonb_array_elements(e.roster_ids)) mapped),
        version = version + 1, updated_at = NOW()
        WHERE e.roster_ids @> ${JSON.stringify([source.id])}::jsonb`);
      queries.push(sql`UPDATE league_players SET user_id = NULL, merged_into = ${target.id}, updated_at = NOW()
        WHERE id = ${source.id}`);
    }
    queries.push(sql`UPDATE league_players SET user_id = ${input.user_id}, updated_at = NOW() WHERE id = ${target.id}`);
    await leagueTransaction(sql, queries);
    return { player_id: target.id };
  }
  if (input.action === 'generate') {
    const season = world.seasons.find(s => s.id === input.season_id);
    const session = world.sessions.find(s => s.id === input.session_id);
    assert(season, 'Season not found', 404);
    assert(session, 'Training session not found', 404);
    assert(!session.is_cancelled && session.session_date >= season.start_date && session.session_date <= season.end_date,
      'Session must be active and inside the season', 409);
    const oldEvent = world.events.find(e => e.session_id === input.session_id);
    if (oldEvent) {
      assert(oldEvent.status === 'draft' && oldEvent.version === input.version,
        'Only drafts can be regenerated, using their current version', 409);
      assert(oldEvent.season_id === input.season_id, 'A session already belongs to another season', 409);
      requireEditableRoster(oldEvent);
    } else {
      assert(input.version === undefined, 'Event no longer exists. Reload first.', 409);
    }
    const rsvpIds = rsvpUserIds(world, session.id);
    const selectedIds = input.player_ids ? [...input.player_ids].sort() : leagueIdsForUsers(world, rsvpIds);
    const players = playerView(world, season).filter(p => selectedIds.includes(p.id)).sort((a, b) => a.id.localeCompare(b.id));
    assert(players.length === selectedIds.length, 'Unknown, merged, or inactive player in the roster', 400);
    const generated = balanceTeams(players.map(({ user_id, ...player }) => player), input.team_size, input.max_teams);
    const names = generateTeamNames(generated.teams.length);
    generated.teams.forEach((team, index) => { team.name = names[index]; });
    const frozenSettings = settings(season);
    const id = oldEvent ? oldEvent.id : randomUUID();
    const queries = [writerLock(sql), sessionLock(sql, input.session_id), rosterLock(sql, input.session_id, selectedIds),
      seasonGuard(sql, season.id), ...sessionGuard(sql, session.id, season.id, session.session_date)];
    if (oldEvent) queries.push(...eventGuard(sql, id, input.version, ['draft']));
    else queries.push(sql`SELECT league_assert(NOT EXISTS(
      SELECT 1 FROM league_events WHERE session_id = ${input.session_id}
    ), 409, 'An event was already generated for this session. Reload first.')`);
    queries.push(sql`SELECT league_assert(EXISTS(
      SELECT 1 FROM league_seasons WHERE id = ${season.id} AND jsonb_build_object(
        'placement_points', placement_points, 'k_factor', k_factor,
        'scoring_mode', scoring_mode, 'points_step', points_step,
        'default_rating', default_rating, 'rookie_rating', rookie_rating
      ) = ${JSON.stringify(frozenSettings)}::jsonb
    ), 409, 'Season settings changed. Generate again.')`);
    queries.push(sql.query(`SELECT league_assert((${ROSTER_SQL}) = $3::jsonb, 409,
      'Attendees or player ratings changed. Generate again.')`,
    [selectedIds, season.id, JSON.stringify(players)]));
    queries.push(attendanceGuard(sql, session.id, rsvpIds));
    queries.push(sql`UPDATE league_players p SET initial_rating = (snapshot->>'initial_rating')::numeric, updated_at = NOW()
      FROM jsonb_array_elements(${JSON.stringify(players)}::jsonb) snapshot
      WHERE p.id = (snapshot->>'id')::uuid AND p.initial_rating IS NULL`);
    if (oldEvent) {
      queries.push(sql`UPDATE league_events SET team_size = ${generated.team_size},
        max_teams = ${generated.max_teams}, schedule = NULL,
        teams = ${JSON.stringify(generated.teams)}::jsonb, settings = ${JSON.stringify(frozenSettings)}::jsonb,
        roster_ids = ${JSON.stringify(players.map(p => p.id))}::jsonb, session_date = ${session.session_date}::date,
        rsvp_user_ids = ${JSON.stringify(rsvpIds)}::jsonb, roster_source = ${input.player_ids ? 'manual' : 'rsvp'},
        version = version + 1, updated_at = NOW() WHERE id = ${id}`);
    } else {
      queries.push(sql`INSERT INTO league_events (id, season_id, session_id, team_size, teams, settings, roster_ids, session_date, rsvp_user_ids, roster_source, max_teams)
        VALUES (${id}, ${season.id}, ${session.id}, ${generated.team_size}, ${JSON.stringify(generated.teams)}::jsonb,
          ${JSON.stringify(frozenSettings)}::jsonb, ${JSON.stringify(players.map(p => p.id))}::jsonb, ${session.session_date}::date,
          ${JSON.stringify(rsvpIds)}::jsonb, ${input.player_ids ? 'manual' : 'rsvp'}, ${generated.max_teams})`);
    }
    await leagueTransaction(sql, queries);
    return { event_id: id };
  }

  const event = world.events.find(e => e.id === input.event_id);
  assert(event, 'League event not found', 404);
  assert(event.version === input.version, 'The event changed. Reload first.', 409);
  const queries = [writerLock(sql), sessionLock(sql, event.session_id)];
  if (input.action === 'save_teams') {
    assert(event.status === 'draft', 'Only draft teams may be edited', 409);
    requireEditableRoster(event);
    const teams = editTeams(event, input.teams);
    queries.push(...eventGuard(sql, event.id, input.version, ['draft']));
    queries.push(sql`UPDATE league_events SET teams = ${JSON.stringify(teams)}::jsonb, schedule = NULL,
      version = version + 1, updated_at = NOW() WHERE id = ${event.id}`);
  } else if (input.action === 'publish') {
    requireEditableRoster(event);
    queries.push(rosterLock(sql, event.session_id, event.roster_ids));
    queries.push(...eventGuard(sql, event.id, input.version, ['draft']));
    queries.push(...sessionGuard(sql, event.session_id, event.season_id, event.session_date));
    queries.push(attendanceGuard(sql, event.session_id, event.rsvp_user_ids));
    queries.push(selectedPlayersGuard(sql, event.roster_ids));
    queries.push(sql`UPDATE league_events SET status = 'published', version = version + 1,
      updated_at = NOW() WHERE id = ${event.id}`);
  } else if (input.action === 'unpublish') {
    requireEditableRoster(event);
    queries.push(...eventGuard(sql, event.id, input.version, ['published']));
    queries.push(sql`UPDATE league_events SET status = 'draft', version = version + 1,
      updated_at = NOW() WHERE id = ${event.id}`);
  } else if (input.action === 'generate_schedule') {
    assert(event.status === 'draft', 'Generate schedules only for draft events', 409);
    requireEditableRoster(event);
    const schedule = buildSchedule(event.teams.length, input);
    matchData({ ...event, schedule });
    queries.push(...eventGuard(sql, event.id, input.version, ['draft']));
    queries.push(...sessionGuard(sql, event.session_id, event.season_id, event.session_date));
    queries.push(sql`UPDATE league_events SET schedule = ${JSON.stringify(schedule)}::jsonb,
      version = version + 1, updated_at = NOW() WHERE id = ${event.id}`);
  } else if (input.action === 'save_match') {
    assert(event.status === 'published', 'Match scores can only be edited while published. Reopen finalized results first.', 409);
    assert(event.session_date <= today(), 'Match scores cannot be entered before the training date', 409);
    const current = matchData(event);
    assert(current.schedule, 'Generate and publish a schedule before entering match scores', 409);
    const schedule = updateMatchScore(event.teams.length, current.schedule, input.match_number, input.score_a, input.score_b);
    matchData({ ...event, schedule });
    queries.push(...eventGuard(sql, event.id, input.version, ['published']));
    queries.push(...sessionGuard(sql, event.session_id, event.season_id, event.session_date));
    queries.push(sql`SELECT league_assert(
      (SELECT session_date <= (NOW() AT TIME ZONE 'Europe/Vienna')::date FROM league_events WHERE id = ${event.id}),
      409, 'Match scores cannot be entered before the training date')`);
    queries.push(sql`UPDATE league_events SET schedule = ${JSON.stringify(schedule)}::jsonb, roster_locked = true,
      version = version + 1, updated_at = NOW() WHERE id = ${event.id}`);
  } else if (input.action === 'reopen_results') {
    assert(event.status === 'finalized', 'Only finalized results can be reopened', 409);
    const teams = event.teams.map(t => ({ ...t, placement: null }));
    queries.push(...eventGuard(sql, event.id, input.version, ['finalized']));
    queries.push(sql`DELETE FROM league_results WHERE event_id = ${event.id}`);
    queries.push(sql`UPDATE league_events SET teams = ${JSON.stringify(teams)}::jsonb,
      status = 'published', roster_locked = true, version = version + 1, updated_at = NOW() WHERE id = ${event.id}`);
  } else if (input.action === 'results') {
    assert(['published', 'finalized'].includes(event.status), 'Publish the event before entering results', 409);
    assert(event.session_date <= today(), 'Results cannot be entered before the training date', 409);
    const scored = scoreEvent(event, eventPlacements(event, input.placements));
    queries.push(...eventGuard(sql, event.id, input.version, ['published', 'finalized']));
    queries.push(...sessionGuard(sql, event.session_id, event.season_id, event.session_date));
    queries.push(sql`SELECT league_assert(
      (SELECT session_date <= (NOW() AT TIME ZONE 'Europe/Vienna')::date FROM league_events WHERE id = ${event.id}),
      409, 'Results cannot be entered before the training date')`);
    // Delete and insert share a transaction: corrections replace, rather than accumulate, both ledgers.
    queries.push(sql`DELETE FROM league_results WHERE event_id = ${event.id}`);
    queries.push(sql`INSERT INTO league_results (event_id, player_id, display_name, team_number, placement, points, rating_delta)
      SELECT ${event.id}::uuid, r.player_id, r.display_name, r.team_number, r.placement, r.points, r.rating_delta
      FROM jsonb_to_recordset(${JSON.stringify(scored.ledger)}::jsonb) AS r(
        player_id uuid, display_name text, team_number integer, placement integer, points numeric, rating_delta numeric)`);
    queries.push(sql`UPDATE league_events SET teams = ${JSON.stringify(scored.teams)}::jsonb,
      status = 'finalized', roster_locked = true, version = version + 1, updated_at = NOW() WHERE id = ${event.id}`);
  }
  await leagueTransaction(sql, queries);
  return { event_id: event.id };
}

function trainingError(error, res) {
  const known = dbError(error);
  if (!known) return false;
  res.status(known.status).json({ error: known.message, code: known.code });
  return true;
}

function trainingMutationGuards(sql, sessionId, nextDate, cancelling = false, deleting = false) {
  const queries = [writerLock(sql), sessionLock(sql, sessionId)];
  queries.push(sql`SELECT league_assert(EXISTS(SELECT 1 FROM training_sessions WHERE id = ${sessionId}),
    404, 'Training session not found')`);
  if (deleting) {
    queries.push(sql`SELECT league_assert(NOT EXISTS(SELECT 1 FROM league_events WHERE session_id = ${sessionId}),
      409, 'This training belongs to a league event and cannot be deleted. Its season history must be retained.')`);
  } else if (cancelling || nextDate !== undefined) {
    queries.push(sql`SELECT league_assert(NOT EXISTS(
      SELECT 1 FROM league_events e JOIN training_sessions t ON t.id = e.session_id
      WHERE e.session_id = ${sessionId} AND e.status IN ('published', 'finalized')
        AND (${cancelling}::boolean OR t.session_date <> COALESCE(${nextDate || null}::date, t.session_date))
    ), 409, 'Published league training cannot be cancelled or moved. Unpublish it first; finalized history is locked.')`);
    if (nextDate !== undefined) {
      queries.push(sql`SELECT league_assert(NOT EXISTS(
        SELECT 1 FROM league_events e JOIN league_seasons s ON s.id = e.season_id
        WHERE e.session_id = ${sessionId} AND ${nextDate}::date NOT BETWEEN s.start_date AND s.end_date
      ), 409, 'The training date must remain inside its assigned league season')`);
    }
  }
  return queries;
}

module.exports = {
  readWorld, syncPlayers, applyAction, dbError, writerLock, sessionLock, leagueTransaction, trainingError, trainingMutationGuards,
};
