const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MatchError, REFEREE_POLICY, EXTERNAL_REFEREE_POLICY,
  buildSchedule, matchStandings, resolvePlacements, updateMatchScore,
} = require('../lib/league-matches');

function finish(schedule, score) {
  const completed = structuredClone(schedule);
  for (const match of completed.rounds.flatMap(round => round.matches)) {
    [match.score_a, match.score_b] = score(match);
  }
  return completed;
}

test('five teams fit ten referee-covered games after warm-up and finish at 20:00', () => {
  const schedule = buildSchedule(5);
  assert.equal(schedule.duration_minutes, 120);
  assert.equal(schedule.rounds.length, 5);
  assert.deepEqual(schedule.rounds.map(round => [round.start_minute, round.end_minute]), [[15, 32], [37, 54], [59, 76], [81, 98], [103, 120]]);
  assert.equal(schedule.rounds.flatMap(round => round.matches).length, 10);
  assert.deepEqual(schedule.rounds.map(round => round.bye_teams[0]).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(schedule.rounds.map(round => round.referee_team).sort(), [1, 2, 3, 4, 5]);
  assert(schedule.rounds.every(round => round.rest_teams.length === 0));
  assert.equal(schedule.meetup_time, '18:00');
  assert.equal(schedule.warmup_minutes, 15);
  assert.equal(schedule.finale_start_minute, 120);
  assert.equal(schedule.finale_minutes, 10);
  assert.equal(schedule.total_duration_minutes, 130);
});

test('all referee-safe team/court counts cover every pair once and rotate one non-playing referee team', () => {
  for (let count = 3; count <= 5; count++) {
    for (let courts = 1; courts <= 2; courts++) {
      const schedule = buildSchedule(count, { courts, available_minutes: 480 });
      const appearances = new Map();
      const refereeCounts = new Map(Array.from({ length: count }, (_, index) => [index + 1, 0]));
      const pairs = new Set();
      for (const round of schedule.rounds) {
        const playing = round.matches.flatMap(match => [match.team_a, match.team_b]);
        assert.equal(new Set(playing).size, playing.length);
        assert.ok(round.matches.length <= courts);
        assert.ok(!playing.includes(round.referee_team));
        assert.ok(round.bye_teams.includes(round.referee_team));
        assert.deepEqual(round.rest_teams, round.bye_teams.filter(team => team !== round.referee_team));
        refereeCounts.set(round.referee_team, refereeCounts.get(round.referee_team) + 1);
        for (const match of round.matches) {
          const pair = [match.team_a, match.team_b].sort().join(':');
          assert.ok(!pairs.has(pair));
          pairs.add(pair);
          for (const team of [match.team_a, match.team_b]) appearances.set(team, (appearances.get(team) || 0) + 1);
        }
      }
      assert.equal(pairs.size, count * (count - 1) / 2);
      assert.deepEqual([...appearances.values()], Array(count).fill(count - 1));
      assert.ok(Math.max(...refereeCounts.values()) - Math.min(...refereeCounts.values()) <= 1);
      assert.equal(matchStandings(count, schedule).complete, false);
      if (count === 4) {
        assert.equal(schedule.active_courts, 1);
        assert.equal(schedule.rounds.length, 6);
        assert.ok(schedule.rounds.every(round => round.matches.length === 1 && round.rest_teams.length === 1));
      }
    }
  }
});

test('two teams play one head-to-head fixture with an explicit external Head Ref', () => {
  const schedule = buildSchedule(2);
  assert.equal(schedule.referee_policy, EXTERNAL_REFEREE_POLICY);
  assert.equal(schedule.active_courts, 1);
  assert.equal(schedule.rounds.length, 1);
  assert.equal(schedule.rounds[0].matches.length, 1);
  assert.deepEqual(schedule.rounds[0].bye_teams, []);
  assert.equal(schedule.rounds[0].referee_team, null);
  assert.deepEqual(schedule.rounds[0].rest_teams, []);
  assert.equal(schedule.rounds[0].start_minute, 15);
  assert.equal(schedule.rounds[0].end_minute, 75);
  assert.equal(schedule.finale_start_minute, 120);
  assert.equal(schedule.total_duration_minutes, 130);

  const completed = finish(schedule, () => [4, 2]);
  const table = matchStandings(2, completed);
  assert.equal(table.complete, true);
  assert.deepEqual(table.placements, [
    { team_number: completed.rounds[0].matches[0].team_a, placement: 1 },
    { team_number: completed.rounds[0].matches[0].team_b, placement: 2 },
  ]);
  assert.equal(REFEREE_POLICY, 'rotating_team_v1');

  const invalid = structuredClone(schedule);
  invalid.rounds[0].referee_team = 1;
  assert.throws(() => matchStandings(2, invalid), /external referee/);
  const wrongPolicy = structuredClone(schedule);
  wrongPolicy.referee_policy = REFEREE_POLICY;
  assert.throws(() => matchStandings(2, wrongPolicy), /Referee team/);
});

test('infeasible budgets are rejected instead of silently shortening games', () => {
  assert.throws(() => buildSchedule(5, { courts: 1 }), /needs 230 minutes/);
  assert.throws(() => buildSchedule(5, { available_minutes: 119 }), /needs 120 minutes/);
  assert.throws(() => buildSchedule(6), /between 2 and 5/);
  assert.equal(buildSchedule(5, { match_minutes: 16 }).duration_minutes, 115);
});

test('wins, draws and losses produce 2/1/0 table points and an automatic winner', () => {
  const schedule = finish(buildSchedule(5), match => match.team_a < match.team_b ? [3, 1] : [1, 3]);
  const result = matchStandings(5, schedule);
  assert.equal(result.complete, true);
  assert.equal(result.has_ties, false);
  assert.deepEqual(result.standings.map(team => team.team_number), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.standings.map(team => team.table_points), [8, 6, 4, 2, 0]);
  assert.deepEqual(result.standings.map(team => team.played), [4, 4, 4, 4, 4]);
  assert.deepEqual(resolvePlacements(5, schedule), result.placements);
});

test('score difference and then points scored break equal table points', () => {
  const scores = { '1:2': [3, 1], '1:3': [1, 2], '2:3': [4, 1] };
  const schedule = finish(buildSchedule(3), match => {
    const pair = [match.team_a, match.team_b].sort((a, b) => a - b).join(':');
    return match.team_a < match.team_b ? scores[pair] : [...scores[pair]].reverse();
  });
  const result = matchStandings(3, schedule);
  assert.deepEqual(result.standings.map(team => team.table_points), [2, 2, 2]);
  assert.deepEqual(result.standings.map(team => team.team_number), [2, 1, 3]);
});

test('exact ties require explicit resolution without fabricating a winner', () => {
  const schedule = finish(buildSchedule(5), () => [0, 0]);
  const result = matchStandings(5, schedule);
  assert.equal(result.has_ties, true);
  assert.equal(result.placements, null);
  assert.deepEqual(result.standings.map(team => team.table_points), [4, 4, 4, 4, 4]);
  assert.throws(() => resolvePlacements(5, schedule), /explicitly resolve/);
  const places = [1, 2, 3, 4, 5].map(team => ({ team_number: team, placement: 6 - team }));
  assert.deepEqual(resolvePlacements(5, schedule, places), places);
});

test('admins may only reorder exact tie groups, not override stronger results', () => {
  const schedule = finish(buildSchedule(4, { match_minutes: 15, break_minutes: 3 }), match => {
    if (match.team_a === 1 && match.team_b === 2) return [2, 1];
    if (match.team_a === 2 && match.team_b === 1) return [1, 2];
    return [1, 1];
  });
  const places = [{ team_number: 1, placement: 1 }, { team_number: 4, placement: 2 }, { team_number: 3, placement: 3 }, { team_number: 2, placement: 4 }];
  assert.deepEqual(resolvePlacements(4, schedule, places), places);
  assert.throws(() => resolvePlacements(4, schedule, places.map(entry => ({ ...entry, placement: 5 - entry.placement }))), /Only exact ties/);
});

test('incomplete, invalid or duplicate matches cannot be finalized', () => {
  const schedule = buildSchedule(5);
  assert.throws(() => resolvePlacements(5, schedule), /every match/);
  const invalid = structuredClone(schedule);
  invalid.rounds[0].matches[0].score_a = 1;
  assert.throws(() => matchStandings(5, invalid), MatchError);
  const duplicate = structuredClone(schedule);
  duplicate.rounds[0].matches[1].team_a = duplicate.rounds[0].matches[0].team_a;
  assert.throws(() => matchStandings(5, duplicate), /simultaneous/);
  const missing = structuredClone(schedule);
  missing.rounds.pop();
  assert.throws(() => matchStandings(5, missing), /every pairing/);
});

test('score updates are immutable and reject invalid values', () => {
  const schedule = buildSchedule(5);
  const updated = updateMatchScore(5, schedule, 1, 3, 2);
  assert.equal(schedule.rounds[0].matches[0].score_a, null);
  assert.equal(updated.rounds[0].matches[0].score_a, 3);
  for (const invalid of [-1, 0.5, NaN, '3', 1000, null]) {
    assert.throws(() => updateMatchScore(5, schedule, 1, invalid, 2), MatchError);
  }
});
