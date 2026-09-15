let memberLeagueRequest = 0;
let memberLeagueData = null;
let memberCurrentLeagueData = null;
let memberEvents = [];
let memberStandingsVisible = 15;

async function loadMemberLeague(seasonId = '') {
  const root = byId('memberLeagueContent');
  const request = ++memberLeagueRequest;
  const epoch = memberEpoch;
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = `<p class="league-notice" role="status">${mt('Liga wird geladen …', 'Loading league …')}</p>`;
  try {
    const response = await api('/api/league?view=me' + (seasonId ? '&season_id=' + encodeURIComponent(seasonId) : ''), { cache: 'no-store' });
    if (!response.ok) throw new Error('League request failed');
    const data = await response.json();
    if (request !== memberLeagueRequest || epoch !== memberEpoch || !currentUser) return;
    if (!Array.isArray(data.my_events)) throw new Error('Missing member league events');
    memberLeagueData = data;
    if (!seasonId || !memberCurrentLeagueData) memberCurrentLeagueData = data;
    memberEvents = data.my_events;
    memberStandingsVisible = 15;
    renderMemberLeague();
    renderTrainingSummary();
    if (trainingLoaded) renderTrainingSessions();
    renderOtherMemberEvents();
  } catch (error) {
    if (request !== memberLeagueRequest || epoch !== memberEpoch || error.message === 'SESSION_EXPIRED') return;
    console.error('Member league load failed:', error);
    root.innerHTML = `<p class="league-error" role="alert">${mt('Liga konnte nicht geladen werden.', 'League could not be loaded.')}</p><button class="league-btn" type="button" data-member-league-refresh>${mt('Erneut versuchen', 'Try again')}</button>`;
    if (!seasonId) byId('trainingLeagueSummary').innerHTML = `<p class="league-error" role="alert">${mt('Team- und Ligadaten nicht erreichbar.', 'Team and league data unavailable.')}</p><button class="league-btn" type="button" data-member-league-refresh>${mt('Erneut versuchen', 'Try again')}</button>`;
  } finally {
    if (request === memberLeagueRequest) root.removeAttribute('aria-busy');
  }
}

function comparisonNote(data) {
  if (!data.comparison_event) return '';
  const event = data.comparison_event;
  return `<p class="league-copy">${mt('Letztes gewertetes Training', 'Last scored training')}: ${escapeHtml(window.LeagueUI.date(event.session_date, memberLang()))} · ${escapeHtml(event.title)}</p>`;
}

function renderTrainingSummary() {
  const data = memberCurrentLeagueData;
  if (!data || !data.season) { byId('trainingLeagueSummary').innerHTML = ''; return; }
  const stats = data.stats;
  byId('trainingLeagueSummary').innerHTML = `
    <div class="member-summary-line">
      <div><div class="member-summary-name">${escapeHtml(data.season.name)}</div>
        <span class="member-summary-values">${stats && stats.rank !== null ? '#' + escapeHtml(stats.rank) : '—'} · ${escapeHtml(stats ? stats.points : 0)} ${mt('Punkte', 'points')}</span>
        ${window.LeagueUI.bonus(stats, memberLang())}
      </div>
      <button type="button" class="text-button" data-member-tab="league">${mt('Zur Liga', 'League')}</button>
    </div>
    ${data.comparison_event && stats ? window.LeagueUI.movement(stats, memberLang()) : ''}`;
}

function renderMemberLeague() {
  const data = memberLeagueData;
  if (!data) return;
  const root = byId('memberLeagueContent');
  const ui = window.LeagueUI;
  const lang = memberLang();
  if (!data.season) {
    const season = data.guide_season;
    root.innerHTML = `${season ? `<p class="league-copy">${escapeHtml(ui.date(season.start_date, lang))} – ${escapeHtml(ui.date(season.end_date, lang))}</p>
      ${ui.guide(season, lang)}` : ''}
      <p class="league-notice">${mt('Noch keine Liga veröffentlicht. Dein Training findest du im Training-Tab.', 'No league published yet. Find upcoming sessions in Training.')}</p>
      <button class="league-btn" type="button" data-member-league-refresh>${mt('Aktualisieren', 'Refresh')}</button>`;
    return;
  }
  const stats = data.stats;
  const standings = data.standings || [];
  const history = data.history || [];
  root.innerHTML = `
    <div class="league-toolbar">
      <label class="league-field">${mt('Saison', 'Season')}<select class="league-input" id="memberLeagueSeason">${ui.seasonOptions(data.seasons, data.season.id)}</select></label>
      <button class="league-btn" type="button" data-member-league-refresh>${mt('Aktualisieren', 'Refresh')}</button>
    </div>
    <p class="league-copy">${escapeHtml(ui.date(data.season.start_date, lang))} – ${escapeHtml(ui.date(data.season.end_date, lang))}</p>
    ${ui.guide(data.season, lang)}
    <div class="league-metrics">
      <div class="league-metric"><strong>${stats && stats.rank !== null ? '#' + escapeHtml(stats.rank) : '—'}</strong><span>${mt('Dein Rang', 'Your rank')}</span></div>
      <div class="league-metric"><strong>${escapeHtml(stats ? stats.points : 0)}</strong><span>${mt('Deine Punkte gesamt', 'Your total points')}</span><br>${ui.bonus(stats, lang)}</div>
      <div class="league-metric"><strong>${escapeHtml(stats ? stats.played : 0)}</strong><span>Trainings</span></div>
      <div class="league-metric"><strong>${escapeHtml(stats ? stats.wins : 0)}</strong><span>${mt('Siege', 'Wins')}</span></div>
    </div>
    ${data.comparison_event && stats ? ui.movement(stats, lang) + comparisonNote(data) : ''}
    <h3>${mt('Rangliste', 'Standings')}</h3>
    ${ui.standings(standings.slice(0, memberStandingsVisible), lang)}
    ${standings.length > memberStandingsVisible ? `<button type="button" class="league-btn" data-member-standings-more>${mt('Mehr anzeigen', 'Show more')}</button>` : ''}
    <details class="member-details"><summary>${mt('Deine Ergebnisse', 'Your results')}</summary>
      ${history.length ? `<ol class="league-history">${history.map(entry => `<li>
        <div class="league-player-name">${escapeHtml(entry.title)}</div>
        <p class="league-copy">${escapeHtml(ui.date(entry.session_date, lang))} · ${escapeHtml(entry.team_name)}</p>
        <span class="league-chip league-chip-gold">${mt('Platz', 'Place')} ${escapeHtml(entry.placement)} · +${escapeHtml(entry.points)} ${mt('Punkte', 'points')}</span>
        ${ui.bonus(entry, lang)}
      </li>`).join('')}</ol>` : `<p class="league-notice">${mt('Noch keine gewerteten Trainings.', 'No scored training yet.')}</p>`}
    </details>`;
}

function memberEventForSession(sessionId) {
  return memberEvents.find(event => String(event.session_id) === String(sessionId)
    && ['published', 'finalized'].includes(event.status)) || null;
}

function publishedEventForSession(sessionId) {
  const own = memberEventForSession(sessionId);
  if (own) return own;
  return ((memberCurrentLeagueData && memberCurrentLeagueData.events) || []).find(event =>
    String(event.session_id) === String(sessionId) && ['published', 'finalized'].includes(event.status)) || null;
}

function fixtureClock(event, offset) {
  if (!event.start_time) return '+' + offset + ' min';
  const [hour, minute] = event.start_time.split(':').map(Number);
  const total = hour * 60 + minute + offset;
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
    + (total >= 1440 ? ' (+1)' : '');
}

function nextMemberFixture(event, now = viennaNow()) {
  if (!event.schedule || !event.my_team_number || event.status === 'finalized') return null;
  const date = String(event.session_date).slice(0, 10);
  if (date < now.date) return null;
  const [hour, minute] = (event.start_time || '00:00').split(':').map(Number);
  const elapsed = date === now.date ? now.minutes - hour * 60 - minute : -1;
  for (const round of event.schedule.rounds) {
    if (round.end_minute <= elapsed) continue;
    const match = round.matches.find(item => (item.team_a === event.my_team_number || item.team_b === event.my_team_number)
      && (item.score_a === null || item.score_a === undefined) && (item.score_b === null || item.score_b === undefined));
    if (match) return { round, match };
  }
  return null;
}

function renderMemberEvent(event) {
  const ui = window.LeagueUI;
  const lang = memberLang();
  const own = event.teams.find(team => team.number === event.my_team_number);
  const next = own && nextMemberFixture(event);
  let fixture = '';
  if (next) {
    const opponentNumber = next.match.team_a === own.number ? next.match.team_b : next.match.team_a;
    const opponent = event.teams.find(team => team.number === opponentNumber);
    fixture = `<div class="member-next-match"><small>${mt('Dein nächstes Spiel', 'Your next match')}</small>
      <strong>${escapeHtml(fixtureClock(event, next.round.start_minute))} · ${mt('gegen', 'vs')} ${escapeHtml(opponent ? opponent.name : 'Team ' + opponentNumber)}</strong>
      <small>${mt('Runde', 'Round')} ${escapeHtml(next.round.number)} · ${mt('Feld', 'Court')} ${escapeHtml(next.match.court)}</small></div>`;
  } else if (own) {
    fixture = `<p class="league-copy">${event.status === 'finalized'
      ? mt('Ergebnis bestätigt.', 'Result confirmed.')
      : event.schedule ? mt('Keine weiteren offenen Spiele geplant.', 'No further pending matches scheduled.')
        : mt('Spielplan folgt.', 'Match schedule to follow.')}</p>`;
  }
  return `<div class="member-team league">
    ${own ? `<p class="eyebrow">${mt('Dein Team', 'Your team')}</p><h4>${escapeHtml(own.name)}</h4>
      <p class="member-team-names">${own.players.map(player => escapeHtml(player.display_name)).join(' · ')}</p>${fixture}`
      : `<p class="league-copy">${mt('Teams veröffentlicht. Kein Team mit deinem Profil verknüpft.', 'Teams published. No team linked to your profile.')}</p>`}
    ${ui.matchdayLink(event, lang)}
    <details class="member-details"><summary>${mt('Alle Teams & Spielplan', 'All teams & schedule')}</summary>${ui.event(event, lang, { hideMatchdayLink: true })}${ui.schedule(event, lang)}</details>
  </div>`;
}

function renderOtherMemberEvents() {
  const seen = new Set(trainingSessions.map(session => String(session.id)));
  const today = viennaNow().date;
  const events = memberEvents.filter(event => !seen.has(String(event.session_id))
    && ['published', 'finalized'].includes(event.status) && String(event.session_date).slice(0, 10) >= today);
  byId('otherMemberEvents').innerHTML = events.map(event => `<article class="session-card" data-published-session="${escapeHtml(event.session_id)}">
    <p class="session-date-badge">${escapeHtml(window.LeagueUI.date(event.session_date, memberLang()))}</p>
    <h3 class="session-title">${escapeHtml(event.title)}</h3>
    <p class="session-meta">${escapeHtml(formatTime(event.start_time))}${event.end_time ? ' – ' + escapeHtml(formatTime(event.end_time)) : ''} · ${escapeHtml(event.location)}</p>
    ${renderMemberEvent(event)}
    <p class="rsvp-notice">${mt('Teamfreigabe: Änderungen nur über den Club.', 'Teams published: contact the club for changes.')}</p>
  </article>`).join('');
}
