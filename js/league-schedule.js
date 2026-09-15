(function(root, factory) {
  const schedule = factory();
  if (typeof module === 'object' && module.exports) module.exports = schedule;
  else root.LeagueSchedule = schedule;
})(typeof window === 'undefined' ? globalThis : window, function() {
  const minute = 60000000;

  function timeMicroseconds(value) {
    const match = typeof value === 'string'
      && /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/.exec(value);
    if (!match) return null;
    return (Number(match[1]) * 60 + Number(match[2])) * minute
      + Number(match[3] || 0) * 1000000 + Number((match[4] || '').padEnd(6, '0'));
  }

  function bookingTimes(session) {
    const start = timeMicroseconds(session && session.start_time);
    const end = timeMicroseconds(session && session.end_time);
    if (start === null || end === null) {
      throw new Error('Training booking needs valid start and end times. Set both in the Training tab before generating or publishing a schedule.');
    }
    if (end <= start) {
      throw new Error('Training booking must end after it starts on the same day. Fix the booking in the Training tab; overnight bookings are not supported.');
    }
    return { start, end };
  }

  function bookingWindow(session) {
    const { start, end } = bookingTimes(session);
    return { startMinute: start / minute, endMinute: end / minute };
  }

  function validateBookingSchedule(session, schedule) {
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
      throw new Error('A schedule is required to check the training booking.');
    }
    // Saved legacy round lists are historical; new form settings have no referee policy yet.
    if (!schedule.referee_policy && Array.isArray(schedule.rounds)) return;
    if (schedule.referee_policy && !['rotating_team_v1', 'external_ref_v1'].includes(schedule.referee_policy)) {
      throw new Error('Schedule referee policy is invalid. Regenerate the schedule.');
    }
    const { start, end } = bookingTimes(session);
    const meetup = timeMicroseconds(schedule.meetup_time);
    if (meetup === null) {
      throw new Error('Schedule meetup time is missing or invalid. Set a valid meetup time and regenerate the schedule.');
    }
    if (!Number.isInteger(schedule.available_minutes) || schedule.available_minutes < 1 || schedule.available_minutes > 480
      || !Number.isInteger(schedule.finale_minutes) || schedule.finale_minutes < 1 || schedule.finale_minutes > 10) {
      throw new Error('Schedule needs valid available minutes (1-480) and finale minutes (1-10). Regenerate the schedule.');
    }
    // Preserve SQL microseconds: rounding booking boundaries could admit early starts or late finishes.
    const finish = meetup + (schedule.available_minutes + schedule.finale_minutes) * minute;
    if (meetup < start) {
      throw new Error('Meetup must be at or after the training booking start. Adjust the meetup time or update the booking in the Training tab.');
    }
    if (finish > end) {
      throw new Error('The entire program, including the finale, must finish by the training booking end on the same day. Shorten the program or update the booking in the Training tab.');
    }
  }

  return { bookingWindow, validateBookingSchedule };
});
