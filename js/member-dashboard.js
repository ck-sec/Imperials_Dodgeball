let archiveData = null;
let archiveLoaded = false;
let archiveLoading = false;
let archiveVisible = 20;

function renderAccount(user) {
  currentUser = { ...currentUser, ...user };
  byId('dashName').textContent = currentUser.display_name;
  byId('accountName').textContent = currentUser.display_name;
  byId('accountEmail').textContent = currentUser.email;
  byId('emailNotifToggle').checked = currentUser.email_notifications !== false;
}

function enterDashboard(prefetchedData) {
  showView('dashboard');
  renderAccount(prefetchedData ? prefetchedData.user : currentUser);
  switchTab('training');
  loadMemberLeague();
  if (!prefetchedData) loadAccount();
}

async function loadAccount() {
  const epoch = memberEpoch;
  try {
    const response = await api('/api/member/stats?view=account', { cache: 'no-store' });
    if (!response.ok) throw new Error('Account request failed');
    const data = await response.json();
    if (epoch !== memberEpoch) return;
    renderAccount(data.user);
    byId('accountMessage').hidden = true;
  } catch (error) {
    if (epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member account load failed:', error);
    setMessage('accountMessage', 'Kontodaten konnten nicht geladen werden.', 'Account details could not be loaded.', true);
  }
}

async function saveEmailPrefs() {
  if (byId('savePrefsBtn').disabled) return;
  const epoch = memberEpoch;
  const enabled = byId('emailNotifToggle').checked;
  setBusy('savePrefsBtn', true);
  byId('emailNotifToggle').disabled = true;
  byId('settingsSaved').hidden = true;
  try {
    const response = await api('/api/member/stats', {
      method: 'PATCH', body: JSON.stringify({ email_notifications: enabled })
    });
    if (!response.ok) throw new Error('Preferences request failed');
    if (epoch !== memberEpoch) return;
    currentUser.email_notifications = enabled;
    setMessage('settingsSaved', 'Gespeichert.', 'Saved.');
  } catch (error) {
    if (epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member preferences save failed:', error);
    setMessage('settingsSaved', 'Nicht gespeichert. Bitte erneut versuchen.', 'Not saved. Please try again.', true);
  } finally {
    if (epoch === memberEpoch) {
      setBusy('savePrefsBtn', false);
      byId('emailNotifToggle').disabled = false;
    }
  }
}

async function loadMemberArchive() {
  if (archiveLoaded || archiveLoading) return;
  archiveLoading = true;
  const epoch = memberEpoch;
  byId('memberArchiveContent').innerHTML = `<p class="league-notice" role="status">${mt('Archiv wird geladen …', 'Loading archive …')}</p>`;
  try {
    const response = await api('/api/member/stats', { cache: 'no-store' });
    if (!response.ok) throw new Error('Archive request failed');
    const data = await response.json();
    if (epoch !== memberEpoch) return;
    archiveData = data;
    archiveLoaded = true;
    renderMemberArchive();
  } catch (error) {
    if (epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member archive load failed:', error);
    byId('memberArchiveContent').innerHTML = `<p class="league-error" role="alert">${mt('Archiv nicht erreichbar.', 'Archive unavailable.')}</p><button type="button" class="league-btn" data-archive-retry>${mt('Erneut versuchen', 'Try again')}</button>`;
  } finally {
    if (epoch === memberEpoch) archiveLoading = false;
  }
}

function renderMemberArchive() {
  if (!archiveData) return;
  const stats = archiveData.stats;
  const players = archiveData.rankings || [];
  byId('memberArchiveContent').innerHTML = `
    <p class="league-copy">${mt('Abgeschlossene Saison. Nicht Teil der aktuellen Liga.', 'Completed season. Separate from the current league.')}</p>
    <p class="league-notice">${stats
      ? `${mt('Dein Archiv-Ergebnis', 'Your archived result')}: #${escapeHtml(stats.rank)} · ${escapeHtml(stats.points)} ${mt('Punkte', 'points')}`
      : mt('Kein Season-1-Ergebnis mit deinem Konto verknüpft.', 'No Season 1 result is linked to your account.')}</p>
    ${stats ? `<p class="league-copy">${escapeHtml(stats.played)} ${mt('gespielt', 'played')} · ${mt('Serie', 'Streak')}: ${escapeHtml(stats.streak)} · ${mt('Bonuspunkte', 'Bonus points')}: ${escapeHtml(stats.bp)}${stats.tier ? ' · ' + escapeHtml(stats.tier) : ''}</p>` : ''}
    ${window.LeagueUI.standings(players.slice(0, archiveVisible).map(player => ({
      rank: player.rank, display_name: player.name, points: player.points, played: player.played
    })), memberLang())}
    ${players.length > archiveVisible ? `<button type="button" class="league-btn" data-archive-more>${mt('Mehr anzeigen', 'Show more')}</button>` : ''}`;
}
