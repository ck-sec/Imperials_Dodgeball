const CALENDAR_CONFIG = require('../data/season-2-calendar.json');

class CalendarError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalendarError';
  }
}

function requireValid(condition, message) {
  if (!condition) throw new CalendarError(message);
}

function dateValue(value) {
  requireValid(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Expected an ISO calendar date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  requireValid(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value,
    `Invalid calendar date: ${value}`);
  return date;
}

function timeValue(value) {
  requireValid(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value),
    'Expected a local training time.');
  const [hours, minutes, seconds = '0'] = value.split(':');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function buildCalendar(config = CALENDAR_CONFIG) {
  const start = dateValue(config.start_date);
  const end = dateValue(config.end_date);
  requireValid(start <= end && end - start <= 366 * 86400000, 'Calendar must cover at most one year, in ascending order.');
  requireValid(config.timezone === 'Europe/Vienna', 'Training times must use Europe/Vienna.');
  requireValid(Array.isArray(config.slots) && config.slots.length > 0, 'At least one weekly slot is required.');
  const ids = new Set();
  for (const slot of config.slots) {
    requireValid(typeof slot.id === 'string' && slot.id && !ids.has(slot.id), 'Weekly slot IDs must be nonempty and unique.');
    ids.add(slot.id);
    requireValid(Number.isInteger(slot.recurring_day) && slot.recurring_day >= 0 && slot.recurring_day <= 6,
      'recurring_day must be 0 (Sunday) through 6 (Saturday).');
    requireValid(typeof slot.title === 'string' && slot.title.trim() && slot.title.length <= 200
      && typeof slot.location === 'string' && slot.location.trim() && slot.location.length <= 200,
    'Every slot requires a title and location of at most 200 characters.');
    requireValid(timeValue(slot.start_time) < timeValue(slot.end_time), 'Training must end after it starts on the same day.');
  }
  for (const a of config.slots) {
    for (const b of config.slots) {
      if (a === b || a.recurring_day !== b.recurring_day) continue;
      requireValid(!relatedSessions({ ...a, session_date: '' }, { ...b, session_date: '' }),
        `Weekly slots conflict: ${a.id} / ${b.id}`);
    }
  }
  const exclusions = [
    ...config.school_holidays.map(day => ({ ...day, kind: 'school_holiday' })),
    ...config.public_holidays.map(day => ({ ...day, start_date: day.date, end_date: day.date, kind: 'public_holiday' })),
    ...config.school_free_days.map(day => ({ ...day, start_date: day.date, end_date: day.date, kind: 'school_free_day' })),
  ];
  for (const exclusion of exclusions) {
    requireValid(dateValue(exclusion.start_date) <= dateValue(exclusion.end_date), 'Holiday dates must be in ascending order.');
    requireValid(exclusion.name && Array.isArray(exclusion.sources) && exclusion.sources.length > 0
      && exclusion.sources.every(source => config.sources[source]?.url?.startsWith('https://')),
    'Every holiday must cite a verified source in the calendar configuration.');
  }

  const sessions = [];
  const skipped = [];
  const bySlot = config.slots.map(slot => ({ slot_id: slot.id, title: slot.title, candidates: 0, included: 0, excluded: 0 }));
  // UTC is used only to enumerate civil dates; TIME columns retain Vienna wall-clock hours across DST.
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const sessionDate = date.toISOString().slice(0, 10);
    const reasons = exclusions.filter(day => day.start_date <= sessionDate && sessionDate <= day.end_date)
      .map(({ name, kind, sources }) => ({ name, kind, sources }));
    config.slots.forEach((slot, index) => {
      if (date.getUTCDay() !== slot.recurring_day) return;
      const session = {
        title: slot.title, description: null, location: slot.location, session_date: sessionDate,
        start_time: slot.start_time, end_time: slot.end_time, recurring_day: slot.recurring_day,
        max_capacity: null, is_cancelled: false,
      };
      bySlot[index].candidates++;
      if (reasons.length) {
        skipped.push({ slot_id: slot.id, session, reasons });
        bySlot[index].excluded++;
      } else {
        sessions.push(session);
        bySlot[index].included++;
      }
    });
  }
  const skippedDates = [...new Set(skipped.map(item => item.session.session_date))].map(date => {
    const items = skipped.filter(item => item.session.session_date === date);
    return { date, sessions: items.length, slot_ids: items.map(item => item.slot_id), reasons: items[0].reasons };
  });
  return {
    season: { ...config.season, start_date: config.start_date, end_date: config.end_date },
    sessions, skipped,
    summary: {
      start_date: config.start_date, end_date: config.end_date, timezone: config.timezone,
      candidates: sessions.length + skipped.length, included: sessions.length, excluded: skipped.length,
      by_slot: bySlot, skipped_dates: skippedDates, notes: config.notes, sources: config.sources,
    },
  };
}

function sameIdentity(a, b) {
  return a.session_date === b.session_date && a.title === b.title && a.location === b.location
    && timeValue(a.start_time) === timeValue(b.start_time) && timeValue(a.end_time) === timeValue(b.end_time);
}

function relatedSessions(a, b) {
  if (a.session_date !== b.session_date) return false;
  const sameTimes = timeValue(a.start_time) === timeValue(b.start_time) && timeValue(a.end_time) === timeValue(b.end_time);
  const overlap = timeValue(a.start_time) < timeValue(b.end_time) && timeValue(b.start_time) < timeValue(a.end_time);
  // Conservatively require review of renamed/moved slots and venue overlaps, including cancelled duplicates.
  return a.title === b.title || sameTimes || (a.location === b.location && overlap);
}

function describe(session) {
  return `${session.session_date} ${session.start_time}-${session.end_time} "${session.title}" at "${session.location}"`;
}

function planExisting(calendar, state) {
  requireValid(state && Array.isArray(state.seasons) && Array.isArray(state.sessions), 'Invalid calendar database snapshot.');
  const target = calendar.season;
  const seasonName = name => String(name).toLowerCase().replace(/\s+/g, '');
  const candidates = state.seasons.filter(season => seasonName(season.name) === seasonName(target.name)
    || (season.start_date <= target.end_date && season.end_date >= target.start_date));
  requireValid(candidates.length <= 1, 'Conflicting/overlapping league seasons found. Review existing seasons; none were overwritten.');
  const existingSeason = candidates[0];
  if (existingSeason) {
    requireValid(seasonName(existingSeason.name) === seasonName(target.name)
      || (existingSeason.start_date === target.start_date && existingSeason.end_date === target.end_date),
    `Another league season overlaps the confirmed dates (${existingSeason.id}). Review its identity before initializing Season 2.`);
    requireValid(existingSeason.start_date <= target.start_date && existingSeason.end_date >= target.end_date,
      `Existing Season 2 (${existingSeason.id}) does not contain every confirmed training date. Its dates were preserved; resolve this conflict explicitly.`);
  }
  const missing = [];
  const preserved = [];
  const conflicts = [];
  for (const session of calendar.sessions) {
    const matches = state.sessions.filter(row => relatedSessions(session, row));
    if (!matches.length) missing.push(session);
    else if (matches.length === 1 && sameIdentity(session, matches[0])) preserved.push(matches[0]);
    else conflicts.push(`${describe(session)} conflicts with existing row(s): ${matches.map(row => `${row.id} (${describe(row)})`).join('; ')}`);
  }
  for (const { session, reasons } of calendar.skipped) {
    const active = state.sessions.filter(row => relatedSessions(session, row) && row.is_cancelled !== true);
    if (active.length) conflicts.push(`Excluded holiday ${describe(session)} (${reasons.map(reason => reason.name).join(', ')}) already has active row(s): ${active.map(row => row.id).join(', ')}. Cancel or resolve explicitly; the initializer never cancels existing sessions.`);
  }
  requireValid(conflicts.length === 0, `Calendar conflicts (${conflicts.length}). Nothing was inserted:\n${conflicts.join('\n')}`);
  return {
    season: { action: existingSeason ? 'preserve' : 'create', values: existingSeason || target },
    missing, preserved,
    summary: {
      season_action: existingSeason ? 'preserve' : 'create',
      season: existingSeason || target,
      sessions_to_create: missing.length, sessions_preserved: preserved.length,
      preserved_cancelled_ids: preserved.filter(session => session.is_cancelled === true).map(session => session.id),
    },
  };
}

function validateTarget(expectedHost, databaseUrl) {
  requireValid(typeof expectedHost === 'string' && expectedHost.length <= 253
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(expectedHost),
  'Supply --expected-host with the exact database hostname only (not a URL, port or credentials).');
  requireValid(typeof databaseUrl === 'string' && databaseUrl.length > 0,
    'Set DATABASE_URL (or POSTGRES_URL) in the process environment. This tool never reads .env files.');
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new CalendarError('The database connection URL is invalid.'); }
  requireValid(['postgres:', 'postgresql:'].includes(parsed.protocol), 'The database URL must use postgres:// or postgresql://.');
  requireValid(parsed.hostname.toLowerCase() === expectedHost.toLowerCase(),
    'Database hostname does not match --expected-host. Refusing database access.');
  return parsed.hostname.toLowerCase();
}

// Only these two tables are read. Stable ordering allows an atomic snapshot comparison after acquiring locks.
const SNAPSHOT_SQL = `
  SELECT jsonb_build_object(
    'seasons', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM (
      SELECT id, name, start_date, end_date, placement_points, scoring_mode, points_step,
        default_rating, rookie_rating, k_factor FROM league_seasons
    ) s), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM (
      SELECT id, title, description, location, session_date, start_time, end_time,
        recurring_day, max_capacity, is_cancelled FROM training_sessions
      WHERE session_date BETWEEN $1::date AND $2::date
    ) t), '[]'::jsonb)
  ) AS state
`;

const INSERT_SEASON_SQL = `
  INSERT INTO league_seasons (name, start_date, end_date, placement_points, scoring_mode,
    points_step, default_rating, rookie_rating, k_factor)
  SELECT name, start_date, end_date, placement_points, scoring_mode,
    points_step, default_rating, rookie_rating, k_factor
  FROM jsonb_to_record($1::jsonb) AS s(name text, start_date date, end_date date,
    placement_points jsonb, scoring_mode text, points_step numeric,
    default_rating numeric, rookie_rating numeric, k_factor numeric)
  RETURNING id
`;

const INSERT_SESSIONS_SQL = `
  INSERT INTO training_sessions (title, description, location, session_date, start_time, end_time,
    recurring_day, max_capacity, is_cancelled)
  SELECT title, description, location, session_date, start_time, end_time,
    recurring_day, max_capacity, is_cancelled
  FROM jsonb_to_recordset($1::jsonb) AS t(title text, description text, location text,
    session_date date, start_time time, end_time time, recurring_day integer,
    max_capacity integer, is_cancelled boolean)
  RETURNING id
`;

async function initializeSeasonTwo({ sql, apply = false, expectedHost, databaseUrl }) {
  const host = validateTarget(expectedHost, databaseUrl);
  requireValid(typeof apply === 'boolean', 'apply must be an explicit boolean.');
  const calendar = buildCalendar();
  const dates = [calendar.season.start_date, calendar.season.end_date];
  const [[snapshot]] = await sql.transaction([sql.query(SNAPSHOT_SQL, dates)],
    { isolationLevel: 'RepeatableRead', readOnly: true });
  requireValid(snapshot?.state, 'Database did not return a calendar snapshot.');
  const plan = planExisting(calendar, snapshot.state);
  const result = {
    mode: apply ? 'APPLIED' : 'DRY_RUN', database_checked: true, target_host: host,
    calendar: calendar.summary, plan: plan.summary,
  };
  if (!apply) return result;

  const queries = [
    sql.query("SELECT set_config('lock_timeout', '10s', true), set_config('statement_timeout', '30s', true)", []),
    // Same advisory lock as lib/league-db.js. Table locks also serialize writers that do not take that lock.
    sql.query('SELECT pg_advisory_xact_lock(782146931)', []),
    sql.query('LOCK TABLE league_seasons, training_sessions IN SHARE ROW EXCLUSIVE MODE', []),
    sql.query(`SELECT league_assert(state = $3::jsonb, 409,
      'Calendar or season changed after preflight. Nothing was inserted; rerun the initializer.')
      FROM (${SNAPSHOT_SQL}) current_snapshot`, [...dates, JSON.stringify(snapshot.state)]),
  ];
  if (plan.season.action === 'create') queries.push(sql.query(INSERT_SEASON_SQL, [JSON.stringify(calendar.season)]));
  if (plan.missing.length) queries.push(sql.query(INSERT_SESSIONS_SQL, [JSON.stringify(plan.missing)]));
  queries.push(sql.query(`SELECT league_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset($1::jsonb)
        AS p(title text, location text, session_date date, start_time time, end_time time)
      WHERE (SELECT COUNT(*) FROM training_sessions t
        WHERE t.session_date = p.session_date AND t.start_time = p.start_time AND t.end_time = p.end_time
          AND t.location = p.location AND t.title = p.title) <> 1
    ) AND (SELECT COUNT(*) FROM league_seasons s WHERE to_jsonb(s) @> $2::jsonb) = 1,
    409, 'Calendar postcondition failed. Nothing was committed; review the existing rows and schema.')`,
  [JSON.stringify(calendar.sessions), JSON.stringify(plan.season.values)]));
  queries.push(sql.query(SNAPSHOT_SQL, dates));
  const applied = await sql.transaction(queries, { isolationLevel: 'ReadCommitted' });
  const finalState = applied[applied.length - 1]?.[0]?.state;
  const verified = planExisting(calendar, finalState);
  requireValid(verified.missing.length === 0 && verified.season.action === 'preserve',
    'The committed calendar could not be verified. Review the database before retrying.');
  return { ...result, verified: verified.summary };
}

module.exports = {
  CALENDAR_CONFIG, CalendarError, buildCalendar, sameIdentity, relatedSessions,
  planExisting, validateTarget, initializeSeasonTwo,
};
