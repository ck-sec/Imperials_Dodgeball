const attendeeCache = {};
const trainingErrors = {};
let trainingRequest = 0;
let trainingLoading = false;

async function loadTrainingSessions() {
  const request = ++trainingRequest;
  const epoch = memberEpoch;
  trainingLoading = true;
  byId('trainingLoading').hidden = false;
  byId('trainingEmpty').hidden = true;
  try {
    const response = await api('/api/training?view=upcoming', { cache: 'no-store' });
    if (!response.ok) throw new Error('Training request failed');
    const data = await response.json();
    if (request !== trainingRequest || epoch !== memberEpoch || !currentUser) return;
    if (!Array.isArray(data.sessions)) throw new Error('Missing training sessions');
    trainingSessions = data.sessions;
    trainingLoaded = true;
    renderTrainingSessions();
    renderOtherMemberEvents();
  } catch (error) {
    if (request !== trainingRequest || epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member training load failed:', error);
    byId('trainingList').innerHTML = `<p class="member-error" role="alert">${mt('Trainings konnten nicht geladen werden.', 'Training could not be loaded.')}</p><button type="button" class="text-button" data-training-refresh>${mt('Erneut versuchen', 'Try again')}</button>`;
  } finally {
    if (request === trainingRequest) {
      trainingLoading = false;
      byId('trainingLoading').hidden = true;
    }
  }
}

function sessionIsLocked(session) {
  return session.rsvp_locked === true || ['published', 'finalized'].includes(session.league_status) || !!publishedEventForSession(session.id);
}

function canRsvpToSession(session) {
  return !session.is_cancelled && !sessionIsLocked(session) && String(session.session_date).slice(0, 10) >= viennaNow().date;
}

function renderTrainingSessions() {
  const list = byId('trainingList');
  const focus = document.activeElement && document.activeElement.dataset;
  const focusSession = focus && focus.rsvpSession;
  const focusStatus = focus && focus.rsvpStatus;
  list.innerHTML = trainingSessions.map(renderSessionCard).join('');
  byId('trainingEmpty').hidden = trainingSessions.length !== 0;
  if (focusSession) {
    const button = Array.from(list.querySelectorAll('[data-rsvp-session]')).find(element =>
      element.dataset.rsvpSession === focusSession && element.dataset.rsvpStatus === focusStatus);
    if (button && !button.disabled) button.focus({ preventScroll: true });
  }
}

function renderSessionCard(session) {
  const id = String(session.id);
  const date = String(session.session_date).slice(0, 10);
  const published = publishedEventForSession(id);
  const locked = sessionIsLocked(session);
  const status = session.my_status || 'pending';
  const assignedWithoutRsvp = status !== 'attending' && !!memberEventForSession(id);
  const attending = Number(session.attending_count) || 0;
  const capacity = Number(session.max_capacity);
  const full = capacity > 0 && attending >= capacity && status !== 'attending';
  let rsvp = '';
  if (canRsvpToSession(session)) {
    rsvp = `<div class="rsvp-buttons">
      <button type="button" class="rsvp-btn rsvp-attending${status === 'attending' ? ' active' : ''}" data-rsvp-session="${escapeHtml(id)}" data-rsvp-status="attending" aria-pressed="${status === 'attending'}"${rsvpInFlight.has(id) || full ? ' disabled' : ''}>${full ? mt('Ausgebucht', 'Full') : mt('Dabei', 'Going')}</button>
      <button type="button" class="rsvp-btn rsvp-not-attending${status === 'not_attending' ? ' active' : ''}" data-rsvp-session="${escapeHtml(id)}" data-rsvp-status="not_attending" aria-pressed="${status === 'not_attending'}"${rsvpInFlight.has(id) ? ' disabled' : ''}>${mt('Nicht dabei', 'Not going')}</button>
    </div>`;
  } else if (session.is_cancelled) {
    rsvp = `<p class="rsvp-notice">${mt('Abgesagt', 'Cancelled')}</p>`;
  } else if (locked) {
    rsvp = `<p class="rsvp-notice">${mt('Teams veröffentlicht. Änderungen nur über den', 'Teams published. For changes contact the')} <a href="mailto:imperialsdodgeball@gmail.com">Club</a>.</p>`;
    if (!published) rsvp += `<p class="league-copy">${mt('Teamdaten noch nicht geladen.', 'Team details not loaded yet.')}</p><button type="button" class="text-button" data-member-league-refresh>${mt('Teams laden', 'Load teams')}</button>`;
  }
  return `<article class="session-card${session.is_cancelled ? ' cancelled' : ''}" data-session-id="${escapeHtml(id)}">
    <p class="session-date-badge">${escapeHtml(new Date(date + 'T12:00:00Z').toLocaleDateString(memberLang() === 'de' ? 'de-AT' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Vienna' }))}</p>
    <h3 class="session-title">${escapeHtml(session.title)}</h3>
    <div class="session-meta"><span>${escapeHtml(formatTime(session.start_time))}${session.end_time ? ' – ' + escapeHtml(formatTime(session.end_time)) : ''}</span>${session.location ? `<span>${escapeHtml(session.location)}</span>` : ''}</div>
    ${!session.is_cancelled ? `<div class="session-counts"><span>${attending}${capacity > 0 ? '/' + capacity : ''} ${mt(attending === 1 ? 'Zusage' : 'Zusagen', attending === 1 ? 'RSVP' : 'RSVPs')}</span>
      <span class="rsvp-status" role="status">${assignedWithoutRsvp ? mt('Im Team eingeplant', 'Assigned to a team') : status === 'attending' ? mt('Du bist dabei', 'You’re going') : status === 'not_attending' ? mt('Du bist nicht dabei', 'You’re not going') : mt('Noch keine Antwort', 'No response yet')}</span></div>` : ''}
    ${rsvp}
    ${trainingErrors[id] ? `<p class="member-error" role="alert">${escapeHtml(mt(trainingErrors[id].de, trainingErrors[id].en))}</p>` : ''}
    ${!session.is_cancelled && published ? renderMemberEvent(published) : ''}
    ${!session.is_cancelled ? `<button type="button" class="attendees-toggle" data-attendees-session="${escapeHtml(id)}" aria-expanded="false" aria-controls="attendees-${escapeHtml(id)}">${mt('Wer ist dabei?', 'Who’s going?')}</button>
      <div class="attendees-list" id="attendees-${escapeHtml(id)}" hidden></div>` : ''}
  </article>`;
}

async function handleRsvp(sessionId, status) {
  const id = String(sessionId);
  const session = trainingSessions.find(item => String(item.id) === id);
  if (!session || !['attending', 'not_attending'].includes(status) || rsvpInFlight.has(id)
    || !canRsvpToSession(session) || session.my_status === status) return;
  const epoch = memberEpoch;
  rsvpInFlight.add(id);
  delete trainingErrors[id];
  renderTrainingSessions();
  try {
    const response = await api('/api/training', {
      method: 'POST', body: JSON.stringify({ action: 'rsvp', session_id: id, status })
    });
    const data = await response.json();
    if (epoch !== memberEpoch) return;
    if (!response.ok) {
      trainingErrors[id] = response.status === 409
        ? { de: 'Die Anmeldung wurde gesperrt. Teams werden aktualisiert.', en: 'Registration is locked. Updating teams.' }
        : response.status === 403
          ? { de: 'Dein Konto ist nicht freigeschaltet. Bitte kontaktiere den Club.', en: 'Your account is not approved. Please contact the club.' }
          : { de: 'Antwort nicht gespeichert. Das Training kann voll oder gesperrt sein. Bitte aktualisieren.', en: 'Response not saved. Training may be full or locked. Please refresh.' };
      if (response.status === 409) {
        session.rsvp_locked = true;
        loadMemberLeague();
      }
      return;
    }
    const latest = trainingSessions.find(item => String(item.id) === id);
    if (latest) {
      latest.my_status = data.my_status;
      latest.attending_count = data.attending_count;
      latest.not_attending_count = data.not_attending_count;
    }
    delete attendeeCache[id];
  } catch (error) {
    if (epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member RSVP failed:', error);
    trainingErrors[id] = { de: 'Antwort nicht bestätigt. Bitte aktualisieren und erneut versuchen.', en: 'Response not confirmed. Please refresh and try again.' };
  } finally {
    if (epoch === memberEpoch) {
      rsvpInFlight.delete(id);
      renderTrainingSessions();
      const button = Array.from(byId('trainingList').querySelectorAll('[data-rsvp-session]')).find(element =>
        element.dataset.rsvpSession === id && element.dataset.rsvpStatus === status);
      if (button && !button.disabled) button.focus({ preventScroll: true });
    }
  }
}

async function toggleAttendees(button, sessionId) {
  const list = byId('attendees-' + sessionId);
  if (!list) return;
  if (!list.hidden) {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.textContent = mt('Wer ist dabei?', 'Who’s going?');
    return;
  }
  const epoch = memberEpoch;
  button.disabled = true;
  button.textContent = mt('Wird geladen …', 'Loading …');
  try {
    if (!attendeeCache[sessionId]) {
      const response = await api('/api/training?view=session&id=' + encodeURIComponent(sessionId), { cache: 'no-store' });
      if (!response.ok) throw new Error('Attendees request failed');
      const data = await response.json();
      if (epoch !== memberEpoch) return;
      if (!Array.isArray(data.attendees)) throw new Error('Missing attendees');
      attendeeCache[sessionId] = data.attendees;
    }
    if (epoch !== memberEpoch) return;
    const names = attendeeCache[sessionId].filter(person => person.status === 'attending').map(person => escapeHtml(person.display_name));
    list.innerHTML = names.length ? names.join(' · ') : mt('Noch keine Zusagen.', 'No one has RSVP’d yet.');
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.textContent = mt('Ausblenden', 'Hide attendees');
  } catch (error) {
    if (epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member attendees load failed:', error);
    list.innerHTML = `<p class="member-error" role="alert">${mt('Teilnehmende konnten nicht geladen werden. Bitte erneut versuchen.', 'Attendees could not be loaded. Please try again.')}</p>`;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.textContent = mt('Ausblenden', 'Hide attendees');
  } finally { button.disabled = false; }
}
