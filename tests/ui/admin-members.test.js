const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'admin-members.js'), 'utf8');
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function node(id) {
  return {
    id, value: '', innerHTML: '', disabled: false, listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    focus() {}, setSelectionRange() {}
  };
}

function app() {
  const elements = new Map([
    ['pendingMembersList', node('pendingMembersList')],
    ['memberManagementList', node('memberManagementList')],
    ['league-player-u1', Object.assign(node('league-player-u1'), { value: 'guest-1' })],
    ['archive-player-u1', Object.assign(node('archive-player-u1'), { value: 'Archive Player' })]
  ]);
  const members = [{
    id: 'u1', email: 'member@example.test', display_name: 'Account Member',
    ranking_player_name: null, is_active: true, status: 'approved', created_at: '2026-09-01T00:00:00Z'
  }];
  const leaguePlayers = [
    { id: 'account-1', user_id: 'u1', display_name: 'Account Member' },
    { id: 'guest-1', user_id: null, display_name: 'Recorded Guest' }
  ];
  const writes = [];
  const reply = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body))
  });
  const adminFetch = async (url, options = {}) => {
    if (options.method === 'POST' || options.method === 'PATCH') {
      writes.push({ url, body: JSON.parse(options.body) });
      return reply({ success: true, player_id: 'guest-1' });
    }
    if (url.startsWith('/api/admin/members')) return reply({ members });
    if (url === '/api/league?view=admin') {
      return reply({ players: leaguePlayers, members: [], seasons: [], sessions: [], events: [] });
    }
    throw new Error('Unexpected admin request: ' + url);
  };
  const context = vm.createContext({
    document: {
      getElementById: id => elements.get(id) || null
    },
    console,
    Date,
    confirm: () => true,
    esc: escape,
    toast() {},
    adminFetch,
    fetch: async url => {
      if (url === '/api/rankings') return reply([{ id: 1, name: 'Archive Player' }]);
      throw new Error('Unexpected public request: ' + url);
    }
  });
  vm.runInContext(source, context);
  return { context, elements, writes };
}

test('member management lists account links and merges a selected guest identity through the league API', async () => {
  const fixture = app();
  await fixture.context.loadMemberManagement();
  assert.match(fixture.elements.get('memberManagementList').innerHTML, /Recorded Guest — unlinked guest\/player/);
  assert.match(fixture.elements.get('memberManagementList').innerHTML, /Season 1 archive/);
  await fixture.context.saveLeagueMemberLink('u1');
  assert.deepEqual(fixture.writes[0], {
    url: '/api/league',
    body: { action: 'link_player', player_id: 'guest-1', user_id: 'u1' }
  });
});

test('member management saves the legacy archive link independently', async () => {
  const fixture = app();
  await fixture.context.loadMemberManagement();
  await fixture.context.saveArchiveMemberLink('u1');
  assert.deepEqual(fixture.writes[0], {
    url: '/api/admin/members',
    body: { user_id: 'u1', action: 'link', ranking_player_name: 'Archive Player' }
  });
});
