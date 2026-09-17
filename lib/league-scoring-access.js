const { requireAdmin, requireMember } = require('./auth');
const { isValidUuid } = require('./validation');
const { assert, publicView, publicEvent, today } = require('./league');

function scoringIdentity(req) {
  const silent = { status() { return this; }, json() { return this; } };
  if (requireAdmin(req, silent)) return { is_admin: true, user_id: null };
  const member = requireMember(req, silent);
  return { is_admin: false, user_id: member && isValidUuid(member.sub) ? member.sub.toLowerCase() : null };
}

function isThursday(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T12:00:00Z`).getUTCDay() === 4;
}

function scoringPermissions(world, identity = {}, event, dateNow = today()) {
  const is_admin = identity.is_admin === true;
  const is_scorekeeper = Boolean(identity.user_id && world.users.some(u => u.id === identity.user_id
    && u.is_active === true && u.status === 'approved' && u.league_scorekeeper === true));
  const session = event && world.sessions.find(s => s.id === event.session_id);
  return { is_admin, is_scorekeeper, can_score: Boolean((is_admin || is_scorekeeper) && event
    && !event.cancelled_at && event.status === 'published' && event.schedule && session && !session.is_cancelled
    && session.session_date === event.session_date && isThursday(session.session_date) && session.session_date <= dateNow) };
}

function scoringView(world, requested, identity, dateNow = today()) {
  const sessions = new Map(world.sessions.map(s => [s.id, s]));
  const events = world.events.filter(e => {
    const session = sessions.get(e.session_id);
    return session && !session.is_cancelled && !e.cancelled_at && isThursday(session.session_date)
      && e.session_date === session.session_date && ['published', 'finalized'].includes(e.status);
  }).sort((a, b) => b.session_date.localeCompare(a.session_date)
    || (sessions.get(b.session_id).start_time || '').localeCompare(sessions.get(a.session_id).start_time || '')
    || a.id.localeCompare(b.id));
  let selected;
  if (requested) {
    selected = events.find(e => e.id === requested);
    assert(selected, 'Published Thursday event not found', 404);
  } else {
    selected = events.find(e => e.session_date === dateNow)
      || [...events].reverse().find(e => e.session_date > dateNow)
      || events.find(e => e.session_date < dateNow) || null;
  }
  const visible = publicView(world, selected ? selected.season_id : undefined, undefined, dateNow);
  return {
    events: events.map(e => publicEvent(e, sessions.get(e.session_id))),
    event: selected ? publicEvent(selected, sessions.get(selected.session_id)) : null,
    season: visible.season, standings: visible.standings, comparison_event: visible.comparison_event,
    permissions: scoringPermissions(world, identity, selected, dateNow),
  };
}

module.exports = { scoringIdentity, scoringPermissions, scoringView, isThursday };
