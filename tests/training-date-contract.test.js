const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const [file, projections] of [['training.js', 2], [path.join('admin', 'training.js'), 7]]) {
  test(`${file} returns calendar dates as text rather than timezone-dependent Date objects`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api', file), 'utf8');
    // Neon parses DATE as local midnight; JSON serialization can otherwise shift it to the previous day.
    assert.equal((source.match(/session_date::text AS session_date/g) || []).length, projections);
    assert.doesNotMatch(source, /s\.session_date,\s*s\.start_time/);
    assert.doesNotMatch(source, /(?:SELECT|RETURNING) id, title, description, location, session_date,/);
  });
}
