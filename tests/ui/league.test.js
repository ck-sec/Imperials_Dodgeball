const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'site-utils.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'league-scoring.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'league-ui.js'), 'utf8'), context);
const ui = context.window.LeagueUI;
const { buildSchedule, matchStandings } = require('../../lib/league-matches');

function fixture(count = 6) {
  return {
    title: 'Thursday league',
    session_date: '2026-09-17',
    start_time: '19:00:00',
    team_size: 6,
    status: 'published',
    teams: Array.from({ length: 5 }, (_, team) => ({
      number: team + 1,
      name: 'Team ' + (team + 1),
      placement: team + 1,
      points: 5 - team,
      players: Array.from({ length: count }, (_, player) => ({
        display_name: 'Player ' + (team * count + player + 1),
        gender: 'unspecified',
        is_rookie: true,
        rating: 1234,
        initial_rating: 876,
        user_id: 'private-user-id'
      }))
    }))
  };
}

test('public teams show all thirty players without private balancing fields', () => {
  const html = ui.event(fixture(), 'en');
  assert.equal((html.match(/<article /g) || []).length, 5);
  assert.equal((html.match(/<li>/g) || []).length, 30);
  assert.match(html, /6v6/);
  assert.doesNotMatch(html, /1234|876|unspecified|rookie|private-user-id/);
  assert.doesNotMatch(html, /Place 1/);
});

test('larger squads explicitly explain rotating substitutes', () => {
  const html = ui.event(fixture(7), 'en');
  assert.equal((html.match(/1 rotating substitutes/g) || []).length, 5);
  assert.equal((html.match(/<li>/g) || []).length, 35);
});

test('only finalized results show per-player placement awards', () => {
  const event = fixture();
  event.status = 'finalized';
  const html = ui.event(event, 'en');
  assert.match(html, /Result confirmed/);
  assert.match(html, /Place 1 &middot; 5 Points/);
  assert.match(html, /Place 5 &middot; 1 Points/);
});

test('guest names, event titles and team names are escaped as text', () => {
  const event = fixture();
  event.title = '<img src=x onerror="alert(1)">';
  event.teams[0].name = '<script>not markup</script>';
  event.teams[0].players[0].display_name = 'Guest <b>& "quoted"</b>';
  const html = ui.event(event, 'en');
  assert.doesNotMatch(html, /<img|<script|<b>/);
  assert.match(html, /&lt;script&gt;not markup&lt;\/script&gt;/);
  assert.match(html, /Guest &lt;b&gt;&amp; &quot;quoted&quot;&lt;\/b&gt;/);
});

test('standings preserve shared ranks, zero points and server totals', () => {
  const html = ui.standings([
    { rank: 1, display_name: 'One', points: 20, played: 9, wins: 1 },
    { rank: 1, display_name: 'Two', points: 20, played: 6, wins: 0 },
    { rank: 3, display_name: 'Three', points: 0, played: 1, wins: 0 }
  ], 'en');
  assert.equal((html.match(/#1</g) || []).length, 2);
  assert.match(html, /9 Trainings/);
  assert.match(html, /league-table-points">0</);
});

test('movement renders localized signed points and rank direction without relying only on arrows', () => {
  const rising = { rank: 2, points_gain: 1.5, previous_rank: 4, rank_gain: 2 };
  const en = ui.movement(rising, 'en');
  assert.match(en, /From the last scored training/);
  assert.match(en, /\+1.5 Points/);
  assert.match(en, /2 places up/);
  assert.match(en, /aria-hidden="true">\u2191/);
  const de = ui.movement(rising, 'de');
  assert.match(de, /Durch das letzte gewertete Training/);
  assert.match(de, /\+1,5 Punkte/);
  assert.match(de, /2 Pl\u00e4tze gestiegen/);
  const dropping = { rank: 3, points_gain: 0, previous_rank: 2, rank_gain: -1 };
  assert.match(ui.movement(dropping, 'en'), /0 Points[\s\S]*1 place down/);
  assert.match(ui.movement(dropping, 'de'), /0 Punkte[\s\S]*1 Platz gefallen/);
  assert.match(ui.movement(dropping, 'en'), /aria-hidden="true">\u2193/);
});

test('movement distinguishes first appearance from unchanged rank, including zero points', () => {
  const entrant = { rank: 5, points_gain: 0, previous_rank: null, rank_gain: null };
  assert.match(ui.movement(entrant, 'en'), /0 Points[\s\S]*New/);
  assert.match(ui.movement(entrant, 'de'), /0 Punkte[\s\S]*Neu/);
  const unchanged = { rank: 1, points_gain: 3, previous_rank: 1, rank_gain: 0 };
  assert.match(ui.movement(unchanged, 'en'), /\+3 Points[\s\S]*Rank unchanged/);
  assert.match(ui.movement(unchanged, 'de'), /Rang unver\u00e4ndert/);
  assert.doesNotMatch(ui.movement(unchanged, 'en'), /aria-hidden|New/);
  assert.match(ui.movement(unchanged, 'unsupported'), /Rank unchanged/);
});

test('movement is absent for archives and incomplete, nonnumeric or unranked entries', () => {
  const archive = { rank: 1, points: 70, legacy: { gain: 3, change: 2 }, gain: 3, change: 2 };
  const valid = { rank: 2, points_gain: 1, previous_rank: 3, rank_gain: 1 };
  const malformed = [
    null, undefined, archive, {}, { ...valid, rank: null }, { ...valid, rank: 0 },
    { ...valid, points_gain: NaN }, { ...valid, points_gain: Infinity },
    { ...valid, points_gain: '<img src=x onerror=alert(1)>' },
    { ...valid, previous_rank: '3' }, { ...valid, previous_rank: 0 },
    { ...valid, rank_gain: '<script>bad</script>' }, { ...valid, rank_gain: 1.5 },
    { ...valid, previous_rank: null },
  ];
  malformed.forEach(entry => assert.equal(ui.movement(entry, 'en'), ''));
  assert.doesNotMatch(ui.standings([archive], 'en'), /league-movement/);
});

test('movement escapes localized content, formats singular gains, and normalizes negative zero', () => {
  const entry = { rank: 1, points_gain: -0, previous_rank: 2, rank_gain: 1 };
  assert.match(ui.movement(entry), /0 Points[\s\S]*1 place up/);
  assert.doesNotMatch(ui.movement(entry), /-0/);
  assert.match(ui.movement(entry, 'de'), /1 Platz gestiegen/);
  const original = ui.text.en.movementCompared;
  ui.text.en.movementCompared = '<img src=x onerror="bad()"> & context';
  try {
    const html = ui.movement(entry);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp; context/);
  } finally {
    ui.text.en.movementCompared = original;
  }
});

test('standings render server-provided movements for shared ranks and nonparticipants without recalculating', () => {
  const html = ui.standings([
    { rank: 1, display_name: 'A', points: 5, played: 2, wins: 1, points_gain: 3, previous_rank: 3, rank_gain: 2 },
    { rank: 1, display_name: 'B', points: 5, played: 2, wins: 1, points_gain: 2, previous_rank: 2, rank_gain: 1 },
    { rank: 3, display_name: '<Guest>', points: 4, played: 1, wins: 1, points_gain: 0, previous_rank: 1, rank_gain: -2 },
  ], 'en');
  assert.equal((html.match(/class="league-table-change/g) || []).length, 12);
  assert.equal((html.match(/#1</g) || []).length, 2);
  assert.match(html, /&lt;Guest&gt;/);
  assert.match(html, /0 Points[\s\S]*2 places down/);
  assert.doesNotMatch(html, /class="league-movement-context"/);
});

test('custom scoring describes whole-season accumulation, not best-N scoring', () => {
  const html = ui.rules({ placement_points: [3, 2.5, 2, 1.5, 1], scoring_mode: 'fixed' }, 'en');
  assert.match(html, /Every training counts/);
  assert.match(html, /2\. Place: 2.5 Points/);
  assert.match(html, /Further places: 1 Points/);
  assert.doesNotMatch(html, /best 8/);
});

test('relative scoring rules show the exact team-count scale', () => {
  const html = ui.rules({ placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative', points_step: 0.5 }, 'en');
  assert.match(html, /3 Teams<\/dt><dd>\+3 \/ \+2 \/ \+0.5/);
  assert.match(html, /6 Teams<\/dt><dd>\+3 \/ \+2.5 \/ \+2 \/ \+1.5 \/ \+1 \/ \+0.5/);
});

test('beginner guide explains signup, scoring, balancing and Diamond in plain language', () => {
  const config = {
    placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative', points_step: 0.5,
    bonus_points_max: 1, bonus_points_step: 0.5
  };
  const en = ui.guide(config, 'en');
  assert.match(en, /Each date needs its own RSVP/);
  assert.match(en, /private ELO skill estimate/);
  assert.match(en, /not a random draw/);
  assert.match(en, /including rotating substitutes/);
  assert.match(en, /win = 2, draw = 1, loss = 0/);
  assert.match(en, /does not pick individual opponents/);
  assert.match(en, /5 Teams<\/dt><dd>\+3 \/ \+2.5 \/ \+2 \/ \+1 \/ \+0.5/);
  assert.match(en, /first place gets \+1 BP and second gets \+0.5 BP/);
  assert.match(en, /Diamond starts at 70 total points/);
  assert.match(en, /14 first-place finishes \(42 points\).*14 third-place finishes \(28 points\)/);
  assert.match(en, /href="\/member#training"/);
  const de = ui.guide(config, 'de');
  assert.match(de, /Jeder Termin braucht eine eigene Zusage/);
  assert.match(de, /keine zufällige Auslosung/);
  assert.match(de, /Diamond beginnt bei 70 Gesamtpunkten/);
});

test('season selectors escape names and select the requested season', () => {
  const html = ui.seasonOptions([{ id: 'one', name: '<Autumn>' }, { id: 'two', name: 'Winter' }], 'two');
  assert.match(html, /&lt;Autumn&gt;/);
  assert.match(html, /value="two" selected/);
});

test('public fixtures show the ref-safe program, ref teams and separate match-table points', () => {
  const event = fixture();
  event.schedule = buildSchedule(5);
  event.match_standings = matchStandings(5, event.schedule);
  const html = ui.schedule(event, 'en');
  assert.match(html, /18:15 &ndash; 18:32/);
  assert.match(html, /19:43 &ndash; 20:00/);
  assert.match(html, /No time buffer/);
  assert.match(html, /not season points/);
  assert.equal((html.match(/class="league-match"/g) || []).length, 10);
  assert.match(html, /Ref team: Team 1/);
  assert.match(html, /Last Man \/ Last Woman Standing/);
  assert.doesNotMatch(html, /1234|rookie|private-user-id/);
});

test('public finalized ties show the confirmed winner rather than a pending decision', () => {
  const event = fixture();
  event.status = 'finalized';
  event.teams.forEach(team => { team.placement = 6 - team.number; });
  event.schedule = buildSchedule(5);
  event.schedule.rounds.flatMap(round => round.matches).forEach(match => {
    match.score_a = 0;
    match.score_b = 0;
  });
  event.match_standings = matchStandings(5, event.schedule);
  const html = ui.schedule(event, 'en');
  assert.match(html, /Winner: Team 5/);
  assert.match(html, /Admins have confirmed/);
  assert.doesNotMatch(html, /admins must confirm/);
  assert.ok(html.indexOf('league-player-name">Team 5') < html.indexOf('league-player-name">Team 1'));
});

test('season totals include a separately labelled BP amount without adding it again', () => {
  const html = ui.standings([
    { rank: 1, display_name: 'Bonus player', points: 3.5, base_points: 3, bonus_points: 0.5, played: 1, wins: 1 },
    { rank: 2, display_name: 'No bonus', points: 3, bonus_points: 0, played: 1, wins: 1 }
  ], 'de');
  assert.match(html, /<th[^>]*>Punkte gesamt<\/th>/);
  assert.match(html, /league-table-points">3,5<\/span>/);
  assert.match(html, /aria-label="Bonuspunkte: 0,5[^"]*">0,5<\/span>/);
  assert.match(html, /aria-label="Bonuspunkte: 0\.[^"]*">0<\/span>/);
  assert.match(html, /BP sind in der Gesamtpunktzahl enthalten/);
  assert.doesNotMatch(html, /league-table-points">4</);
  assert.match(ui.bonus({ bonus_points: '<img src=x>' }, 'en'), /&lt;img src=x&gt;/);
  assert.doesNotMatch(ui.bonus({ bonus_points: '<img src=x>' }, 'en'), /<img/);
});

test('rankings use compact table columns rather than repeated player cards and detail controls', () => {
  const html = ui.standings([
    { rank: 1, display_name: 'One', points: 3.5, bonus_points: 0.5, played: 1, wins: 1,
      points_gain: 3.5, previous_rank: null, rank_gain: null },
  ], 'en');
  assert.match(html, /<table class="league-ranking-table">/);
  assert.equal((html.match(/scope="col"/g) || []).length, 8);
  assert.match(html, /<th scope="row" class="league-table-player">/);
  assert.match(html, />Total points<\/th>/);
  assert.match(html, />Gain<\/th>/);
  assert.match(html, />Rank \+\/-<\/th>/);
  assert.doesNotMatch(html, /<ol|<details|league-standing-details/);
  assert.match(html, /league-table-mobile/);
  assert.match(html, /league-sr-only">New<\/span>/);
});

test('archive table preserves original BP, gain, streak and rank change without live-season assumptions', () => {
  const player = { rank: 1, display_name: '<Archived>', points: 70, played: 26,
    legacy: { tier: 'platinum', bp: 2, gain: 2, streak: 11, change: -1 } };
  const before = JSON.stringify(player);
  const html = ui.standings([player], 'en');
  assert.match(html, /&lt;Archived&gt;/);
  assert.match(html, /Archived BP">2<\/span>/);
  assert.match(html, />Streak<\/th>/);
  assert.match(html, /Archived movement: \+2 Points/);
  assert.match(html, /1 place down/);
  assert.match(html, /league-table-points">70</);
  assert.match(html, /league-tier-platinum" title="Season 1: archived tier">Platinum/);
  assert.doesNotMatch(html, /league-tier-diamond|From 45 total/);
  assert.doesNotMatch(html, /BP are included|BP 0|From the last scored training/);
  assert.equal(JSON.stringify(player), before);
});

test('live tier badges use total points including BP exactly once, never private skill or table position', () => {
  const player = { rank: 1, display_name: 'Player', points: 24.5, base_points: 24, bonus_points: 0.5,
    played: 10, wins: 3, rating: 2000 };
  const before = JSON.stringify(player);
  assert.match(ui.standings([player], 'en'), /league-tier-silver/);
  assert.doesNotMatch(ui.standings([player], 'en'), /league-tier-gold|2000/);
  assert.match(ui.standings([{ ...player, points: 25, base_points: 24.5 }], 'en'), /league-tier-gold/);
  assert.match(ui.tierBadge({ points: 70 }, 'de'), /league-tier-diamond" title="Ab 70 Gesamtpunkten inklusive BP">Diamond/);
  assert.equal(JSON.stringify(player), before);
});

test('unknown archived labels are escaped and cannot inject a badge class', () => {
  const html = ui.tierBadge({ legacy: { tier: '"><img src=x>' } }, 'en');
  assert.match(html, /&quot;&gt;&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img|league-tier-/);
});

test('points rules expose the five tier thresholds without expanding the compact rankings', () => {
  const config = { placement_points: [3, 2.5, 2, 1, 0.5] };
  const html = ui.rules(config, 'de');
  assert.match(html, /Punkte &amp; Rangstufen/);
  assert.match(html, /Gesamtpunkten inklusive BP/);
  assert.equal((html.match(/<li>/g) || []).length, 5);
  for (const minimum of [0, 10, 25, 45, 70]) assert.match(html, new RegExp('ab ' + minimum + ' Punkte'));
  assert.match(ui.rules(config, 'en'), /Each season starts fresh/);
});

test('all ranking surfaces load the same refreshed tier logic, markup and styles', () => {
  for (const file of ['index.html', 'admin.html', 'member.html', 'spieltag.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('/js/league-scoring.js?v=20260912d'), file + ' must refresh league scoring');
    assert.ok(html.includes('/league.css?v=20260915'), file + ' must refresh league styles');
    assert.ok(html.includes('/js/league-ui.js?v=20260915'), file + ' must refresh league UI');
  }
});

test('bonus rules explain configurable limits and the disabled state', () => {
  const config = { placement_points: [3, 2, 1], scoring_mode: 'fixed', bonus_points_max: 2, bonus_points_step: 0.25 };
  assert.match(ui.rules(config, 'en'), /Up to 2 BP per player and training, in steps of 0.25/);
  assert.match(ui.rules(config, 'de'), /2 BP pro Spieler und Training, in 0,25er-Schritten/);
  assert.match(ui.rules({ ...config, bonus_points_max: 0 }, 'en'), /Bonus points are disabled/);
  assert.match(ui.bonus(null, 'en'), /BP 0<\/span>/);
});

test('public Thursday events expose a safe matchday link without linking drafts or other weekdays', () => {
  const event = { ...fixture(), id: '00000000-0000-4000-8000-000000000001' };
  assert.match(ui.matchdayLink(event, 'de'), /href="\/spieltag\?event=00000000-0000-4000-8000-000000000001"/);
  assert.match(ui.event(event, 'en'), /Schedule &amp; live scores/);
  assert.doesNotMatch(ui.event(event, 'en', { hideMatchdayLink: true }), /\/spieltag/);
  assert.equal(ui.matchdayLink({ ...event, status: 'draft' }), '');
  assert.equal(ui.matchdayLink({ ...event, session_date: '2026-09-18' }), '');
  assert.equal(ui.matchdayLink({ ...event, session_date: 'not-a-date' }), '');
  assert.doesNotMatch(ui.matchdayLink({ ...event, id: '"><script>bad</script>' }), /<script/);
});

test('the standalone match table reuses confirmed standings without fixtures or season BP', () => {
  const event = fixture();
  event.schedule = buildSchedule(5);
  event.match_standings = matchStandings(5, event.schedule);
  const before = JSON.stringify(event);
  const table = ui.matchTable(event, 'en');
  assert.match(table, /Match standings/);
  assert.doesNotMatch(table, /class="league-match"|league-bonus/);
  assert.ok(ui.schedule(event, 'en').includes(table));
  assert.equal(JSON.stringify(event), before);
  assert.equal(ui.matchTable(null), '');
});
