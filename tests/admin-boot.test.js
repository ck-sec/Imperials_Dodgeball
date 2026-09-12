const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('restoring an admin session waits for later dashboard scripts', async () => {
  const listeners = new Map();
  const element = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const nodes = new Map();
  const context = vm.createContext({
    sessionStorage: { getItem: () => 'local-test-token' },
    document: {
      body: element(),
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
      addEventListener(name, callback) { listeners.set(name, callback); }
    }
  });
  assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-auth.js'), 'utf8'), context));
  let membersLoaded = 0;
  let rankingsRendered = 0;
  context.loadPendingMembers = () => membersLoaded++;
  context.loadPlayersFromAPI = () => Promise.resolve();
  context.render = () => rankingsRendered++;
  assert.equal(membersLoaded, 0);
  listeners.get('DOMContentLoaded')();
  await Promise.resolve();
  assert.equal(membersLoaded, 1);
  assert.equal(rankingsRendered, 1);
  assert.equal(nodes.get('loginView').style.display, 'none');
});
