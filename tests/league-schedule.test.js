const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { bookingWindow, validateBookingSchedule } = require('../js/league-schedule');

const session = { start_time: '18:00:00', end_time: '20:10:00' };
const program = {
  referee_policy: 'rotating_team_v1', meetup_time: '18:00', available_minutes: 120, finale_minutes: 10,
};

test('booking helper exposes identical CommonJS and browser interfaces without dependencies', () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/league-schedule.js'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.window.LeagueSchedule).sort(), ['bookingWindow', 'validateBookingSchedule']);
  assert.equal(browser.window.LeagueSchedule.validateBookingSchedule(session, program), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.window.LeagueSchedule.bookingWindow(session))), bookingWindow(session));
  assert.throws(() => browser.window.LeagueSchedule.validateBookingSchedule(
    { ...session, end_time: '20:00' }, program), /including the finale/);
  const { referee_policy, ...form } = program;
  assert.throws(() => browser.window.LeagueSchedule.validateBookingSchedule(
    { ...session, end_time: '20:00' }, form), /including the finale/);
});

test('booking windows support clock and SQL times with exact fractional seconds', () => {
  assert.deepEqual(bookingWindow({ start_time: '00:00', end_time: '23:59' }), { startMinute: 0, endMinute: 1439 });
  assert.deepEqual(bookingWindow(session), { startMinute: 1080, endMinute: 1210 });
  assert.deepEqual(bookingWindow({ start_time: '18:00:30.5', end_time: '20:10:45.125000' }),
    { startMinute: 1080 + 30.5 / 60, endMinute: 1210 + 45.125 / 60 });
  assert(bookingWindow({ ...session, start_time: '18:00:00.000001' }).startMinute > 1080);
  assert(bookingWindow({ ...session, end_time: '20:09:59.999999' }).endMinute < 1210);
});

test('missing, malformed and overnight booking times fail with Training tab guidance', () => {
  for (const bad of [undefined, null, '', 1800, '6:00', '18:60', '18:00:60', '24:00:00', '18:00Z', '18:00:00.1234567']) {
    for (const field of ['start_time', 'end_time']) {
      assert.throws(() => bookingWindow({ ...session, [field]: bad }), /valid start and end times.*Training tab/);
    }
  }
  for (const booking of [undefined, null, {}, { start_time: '18:00', end_time: '18:00' },
    { start_time: '23:00', end_time: '01:00' }]) {
    assert.throws(() => bookingWindow(booking), /Training tab/);
    assert.throws(() => validateBookingSchedule(booking, program), /Training tab/);
  }
});

test('managed schedules must fit meetup through the finale, not just the last match', () => {
  for (const referee_policy of ['rotating_team_v1', 'external_ref_v1']) {
    const schedule = { ...program, referee_policy, duration_minutes: 75, total_duration_minutes: 75 };
    assert.equal(validateBookingSchedule(session, schedule), undefined, 'Exact boundaries fit');
    assert.equal(validateBookingSchedule({ start_time: '17:30', end_time: '21:00' }, schedule), undefined);
    assert.throws(() => validateBookingSchedule({ ...session, start_time: '18:01' }, schedule), /Meetup.*booking start/);
    assert.throws(() => validateBookingSchedule({ ...session, end_time: '20:00' }, schedule), /including the finale/);
    assert.throws(() => validateBookingSchedule({ ...session, end_time: '19:15' }, schedule), /including the finale/);
    assert.throws(() => validateBookingSchedule({ start_time: '23:00', end_time: '23:59:59.999999' },
      { ...schedule, meetup_time: '23:00', available_minutes: 60, finale_minutes: 1 }), /same day/);
  }
});

test('raw form settings validate booking and required timing without a referee policy', () => {
  const { referee_policy, ...form } = program;
  assert.equal(validateBookingSchedule(session, form), undefined);
  assert.throws(() => validateBookingSchedule(null, form), /Training tab/);
  assert.throws(() => validateBookingSchedule({ ...session, start_time: '18:00:00.000001' }, form), /booking start/);
  assert.throws(() => validateBookingSchedule({ ...session, end_time: '20:09:59.999999' }, form), /including the finale/);
  for (const field of ['meetup_time', 'available_minutes', 'finale_minutes']) {
    const missing = { ...form };
    delete missing[field];
    assert.throws(() => validateBookingSchedule(session, missing), /missing or invalid|valid available minutes/);
  }
  assert.throws(() => validateBookingSchedule(session, {}), /meetup time is missing or invalid/);
  assert.throws(() => validateBookingSchedule(session, { ...form, referee_policy: 'unknown' }), /referee policy is invalid/);
});

test('fractional SQL seconds never round an early meetup or late finale into the booking', () => {
  assert.throws(() => validateBookingSchedule({ ...session, start_time: '18:00:00.000001' }, program), /booking start/);
  assert.throws(() => validateBookingSchedule({ ...session, end_time: '20:09:59.999999' }, program), /booking end/);
  assert.equal(validateBookingSchedule({ start_time: '18:00:00.123456', end_time: '20:10:00.123456' },
    { ...program, meetup_time: '18:00:00.123456' }), undefined);
  assert.throws(() => validateBookingSchedule({ start_time: '18:00:00.123456', end_time: '20:10:00.123455' },
    { ...program, meetup_time: '18:00:00.123456' }), /booking end/);
});

test('managed program timing is required and validated explicitly; legacy schedules remain readable', () => {
  for (const bad of [null, undefined, [], 'schedule']) {
    assert.throws(() => validateBookingSchedule(session, bad), /schedule is required/);
  }
  for (const meetup_time of [undefined, null, '', 'tomorrow', '25:00']) {
    assert.throws(() => validateBookingSchedule(session, { ...program, meetup_time }), /meetup time is missing or invalid/);
  }
  for (const field of ['available_minutes', 'finale_minutes']) {
    for (const bad of [undefined, null, '10', 0, -1, 1.5, NaN, Infinity, field === 'available_minutes' ? 481 : 11]) {
      assert.throws(() => validateBookingSchedule(session, { ...program, [field]: bad }), /valid available minutes.*finale minutes/);
    }
  }
  assert.equal(validateBookingSchedule(null, { rounds: [], duration_minutes: 20 }), undefined);
  const frozen = Object.freeze({ ...program });
  assert.equal(validateBookingSchedule(Object.freeze({ ...session }), frozen), undefined);
});
