const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, adminStatisticsView, publicView } = require('../lib/league');

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function fixture() {
  const users = [1, 2, 3, 4].map(value => ({
    id: id(100 + value), display_name: `Member ${value}`, is_active: true, status: 'approved'
  }));
  const profiles = users.map((user, index) => ({
    id: id(index + 1), user_id: user.id, display_name: `Player ${index + 1}`,
    gender: 'unspecified', is_rookie: false, initial_rating: 1000, merged_into: null
  }));
  const season = { id: id(200), name: 'Season 2', start_date: '2026-01-01', end_date: '2026-12-31', ...DEFAULTS };
  const sessions = [1, 2, 3].map(value => ({
    id: id(300 + value), title: `Training ${value}`, session_date: `2026-09-${String(10 + value).padStart(2, '0')}`,
    start_time: '19:00:00', end_time: '21:00:00', location: 'Vienna', is_cancelled: false
  }));
  const placements = [[1, 2, 3], [3, 1, 2]];
  const events = sessions.map((session, index) => ({
    id: id(400 + index), season_id: season.id, session_id: session.id, session_date: session.session_date,
    status: index < 2 ? 'finalized' : 'published', version: 1, team_size: 1, max_teams: 3,
    settings: { ...DEFAULTS }, schedule: null, bonus_points: [], roster_ids: profiles.map(profile => profile.id),
    rsvp_user_ids: users.map(user => user.id), roster_source: 'manual',
    teams: [1, 2, 3].map(teamNumber => ({
      number: teamNumber, name: `Team ${teamNumber}`,
      placement: index < 2 ? placements[index][teamNumber - 1] : null,
      players: (teamNumber === 1 ? [profiles[0], profiles[3]] : [profiles[teamNumber - 1]])
        .map(profile => ({ ...profile, rating: 1000 }))
    }))
  }));
  const awards = [[2, 1.5, 1], [1, 2, 1.5]];
  const teamNumbers = [1, 2, 3, 1];
  const results = events.slice(0, 2).flatMap((event, eventIndex) => profiles.map((profile, playerIndex) => {
    const teamNumber = teamNumbers[playerIndex];
    return {
      event_id: event.id,
      player_id: profile.id,
      display_name: profile.display_name,
      team_number: teamNumber,
      placement: placements[eventIndex][teamNumber - 1],
      points: awards[eventIndex][teamNumber - 1],
      bonus_points: 0,
      rating_delta: 0
    };
  }));
  return { users, profiles, seasons: [season], sessions, events, results, attendance: [] };
}

test('admin statistics aggregate every finalized placement and ignore unfinalized events', () => {
  const world = fixture();
  const result = adminStatisticsView(world, world.seasons[0].id, '2026-09-17');
  assert.equal(result.finalized_event_count, 2);
  assert.equal(result.events.length, 3);
  assert.equal(result.players.length, 4);
  assert.deepEqual(result.players.map(player => [player.display_name, player.rank, player.points]), [
    ['Player 2', 1, 3.5],
    ['Player 1', 2, 3],
    ['Player 4', 2, 3],
    ['Player 3', 4, 2.5]
  ]);
  assert.deepEqual(result.players[1].placement_counts, { 1: 1, 3: 1 });
  assert.equal(result.players[1].average_placement, 2);
  assert.equal(result.players[1].best_placement, 1);
  assert.equal(result.players[1].win_rate, 50);
  assert.deepEqual(result.players[1].teammates, [{
    id: world.profiles[3].id,
    display_name: 'Player 4',
    played_together: 2,
    wins_together: 1
  }]);
  assert.equal(result.players.reduce((sum, player) => sum + player.played, 0), 8);
});

test('linked members receive their own placement statistics without exposing private league IDs publicly', () => {
  const world = fixture();
  const member = publicView(world, world.seasons[0].id, world.users[0].id, '2026-09-17');
  assert.equal(member.player_linked, true);
  assert.deepEqual(member.performance, {
    average_placement: 2,
    best_placement: 1,
    podiums: 2,
    placement_counts: { 1: 1, 3: 1 }
  });
  assert.deepEqual(member.teammates, [{
    display_name: 'Player 4',
    played_together: 2,
    wins_together: 1
  }]);
  assert.equal(member.history.length, 2);
  assert.doesNotMatch(JSON.stringify(member), new RegExp(world.profiles[0].id));
  const unlinked = publicView(world, world.seasons[0].id, id(999), '2026-09-17');
  assert.equal(unlinked.player_linked, false);
  assert.deepEqual(unlinked.performance, {
    average_placement: null, best_placement: null, podiums: 0, placement_counts: {}
  });
  assert.deepEqual(unlinked.teammates, []);
});

test('an admin can open statistics for a configured season before any result is finalized', () => {
  const world = fixture();
  world.events = [];
  world.results = [];
  const result = adminStatisticsView(world, world.seasons[0].id, '2026-09-17');
  assert.equal(result.season.id, world.seasons[0].id);
  assert.deepEqual(result.players, []);
  assert.deepEqual(result.events, []);
  assert.equal(result.finalized_event_count, 0);
});
