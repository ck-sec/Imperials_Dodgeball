const { assert, uuid, publicEvent, matchData, today } = require('./league');
const { scoringPermissions, isThursday } = require('./league-scoring-access');

const MAX_TIMER_SECONDS = 99 * 60 + 59;
const MAX_TIMER_MILLISECONDS = MAX_TIMER_SECONDS * 1000;
const TIMER_PHASES = new Set(['ready', 'running', 'paused']);
const TIMER_ACTIONS = new Set(['start', 'pause', 'adjust', 'reset', 'configure']);

function integer(value, label, minimum, maximum) {
  assert(Number.isInteger(value) && value >= minimum && value <= maximum,
    `${label} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

function matchNumber(value) {
  const parsed = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  return integer(parsed, 'match_number', 1, 10);
}

function validateTimerQuery(query = {}) {
  return {
    event_id: uuid(query.event_id, 'event_id'),
    match_number: matchNumber(query.match_number),
  };
}

function validateTimerCommand(body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 'JSON object required');
  assert(TIMER_ACTIONS.has(body.action), 'Invalid timer action');
  const input = {
    action: body.action,
    event_id: uuid(body.event_id, 'event_id'),
    match_number: matchNumber(body.match_number),
    revision: integer(body.revision, 'revision', 0, 2147483646),
  };
  if (body.action === 'adjust') {
    assert(['match', 'set'].includes(body.clock), 'clock must be match or set');
    assert([-60, -5, 5, 60].includes(body.delta_seconds), 'delta_seconds must be -60, -5, 5 or 60');
    input.clock = body.clock;
    input.delta_seconds = body.delta_seconds;
  }
  if (body.action === 'reset') {
    assert(['match', 'set'].includes(body.clock), 'clock must be match or set');
    input.clock = body.clock;
  }
  if (body.action === 'configure') {
    const configuresOneClock = Object.hasOwn(body, 'clock') || Object.hasOwn(body, 'default_seconds');
    if (configuresOneClock) {
      assert(['match', 'set'].includes(body.clock), 'clock must be match or set');
      assert(!Object.hasOwn(body, 'match_default_seconds') && !Object.hasOwn(body, 'set_default_seconds'),
        'Configure one clock at a time');
      input.clock = body.clock;
      input.default_seconds = integer(body.default_seconds, 'default_seconds', 0, MAX_TIMER_SECONDS);
    } else {
      input.match_default_seconds = integer(body.match_default_seconds, 'match_default_seconds', 0, MAX_TIMER_SECONDS);
      input.set_default_seconds = integer(body.set_default_seconds, 'set_default_seconds', 0, MAX_TIMER_SECONDS);
    }
  }
  return input;
}

function timerDefaults(event) {
  const { schedule } = matchData(event);
  assert(schedule, 'Generate and publish a schedule before opening a match timer', 409);
  return { match_default_seconds: schedule.match_minutes * 60, set_default_seconds: 3 * 60 };
}

function asDate(value, label) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error(`Stored timer ${label} is invalid`);
  return result;
}

function timerRecord(row, defaults) {
  if (!row) {
    return {
      revision: 0,
      phase: 'ready',
      match_default_seconds: defaults.match_default_seconds,
      set_default_seconds: defaults.set_default_seconds,
      match_remaining_ms: defaults.match_default_seconds * 1000,
      set_remaining_ms: defaults.set_default_seconds * 1000,
      started_at: null,
      updated_at: null,
    };
  }
  const record = {
    revision: Number(row.revision),
    phase: row.phase,
    match_default_seconds: Number(row.match_default_seconds),
    set_default_seconds: Number(row.set_default_seconds),
    match_remaining_ms: Number(row.match_remaining_ms),
    set_remaining_ms: Number(row.set_remaining_ms),
    started_at: row.started_at,
    updated_at: row.updated_at,
  };
  if (!Number.isInteger(record.revision) || record.revision < 0 || !TIMER_PHASES.has(record.phase)
    || !Number.isInteger(record.match_default_seconds) || record.match_default_seconds < 0
    || record.match_default_seconds > MAX_TIMER_SECONDS
    || !Number.isInteger(record.set_default_seconds) || record.set_default_seconds < 0
    || record.set_default_seconds > MAX_TIMER_SECONDS
    || !Number.isInteger(record.match_remaining_ms) || record.match_remaining_ms < 0
    || record.match_remaining_ms > MAX_TIMER_MILLISECONDS
    || !Number.isInteger(record.set_remaining_ms) || record.set_remaining_ms < 0
    || record.set_remaining_ms > MAX_TIMER_MILLISECONDS
    || (record.phase === 'running') !== Boolean(record.started_at)) {
    throw new Error('Stored timer state is invalid');
  }
  return record;
}

function statusFor(phase, matchMs, setMs) {
  if (matchMs === 0 && setMs === 0) return 'expired';
  if (matchMs === 0) return 'match_expired';
  if (setMs === 0) return 'set_expired';
  if (phase === 'ready') return 'ready';
  return phase === 'running' ? 'live' : 'paused';
}

function timerSnapshot(row, defaults, now = new Date()) {
  const at = asDate(now, 'timestamp');
  const record = timerRecord(row, defaults);
  let elapsedMs = 0;
  if (record.phase === 'running') {
    const started = asDate(record.started_at, 'start timestamp');
    elapsedMs = Math.max(0, at.getTime() - started.getTime());
  }
  const matchRemainingMs = Math.max(0, record.match_remaining_ms - elapsedMs);
  const setRemainingMs = Math.max(0, record.set_remaining_ms - elapsedMs);
  const phase = record.phase === 'running' && matchRemainingMs === 0 && setRemainingMs === 0
    ? 'paused' : record.phase;
  return {
    revision: record.revision,
    phase,
    status: statusFor(record.phase, matchRemainingMs, setRemainingMs),
    match_default_seconds: record.match_default_seconds,
    set_default_seconds: record.set_default_seconds,
    match_remaining_seconds: Math.ceil(matchRemainingMs / 1000),
    set_remaining_seconds: Math.ceil(setRemainingMs / 1000),
    match_remaining_ms: Math.ceil(matchRemainingMs),
    set_remaining_ms: Math.ceil(setRemainingMs),
    started_at: phase === 'running' ? at.toISOString() : null,
    updated_at: record.updated_at ? asDate(record.updated_at, 'update timestamp').toISOString() : null,
    as_of: at.toISOString(),
  };
}

function applyTimerCommand(row, defaults, input, now = new Date()) {
  const at = asDate(now, 'timestamp');
  const current = timerSnapshot(row, defaults, at);
  assert(current.revision === input.revision, 'The timer changed. Reload before trying again.', 409);
  let phase = current.phase;
  let matchDefault = current.match_default_seconds;
  let setDefault = current.set_default_seconds;
  let matchRemainingMs = current.match_remaining_ms;
  let setRemainingMs = current.set_remaining_ms;

  if (input.action === 'start') {
    assert(phase !== 'running', 'The timer is already running', 409);
    assert(matchRemainingMs > 0 || setRemainingMs > 0, 'Reset a clock before starting the timer', 409);
    phase = 'running';
  } else if (input.action === 'pause') {
    assert(phase === 'running', 'The timer is not running', 409);
    phase = 'paused';
  } else if (input.action === 'adjust') {
    if (input.clock === 'match') {
      matchRemainingMs = Math.max(0, Math.min(MAX_TIMER_MILLISECONDS,
        matchRemainingMs + input.delta_seconds * 1000));
    } else {
      setRemainingMs = Math.max(0, Math.min(MAX_TIMER_MILLISECONDS,
        setRemainingMs + input.delta_seconds * 1000));
    }
  } else if (input.action === 'reset') {
    if (input.clock === 'match') matchRemainingMs = matchDefault * 1000;
    else setRemainingMs = setDefault * 1000;
  } else if (input.action === 'configure') {
    if (input.clock === 'match') {
      matchDefault = input.default_seconds;
      if (phase !== 'running') matchRemainingMs = matchDefault * 1000;
    } else if (input.clock === 'set') {
      setDefault = input.default_seconds;
      if (phase !== 'running') setRemainingMs = setDefault * 1000;
    } else {
      matchDefault = input.match_default_seconds;
      setDefault = input.set_default_seconds;
      if (phase !== 'running') {
        matchRemainingMs = matchDefault * 1000;
        setRemainingMs = setDefault * 1000;
      }
    }
  }

  if (phase === 'running' && matchRemainingMs === 0 && setRemainingMs === 0) phase = 'paused';
  const next = {
    revision: current.revision + 1,
    phase,
    match_default_seconds: matchDefault,
    set_default_seconds: setDefault,
    match_remaining_ms: Math.ceil(matchRemainingMs),
    set_remaining_ms: Math.ceil(setRemainingMs),
    started_at: phase === 'running' ? at.toISOString() : null,
    updated_at: at.toISOString(),
  };
  return timerSnapshot(next, defaults, at);
}

function timerView(world, eventId, requestedMatch, identity = {}, row, now = new Date(), dateNow = today()) {
  const event = world.events.find(item => item.id === eventId);
  assert(event && ['published', 'finalized'].includes(event.status), 'Published match not found', 404);
  const session = world.sessions.find(item => item.id === event.session_id);
  assert(session && !session.is_cancelled && session.session_date === event.session_date
    && isThursday(session.session_date), 'Published match not found', 404);
  const visible = publicEvent(event, session);
  const round = visible.schedule && visible.schedule.rounds.find(item =>
    item.matches.some(match => match.number === requestedMatch));
  const match = round && round.matches.find(item => item.number === requestedMatch);
  assert(match, 'Match not found', 404);
  const names = new Map(visible.teams.map(team => [team.number, team]));
  const permissions = scoringPermissions(world, identity, event, dateNow);
  const canControl = Boolean((permissions.is_admin || permissions.is_scorekeeper)
    && permissions.can_score && event.session_date === dateNow);
  return {
    event: {
      id: visible.id,
      version: visible.version,
      title: visible.title,
      session_date: visible.session_date,
      start_time: visible.start_time,
      end_time: visible.end_time,
      location: visible.location,
      status: visible.status,
    },
    match: {
      number: match.number,
      court: match.court,
      round_number: round.number,
      start_minute: round.start_minute,
      end_minute: round.end_minute,
      score_a: match.score_a,
      score_b: match.score_b,
      team_a: names.get(match.team_a),
      team_b: names.get(match.team_b),
      referee_team: round.referee_team ? names.get(round.referee_team) : null,
    },
    timer: timerSnapshot(row, timerDefaults(event), now),
    permissions: {
      is_admin: permissions.is_admin,
      is_scorekeeper: permissions.is_scorekeeper,
      signed_in: permissions.is_admin || Boolean(identity.user_id),
      can_control: canControl,
    },
  };
}

module.exports = {
  MAX_TIMER_SECONDS,
  MAX_TIMER_MILLISECONDS,
  validateTimerQuery,
  validateTimerCommand,
  timerDefaults,
  timerSnapshot,
  applyTimerCommand,
  timerView,
};
