const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSchedule, matchStandings } = require('../../lib/league-matches');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'league-pdf.js'), 'utf8');
const context = vm.createContext({
  window: {},
  URL,
  Blob,
  Uint8Array,
  Intl,
  Date,
});
vm.runInContext(source, context);
const pdf = context.window.LeaguePDF;
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

test('PDF projection accepts only public finished league data and strips private account fields', () => {
  const projected = pdf.projectEvent(fixture(), [
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
  assert.throws(() => pdf.projectEvent({ ...fixture(), status: 'draft' }), /Publish/);
  assert.throws(() => pdf.projectEvent({ ...fixture(), schedule: null }), /schedule/);
});

test('PDF plan produces one WhatsApp poster with the complete match tree summary', () => {
  const event = pdf.projectEvent(fixture());
  assert.deepEqual(JSON.parse(JSON.stringify(pdf.pagePlan(event))), [{
    type: 'poster',
    mode: 'results',
    teamCount: 3,
    roundCount: 3,
    matchCount: 3,
  }]);
  assert.equal(pdf.allMatches(event).length, 3);
  assert.equal(pdf.clock('18:00:00', 15), '18:15');
  assert.equal(pdf.fileName(event), 'vienna-imperials-results-2026-09-17.pdf');
  const published = pdf.projectEvent(fixture('published'));
  assert.equal(pdf.pagePlan(published).length, 1);
  assert.equal(pdf.pagePlan(published)[0].mode, 'itinerary');
  assert.equal(pdf.fileName(published), 'vienna-imperials-itinerary-2026-09-17.pdf');
  assert.equal(pdf.fileName(event, 'itinerary'), 'vienna-imperials-itinerary-2026-09-17.pdf');
});

test('PDF encoder builds a valid multi-page document with a correct cross-reference offset', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const bytes = pdf.pdfFromJpegs([
    { bytes: jpeg, width: 10, height: 10 },
    { bytes: jpeg, width: 10, height: 10 },
  ], { title: 'Imperials Test' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Pages \/Count 2/);
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.match(text, /\/Title \(Imperials Test\)/);
  const offset = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(offset, offset + 4), 'xref');
  const landscape = Buffer.from(pdf.pdfFromJpegs([
    { bytes: jpeg, width: 1754, height: 1240 },
  ], { title: 'Landscape poster' })).toString('latin1');
  assert.match(landscape, /\/MediaBox \[0 0 841\.89 595\.28\]/);
});
