const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, publicView, buildSchedule } = require('../lib/league');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dateNow = '2026-09-12';
const memberId = id(1001);
const canonicalId = id(50);
function fixture() {
  const canonical = { id: canonicalId, user_id: memberId, merged_into: null, display_name: 'Former guest name',
    gender: 'female', is_rookie: true, initial_rating: 800, rating: 812 };
  const other = { ...canonical, id: id(2), user_id: id(1002) };
  const world = {
    users: [{ id: memberId, display_name: 'Different account name', is_active: true, status: 'approved' }],
    profiles: [{ ...canonical, id: id(1), user_id: null, merged_into: canonicalId }, canonical, other],
    seasons: [
      { id: id(100), name: 'Selected season', start_date: '2026-01-01', end_date: '2026-12-31', ...DEFAULTS },
      { id: id(101), name: 'Next season', start_date: '2027-01-01', end_date: '2027-12-31', ...DEFAULTS },
    ],
    sessions: [], events: [], results: [], attendance: [],
  };
  function add(n, date, status = 'published', seasonId = id(100), player = canonical) {
    world.sessions.push({ id: id(200 + n), title: `Training ${n}`, session_date: date,
      start_time: '19:00:00', location: 'Vienna', is_cancelled: n === 5 });
    world.events.push({ id: id(300 + n), session_id: id(200 + n), season_id: seasonId,
      session_date: date, status, team_size: 4, settings: { ...DEFAULTS }, schedule: buildSchedule(2),
      teams: [
        { number: 1, name: 'Others', placement: 1, players: [{ ...other, id: id(3) }] },
        { number: 2, name: 'My squad', placement: 2, players: [structuredClone(player)] },
      ] });
  }
  add(1, '2026-09-11');
  add(2, dateNow);
  world.sessions.at(-1).start_time = '09:00:00';
  add(3, '2027-01-01', 'finalized', id(101));
  add(4, '2026-09-13', 'draft');
  add(5, '2026-09-14');
  add(6, '2026-09-15', 'published', id(100), { ...other, user_id: memberId });
  add(7, '2026-09-16', 'published', id(100), world.profiles[0]);
  add(8, dateNow);
  return world;
}
const view = (world, userId = memberId, seasonId = id(100)) => publicView(world, seasonId, userId, dateNow);

test('my_events includes today and future published/finalized teams across all seasons in chronological order', () => {
  const world = fixture();
  const before = structuredClone(world);
  const payload = view(world);
  assert.deepEqual(payload.my_events.map(e => e.id), [id(302), id(308), id(303)]);
  assert(payload.my_events.every(e => e.my_team_number === 2));
  assert.equal(payload.my_events.at(-1).season_id, id(101));
  assert.equal(payload.my_events.at(-1).status, 'finalized');
  assert.deepEqual(view(world, memberId, id(101)).my_events, payload.my_events,
    'Selected season only scopes stats/history/standings, not upcoming participation');
  assert.deepEqual(world, before);
});

test('membership is matched only by canonical league identity, never account ID, display name, merge source or RSVP', () => {
  const world = fixture();
  world.attendance.push({ session_id: id(206), user_id: memberId });
  assert.deepEqual(view(world).my_events.map(e => e.id), [id(302), id(308), id(303)]);
  assert.deepEqual(view(world, id(9999)).my_events, []);
  world.profiles.find(p => p.id === canonicalId).user_id = null;
  assert.deepEqual(view(world).my_events, [], 'No canonical linked profile means no personal roster');
});

test('anonymous events and member fixtures use explicit public projections without private player data', () => {
  const world = fixture();
  world.events[1].schedule.private_note = 'private schedule note';
  world.events[1].schedule.rounds[0].matches[0].player_id = canonicalId;
  const member = view(world);
  const event = member.my_events[0];
  assert.equal(event.session_id, id(202));
  assert.equal(event.end_time, '09:20:00');
  assert.equal(event.schedule.rounds[0].matches.length, 1);
  assert.equal(event.match_standings.standings.length, 2);
  assert.deepEqual(Object.keys(event.teams[1].players[0]), ['display_name']);
  assert.equal(event.teams[1].players[0].display_name, 'Former guest name');
  assert.doesNotMatch(JSON.stringify(member), /"(rating|rating_delta|initial_rating|gender|is_rookie|user_id|player_id|merged_into|private_note)"/);
  assert(!JSON.stringify(member).includes(canonicalId));
  const anonymous = publicView(world, id(100), undefined, dateNow);
  assert.doesNotMatch(JSON.stringify(anonymous), /"(stats|history|my_events|my_team_number)"/);
  const { my_team_number, ...safeEvent } = event;
  assert.deepEqual(safeEvent, anonymous.events.find(e => e.id === event.id));
});

test('end_time prefers the actual session end, otherwise derives only a known schedule end', () => {
  const world = fixture();
  world.sessions.find(s => s.id === id(202)).end_time = '21:15:00';
  world.sessions.find(s => s.id === id(208)).start_time = '23:55:30';
  const events = view(world).my_events;
  assert.equal(events.find(e => e.id === id(302)).end_time, '21:15:00');
  assert.equal(events.find(e => e.id === id(308)).end_time, '00:15:30');
  world.events.find(e => e.id === id(308)).schedule = null;
  assert.equal(view(world).my_events.find(e => e.id === id(308)).end_time, null);
  world.sessions.find(s => s.id === id(203)).start_time = null;
  assert.equal(view(world).my_events.find(e => e.id === id(303)).end_time, null);
});

test('unpublishing a training immediately removes it from personal fixtures without changing attendance', () => {
  const world = fixture();
  world.events.find(e => e.id === id(302)).status = 'draft';
  assert.deepEqual(view(world).my_events.map(e => e.id), [id(308), id(303)]);
});
