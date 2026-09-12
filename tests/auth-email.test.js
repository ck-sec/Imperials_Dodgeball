const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../lib/email-templates');
const { loadModule, json } = require('./auth-test-helpers');

const token = 'ab'.repeat(32);
const club = 'imperialsdodgeball@gmail.com';
const from = 'Vienna Imperials <noreply@imperialsdodgeball.com>';
const message = { to: 'member@example.test', subject: 'Reset', html: '<p>Reset</p>', text: 'Reset' };

function harness(options = {}) {
  const calls = [];
  const keys = [];
  class Resend {
    constructor(key) {
      keys.push(key);
      this.emails = { send: async payload => {
        calls.push(payload);
        return options.send ? options.send(payload) : { data: { id: 'accepted-id' }, error: null };
      } };
    }
  }
  const loaded = loadModule('lib\\email.js', { resend: { Resend } }, {
    process: { env: options.env || { RESEND_API_KEY: 'mock-key' } },
  });
  return { ...loaded, calls, keys };
}

test('password reset delivery uses the approved sender and Reply-To with absolutely no CC/BCC inheritance', async () => {
  const app = harness({ env: {
    RESEND_API_KEY: 'mock-key',
    EMAIL_FROM: 'Legacy sender <legacy@example.test>',
    EMAIL_CC: 'copy@example.test',
    EMAIL_BCC: 'archive@example.test',
  } });
  const result = await app.exports.sendPasswordResetEmail({
    ...message,
    ...templates.passwordReset({ name: 'Member', token }),
    cc: club,
    bcc: club,
    replyTo: 'override@example.test',
    from: 'override@example.test',
    headers: { Bcc: club, Cc: club },
  });
  assert.equal(result.data.id, 'accepted-id');
  const payload = app.calls[0];
  assert.equal(payload.from, from);
  assert.equal(payload.replyTo, club);
  assert.equal(payload.to, message.to);
  assert.deepEqual(Object.keys(payload).sort(), ['from', 'html', 'replyTo', 'subject', 'text', 'to']);
  assert(payload.html.includes(token));
  assert(payload.text.includes(token));
});

test('existing signup/reminder delivery keeps club CC, custom CC and optional CC opt-out', async () => {
  const app = harness();
  await app.exports.sendEmail(message);
  assert.equal(app.calls[0].cc, club);
  assert.equal(app.calls[0].from, from);
  assert.equal(app.calls[0].replyTo, club);
  assert.match(app.calls[0].headers['List-Unsubscribe'], /mailto:imperialsdodgeball@gmail.com/);
  await app.exports.sendEmail({ ...message, cc: 'custom@example.test', replyTo: 'reply@example.test' });
  assert.equal(app.calls[1].cc, 'custom@example.test');
  assert.equal(app.calls[1].replyTo, 'reply@example.test');
  await app.exports.sendEmail({ ...message, cc: false });
  assert.equal(Object.hasOwn(app.calls[2], 'cc'), false);
  assert.deepEqual(app.keys, ['mock-key']);
});

test('installed Resend SDK serializes the Reply-To and omits security CC/BCC on its mocked transport', async () => {
  const { Resend } = require('resend');
  const outgoing = [];
  class OfflineResend extends Resend {
    async post(endpoint, payload) {
      outgoing.push({ endpoint, payload: json(payload) });
      return { data: { id: 'accepted-offline' }, error: null };
    }
    async fetchRequest() {
      throw new Error('Network access is forbidden in auth tests');
    }
  }
  const app = loadModule('lib\\email.js', { resend: { Resend: OfflineResend } }, {
    process: { env: { RESEND_API_KEY: 'mock-key' } },
  });
  await app.exports.sendPasswordResetEmail(message);
  await app.exports.sendEmail(message);
  const security = outgoing[0];
  assert.equal(security.endpoint, '/emails');
  assert.equal(security.payload.reply_to, club);
  assert.equal(security.payload.from, from);
  assert.equal(Object.hasOwn(security.payload, 'cc'), false);
  assert.equal(Object.hasOwn(security.payload, 'bcc'), false);
  assert.equal(outgoing[1].payload.reply_to, club);
  assert.equal(outgoing[1].payload.cc, club);
});

test('neither normal nor security mail claims acceptance on provider error, missing id or network failure', async () => {
  for (const send of [
    async () => { throw new Error(`private-provider-key ${token}`); },
    async () => ({ data: { id: 'not-accepted' }, error: { message: `private-provider-key ${token}` } }),
    async () => ({ data: null, error: null }),
    async () => ({ data: {}, error: null }),
    async () => ({ data: { id: 12 } }),
    async () => ({ data: { id: '  ' } }),
    async () => undefined,
  ]) {
    for (const method of ['sendEmail', 'sendPasswordResetEmail']) {
      const app = harness({ send });
      await assert.rejects(app.exports[method](message), { message: 'Email delivery unavailable' });
      assert.deepEqual(app.logs, [['Email delivery unavailable']]);
      assert(!JSON.stringify(app.logs).includes(token));
    }
  }
});

test('missing provider credentials fail closed without invoking a real provider', async () => {
  const app = harness({ env: {} });
  assert.throws(() => app.exports.getResend(), /Missing RESEND_API_KEY/);
  await assert.rejects(app.exports.sendPasswordResetEmail(message), /Email delivery unavailable/);
  assert.equal(app.keys.length, 0);
  assert.equal(app.calls.length, 0);
});

test('delivery resolves only once the provider accepts the message', async () => {
  let complete;
  const app = harness({ send: () => new Promise(resolve => { complete = resolve; }) });
  let settled = false;
  const pending = app.exports.sendPasswordResetEmail(message).then(result => { settled = true; return result; });
  assert.equal(settled, false);
  complete({ data: { id: 'accepted-id' } });
  assert.deepEqual(json(await pending), { data: { id: 'accepted-id' } });
  assert.equal(settled, true);
});

test('reset template uses the exact canonical fragment link and explains expiry, single use, and unchanged approval', () => {
  const mail = templates.passwordReset({ name: '<img src=x onerror=alert(1)> & "Member"', token });
  const link = `https://www.imperialsdodgeball.com/member#reset=${token}`;
  assert(mail.html.includes(`href="${link}"`));
  assert(mail.text.includes(link));
  assert(!mail.subject.includes(token));
  assert(!mail.html.includes('<img src=x'));
  assert(mail.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Member&quot;'));
  assert.match(mail.text, /30 minutes/);
  assert.match(mail.text, /only be used once/);
  assert.match(mail.text, /approval remains unchanged/);
  assert.match(mail.text, /password will remain unchanged/);
  assert.match(templates.passwordReset({ token }).text, /Hallo,/);
  for (const invalid of [undefined, 1, '', 'a'.repeat(63), 'A'.repeat(64), `${token}\n`]) {
    assert.throws(() => templates.passwordReset({ token: invalid }), /Invalid password reset token/);
  }
});

test('signup confirmation escapes the submitted name in HTML without changing the plain-text greeting', () => {
  const mail = templates.signupConfirmation({ name: '<a href="https://example.test">name</a>' });
  assert(!mail.html.includes('<a href="https://example.test">name</a>'));
  assert(mail.html.includes('&lt;a href=&quot;https://example.test&quot;&gt;name&lt;/a&gt;'));
  assert(mail.text.includes('<a href="https://example.test">name</a>'));
});
