class MatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MatchError';
    this.status = 400;
    this.code = 'VALIDATION_ERROR';
  }
}

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

function buildSchedule(teamCount, settings = {}) {
  const teams = teamNumbers(teamCount);
  const courts = integer(settings.courts === undefined ? 2 : settings.courts, 1, 2, 'Courts');
  const matchMinutes = integer(settings.match_minutes === undefined ? 20 : settings.match_minutes, 1, 60, 'Match minutes');
  const breakMinutes = integer(settings.break_minutes === undefined ? 5 : settings.break_minutes, 0, 30, 'Break minutes');
  const availableMinutes = integer(settings.available_minutes === undefined ? 120 : settings.available_minutes, 1, 480, 'Available minutes');
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
    for (let offset = 0; offset < pairs.length; offset += courts) {
      const matches = pairs.slice(offset, offset + courts).map(([teamA, teamB], court) => ({
        number: ++matchNumber, team_a: teamA, team_b: teamB,
        court: court + 1, score_a: null, score_b: null
      }));
      const playing = new Set(matches.flatMap(match => [match.team_a, match.team_b]));
      const startMinute = rounds.length * (matchMinutes + breakMinutes);
      rounds.push({
        number: rounds.length + 1, start_minute: startMinute, end_minute: startMinute + matchMinutes,
        bye_teams: teams.filter(team => !playing.has(team)), matches
      });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  const durationMinutes = rounds[rounds.length - 1].end_minute;
  if (durationMinutes > availableMinutes) {
    throw new MatchError(`This round robin needs ${durationMinutes} minutes, but only ${availableMinutes} are available. Shorten games or changeovers, use more courts, or reduce the number of teams.`);
  }
  return {
    courts, match_minutes: matchMinutes, break_minutes: breakMinutes,
    available_minutes: availableMinutes, duration_minutes: durationMinutes, rounds
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
  }
  if (pairs.size !== teamCount * (teamCount - 1) / 2) {
    throw new MatchError('The schedule must include every pairing exactly once.');
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

module.exports = { MatchError, buildSchedule, matchStandings, resolvePlacements, updateMatchScore };
