function openMemberReset() {
  const form = byId('resetForm');
  ['resetPassword', 'resetConfirm'].forEach(id => {
    const input = byId(id);
    input.value = '';
    input.type = 'password';
    input.removeAttribute('aria-invalid');
  });
  ['resetPasswordError', 'resetConfirmError', 'resetError'].forEach(id => {
    const error = byId(id);
    error.textContent = '';
    error.hidden = true;
    delete error.dataset.de;
    delete error.dataset.en;
  });
  form.querySelectorAll('.password-toggle').forEach(button => {
    button.setAttribute('aria-pressed', 'false');
    button.textContent = mt('Zeigen', 'Show');
  });
  delete byId('resetBtn').dataset.retryUntil;
  setBusy('resetBtn', false);
  form.hidden = false;
  sessionExpiredShown = false;
  showView('reset');
  if (!window.MemberRecovery.getToken()) {
    invalidateReset();
    byId('resetError').setAttribute('tabindex', '-1');
    byId('resetError').focus();
  }
}

document.addEventListener('member-reset-link', openMemberReset);
document.addEventListener('click', event => {
  const viewButton = event.target.closest('[data-auth-view]');
  if (viewButton) {
    const view = viewButton.dataset.authView;
    if (view === 'recovery') {
      window.MemberRecovery.clear();
      byId('recoveryForm').hidden = false;
      byId('recoveryMessage').hidden = true;
      clearErrors('recoveryForm');
      byId('recoveryEmail').value = (currentUser && currentUser.email) || byId('loginEmail').value;
    }
    sessionExpiredShown = false;
    showView(view);
    return;
  }
  const tab = event.target.closest('[data-tab], [data-member-tab]');
  if (tab) { switchTab(tab.dataset.tab || tab.dataset.memberTab); return; }
  const rsvp = event.target.closest('[data-rsvp-session]');
  if (rsvp) { handleRsvp(rsvp.dataset.rsvpSession, rsvp.dataset.rsvpStatus); return; }
  const attendees = event.target.closest('[data-attendees-session]');
  if (attendees) { toggleAttendees(attendees, attendees.dataset.attendeesSession); return; }
  if (event.target.closest('[data-training-refresh]')) {
    loadTrainingSessions();
    loadMemberLeague();
    return;
  }
  if (event.target.closest('[data-member-league-refresh]')) {
    const select = byId('memberLeagueSeason');
    loadMemberLeague(activeTab === 'league' && select ? select.value : '');
    return;
  }
  if (event.target.closest('[data-member-standings-more]')) { memberStandingsVisible += 25; renderMemberLeague(); return; }
  if (event.target.closest('[data-archive-retry]')) { loadMemberArchive(); return; }
  if (event.target.closest('[data-archive-more]')) { archiveVisible += 30; renderMemberArchive(); }
});

document.querySelector('.dash-tabs').addEventListener('keydown', event => {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const tabs = ['training', 'league', 'account'];
  const index = tabs.indexOf(activeTab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
  switchTab(tabs[next], true);
});
byId('memberLeagueContent').addEventListener('change', event => {
  if (event.target.id === 'memberLeagueSeason') loadMemberLeague(event.target.value);
});
byId('seasonOneArchive').addEventListener('toggle', () => {
  if (byId('seasonOneArchive').open) loadMemberArchive();
});
byId('loginForm').addEventListener('submit', handleLogin);
byId('registerForm').addEventListener('submit', handleRegister);
byId('reAuthForm').addEventListener('submit', handleReAuth);
byId('recoveryForm').addEventListener('submit', handleRecovery);
byId('resetForm').addEventListener('submit', handleResetPassword);
byId('navLogoutBtn').addEventListener('click', handleLogout);
byId('fullLogoutLink').addEventListener('click', handleLogout);
byId('savePrefsBtn').addEventListener('click', saveEmailPrefs);
byId('sessionOverlay').addEventListener('cancel', event => { event.preventDefault(); });
document.querySelectorAll('.password-toggle').forEach(button => {
  button.addEventListener('click', () => togglePasswordVisibility(button));
});
document.addEventListener('site-language-change', () => {
  applyMemberLanguage();
  if (trainingLoaded) renderTrainingSessions();
  renderTrainingSummary();
  renderMemberLeague();
  renderOtherMemberEvents();
  renderMemberArchive();
});

async function initMember() {
  applyMemberLanguage();
  if (window.MemberRecovery.present) {
    openMemberReset();
    return;
  }
  const epoch = memberEpoch;
  try {
    const response = await api('/api/member/stats?view=account', { _suppressExpired: true, cache: 'no-store' });
    if (epoch !== memberEpoch || currentView !== 'login') return;
    if (response.status === 403) { showView('pending'); return; }
    if (!response.ok) throw new Error('Initial account request failed');
    const data = await response.json();
    if (epoch !== memberEpoch || currentView !== 'login') return;
    if (!data.user) throw new Error('Missing account data');
    currentUser = data.user;
    enterDashboard(data);
  } catch (error) {
    if (epoch !== memberEpoch || currentView !== 'login') return;
    showView('login');
    if (error.message !== 'SESSION_EXPIRED') {
      console.error('Member session check failed:', error);
      setMessage('loginMessage', 'Sitzung konnte nicht geprüft werden. Bitte erneut anmelden.', 'Could not check your session. Please sign in again.', true);
    }
  }
}
initMember();
