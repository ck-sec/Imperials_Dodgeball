// Run once with: node tools/archive-season-one.js
// Downloads only the public leaderboard. Never overwrites an existing archive.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const source = 'https://www.imperialsdodgeball.com/api/rankings';
const output = path.join(__dirname, '..', 'data', 'season-1.json');
const fields = ['id', 'name', 'gender', 'tier', 'points', 'gain', 'played', 'streak', 'bp', 'change'];

async function archive() {
  if (fs.existsSync(output)) throw new Error('Season 1 is already archived. Refusing to overwrite it.');
  const response = await fetch(source, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Public rankings request failed (${response.status}).`);
  const raw = await response.text();
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || !data.length || data.length > 500) throw new Error('Expected 1-500 players in the public rankings.');
  const seen = new Set();
  const players = data.map(player => {
    if (!player || !Number.isInteger(player.id) || seen.has(player.id)
      || typeof player.name !== 'string' || !player.name.trim()
      || !['male', 'female', ''].includes(player.gender)
      || !Number.isFinite(player.points) || !Number.isInteger(player.played)) {
      throw new Error('The public rankings contain an invalid or duplicate player. Nothing was archived.');
    }
    seen.add(player.id);
    return Object.fromEntries(fields.filter(field => player[field] !== undefined).map(field => [field, player[field]]));
  });
  const snapshot = {
    id: 'season-1',
    name: 'Season 1',
    league: 'Imperials Social League',
    archived_at: new Date().toISOString(),
    source_url: source,
    source_sha256: createHash('sha256').update(raw).digest('hex'),
    players
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
  console.log(`Archived ${players.length} players as Season 1. SHA-256: ${snapshot.source_sha256}`);
}

archive().catch(error => { console.error(error.message); process.exitCode = 1; });
