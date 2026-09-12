const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULTS, validateAction, playerView, adminView, publicView, balanceTeams, scoreEvent, linkPlan,
} = require('../lib/league');
const { applyAction, syncPlayers, dbError } = require('../lib/league-db');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function worldFixture() {
  const users = Array.from({ length: 12 }, (_, i) => ({
    id: id(1001 + i), display_name: `Member ${i + 1}`, is_active: true, status: 'approved',
  }));
  const profiles = users.map((u, i) => ({ id: id(i + 1), user_id: u.id, display_name: u.display_name,
    gender: 'unspecified', is_rookie: false, initial_rating: 1000, merged_into: null }));
  profiles.push({ id: id(50), user_id: null, display_name: 'Named Guest',
    gender: 'unspecified', is_rookie: true, initial_rating: 800, merged_into: null });
  return {
    users, profiles, events: [], results: [],
    seasons: [{ id: id(100), name: 'Season', start_date: '2020-01-01', end_date: '2099-12-31', ...DEFAULTS }],
    sessions: [1, 2].map(n => ({ id: id(200 + n), title: `Training ${n}`, session_date: `2026-01-0${n}`,
      start_time: '19:00:00', is_cancelled: false, location: 'Vienna' })),
    attendance: users.slice(0, 8).map(u => ({ session_id: id(201), user_id: u.id })),
  };
}

function recorder(transaction) {
  const sql = (strings, ...values) => ({
    text: strings.reduce((out, segment, i) => out + (i ? `$${i}` : '') + segment, ''), values,
  });
  sql.query = (text, values) => ({ text, values });
  sql.transactions = [];
  sql.transaction = async (queries, options) => {
    sql.transactions.push({ queries, options });
    return transaction ? transaction(queries) : queries.map(() => []);
  };
  return sql;
}

function event(world, players, index = 0, status = 'draft') {
  return {
    id: id(300 + index), season_id: id(100), session_id: world.sessions[index].id,
    session_date: world.sessions[index].session_date, version: 1, status,
    settings: structuredClone(DEFAULTS), ...balanceTeams(players, 4),
    roster_ids: players.map(p => p.id).sort(), roster_source: 'manual',
    rsvp_user_ids: world.attendance.filter(a => a.session_id === world.sessions[index].id).map(a => a.user_id).sort(),
  };
}

test('named guests have durable IDs and no inferred gender/account matching', async () => {
  const world = worldFixture();
  const input = validateAction({ action: 'save_player', display_name: '  Last-minute Guest  ', user_id: null,
    gender: 'unspecified', is_rookie: true, initial_rating: 800 });
  const sql = recorder();
  const first = await applyAction(sql, input, world);
  const second = await applyAction(sql, input, world);
  assert.notEqual(first.player_id, second.player_id, 'Identical names must not silently merge people');
  const insertion = sql.transactions[0].queries.find(q => q.text.includes('INSERT INTO league_players'));
  assert.equal(insertion.values[1], null);
  assert.equal(insertion.values[2], 'Last-minute Guest');
  assert.equal(insertion.values[3], 'unspecified');
  assert.throws(() => validateAction({ action: 'save_player', gender: 'unspecified', is_rookie: false, initial_rating: 1000 }), /named guest/);
});

test('approved account synchronization creates independent profiles without overwriting guest/admin state', async () => {
  const sql = recorder();
  await syncPlayers(sql);
  const queries = sql.transactions[0].queries;
  assert.match(queries[0].text, /pg_advisory_xact_lock/);
  assert.match(queries[1].text, /FOR SHARE/);
  const insert = queries.find(q => q.text.includes('INSERT INTO league_players'));
  assert.match(insert.text, /is_active = true AND status = 'approved'/);
  assert.match(insert.text, /ON CONFLICT \(user_id\) DO NOTHING/);
  assert(!/DO UPDATE/.test(insert.text));
  const world = worldFixture();
  const admin = adminView(world);
  assert.equal(admin.players.length, 13);
  assert.equal(admin.members.length, 12);
  assert.equal(admin.players.find(p => p.id === id(1)).user_id, id(1001));
  assert.equal(admin.players.find(p => p.id === id(50)).user_id, null);
  assert.deepEqual(admin.sessions[0].attending_player_ids, Array.from({ length: 8 }, (_, i) => id(i + 1)));
});

test('manual generation includes non-RSVP members and guests, while separately freezing the complete RSVP source', async () => {
  const world = worldFixture();
  const selected = [id(1), id(2), id(3), id(4), id(5), id(6), id(9), id(50)];
  const sql = recorder();
  await applyAction(sql, validateAction({ action: 'generate', season_id: id(100), session_id: id(201),
    team_size: 4, player_ids: selected }), world);
  const queries = sql.transactions[0].queries;
  const fingerprint = queries.find(q => q.text.includes('Attendees or player ratings changed'));
  const snapshot = JSON.parse(fingerprint.values[2]);
  assert.deepEqual(snapshot.map(p => p.id), [...selected].sort());
  assert.equal(snapshot.find(p => p.id === id(50)).rating, 800);
  const attendance = queries.find(q => q.text.includes('Eligible attendance changed'));
  assert.deepEqual(JSON.parse(attendance.values[0]), world.attendance.map(a => a.user_id));
  const insert = queries.find(q => q.text.includes('INSERT INTO league_events'));
  assert.equal(insert.values.at(-2), 'manual');
  assert.equal(insert.values.at(-1), 5);
  const teams = JSON.parse(insert.values[4]);
  assert.equal(teams.flatMap(t => t.players).length, 8);
  assert(teams.flatMap(t => t.players).every(p => !Object.hasOwn(p, 'user_id')));
  assert(!snapshot.some(p => p.id === id(7)), 'Intentional RSVP removals are respected');
  await assert.rejects(applyAction(recorder(), { action: 'generate', season_id: id(100), session_id: id(201),
    team_size: 4, player_ids: selected.map(p => p === id(50) ? id(999) : p) }, world), error => error.status === 400);
});

test('manual publication compares RSVP source, not selected roster; later RSVPs are visibly stale', async () => {
  const world = worldFixture();
  const selected = playerView(world).filter(p => [1, 2, 3, 4, 5, 6, 9, 50].some(n => p.id === id(n)));
  const draft = event(world, selected);
  world.events = [draft];
  assert.equal(adminView(world).events[0].roster_stale, false);
  const sql = recorder();
  await applyAction(sql, { action: 'publish', event_id: draft.id, version: 1 }, world);
  const queries = sql.transactions[0].queries;
  const attendance = queries.find(q => q.text.includes('Eligible attendance changed'));
  assert.deepEqual(JSON.parse(attendance.values[0]), draft.rsvp_user_ids);
  assert.notDeepEqual(JSON.parse(attendance.values[0]), draft.roster_ids);
  assert(queries.some(q => q.text.includes('A selected player was merged')));
  world.attendance.push({ session_id: id(201), user_id: id(1010) });
  const admin = adminView(world);
  assert.equal(admin.events[0].roster_stale, true);
  assert.equal(admin.events[0].current_rsvp_player_ids.length, 9);
  assert.equal(admin.events[0].rsvp_player_ids.length, 8);
});

test('guest results use durable player IDs and retain points without any account', () => {
  const world = worldFixture();
  const roster = playerView(world).filter(p => p.id === id(50) || [1, 2, 3, 4, 5, 6, 7].some(n => p.id === id(n)));
  const scored = event(world, roster, 0, 'finalized');
  const result = scoreEvent(scored, [{ team_number: 1, placement: 1 }, { team_number: 2, placement: 2 }]);
  scored.teams = result.teams;
  world.events = [scored];
  world.results = result.ledger.map(r => ({ ...r, event_id: scored.id }));
  const guestResult = world.results.find(r => r.player_id === id(50));
  assert([3, 0.5].includes(guestResult.points));
  assert(!Object.hasOwn(guestResult, 'user_id'));
  assert.equal(publicView(world, id(100)).standings.find(p => p.display_name === 'Named Guest').points, guestResult.points);
  assert.equal(playerView(world).find(p => p.id === id(50)).rating, 800 + guestResult.rating_delta);
});

test('guest linking rejects shared events and implicit account reassignment', async () => {
  const world = worldFixture();
  const roster = playerView(world).filter(p => p.id === id(50) || [1, 2, 3, 4, 5, 6, 7].some(n => p.id === id(n)));
  for (const status of ['draft', 'published', 'finalized']) {
    world.events = [event(world, roster, 0, status)];
    assert.throws(() => linkPlan(world, id(50), id(1001)), error => error.status === 409);
  }
  world.events = [];
  await assert.rejects(applyAction(recorder(), validateAction({ action: 'save_player', player_id: id(50),
    user_id: id(1001), gender: 'unspecified', is_rookie: true, initial_rating: 800 }), world),
  error => error.status === 409 && /link_player/.test(error.message));
  assert.throws(() => linkPlan(world, id(1), id(1002)), /another account/);
  assert.throws(() => linkPlan(world, id(50), id(999)), error => error.status === 404);
});

test('linking replaces account identity in ledger and frozen rosters, preserving guest seed and both histories', async () => {
  const world = worldFixture();
  const accountRoster = playerView(world).filter(p => [1, 2, 3, 4, 5, 6, 7, 8].some(n => p.id === id(n)));
  const guestRoster = playerView(world).filter(p => [2, 3, 4, 5, 6, 7, 8, 50].some(n => p.id === id(n)));
  world.events = [event(world, accountRoster, 0, 'finalized'), event(world, guestRoster, 1, 'finalized')];
  world.results = world.events.flatMap(e => {
    const scored = scoreEvent(e, [{ team_number: 1, placement: 1 }, { team_number: 2, placement: 2 }]);
    e.teams = scored.teams;
    return scored.ledger.map(r => ({ ...r, event_id: e.id }));
  });
  const combined = world.results.filter(r => [id(1), id(50)].includes(r.player_id));
  const expectedPoints = combined.reduce((sum, r) => sum + r.points, 0);
  const expectedRating = 800 + combined.reduce((sum, r) => sum + r.rating_delta, 0);
  const frozen = world.events.map(e => e.teams.flatMap(t => t.players.map(p => ({
    display_name: p.display_name, rating: p.rating,
  }))));
  const sql = recorder(queries => {
    // Exercise the emitted merge writes against a transactional in-memory fixture; no live DB.
    for (const q of queries) {
      if (q.text.includes('UPDATE league_results SET player_id')) {
        world.results.forEach(r => { if (r.player_id === q.values[1]) r.player_id = q.values[0]; });
      } else if (q.text.includes('UPDATE league_events e SET')) {
        world.events.filter(e => e.roster_ids.includes(id(1))).forEach(e => {
          e.teams.forEach(t => t.players.forEach(p => { if (p.id === id(1)) p.id = id(50); }));
          e.roster_ids = e.roster_ids.map(p => p === id(1) ? id(50) : p).sort();
          e.version++;
        });
      } else if (q.text.includes('SET user_id = NULL, merged_into')) {
        Object.assign(world.profiles.find(p => p.id === id(1)), { user_id: null, merged_into: id(50) });
      } else if (q.text.includes('SET user_id =')) {
        world.profiles.find(p => p.id === id(50)).user_id = id(1001);
      }
    }
    return queries.map(() => []);
  });
  const response = await applyAction(sql, { action: 'link_player', player_id: id(50), user_id: id(1001) }, world);
  assert.equal(response.player_id, id(50));
  const queries = sql.transactions[0].queries;
  const conflictCheck = queries.findIndex(q => q.text.includes('Both identities appear'));
  const ledgerUpdate = queries.findIndex(q => q.text.includes('UPDATE league_results SET'));
  assert(conflictCheck > 0 && ledgerUpdate > conflictCheck);
  assert(queries.some(q => q.text.includes('version = version + 1')));
  assert(!queries.some(q => /SET initial_rating|DELETE FROM league_results/.test(q.text)));
  assert.deepEqual(world.events.map(e => e.teams.flatMap(t => t.players.map(p => ({
    display_name: p.display_name, rating: p.rating,
  })))), frozen);
  const own = publicView(world, id(100), id(1001));
  assert.equal(own.stats.points, expectedPoints);
  assert.equal(own.stats.played, 2);
  assert.equal(own.history.length, 2);
  assert.equal(playerView(world).find(p => p.id === id(50)).rating, Math.round(expectedRating * 1e6) / 1e6);
  assert(!playerView(world).some(p => p.id === id(1)));
  const repeated = recorder();
  await applyAction(repeated, { action: 'link_player', player_id: id(50), user_id: id(1001) }, world);
  assert(!repeated.transactions[0].queries.some(q => q.text.includes('UPDATE league_results')));
});

test('unpublish/rebalance/republish remains explicit; finalized rosters cannot be regenerated', async () => {
  const world = worldFixture();
  const published = event(world, playerView(world).slice(0, 8), 0, 'published');
  world.events = [published];
  const input = { action: 'generate', season_id: id(100), session_id: id(201), team_size: 4,
    version: 1, player_ids: [...published.roster_ids.slice(0, 7), id(50)] };
  await assert.rejects(applyAction(recorder(), input, world), error => error.status === 409);
  const unpublish = recorder();
  await applyAction(unpublish, { action: 'unpublish', event_id: published.id, version: 1 }, world);
  assert(unpublish.transactions[0].queries.some(q => q.text.includes("SET status = 'draft'")));
  published.status = 'draft'; published.version = 2;
  const regenerate = recorder();
  await applyAction(regenerate, { ...input, version: 2 }, world);
  assert(!regenerate.transactions[0].queries.some(q => q.text.includes("status = 'published'")));
  published.status = 'finalized';
  await assert.rejects(applyAction(recorder(), { ...input, version: 2 }, world), error => error.status === 409);
});

test('concurrent account links check the current mapping before changing either identity', async () => {
  const world = worldFixture();
  world.profiles.push({ ...world.profiles.at(-1), id: id(51), display_name: 'Second Guest' });
  let canonicalId = id(1), links = 0, serialized = Promise.resolve();
  const sql = recorder(queries => {
    const operation = serialized.then(() => {
      for (const q of queries) {
        if (q.text.includes('Account player changed') && q.values[1] !== canonicalId) {
          throw Object.assign(new Error('Account player changed'), { code: 'P0001', detail: 'LEAGUE_409' });
        }
        if (q.text.includes('UPDATE league_players SET user_id = $')) {
          canonicalId = q.values[1]; links++;
        }
      }
      return queries.map(() => []);
    });
    serialized = operation.catch(() => {});
    return operation;
  });
  const outcomes = await Promise.allSettled([50, 51].map(n =>
    applyAction(sql, { action: 'link_player', player_id: id(n), user_id: id(1001) }, world)));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(dbError(outcomes.find(o => o.status === 'rejected').reason).status, 409);
  assert.equal(links, 1);
});
