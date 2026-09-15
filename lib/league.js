const { isValidUuid } = require('./validation');
const { placementPoints } = require('../js/league-scoring');
const {
  REFEREE_POLICY, EXTERNAL_REFEREE_POLICY, buildSchedule, matchStandings, resolvePlacements,
} = require('./league-matches');

const DEFAULTS = Object.freeze({
  placement_points: [1, 0.5],
  scoring_mode: 'beaten',
  points_step: 0.5,
  k_factor: 24,
  default_rating: 1000,
  rookie_rating: 800,
  bonus_points_max: 1,
  bonus_points_step: 0.5,
});

class LeagueError extends Error {
  constructor(status, message, code = ({ 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' })[status] || 'VALIDATION_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function assert(condition, message, status = 400) {
  if (!condition) throw new LeagueError(status, message, status === 404 ? 'NOT_FOUND' : undefined);
}

function uuid(value, label) {
  assert(isValidUuid(value), `${label} must be a UUID`);
  return value.toLowerCase();
}

function text(value, label, max = 200) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    `${label} must contain 1–${max} characters`);
  return value.trim();
}

function number(value, label, min, max, integer = false) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value)), `${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  assert(integer || Math.round(value * 1e6) / 1e6 === value, `${label} supports at most six decimal places`);
  return value;
}

function date(value, label) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '2000-01-01' && value <= '2199-12-31', `${label} must be a valid YYYY-MM-DD date`);
  const parsed = new Date(`${value}T12:00:00Z`);
  assert(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    `${label} must be a valid YYYY-MM-DD date`);
  return value;
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
}

function settings(input) {
  const points = input.placement_points === undefined ? DEFAULTS.placement_points : input.placement_points;
  const mode = input.scoring_mode === undefined ? DEFAULTS.scoring_mode : input.scoring_mode;
  const step = input.points_step === undefined ? DEFAULTS.points_step : input.points_step;
  assert(['beaten', 'relative', 'fixed'].includes(mode), 'scoring_mode must be beaten, relative or fixed');
  assert([0.1, 0.25, 0.5, 1].includes(step), 'points_step must be 0.1, 0.25, 0.5 or 1');
  assert(Array.isArray(points) && points.length >= 1 && points.length <= 100,
    'placement_points must contain 1–100 values');
  points.forEach(p => number(p, 'Placement points', 0, 10000));
  assert(mode !== 'beaten' || points.length === 2,
    'Teams-beaten scoring requires [participation points, points per team beaten]');
  assert(mode === 'beaten' || points.every((p, i) => i === 0 || p <= points[i - 1]),
    'Placement points must be non-increasing');
  assert(mode === 'fixed' || points.every(p => Math.abs(p / step - Math.round(p / step)) < 1e-8),
    'Teams-beaten and relative placement points must all be multiples of points_step');
  return {
    placement_points: [...points], scoring_mode: mode, points_step: step,
    ...bonusSettings(input),
    k_factor: number(input.k_factor === undefined ? DEFAULTS.k_factor : input.k_factor, 'k_factor', 0, 200),
    default_rating: number(input.default_rating === undefined ? DEFAULTS.default_rating : input.default_rating, 'default_rating', 0, 10000),
    rookie_rating: number(input.rookie_rating === undefined ? DEFAULTS.rookie_rating : input.rookie_rating, 'rookie_rating', 0, 10000),
  };
}

function bonusSettings(input = {}) {
  const max = number(Number(input.bonus_points_max === undefined ? DEFAULTS.bonus_points_max : input.bonus_points_max),
    'bonus_points_max', 0, 10000);
  const step = number(Number(input.bonus_points_step === undefined ? DEFAULTS.bonus_points_step : input.bonus_points_step),
    'bonus_points_step', 0.000001, 10000);
  assert(Math.round(max * 1e6) % Math.round(step * 1e6) === 0, 'bonus_points_max must be a multiple of bonus_points_step');
  return { bonus_points_max: max, bonus_points_step: step };
}

function bonusAwards(event, awards = event.bonus_points || []) {
  assert(Array.isArray(awards) && awards.length <= 500, 'bonus_points must be an array of at most 500 awards');
  const roster = new Set(event.teams.flatMap(t => t.players.map(p => p.id)));
  const { bonus_points_max: max, bonus_points_step: step } = bonusSettings(event.settings);
  const seen = new Set();
  return awards.map(award => {
    assert(award && typeof award === 'object', 'Invalid bonus award');
    const player_id = uuid(award.player_id, 'Bonus player id');
    assert(roster.has(player_id), 'Bonus points may only be awarded to roster participants');
    assert(!seen.has(player_id), 'Duplicate bonus award');
    seen.add(player_id);
    const points = number(award.points, 'Bonus points', 0, max);
    assert(Math.round(points * 1e6) % Math.round(step * 1e6) === 0, 'Bonus points must be a multiple of bonus_points_step');
    return { player_id, points };
  }).sort((a, b) => a.player_id.localeCompare(b.player_id));
}

function pruneBonusAwards(event, teams) {
  const ids = new Set(teams.flatMap(t => t.players.map(p => p.id)));
  return (event.bonus_points || []).filter(a => ids.has(a.player_id));
}

function pointsForPlacement(config, placement, teamCount) {
  number(teamCount, 'Team count', 2, 125, true);
  number(placement, 'Placement', 1, teamCount, true);
  // Missing mode denotes an older frozen snapshot, whose fixed awards must not change.
  return placementPoints({
    ...config, scoring_mode: config.scoring_mode === undefined ? 'fixed' : config.scoring_mode,
  }, teamCount)[placement - 1];
}

function scheduleSettings(input, managedProgram = true, preserveRecommendedTiming = false) {
  const meetupTime = input.meetup_time === undefined ? (managedProgram ? '18:00' : null) : input.meetup_time;
  assert(meetupTime === null || (typeof meetupTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(meetupTime)),
    'meetup_time must use HH:MM');
  const warmupMinutes = number(input.warmup_minutes === undefined ? (managedProgram ? 15 : 0) : input.warmup_minutes,
    'warmup_minutes', 0, 120, true);
  const availableMinutes = number(input.available_minutes === undefined ? 120 : input.available_minutes,
    'available_minutes', 1, 480, true);
  assert(warmupMinutes < availableMinutes, 'warmup_minutes must end before available_minutes');
  return {
    courts: number(input.courts === undefined ? 2 : input.courts, 'courts', 1, 2, true),
    match_minutes: input.match_minutes === undefined && preserveRecommendedTiming ? undefined
      : number(input.match_minutes === undefined ? (managedProgram ? 17 : 20) : input.match_minutes, 'match_minutes', 1, 60, true),
    break_minutes: input.break_minutes === undefined && preserveRecommendedTiming ? undefined
      : number(input.break_minutes === undefined ? 5 : input.break_minutes, 'break_minutes', 0, 30, true),
    meetup_time: meetupTime,
    warmup_minutes: warmupMinutes,
    available_minutes: availableMinutes,
    finale_minutes: number(input.finale_minutes === undefined ? (managedProgram ? 10 : 0) : input.finale_minutes,
      'finale_minutes', managedProgram ? 1 : 0, 10, true),
  };
}

function validateAction(body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 'JSON object required');
  const action = body.action;
  const out = { action };
  if (action === 'set_scorekeeper') {
    assert(typeof body.enabled === 'boolean', 'enabled must be boolean');
    return { action, user_id: uuid(body.user_id, 'user_id'), enabled: body.enabled };
  }
  if (action === 'save_season') {
    if (body.id !== undefined) out.id = uuid(body.id, 'id');
    out.name = text(body.name, 'name', 100);
    out.start_date = date(body.start_date, 'start_date');
    out.end_date = date(body.end_date, 'end_date');
    assert(out.end_date >= out.start_date, 'end_date must not precede start_date');
    for (const key of ['bonus_points_max', 'bonus_points_step']) {
      if (body[key] !== undefined) number(body[key], key, key === 'bonus_points_step' ? 0.000001 : 0, 10000);
    }
    return { ...out, ...settings(body) };
  }
  if (action === 'save_player') {
    if (body.player_id !== undefined) out.player_id = uuid(body.player_id, 'player_id');
    if (body.user_id !== undefined) out.user_id = body.user_id === null ? null : uuid(body.user_id, 'user_id');
    if (body.display_name !== undefined) out.display_name = text(body.display_name, 'display_name', 100);
    assert(out.player_id || out.user_id || out.display_name, 'A named guest or existing player/member is required');
    assert(['male', 'female', 'unspecified'].includes(body.gender), 'Invalid gender');
    assert(typeof body.is_rookie === 'boolean', 'is_rookie must be boolean');
    return { ...out, gender: body.gender, is_rookie: body.is_rookie,
      initial_rating: number(body.initial_rating, 'initial_rating', 0, 10000) };
  }
  if (action === 'link_player') {
    return { action, player_id: uuid(body.player_id, 'player_id'), user_id: uuid(body.user_id, 'user_id') };
  }
  if (action === 'generate') {
    out.season_id = uuid(body.season_id, 'season_id');
    out.session_id = uuid(body.session_id, 'session_id');
    assert(['auto', 2, 3, 4, 5, 6].includes(body.team_size), 'team_size must be auto, 2, 3, 4, 5 or 6');
    out.team_size = body.team_size;
    out.max_teams = number(body.max_teams === undefined ? 5 : body.max_teams, 'max_teams', 2, 5, true);
    if (body.player_ids !== undefined) {
      const minimumPlayers = out.max_teams === 2 ? 4 : 6;
      assert(Array.isArray(body.player_ids)
        && body.player_ids.length >= minimumPlayers && body.player_ids.length <= 500,
      `Manual player_ids must contain ${minimumPlayers}–500 players`);
      out.player_ids = body.player_ids.map(value => uuid(value, 'Player id'));
      assert(new Set(out.player_ids).size === out.player_ids.length, 'Manual roster contains duplicate players');
    }
    if (body.version !== undefined) out.version = number(body.version, 'version', 1, 2147483646, true);
    return out;
  }
  assert(['save_teams', 'save_draft', 'save_bonus_points', 'set_bonus', 'publish', 'unpublish',
    'results', 'generate_schedule', 'delete_schedule', 'save_match', 'reopen_results'].includes(action), 'Invalid action');
  out.event_id = uuid(body.event_id, 'event_id');
  out.version = number(body.version, 'version', 1, 2147483646, true);
  if (action === 'generate_schedule') return { ...out, ...scheduleSettings(body, true, true) };
  if (action === 'save_match') {
    return { ...out, match_number: number(body.match_number, 'match_number', 1, 10, true),
      score_a: number(body.score_a, 'score_a', 0, 999, true), score_b: number(body.score_b, 'score_b', 0, 999, true) };
  }
  if (['save_bonus_points', 'set_bonus'].includes(action)) {
    const key = action === 'save_bonus_points' ? 'awards' : 'bonus_points';
    assert(Array.isArray(body[key]) && body[key].length <= 500, `${key} must contain at most 500 awards`);
    out[key] = body[key].map(a => {
      assert(a && typeof a === 'object', 'Invalid bonus award');
      return { player_id: uuid(a.player_id, 'Bonus player id'), points: number(a.points, 'Bonus points', 0, 10000) };
    });
  }
  if (action === 'save_draft') {
    assert(['auto', 2, 3, 4, 5, 6].includes(body.team_size), 'team_size must be auto, 2, 3, 4, 5 or 6');
    out.team_size = body.team_size;
  }
  if (['save_teams', 'save_draft'].includes(action)) {
    assert(Array.isArray(body.teams) && body.teams.length >= 2 && body.teams.length <= 125,
      'teams must contain 2–125 squads');
    out.teams = body.teams.map(team => {
      assert(team && typeof team === 'object', 'Invalid team');
      assert(Array.isArray(team.player_ids) && team.player_ids.length <= 500, 'Invalid player_ids');
      return { number: number(team.number, 'Team number', 1, 125, true),
        name: text(team.name, 'Team name', 80),
        player_ids: team.player_ids.map(id => uuid(id, 'Player id')) };
    });
  }
  if (action === 'results' && body.placements !== undefined) {
    assert(Array.isArray(body.placements) && body.placements.length >= 2 && body.placements.length <= 125,
      'placements must contain every team');
    out.placements = body.placements.map(p => {
      assert(p && typeof p === 'object', 'Invalid placement');
      return { team_number: number(p.team_number, 'team_number', 1, 125, true),
        placement: number(p.placement, 'placement', 1, 125, true) };
    });
  }
  return out;
}

function chooseTeamSize(count, requested) {
  number(count, 'Attendee count', 4, 500, true);
  assert(['auto', 2, 3, 4, 5, 6].includes(requested), 'Invalid team size');
  const size = requested === 'auto'
    ? [6, 5, 4].find(n => count >= n * 2 && count % n === 0)
      || [6, 5, 4, 3, 2].find(n => count >= n * 2)
    : requested;
  assert(count >= size * 2, `At least ${size * 2} eligible players are needed for ${size}-a-side`);
  return size;
}

function refereeTeamSize(count, requested, maxTeams) {
  number(count, 'Attendee count', 6, 500, true);
  assert(['auto', 2, 3, 4, 5, 6].includes(requested), 'Invalid team size');
  const preferredTeams = maxTeams >= 5 && count >= 10 ? 5 : 3;
  const size = requested === 'auto' ? Math.min(6, Math.floor(count / preferredTeams)) : requested;
  assert(count >= size * 3, `At least ${size * 3} eligible players are needed for three ${size}-a-side teams`);
  return size;
}

function balanceTeams(players, requested, maxTeams = 5, refereeSafe = false) {
  number(maxTeams, 'max_teams', 2, 5, true);
  const externalReferee = refereeSafe && maxTeams === 2;
  const teamSize = refereeSafe && !externalReferee
    ? refereeTeamSize(players.length, requested, maxTeams) : chooseTeamSize(players.length, requested);
  assert(new Set(players.map(p => p.id)).size === players.length, 'Duplicate attendee');
  players.forEach(p => {
    assert(Number.isFinite(p.rating), 'Invalid player rating');
    assert(['male', 'female', 'unspecified'].includes(p.gender), 'Invalid player gender');
  });
  const feasible = Math.min(maxTeams, Math.floor(players.length / teamSize));
  const count = externalReferee ? 2 : refereeSafe ? (feasible >= 5 ? 5 : 3) : feasible;
  const capacities = Array.from({ length: count }, (_, i) =>
    Math.floor(players.length / count) + (i < players.length % count ? 1 : 0));
  const total = players.reduce((acc, p) => {
    acc.rating += p.rating;
    acc.male += p.gender === 'male' ? 1 : 0;
    acc.female += p.gender === 'female' ? 1 : 0;
    acc.unspecified += p.gender === 'unspecified' ? 1 : 0;
    acc.rookie += p.is_rookie ? 1 : 0;
    return acc;
  }, { rating: 0, male: 0, female: 0, unspecified: 0, rookie: 0 });
  const aggregate = list => list.reduce((acc, p) => ({
    rating: acc.rating + p.rating, male: acc.male + (p.gender === 'male' ? 1 : 0),
    female: acc.female + (p.gender === 'female' ? 1 : 0), rookie: acc.rookie + (p.is_rookie ? 1 : 0),
    unspecified: acc.unspecified + (p.gender === 'unspecified' ? 1 : 0),
  }), { rating: 0, male: 0, female: 0, unspecified: 0, rookie: 0 });
  const cost = (sums, size) => {
    if (!size) return 0;
    const proportion = size / players.length;
    return ((sums.rating / size - total.rating / players.length) / 150) ** 2
      + 4 * (sums.male - total.male * proportion) ** 2
      + 4 * (sums.female - total.female * proportion) ** 2
      + 4 * (sums.unspecified - total.unspecified * proportion) ** 2
      + 5 * (sums.rookie - total.rookie * proportion) ** 2;
  };
  const teams = capacities.map((_, i) => ({ number: i + 1, name: `Team ${i + 1}`, placement: null, players: [] }));
  const sorted = [...players].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  for (const player of sorted) {
    let best = null;
    let bestCost = Infinity;
    teams.forEach((team, i) => {
      if (team.players.length >= capacities[i]) return;
      // Fill equally before optimizing, so an early extreme rating cannot fill one squad.
      const score = team.players.length * 1e8 + cost(aggregate([...team.players, player]), team.players.length + 1);
      if (score < bestCost) { best = team; bestCost = score; }
    });
    best.players.push({ ...player });
  }
  let sums = teams.map(t => aggregate(t.players));
  const changed = (sum, out, into) => ({
    rating: sum.rating - out.rating + into.rating,
    male: sum.male - (out.gender === 'male' ? 1 : 0) + (into.gender === 'male' ? 1 : 0),
    female: sum.female - (out.gender === 'female' ? 1 : 0) + (into.gender === 'female' ? 1 : 0),
    unspecified: sum.unspecified - (out.gender === 'unspecified' ? 1 : 0) + (into.gender === 'unspecified' ? 1 : 0),
    rookie: sum.rookie - (out.is_rookie ? 1 : 0) + (into.is_rookie ? 1 : 0),
  });
  // Deterministic best-improvement swaps preserve exact squad sizes and the entire RSVP roster.
  for (let pass = 0; pass < 80; pass++) {
    let best = null;
    let improvement = 1e-8;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        const before = cost(sums[a], capacities[a]) + cost(sums[b], capacities[b]);
        for (let i = 0; i < teams[a].players.length; i++) {
          for (let j = 0; j < teams[b].players.length; j++) {
            const p = teams[a].players[i], q = teams[b].players[j];
            const sa = changed(sums[a], p, q), sb = changed(sums[b], q, p);
            const gain = before - cost(sa, capacities[a]) - cost(sb, capacities[b]);
            if (gain > improvement) { improvement = gain; best = { a, b, i, j, sa, sb }; }
          }
        }
      }
    }
    if (!best) break;
    const { a, b, i, j, sa, sb } = best;
    [teams[a].players[i], teams[b].players[j]] = [teams[b].players[j], teams[a].players[i]];
    sums[a] = sa; sums[b] = sb;
  }
  return { team_size: teamSize, max_teams: maxTeams, teams };
}

function matchData(event) {
  if (event.schedule === null || event.schedule === undefined) return { schedule: null, match_standings: null };
  const source = event.schedule;
  const refereeSafe = source.referee_policy === REFEREE_POLICY;
  const externalReferee = source.referee_policy === EXTERNAL_REFEREE_POLICY;
  const managedProgram = refereeSafe || externalReferee;
  assert(!source.referee_policy || managedProgram, 'Stored schedule referee policy is invalid');
  assert(!externalReferee || event.teams.length === 2, 'External-ref schedules require exactly two teams');
  assert(!refereeSafe || event.teams.length >= 3, 'Rotating-team referee schedules require at least three teams');
  const config = scheduleSettings(source, managedProgram);
  const table = matchStandings(event.teams.length, source);
  number(source.duration_minutes, 'Schedule duration', 1, config.available_minutes, true);
  const activeCourts = event.teams.length === 2
    ? 1 : Math.min(config.courts, Math.floor((event.teams.length - 1) / 2));
  if (managedProgram) {
    assert(source.active_courts === activeCourts, 'Stored schedule active courts are invalid');
    assert(source.finale_start_minute === config.available_minutes, 'Stored schedule finale start is invalid');
    assert(source.total_duration_minutes === config.available_minutes + config.finale_minutes,
      'Stored schedule total duration is invalid');
  }
  const rounds = source.rounds.map((round, i) => {
    const start = config.warmup_minutes + i * (config.match_minutes + config.break_minutes);
    assert(round.number === i + 1 && round.start_minute === start && round.end_minute === start + config.match_minutes,
      'Stored schedule round timing is invalid');
    const playing = new Set(round.matches.flatMap(m => [m.team_a, m.team_b]));
    const byes = event.teams.map(t => t.number).filter(n => !playing.has(n)).sort((a, b) => a - b);
    assert(Array.isArray(round.bye_teams)
      && JSON.stringify([...round.bye_teams].sort((a, b) => a - b)) === JSON.stringify(byes),
    'Stored schedule bye teams are invalid');
    const refereeTeam = refereeSafe ? round.referee_team : null;
    const restTeams = refereeSafe ? byes.filter(team => team !== refereeTeam) : byes;
    return {
      number: round.number, start_minute: round.start_minute, end_minute: round.end_minute,
      bye_teams: byes, referee_team: refereeTeam, rest_teams: restTeams,
      matches: round.matches.map(m => ({
        number: m.number, team_a: m.team_a, team_b: m.team_b, court: m.court,
        score_a: m.score_a, score_b: m.score_b,
      })),
    };
  });
  assert(rounds.at(-1).end_minute === source.duration_minutes, 'Stored schedule duration is invalid');
  return {
    schedule: {
      ...config,
      active_courts: managedProgram ? activeCourts : config.courts,
      duration_minutes: source.duration_minutes,
      finale_start_minute: managedProgram ? config.available_minutes : null,
      total_duration_minutes: managedProgram ? config.available_minutes + config.finale_minutes : source.duration_minutes,
      referee_policy: refereeSafe ? REFEREE_POLICY : externalReferee ? EXTERNAL_REFEREE_POLICY : null,
      rounds,
    },
    match_standings: table,
  };
}

function hasMatchScores(event) {
  const { schedule } = matchData(event);
  return Boolean(schedule && schedule.rounds.some(r => r.matches.some(m => m.score_a !== null || m.score_b !== null)));
}

function requireEditableRoster(event) {
  assert(!event.roster_locked && event.status !== 'finalized' && !hasMatchScores(event),
    'Teams are locked after play or finalization. Correct match scores/results instead of changing the roster.', 409);
}

function eventPlacements(event, input) {
  if (!event.schedule) {
    assert(Array.isArray(input), 'Manual final placements are required for events without a schedule');
    return input;
  }
  const { schedule, match_standings: table } = matchData(event);
  assert(table.complete, 'Record both scores for every match before finalizing results', 409);
  if (!table.has_ties) return table.placements;
  assert(Array.isArray(input), 'Exact match-table ties require explicit admin placement resolution', 409);
  return resolvePlacements(event.teams.length, schedule, input);
}

function editTeams(event, input) {
  const roster = new Map(event.teams.flatMap(t => t.players).map(p => [p.id, p]));
  const numbers = event.teams.map(t => t.number).sort((a, b) => a - b);
  assert(input.length === event.teams.length
    && JSON.stringify(input.map(t => t.number).sort((a, b) => a - b)) === JSON.stringify(numbers),
  'Keep the same team numbers');
  const ids = input.flatMap(t => t.player_ids);
  assert(ids.length === roster.size && new Set(ids).size === roster.size && ids.every(id => roster.has(id)),
    'Every original attendee must appear exactly once; regenerate for RSVP changes');
  const sizes = input.map(t => t.player_ids.length);
  assert(Math.min(...sizes) >= event.team_size && Math.max(...sizes) - Math.min(...sizes) <= 1,
    'Squads must meet the on-court size and differ by at most one rotating substitute');
  return draftTeams({ ...event, max_teams: Math.max(event.max_teams || 5, event.teams.length) }, input, event.team_size).teams;
}

function draftTeams(event, input, requested, eligible = []) {
  assert(input.length >= 2 && input.length <= (event.max_teams || 5), 'Keep between two and max_teams squads');
  const sorted = [...input].sort((a, b) => a.number - b.number);
  assert(sorted.every((t, i) => t.number === i + 1), 'Team numbers must be consecutive from 1');
  const ids = input.flatMap(t => t.player_ids);
  assert(ids.length <= 500 && new Set(ids).size === ids.length, 'Draft roster contains duplicate players or more than 500 players');
  const existing = new Map(event.teams.flatMap(t => t.players.map(p => [p.id, p])));
  const available = new Map(eligible.map(({ user_id, ...p }) => [p.id, p]));
  const teamSize = requested === 'auto' && ids.length < 4 ? event.team_size
    : requested === 'auto' ? chooseTeamSize(ids.length, requested) : requested;
  assert([2, 3, 4, 5, 6].includes(teamSize), 'Invalid team size');
  const teams = sorted.map(t => ({
    number: t.number, name: t.name, placement: null,
    players: t.player_ids.map(id => {
      const player = existing.get(id) || available.get(id);
      assert(player, 'Unknown, merged, or inactive player in the roster');
      return { ...player };
    }),
  }));
  return { teams, team_size: teamSize, roster_ids: [...ids].sort(), bonus_points: pruneBonusAwards(event, teams) };
}

function requirePublishableRoster(event) {
  const sizes = event.teams.map(t => t.players.length);
  const minimumTeams = event.schedule?.referee_policy === REFEREE_POLICY ? 3 : 2;
  assert(event.teams.length >= minimumTeams && event.teams.length <= (event.max_teams || 5)
    && sizes.every(size => size >= event.team_size),
  `At least ${minimumTeams} squads must meet the on-court team size before publishing`, 409);
  assert(Math.max(...sizes) - Math.min(...sizes) <= 1,
    'Squad sizes must differ by at most one rotating substitute before publishing', 409);
  if (event.schedule) {
    const validPolicy = event.teams.length === 2
      ? event.schedule.referee_policy === EXTERNAL_REFEREE_POLICY
      : event.schedule.referee_policy === REFEREE_POLICY;
    assert(validPolicy,
      'Regenerate the schedule before publishing with the correct rotating-team or external-ref format', 409);
    matchData(event);
  }
  const ids = event.teams.flatMap(t => t.players.map(p => p.id)).sort();
  assert(ids.length >= 4 && new Set(ids).size === ids.length
    && JSON.stringify(ids) === JSON.stringify([...event.roster_ids].sort()),
  'Every selected player must appear exactly once', 409);
}

function scoreEvent(event, placements) {
  const n = event.teams.length;
  assert(placements.length === n && new Set(placements.map(p => p.team_number)).size === n
    && placements.every(p => event.teams.some(t => t.number === p.team_number)), 'Supply every team exactly once');
  assert(new Set(placements.map(p => p.placement)).size === n
    && placements.every(p => p.placement >= 1 && p.placement <= n), `Placements must be unique from 1 to ${n}`);
  const teams = event.teams.map(team => ({
    ...team, placement: placements.find(p => p.team_number === team.number).placement,
  }));
  const averages = teams.map(t => t.players.reduce((sum, p) => sum + p.rating, 0) / t.players.length);
  const ledger = [];
  const bonuses = new Map(bonusAwards(event).map(a => [a.player_id, a.points]));
  teams.forEach((team, i) => {
    let delta = 0;
    teams.forEach((opponent, j) => {
      if (i === j) return;
      const expected = 1 / (1 + 10 ** (Math.max(-16000, Math.min(16000, averages[j] - averages[i])) / 400));
      delta += (team.placement < opponent.placement ? 1 : 0) - expected;
    });
    delta = Math.round(event.settings.k_factor * delta / (n - 1) * 1e6) / 1e6;
    const points = pointsForPlacement(event.settings, team.placement, n);
    for (const player of team.players) {
      const bonus = bonuses.get(player.id) || 0;
      ledger.push({ player_id: player.id, display_name: player.display_name, team_number: team.number,
        placement: team.placement, points: Math.round((points + bonus) * 1e6) / 1e6,
        bonus_points: bonus, rating_delta: delta });
    }
  });
  return { teams, ledger };
}

function selectSeason(seasons, requested, dateNow = today()) {
  if (requested) {
    const selected = seasons.find(s => s.id === requested);
    assert(selected, 'Published season not found', 404);
    return selected;
  }
  const sorted = [...seasons].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id));
  return sorted.find(s => s.start_date <= dateNow && s.end_date >= dateNow) || sorted[0] || null;
}

function seasonSummary(season) {
  return { id: season.id, name: season.name, start_date: season.start_date, end_date: season.end_date,
    ...bonusSettings(season),
    scoring_mode: season.scoring_mode || 'fixed', points_step: Number(season.points_step === undefined ? 0.5 : season.points_step) };
}

function publicSeasonSummary(season) {
  return { ...seasonSummary(season), placement_points: [...season.placement_points] };
}

function finaleAwardCategories(event, requireComplete = false) {
  const awards = new Map(bonusAwards(event).map(award => [award.player_id, award.points]));
  const category = (gender, label) => {
    const players = event.teams.flatMap(team => team.players).filter(player => player.gender === gender);
    if (players.length < 2) return null;
    const place = points => {
      const matching = players.filter(player => awards.get(player.id) === points);
      return matching.length === 1 ? { display_name: matching[0].display_name, bonus_points: points } : null;
    };
    const winner = place(1);
    const runnerUp = place(0.5);
    if (requireComplete) {
      assert(winner && runnerUp,
        `${label}: save exactly one +1 BP winner and one +0.5 BP runner-up before finalizing`, 409);
    }
    return winner && runnerUp ? { winner, runner_up: runnerUp } : null;
  };
  return {
    men: category('male', 'Last Man Standing'),
    women: category('female', 'Last Woman Standing'),
  };
}

function requireFinaleAwards(event) {
  if ([REFEREE_POLICY, EXTERNAL_REFEREE_POLICY].includes(event.schedule?.referee_policy)) {
    finaleAwardCategories(event, true);
  }
}

function finaleResults(event) {
  if (event.status !== 'finalized'
    || ![REFEREE_POLICY, EXTERNAL_REFEREE_POLICY].includes(event.schedule?.referee_policy)) return null;
  const result = finaleAwardCategories(event);
  return result.men || result.women ? result : null;
}

function publicEvent(event, session) {
  const matches = matchData(event);
  const bonuses = new Map(bonusAwards(event).map(a => [a.player_id, a.points]));
  const startTime = matches.schedule?.meetup_time || session.start_time;
  const programMinutes = matches.schedule?.referee_policy
    ? matches.schedule.total_duration_minutes : matches.schedule?.duration_minutes;
  let endTime = matches.schedule?.referee_policy ? null : session.end_time || null;
  if (!endTime && programMinutes && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(startTime || '')) {
    const [hours, minutes, seconds = 0] = startTime.split(':').map(Number);
    const end = (hours * 3600 + minutes * 60 + seconds + programMinutes * 60) % 86400;
    endTime = [Math.floor(end / 3600), Math.floor(end / 60) % 60, end % 60]
      .map(value => String(value).padStart(2, '0')).join(':');
  }
  return {
    id: event.id, season_id: event.season_id, session_id: event.session_id, version: event.version,
    ...bonusSettings(event.settings),
    title: session.title, session_date: session.session_date, start_time: startTime,
    end_time: endTime,
    location: session.location, team_size: event.team_size, max_teams: event.max_teams || 5, status: event.status,
    ...matches, finale_results: finaleResults(event),
    teams: event.teams.map(t => ({
      number: t.number, name: t.name, placement: event.status === 'finalized' ? t.placement : null,
      points: event.status === 'finalized'
        ? pointsForPlacement(event.settings, t.placement, event.teams.length) : 0,
      players: t.players.map(p => {
        const base = event.status === 'finalized' ? pointsForPlacement(event.settings, t.placement, event.teams.length) : 0;
        const bonus = event.status === 'finalized' ? bonuses.get(p.id) || 0 : 0;
        return { display_name: p.display_name, points: Math.round((base + bonus) * 1e6) / 1e6, base_points: base, bonus_points: bonus };
      }),
    })),
  };
}

function publicView(world, requested, userId, dateNow = today()) {
  const sessions = new Map(world.sessions.map(s => [s.id, s]));
  const chronological = (a, b) => {
    const first = sessions.get(a.session_id), second = sessions.get(b.session_id);
    return first.session_date.localeCompare(second.session_date)
      || (first.start_time || '').localeCompare(second.start_time || '') || a.id.localeCompare(b.id);
  };
  const released = world.events.filter(e => ['published', 'finalized'].includes(e.status));
  const seasons = world.seasons.filter(s => released.some(e => e.season_id === s.id));
  const season = selectSeason(seasons, requested, dateNow);
  const guideSeason = season || [...world.seasons]
    .filter(candidate => candidate.start_date <= dateNow && candidate.end_date >= dateNow)
    .sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id))[0] || null;
  const events = season ? released.filter(e => e.season_id === season.id) : [];
  const finalized = events.filter(e => e.status === 'finalized').sort(chronological);
  const eventMap = new Map(finalized.map(e => [e.id, e]));
  const eventOrder = new Map(finalized.map((e, index) => [e.id, index]));
  // Rebuild the same before/after ledger for every viewer, including after corrections or reopening.
  const comparison = finalized.at(-1) || null;
  const totals = new Map();
  const previousTotals = new Map();
  const ownPlayer = userId ? world.profiles.find(p => p.user_id === userId && !p.merged_into) : null;
  function accumulate(target, r) {
    const row = target.get(r.player_id) || { id: r.player_id, display_name: r.display_name, points: 0, bonus_points: 0, played: 0, wins: 0 };
    const order = eventOrder.get(r.event_id);
    if (row.name_order === undefined || order > row.name_order) {
      row.display_name = r.display_name;
      row.name_order = order;
    }
    row.points += Number(r.points);
    row.bonus_points += Number(r.bonus_points || 0);
    row.played++;
    row.wins += r.placement === 1 ? 1 : 0;
    target.set(r.player_id, row);
  }
  for (const r of world.results) {
    if (!eventMap.has(r.event_id)) continue;
    accumulate(totals, r);
    if (r.event_id !== comparison.id) accumulate(previousTotals, r);
  }
  function rankTotals(target) {
    for (const row of target.values()) {
      row.points = Math.round(row.points * 1e6) / 1e6;
      row.bonus_points = Math.round(row.bonus_points * 1e6) / 1e6;
      row.base_points = Math.round((row.points - row.bonus_points) * 1e6) / 1e6;
    }
    const ranked = [...target.values()].sort((a, b) => b.points - a.points
      || a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id));
    let rank = 0;
    ranked.forEach((row, i) => {
      if (i === 0 || row.points !== ranked[i - 1].points) rank = i + 1;
      row.rank = rank;
    });
    return ranked;
  }
  rankTotals(previousTotals);
  const ranked = rankTotals(totals);
  function movement(row) {
    if (!comparison) return {};
    const previous = row && previousTotals.get(row.id);
    return {
      points_gain: Math.round(((row ? row.points : 0) - (previous ? previous.points : 0)) * 1e6) / 1e6 || 0,
      previous_rank: previous ? previous.rank : null,
      rank_gain: previous ? previous.rank - row.rank : null,
    };
  }
  const comparisonSession = comparison && sessions.get(comparison.session_id);
  const payload = {
    seasons: seasons.map(seasonSummary),
    season: season ? publicSeasonSummary(season) : null,
    guide_season: guideSeason ? publicSeasonSummary(guideSeason) : null,
    standings: ranked.map(row => ({
      rank: row.rank, display_name: row.display_name, points: row.points, played: row.played, wins: row.wins,
      bonus_points: row.bonus_points, base_points: row.base_points,
      ...movement(row),
    })),
    comparison_event: comparison ? {
      id: comparison.id, season_id: comparison.season_id, session_id: comparison.session_id,
      title: comparisonSession.title, session_date: comparisonSession.session_date, start_time: comparisonSession.start_time,
    } : null,
    events: [...events].sort((a, b) => -chronological(a, b)).map(e => publicEvent(e, sessions.get(e.session_id))),
  };
  if (userId) {
    const own = ownPlayer ? totals.get(ownPlayer.id) : null;
    payload.stats = { ...(own ? { rank: own.rank, points: own.points, bonus_points: own.bonus_points,
      base_points: own.base_points, played: own.played, wins: own.wins }
      : { rank: null, points: 0, bonus_points: 0, base_points: 0, played: 0, wins: 0 }), ...movement(own) };
    payload.history = world.results.filter(r => ownPlayer && r.player_id === ownPlayer.id && eventMap.has(r.event_id)).map(r => {
      const event = eventMap.get(r.event_id);
      const session = sessions.get(event.session_id);
      return { event_id: event.id, title: session.title, session_date: session.session_date,
        team_name: event.teams.find(t => t.number === r.team_number).name, placement: r.placement, points: Number(r.points),
        bonus_points: Number(r.bonus_points || 0), base_points: Math.round((Number(r.points) - Number(r.bonus_points || 0)) * 1e6) / 1e6 };
    }).sort((a, b) => -chronological(eventMap.get(a.event_id), eventMap.get(b.event_id)));
    payload.my_events = ownPlayer ? released.filter(e => !sessions.get(e.session_id).is_cancelled
      && sessions.get(e.session_id).session_date >= dateNow
      && e.teams.some(t => t.players.some(p => p.id === ownPlayer.id)))
      .sort(chronological).map(e => ({
        ...publicEvent(e, sessions.get(e.session_id)),
        my_team_number: e.teams.find(t => t.players.some(p => p.id === ownPlayer.id)).number,
      })) : [];
  }
  return payload;
}

function playerView(world, season = selectSeason(world.seasons)) {
  return world.profiles.filter(p => !p.merged_into && (p.user_id === null
    || world.users.some(u => u.id === p.user_id && u.is_active && u.status === 'approved'))).map(profile => {
    const rookie = profile.is_rookie;
    const initial = profile.initial_rating !== null ? Number(profile.initial_rating)
      : Number((season || DEFAULTS)[rookie ? 'rookie_rating' : 'default_rating']);
    const delta = world.results.filter(r => r.player_id === profile.id).reduce((sum, r) => sum + Number(r.rating_delta), 0);
    return { id: profile.id, user_id: profile.user_id, display_name: profile.display_name, gender: profile.gender,
      is_rookie: rookie, initial_rating: initial, rating: Math.round((initial + delta) * 1e6) / 1e6 };
  });
}

function rsvpUserIds(world, sessionId) {
  return world.attendance.filter(a => a.session_id === sessionId).map(a => a.user_id).sort();
}

function leagueIdsForUsers(world, userIds) {
  return world.profiles.filter(p => !p.merged_into && userIds.includes(p.user_id)).map(p => p.id).sort();
}

function linkPlan(world, playerId, userId) {
  const target = world.profiles.find(p => p.id === playerId && !p.merged_into);
  assert(target, 'League player not found', 404);
  assert(world.users.some(u => u.id === userId && u.is_active && u.status === 'approved'),
    'Approved active member not found', 404);
  assert(target.user_id === null || target.user_id === userId, 'Player is already linked to another account', 409);
  const source = world.profiles.find(p => p.user_id === userId && !p.merged_into);
  if (source && source.id !== target.id) {
    assert(!world.events.some(e => {
      const ids = e.teams.flatMap(t => t.players.map(p => p.id));
      return ids.includes(source.id) && ids.includes(target.id);
    }), 'Both identities appear in the same event. Resolve the duplicate roster before linking.', 409);
  }
  return { target, source };
}

function adminView(world) {
  const players = playerView(world);
  return {
    seasons: world.seasons.map(s => ({ ...seasonSummary(s), ...settings(s) })),
    players,
    members: world.users.filter(u => u.is_active && u.status === 'approved')
      .map(({ id, display_name, league_scorekeeper }) => ({ id, display_name, league_scorekeeper: league_scorekeeper === true })),
    sessions: world.sessions.map(s => ({ id: s.id, title: s.title, session_date: s.session_date,
      start_time: s.start_time, end_time: s.end_time, location: s.location, is_cancelled: s.is_cancelled,
      attending_count: world.attendance.filter(a => a.session_id === s.id).length,
      attending_player_ids: leagueIdsForUsers(world, rsvpUserIds(world, s.id)) })),
    events: world.events.map(e => {
      const session = world.sessions.find(s => s.id === e.session_id);
      return { id: e.id, season_id: e.season_id, session_id: e.session_id, title: session.title,
        session_date: session.session_date, start_time: session.start_time, end_time: session.end_time, location: session.location,
        team_size: e.team_size, status: e.status, version: e.version,
        ...bonusSettings(e.settings), bonus_points: Object.fromEntries(bonusAwards(e).map(a => [a.player_id, a.points])),
        max_teams: e.max_teams || 5, roster_locked: Boolean(e.roster_locked || e.status === 'finalized' || hasMatchScores(e)),
        ...matchData(e),
        placement_points: [...e.settings.placement_points], k_factor: Number(e.settings.k_factor),
        scoring_mode: e.settings.scoring_mode || 'fixed',
        points_step: Number(e.settings.points_step === undefined ? 0.5 : e.settings.points_step),
        roster_source: e.roster_source, player_ids: e.roster_ids,
        rsvp_player_ids: leagueIdsForUsers(world, e.rsvp_user_ids),
        current_rsvp_player_ids: leagueIdsForUsers(world, rsvpUserIds(world, e.session_id)),
        roster_stale: e.status === 'draft' && (
          JSON.stringify(e.rsvp_user_ids) !== JSON.stringify(rsvpUserIds(world, e.session_id))
          || e.roster_ids.some(id => !players.some(p => p.id === id))
          || session.is_cancelled || session.session_date !== e.session_date),
        teams: e.teams.map(t => ({ number: t.number, name: t.name, placement: t.placement,
          players: t.players.map(({ id, display_name, gender, is_rookie, rating }) =>
            ({ id, display_name, gender, is_rookie, rating })) })) };
    }),
  };
}

module.exports = {
  DEFAULTS, LeagueError, assert, uuid, today, settings, pointsForPlacement, validateAction,
  chooseTeamSize, balanceTeams, editTeams, scoreEvent, selectSeason, publicView, playerView, adminView,
  rsvpUserIds, leagueIdsForUsers, linkPlan, scheduleSettings, matchData, hasMatchScores,
  requireEditableRoster, eventPlacements, buildSchedule, bonusSettings, bonusAwards, pruneBonusAwards,
  draftTeams, requirePublishableRoster, publicEvent, finaleResults, requireFinaleAwards,
};
