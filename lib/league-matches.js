class MatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MatchError';
    this.status = 400;
    this.code = 'VALIDATION_ERROR';
  }
}

const REFEREE_POLICY = 'rotating_team_v1';

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MatchError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function teamNumbers(teamCount) {
  integer(teamCount, 2, 5, 'Team count for this round-robin format');
  return Array.from({ length: teamCount }, (_, index) => index + 1);
}

function time(value, fallback) {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate)) {
    throw new MatchError('Meetup time must use HH:MM.');
  }
  return candidate;
}

function compareScore(a, b) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function assignReferees(rounds, teams) {
  const counts = new Map(teams.map(team => [team, 0]));
  const assignments = [];
  let best = null;
  function visit(index, consecutive) {
    if (index === rounds.length) {
      const values = [...counts.values()];
      const score = [
        Math.max(...values) - Math.min(...values),
        consecutive,
        values.reduce((sum, value) => sum + value * value, 0),
        ...assignments,
      ];
      if (!best || compareScore(score, best.score) < 0) best = { score, assignments: [...assignments] };
      return;
    }
    for (const team of rounds[index].bye_teams) {
      assignments.push(team);
      counts.set(team, counts.get(team) + 1);
      visit(index + 1, consecutive + Number(index > 0 && assignments[index - 1] === team));
      counts.set(team, counts.get(team) - 1);
      assignments.pop();
    }
  }
  visit(0, 0);
  return best.assignments;
}

function buildSchedule(teamCount, settings = {}) {
  const teams = teamNumbers(teamCount);
  if (teamCount < 3) throw new MatchError('At least three teams are required so one team can referee every match slot.');
  const courts = integer(settings.courts === undefined ? 2 : settings.courts, 1, 2, 'Courts');
  const recommendedMatch = teamCount === 3 ? 30 : teamCount === 4 ? 15 : 17;
  const recommendedBreak = teamCount === 3 ? 7 : teamCount === 4 ? 3 : 5;
  const matchMinutes = integer(settings.match_minutes === undefined ? recommendedMatch : settings.match_minutes, 1, 60, 'Match minutes');
  const breakMinutes = integer(settings.break_minutes === undefined ? recommendedBreak : settings.break_minutes, 0, 30, 'Break minutes');
  const availableMinutes = integer(settings.available_minutes === undefined ? 120 : settings.available_minutes, 1, 480, 'Available minutes');
  const warmupMinutes = integer(settings.warmup_minutes === undefined ? 15 : settings.warmup_minutes, 0, 120, 'Warm-up minutes');
  const finaleMinutes = integer(settings.finale_minutes === undefined ? 10 : settings.finale_minutes, 1, 10, 'Finale minutes');
  const meetupTime = time(settings.meetup_time, '18:00');
  if (warmupMinutes >= availableMinutes) throw new MatchError('Warm-up time must end before the games cutoff.');
  const activeCourts = Math.min(courts, Math.floor((teamCount - 1) / 2));
  const rotation = [...teams];
  if (rotation.length % 2) rotation.push(0);
  const rounds = [];
  let matchNumber = 0;
  for (let round = 0; round < rotation.length - 1; round++) {
    const pairs = [];
    for (let index = 0; index < rotation.length / 2; index++) {
      const teamA = rotation[index];
      const teamB = rotation[rotation.length - 1 - index];
      if (teamA && teamB) pairs.push([teamA, teamB]);
    }
    for (let offset = 0; offset < pairs.length; offset += activeCourts) {
      const matches = pairs.slice(offset, offset + activeCourts).map(([teamA, teamB], court) => ({
        number: ++matchNumber, team_a: teamA, team_b: teamB,
        court: court + 1, score_a: null, score_b: null
      }));
      const playing = new Set(matches.flatMap(match => [match.team_a, match.team_b]));
      const startMinute = warmupMinutes + rounds.length * (matchMinutes + breakMinutes);
      rounds.push({
        number: rounds.length + 1, start_minute: startMinute, end_minute: startMinute + matchMinutes,
        bye_teams: teams.filter(team => !playing.has(team)), matches
      });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  const referees = assignReferees(rounds, teams);
  rounds.forEach((round, index) => {
    const referee = referees[index];
    round.referee_team = referee;
    round.rest_teams = round.bye_teams.filter(team => team !== referee);
  });
  const durationMinutes = rounds[rounds.length - 1].end_minute;
  if (durationMinutes > availableMinutes) {
    throw new MatchError(`This referee-safe round robin needs ${durationMinutes} minutes from meetup, but games must finish by minute ${availableMinutes}. Shorten games or changeovers, or use three/five teams with the recommended court setup.`);
  }
  return {
    courts, active_courts: activeCourts, match_minutes: matchMinutes, break_minutes: breakMinutes,
    meetup_time: meetupTime, warmup_minutes: warmupMinutes, available_minutes: availableMinutes,
    duration_minutes: durationMinutes, finale_start_minute: availableMinutes,
    finale_minutes: finaleMinutes, total_duration_minutes: availableMinutes + finaleMinutes,
    referee_policy: REFEREE_POLICY, rounds
  };
}

function scoreValue(value) {
  return integer(value, 0, 999, 'Match score');
}

function tied(a, b) {
  return a.table_points === b.table_points && a.score_difference === b.score_difference && a.score_for === b.score_for;
}

function matchStandings(teamCount, schedule) {
  const teams = teamNumbers(teamCount);
  if (!schedule || !Array.isArray(schedule.rounds) || !schedule.rounds.length) {
    throw new MatchError('Generate a round-robin schedule first.');
  }
  integer(schedule.courts, 1, 2, 'Courts');
  const rows = teams.map(team => ({
    team_number: team, played: 0, won: 0, drawn: 0, lost: 0,
    score_for: 0, score_against: 0, score_difference: 0, table_points: 0
  }));
  const pairs = new Set();
  const numbers = new Set();
  const strictReferees = schedule.referee_policy === REFEREE_POLICY;
  const refereeCounts = new Map(teams.map(team => [team, 0]));
  let complete = true;
  for (const round of schedule.rounds) {
    if (!Array.isArray(round.matches) || !round.matches.length || round.matches.length > schedule.courts) {
      throw new MatchError('A schedule slot has an invalid number of matches.');
    }
    const playing = new Set();
    const courts = new Set();
    for (const match of round.matches) {
      integer(match.number, 1, teamCount * (teamCount - 1) / 2, 'Match number');
      integer(match.team_a, 1, teamCount, 'Team A');
      integer(match.team_b, 1, teamCount, 'Team B');
      integer(match.court, 1, schedule.courts, 'Court');
      const pair = [match.team_a, match.team_b].sort((a, b) => a - b).join(':');
      if (match.team_a === match.team_b || pairs.has(pair) || numbers.has(match.number)
        || playing.has(match.team_a) || playing.has(match.team_b) || courts.has(match.court)) {
        throw new MatchError('The schedule contains a duplicate pairing, match, or simultaneous team/court booking.');
      }
      pairs.add(pair);
      numbers.add(match.number);
      playing.add(match.team_a);
      playing.add(match.team_b);
      courts.add(match.court);
      if (match.score_a === null && match.score_b === null) { complete = false; continue; }
      scoreValue(match.score_a);
      scoreValue(match.score_b);
      const a = rows[match.team_a - 1];
      const b = rows[match.team_b - 1];
      a.played++;
      b.played++;
      a.score_for += match.score_a;
      a.score_against += match.score_b;
      b.score_for += match.score_b;
      b.score_against += match.score_a;
      if (match.score_a === match.score_b) {
        a.drawn++;
        b.drawn++;
        a.table_points++;
        b.table_points++;
      } else {
        const winner = match.score_a > match.score_b ? a : b;
        const loser = winner === a ? b : a;
        winner.won++;
        winner.table_points += 2;
        loser.lost++;
      }
    }
    if (strictReferees) {
      integer(round.referee_team, 1, teamCount, 'Referee team');
      if (playing.has(round.referee_team)) {
        throw new MatchError('A referee team cannot play in the same schedule slot.');
      }
      const byes = teams.filter(team => !playing.has(team));
      const rests = byes.filter(team => team !== round.referee_team);
      if (!Array.isArray(round.bye_teams)
        || JSON.stringify([...round.bye_teams].sort((a, b) => a - b)) !== JSON.stringify(byes)
        || !Array.isArray(round.rest_teams)
        || JSON.stringify([...round.rest_teams].sort((a, b) => a - b)) !== JSON.stringify(rests)) {
        throw new MatchError('The schedule has invalid referee or resting-team assignments.');
      }
      refereeCounts.set(round.referee_team, refereeCounts.get(round.referee_team) + 1);
    }
  }
  if (pairs.size !== teamCount * (teamCount - 1) / 2) {
    throw new MatchError('The schedule must include every pairing exactly once.');
  }
  if (strictReferees) {
    const assignments = [...refereeCounts.values()];
    if (Math.max(...assignments) - Math.min(...assignments) > 1) {
      throw new MatchError('Referee duties must be shared fairly across all teams.');
    }
  }
  rows.forEach(row => { row.score_difference = row.score_for - row.score_against; });
  rows.sort((a, b) => b.table_points - a.table_points || b.score_difference - a.score_difference || b.score_for - a.score_for || a.team_number - b.team_number);
  let rank = 1;
  let hasTies = false;
  rows.forEach((row, index) => {
    if (index > 0) {
      if (tied(row, rows[index - 1])) hasTies = true;
      else rank = index + 1;
    }
    row.rank = rank;
  });
  return {
    complete, has_ties: complete && hasTies, standings: rows,
    placements: complete && !hasTies ? rows.map(row => ({ team_number: row.team_number, placement: row.rank })) : null
  };
}

function resolvePlacements(teamCount, schedule, placements) {
  const result = matchStandings(teamCount, schedule);
  if (!result.complete) throw new MatchError('Record both scores for every match before finalizing results.');
  if (placements === undefined || placements === null) {
    if (result.has_ties) throw new MatchError('Teams are still tied. Admins must explicitly resolve their final placements.');
    return result.placements;
  }
  if (!Array.isArray(placements) || placements.length !== teamCount) {
    throw new MatchError('A final placement is required for every team.');
  }
  const byTeam = new Map();
  const usedPlaces = new Set();
  for (const entry of placements) {
    if (!entry || typeof entry !== 'object') throw new MatchError('Invalid placement entry.');
    integer(entry.team_number, 1, teamCount, 'Team number');
    integer(entry.placement, 1, teamCount, 'Placement');
    if (byTeam.has(entry.team_number) || usedPlaces.has(entry.placement)) throw new MatchError('Duplicate team or placement.');
    byTeam.set(entry.team_number, entry.placement);
    usedPlaces.add(entry.placement);
  }
  for (const row of result.standings) {
    const groupSize = result.standings.filter(other => tied(row, other)).length;
    const placement = byTeam.get(row.team_number);
    if (placement < row.rank || placement >= row.rank + groupSize) {
      throw new MatchError('Placements must follow match-table points, score difference and points scored. Only exact ties can be reordered.');
    }
  }
  return [...byTeam].map(([team_number, placement]) => ({ team_number, placement }));
}

function updateMatchScore(teamCount, schedule, matchNumber, scoreA, scoreB) {
  matchStandings(teamCount, schedule);
  integer(matchNumber, 1, teamCount * (teamCount - 1) / 2, 'Match number');
  scoreValue(scoreA);
  scoreValue(scoreB);
  const updated = structuredClone(schedule);
  const match = updated.rounds.flatMap(round => round.matches).find(entry => entry.number === matchNumber);
  if (!match) throw new MatchError('Match not found.');
  match.score_a = scoreA;
  match.score_b = scoreB;
  return updated;
}

module.exports = { MatchError, REFEREE_POLICY, buildSchedule, matchStandings, resolvePlacements, updateMatchScore };
