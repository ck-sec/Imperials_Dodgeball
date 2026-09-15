const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSchedule, matchStandings } = require('../../lib/league-matches');

const root = path.resolve(__dirname, '..', '..');
const gradient = { addColorStop() {} };
const drawnText = [];
const drawingContext = new Proxy({
  measureText(value) { return { width: String(value).length * 8 }; },
  createLinearGradient() { return gradient; },
  beginPath() {},
  moveTo() {},
  lineTo() {},
  quadraticCurveTo() {},
  closePath() {},
  fill() {},
  stroke() {},
  fillRect() {},
  drawImage() {},
  save() {},
  restore() {},
  clip() {},
  arc() {},
  fillText(value) { drawnText.push(String(value)); },
}, {
  get(target, property) { return property in target ? target[property] : undefined; },
  set(target, property, value) { target[property] = value; return true; },
});
const canvases = [];
const document = {
  baseURI: 'https://imperials.test/spieltag',
  fonts: { ready: Promise.resolve() },
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = {
      width: 0,
      height: 0,
      getContext() { return drawingContext; },
      toBlob(callback, type) { callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type })); },
    };
    canvases.push(canvas);
    return canvas;
  },
};
class Image {
  constructor() {
    this.naturalWidth = 1600;
    this.naturalHeight = 1000;
  }
  set src(value) {
    this.currentSrc = value;
    queueMicrotask(() => this.onload());
  }
}
const source = fs.readFileSync(path.join(root, 'js', 'league-poster.js'), 'utf8');
const context = vm.createContext({
  window: { location: { origin: 'https://imperials.test' } },
  document,
  Image,
  URL,
  Blob,
  Intl,
  Date,
});
vm.runInContext(source, context);
const poster = context.window.LeaguePoster;
const EVENT = '11111111-1111-4111-8111-111111111111';

function fixture(status = 'finalized') {
  const schedule = buildSchedule(3);
  if (status === 'finalized') {
    schedule.rounds.flatMap(round => round.matches).forEach(match => {
      match.score_a = 4;
      match.score_b = 2;
    });
  }
  return {
    id: EVENT,
    title: 'Imperials Social League',
    session_date: '2026-09-17',
    start_time: '18:00:00',
    end_time: '20:10:00',
    location: 'ASKÖ Halle',
    status,
    teams: [
      {
        number: 1,
        name: 'Golden Griffins',
        placement: status === 'finalized' ? 1 : null,
        points: status === 'finalized' ? 3 : 0,
        players: [
          { display_name: 'Player A', rating: 1400, user_id: 'private-a' },
          { display_name: 'Player B', gender: 'private' },
        ],
      },
      {
        number: 2,
        name: 'Navy Thunder',
        placement: status === 'finalized' ? 2 : null,
        points: status === 'finalized' ? 1 : 0,
        players: [{ display_name: 'Player C', league_scorekeeper: true }],
      },
      {
        number: 3,
        name: 'Azure Arrows',
        placement: status === 'finalized' ? 3 : null,
        points: status === 'finalized' ? 0.5 : 0,
        players: [{ display_name: 'Player D', is_rookie: true }],
      },
    ],
    schedule,
    match_standings: matchStandings(3, schedule),
    finale_results: status === 'finalized' ? {
      men: {
        winner: { display_name: 'Player A', bonus_points: 1, gender: 'private' },
        runner_up: { display_name: 'Player C', bonus_points: 0.5, user_id: 'private' },
      },
      women: null,
    } : null,
  };
}

test('poster projection accepts only public league data and strips private account fields', () => {
  const projected = poster.projectEvent(fixture(), [
    { display_name: 'Player A', rank: 1, points: 7, rating: 1500, user_id: 'private' },
  ]);
  assert.equal(projected.id, EVENT);
  assert.equal(projected.teams[0].players[0].display_name, 'Player A');
  assert.equal(projected.standings[0].points, 7);
  assert.equal(projected.schedule.referee_policy, 'rotating_team_v1');
  assert.equal(projected.schedule.rounds[0].referee_team, fixture().schedule.rounds[0].referee_team);
  assert.equal(projected.schedule.finale_minutes, 10);
  assert.equal(projected.finale_results.men.winner.display_name, 'Player A');
  assert.doesNotMatch(JSON.stringify(projected), /rating|user_id|gender|league_scorekeeper/);
  assert.throws(() => poster.projectEvent({ ...fixture(), status: 'draft' }), /Publish/);
  assert.throws(() => poster.projectEvent({ ...fixture(), schedule: null }), /schedule/);
});

test('poster plan produces one portrait WhatsApp image with the complete match tree summary', () => {
  const event = poster.projectEvent(fixture());
  assert.deepEqual(JSON.parse(JSON.stringify(poster.pagePlan(event))), [{
    type: 'poster',
    mode: 'results',
    teamCount: 3,
    roundCount: 3,
    matchCount: 3,
    width: 1080,
    height: 1920,
    mimeType: 'image/jpeg',
  }]);
  assert.equal(poster.allMatches(event).length, 3);
  assert.equal(poster.clock('18:00:00', 15), '18:15');
  assert.equal(poster.fileName(event), 'vienna-imperials-results-2026-09-17.jpg');
  const published = poster.projectEvent(fixture('published'));
  assert.equal(poster.pagePlan(published).length, 1);
  assert.equal(poster.pagePlan(published)[0].mode, 'itinerary');
  assert.equal(poster.fileName(published), 'vienna-imperials-itinerary-2026-09-17.jpg');
  assert.equal(poster.fileName(event, 'itinerary'), 'vienna-imperials-itinerary-2026-09-17.jpg');
});

test('poster renderer creates direct 1080 by 1920 JPEGs in both modes', async () => {
  const itinerary = await poster.create(fixture('published'), {
    mode: 'itinerary',
    publicUrl: 'https://imperials.test/spieltag?event=' + EVENT,
  });
  assert.equal(itinerary.blob.type, 'image/jpeg');
  assert.equal(itinerary.mimeType, 'image/jpeg');
  assert.equal(itinerary.filename, 'vienna-imperials-itinerary-2026-09-17.jpg');
  assert.equal(itinerary.pageCount, 1);
  assert.equal(itinerary.width, 1080);
  assert.equal(itinerary.height, 1920);
  assert.deepEqual([canvases[0].width, canvases[0].height], [1, 1], 'released canvases are discarded after encoding');

  const results = await poster.create(fixture(), { mode: 'results' });
  assert.equal(results.blob.type, 'image/jpeg');
  assert.equal(results.filename, 'vienna-imperials-results-2026-09-17.jpg');
  assert.equal(results.width, 1080);
  assert.equal(results.height, 1920);
  await assert.rejects(poster.create(fixture('published'), { mode: 'results' }), /Finalize/);
});

test('finalized itinerary images do not reveal placements or scores', async () => {
  const event = fixture();
  event.schedule.rounds.flatMap(round => round.matches).forEach(match => {
    match.score_a = 97;
    match.score_b = 83;
  });

  drawnText.length = 0;
  await poster.create(event, { mode: 'itinerary' });
  assert.doesNotMatch(drawnText.join('|'), /#1|#2|#3|97|83/);

  drawnText.length = 0;
  await poster.create(event, { mode: 'results' });
  assert.match(drawnText.join('|'), /#1/);
  assert.match(drawnText.join('|'), /97/);
});

test('ten valid one-court rounds use the compact layout without clipping the summary', async () => {
  const event = fixture('published');
  event.teams = Array.from({ length: 5 }, (_, index) => ({
    number: index + 1,
    name: `Team ${index + 1}`,
    placement: null,
    points: 0,
    players: [{ display_name: `Player ${index + 1}` }],
  }));
  event.schedule = buildSchedule(5, {
    courts: 1,
    match_minutes: 6,
    break_minutes: 5,
  });
  event.match_standings = matchStandings(5, event.schedule);
  const projected = poster.projectEvent(event);
  const layout = poster.portraitLayout(projected);
  assert.equal(projected.schedule.rounds.length, 10);
  assert.equal(layout.compact_fixtures, true);
  assert(layout.fixture_row_height >= 48);
  assert(layout.fixtures_bottom <= 1498);
  assert(layout.summary_top < layout.summary_bottom);

  const result = await poster.create(event, { mode: 'itinerary' });
  assert.deepEqual([result.width, result.height], [1080, 1920]);
});
