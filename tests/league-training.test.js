const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../lib/league-db');

const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const eventId = '00000000-0000-4000-8000-000000000003';

function harness(status) {
  const queries = [];
  const session = { id: sessionId, league_status: status, league_event_id: status ? eventId : null,
    rsvp_locked: ['published', 'finalized'].includes(status) };
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    return { text, values, then(resolve, reject) {
      queries.push(text);
      if (text.includes('AS league_status')) return Promise.resolve([session]).then(resolve, reject);
      if (text.includes('SELECT id FROM users')) return Promise.resolve([{ id: userId }]).then(resolve, reject);
      return Promise.resolve([]).then(resolve, reject);
    } };
  };
  sql.transaction = async statements => {
    assert.match(statements[0].text, /training_sessions.*FOR UPDATE/);
    const freeze = statements.find(q => q.text.includes('Registration is frozen'));
    const message = freeze.text.match(/409, '([^']+)'/)[1];
    throw Object.assign(new Error(message), { code: 'P0001', detail: 'LEAGUE_409' });
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'api', 'training.js'), 'utf8'), {
    module, console: { error() {} },
    require(name) {
      if (name === '../lib/db') return { getDb: () => sql };
      if (name === '../lib/cors') return { setCors() {} };
      if (name === '../lib/auth') return { requireMember: () => ({ sub: userId }) };
      if (name === '../lib/validation') return require('../lib/validation');
      if (name === '../lib/league-db') return db;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  async function request(input) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    await module.exports({ method: 'GET', headers: {}, ...input }, res);
    return res;
  }
  return { request, queries };
}

test('both training views expose nullable league status/event ID and retain RSVP lock projection', async () => {
  for (const status of [null, 'draft', 'published', 'finalized']) {
    for (const view of ['upcoming', 'session']) {
      const app = harness(status);
      const response = await app.request({ query: { view, id: sessionId } });
      assert.equal(response.statusCode, 200);
      const session = view === 'upcoming' ? response.body.sessions[0] : response.body.session;
      assert.equal(session.league_status, status);
      assert.equal(session.league_event_id, status ? eventId : null);
      assert.equal(session.rsvp_locked, ['published', 'finalized'].includes(status));
      const query = app.queries.find(q => q.includes('AS league_status'));
      assert.match(query, /\(SELECT e\.status FROM league_events e WHERE e\.session_id = s\.id\) AS league_status/);
      assert.match(query, /\(SELECT e\.id FROM league_events e WHERE e\.session_id = s\.id\) AS league_event_id/);
      assert(!query.includes('e.teams'), 'Training metadata must not expose draft squads');
    }
  }
});

test('frozen RSVP returns explicit 409 guidance to contact an admin for last-minute changes', async () => {
  for (const status of ['published', 'finalized']) {
    const app = harness(status);
    const response = await app.request({ method: 'POST', body: { action: 'rsvp', session_id: sessionId, status: 'attending' } });
    assert.equal(response.statusCode, 409);
    assert.match(response.body.error, /Contact an admin for last-minute changes/);
    assert.equal(response.body.code, 'CONFLICT');
    assert(!response.body.error.includes('unpublish the event first'));
  }
});
