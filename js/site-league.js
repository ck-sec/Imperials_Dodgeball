(function() {
  const root = document.getElementById('publicLeague');
  if (!root) return;
  const ui = window.LeagueUI;
  const content = root.querySelector('[data-league-content]');
  let lang = window.SiteLanguage ? window.SiteLanguage.get() : 'de';
  let data = null;
  let archive = null;
  let seasons = [];
  const routes = {
    '': 'standings',
    '#training-league': 'standings',
    '#training-league-teams': 'teams',
    '#training-league-schedule': 'schedule',
    '#training-league-standings': 'standings',
    '#rankings': 'standings',
    '#season-1': 'standings',
    '#hall-of-fame': 'honours'
  };
  let selectedSeason = ['#season-1', '#hall-of-fame'].includes(location.hash) ? 'season-1' : '';
  let deepLinkPending = Boolean(location.hash && routes[location.hash]);
  let activePanel = routes[location.hash] || 'standings';
  let selectedEvent = '';
  let search = '';
  let gender = 'all';
  let visible = 25;
  let request = 0;
  let archiveRequest = 0;
  let loading = true;
  let archiveLoading = true;
  let loadError = false;
  let archiveError = false;

  function standingRows() {
    if (selectedSeason !== 'season-1') return data.standings;
    const entries = archive.players.filter(player => gender === 'all' || player.gender === gender);
    return window.LeagueArchive.rankPlayers(entries).map(player => ({
      rank: player.rank, display_name: player.name, points: player.points,
      played: player.played, legacy: player
    }));
  }

  function renderStandings() {
    const t = ui.text[lang];
    const rows = standingRows();
    const filtered = rows.filter(player => player.display_name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    content.querySelector('[data-league-standings]').innerHTML = filtered.length
      ? ui.standings(filtered.slice(0, visible), lang)
      : `<p class="league-notice">${ui.escape(rows.length ? t.noResults : t.noScores)}</p>`;
    const more = content.querySelector('[data-league-more]');
    more.hidden = filtered.length <= visible;
    more.textContent = `${t.more} (${Math.min(visible, filtered.length)}/${filtered.length})`;
  }

  function renderEvent() {
    const event = data.events.find(entry => entry.id === selectedEvent);
    content.querySelector('[data-league-event]').innerHTML = event ? ui.event(event, lang)
      : `<p class="league-notice">${ui.escape(ui.text[lang].noTeams)}</p>`;
    content.querySelector('[data-league-schedule]').innerHTML = ui.schedule(event, lang);
  }

  function updateHash() {
    const hash = selectedSeason === 'season-1'
      ? (activePanel === 'honours' ? '#hall-of-fame' : '#season-1')
      : '#training-league-' + activePanel;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  function selectPanel(panel, navigate = false) {
    activePanel = panel;
    content.querySelectorAll('[data-league-tab]').forEach(button => {
      const active = button.dataset.leagueTab === panel;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    content.querySelectorAll('[data-league-panel]').forEach(section => {
      section.hidden = section.dataset.leaguePanel !== panel;
    });
    const trainingControl = content.querySelector('[data-league-training-control]');
    if (trainingControl) trainingControl.hidden = panel === 'standings';
    if (navigate) updateHash();
    const honours = root.querySelector('[data-league-hof]');
    if (honours) honours.setAttribute('aria-current', selectedSeason === 'season-1' && panel === 'honours' ? 'location' : 'false');
  }

  function tabs(panels) {
    return `<div class="league-tabs" role="tablist" aria-label="Imperials Social League">${panels.map(([key, label]) =>
      `      <button class="league-btn" type="button" role="tab" id="leagueTab-${key}" aria-controls="leaguePanel-${key}" data-league-tab="${key}">${ui.escape(label)}</button>`
    ).join('')}</div>`;
  }

  function standingsPanel(isArchive) {
    const t = ui.text[lang];
    return `<div class="league-block" role="tabpanel" tabindex="0" id="leaguePanel-standings" aria-labelledby="leagueTab-standings" data-league-panel="standings">
      ${!isArchive && data.comparison_event ? `<p class="league-comparison">${ui.escape(lang === 'de' ? 'Veränderung durch das letzte gewertete Training:' : 'Movement from the latest scored training:')} ${ui.escape(ui.date(data.comparison_event.session_date, lang))} · ${ui.escape(data.comparison_event.title)}</p>` : ''}
      <div class="league-toolbar">
        <label class="league-field">${ui.escape(t.search)}<input class="league-input" type="search" data-league-search placeholder="${ui.escape(t.searchHint)}" value="${ui.escape(search)}"></label>
        ${isArchive ? `<label class="league-field">${lang === 'de' ? 'Kategorie' : 'Category'}<select class="league-input" data-league-gender>
          <option value="all"${gender === 'all' ? ' selected' : ''}>${lang === 'de' ? 'Alle' : 'All'}</option>
          <option value="male"${gender === 'male' ? ' selected' : ''}>${lang === 'de' ? 'Herren' : 'Men'}</option>
          <option value="female"${gender === 'female' ? ' selected' : ''}>${lang === 'de' ? 'Damen' : 'Women'}</option>
        </select></label>` : ''}
      </div>
      <div data-league-standings></div>
      <button class="league-btn" data-league-more hidden>${ui.escape(t.more)}</button>
    </div>`;
  }

  function renderArchive() {
    const t = ui.text[lang];
    return `<p class="league-copy">Season 1 &middot; ${lang === 'de' ? 'Abgeschlossen' : 'Completed'} &middot; ${archive.players.length} ${ui.escape(t.members)}</p>
      ${tabs([['standings', t.standings], ['honours', 'Hall of Fame']])}
      ${standingsPanel(true)}
      <div class="league-block" role="tabpanel" tabindex="0" id="leaguePanel-honours" aria-labelledby="leagueTab-honours" data-league-panel="honours">
        <h3>Hall of Fame &middot; Season 1</h3>
        <p class="league-copy">${lang === 'de' ? 'Die Top 3 der Herren und Damen. Gleiche Punkte teilen sich den Platz.' : 'Honouring our top three men and women. Equal points share a place.'}</p>
        <div class="league-hof-grid">${window.LeagueArchive.hallOfFame(archive.players).map(group => `
          <section class="league-hof-category">
            <h4>${group.gender === 'male' ? (lang === 'de' ? 'Herren' : 'Men') : (lang === 'de' ? 'Damen' : 'Women')}</h4>
            <ol class="league-hof-podium">${group.players.map(player => `<li class="league-hof-winner">
              <div class="league-hof-medal" aria-label="${ui.escape(t.place)} ${player.rank}">${player.rank}</div>
              <div><div class="league-player-name">${ui.escape(player.name)}</div><div class="league-player-meta">${player.played} ${ui.escape(t.played)}</div></div>
              <div class="league-points">${ui.escape(player.points)}<small>${ui.escape(t.points)}</small></div>
            </li>`).join('')}</ol>
          </section>`).join('')}</div>
      </div>`;
  }

  function renderCurrent() {
    const t = ui.text[lang];
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const events = [...data.events].sort((a, b) => {
      const aUpcoming = a.session_date.slice(0, 10) >= today && a.status === 'published';
      const bUpcoming = b.session_date.slice(0, 10) >= today && b.status === 'published';
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      return aUpcoming ? a.session_date.localeCompare(b.session_date) : b.session_date.localeCompare(a.session_date);
    });
    if (!events.some(event => event.id === selectedEvent)) selectedEvent = events.length ? events[0].id : '';
    return `<p class="league-copy">${ui.escape(ui.date(data.season.start_date, lang))} &ndash; ${ui.escape(ui.date(data.season.end_date, lang))}</p>
      ${ui.guide(data.season, lang)}
      ${tabs([['standings', t.standings], ['teams', t.teams], ['schedule', t.schedule]])}
      ${events.length ? `<label class="league-field league-block" data-league-training-control>${ui.escape(t.training)}<select class="league-input" data-league-event-select>${events.map(event =>
          `<option value="${ui.escape(event.id)}"${event.id === selectedEvent ? ' selected' : ''}>${ui.escape(ui.date(event.session_date, lang))} - ${ui.escape(event.title)}</option>`
        ).join('')}</select></label>` : ''}
      <div class="league-block" role="tabpanel" tabindex="0" id="leaguePanel-teams" aria-labelledby="leagueTab-teams" data-league-panel="teams">
        <div class="league-block" data-league-event></div>
      </div>
      <div class="league-block" role="tabpanel" tabindex="0" id="leaguePanel-schedule" aria-labelledby="leagueTab-schedule" data-league-panel="schedule">
        <div data-league-schedule></div>
      </div>
      ${standingsPanel(false)}`;
  }

  function render() {
    const focused = document.activeElement;
    const focusAttribute = focused && content.contains(focused)
      ? ['data-league-season', 'data-league-refresh', 'data-league-search', 'data-league-gender', 'data-league-event-select', 'data-league-tab']
        .find(attribute => focused.hasAttribute(attribute)) : null;
    const focusSelector = focusAttribute === 'data-league-tab'
      ? `[data-league-tab="${focused.dataset.leagueTab}"]`
      : (focusAttribute ? '[' + focusAttribute + ']' : null);
    const t = ui.text[lang];
    const archived = selectedSeason === 'season-1';
    root.lang = lang;
    root.querySelector('[data-league-intro]').textContent = lang === 'de'
      ? 'Dein Team. Deine Punkte. Eure Saison.'
      : 'Your team. Your points. One season together.';
    const currentSeasons = seasons.filter(season => season.id !== 'season-1');
    const options = currentSeasons.length ? ui.seasonOptions(currentSeasons, selectedSeason)
      : `<option value=""${archived ? '' : ' selected'}>Season 2</option>`;
    const busy = archived ? archiveLoading : loading;
    const failed = archived ? archiveError : loadError;
    let body;
    if (busy) body = `<p class="league-notice" role="status">${ui.escape(t.loading)}</p>`;
    else if (failed) body = `<p class="league-notice league-error" role="alert">${ui.escape(t.error)}</p>`;
    else if (archived) body = renderArchive();
    else body = data && data.season ? renderCurrent() : `<p class="league-notice">${ui.escape(t.empty)}</p>`;
    content.innerHTML = `<div class="league-toolbar league-season-toolbar">
      <label class="league-field">${ui.escape(t.season)}<select class="league-input" data-league-season>${options}<option value="season-1"${archived ? ' selected' : ''}>Season 1</option></select></label>
      <button class="league-btn" data-league-refresh${busy ? ' disabled' : ''}>${ui.escape(t.refresh)}</button>
    </div><div data-league-body${busy ? ' aria-busy="true"' : ''}>${body}</div>`;
    selectPanel(activePanel);
    if (focusSelector) content.querySelector(focusSelector)?.focus({ preventScroll: true });
    if (!busy && !failed && (archived || (data && data.season))) {
      if (!archived) renderEvent();
      renderStandings();
    }
    if (deepLinkPending) {
      deepLinkPending = false;
      if (location.hash) document.getElementById('training-league').scrollIntoView({ block: 'start' });
    }
  }

  async function load(seasonId = '') {
    const current = ++request;
    loading = true;
    loadError = false;
    render();
    try {
      const response = await fetch('/api/league?view=public' + (seasonId ? '&season_id=' + encodeURIComponent(seasonId) : ''), { cache: 'no-store' });
      if (!response.ok) throw new Error(`League request failed (${response.status})`);
      const result = await response.json();
      if (current !== request) return;
      data = result;
      seasons = Array.isArray(result.seasons) ? result.seasons : [];
      if (selectedSeason !== 'season-1') selectedSeason = result.season ? result.season.id : '';
    } catch (error) {
      if (current !== request) return;
      console.error('Public league load failed:', error);
      loadError = true;
      data = null;
    } finally {
      if (current === request) { loading = false; render(); }
    }
  }

  async function loadArchive() {
    const current = ++archiveRequest;
    archiveLoading = true;
    archiveError = false;
    render();
    try {
      const response = await fetch('/data/season-1.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Season 1 archive failed (${response.status})`);
      const result = await response.json();
      if (!Array.isArray(result.players) || !result.players.length) throw new Error('Season 1 archive is empty.');
      if (current === archiveRequest) archive = result;
    } catch (error) {
      if (current !== archiveRequest) return;
      console.error('Season 1 archive load failed:', error);
      archiveError = true;
    } finally {
      if (current === archiveRequest) { archiveLoading = false; render(); }
    }
  }

  root.addEventListener('click', event => {
    if (event.target.closest('[data-league-hof]')) {
      event.preventDefault();
      selectedSeason = 'season-1';
      activePanel = 'honours';
      updateHash();
      render();
    }
    if (event.target.closest('[data-league-refresh]')) {
      if (selectedSeason === 'season-1') loadArchive();
      else load(selectedSeason);
    }
    if (event.target.closest('[data-league-more]')) { visible += 25; renderStandings(); }
    const tab = event.target.closest('[data-league-tab]');
    if (tab) selectPanel(tab.dataset.leagueTab, true);
  });
  root.addEventListener('keydown', event => {
    if (!event.target.matches('[data-league-tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...content.querySelectorAll('[data-league-tab]')];
    const index = buttons.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
    selectPanel(buttons[next].dataset.leagueTab, true);
    buttons[next].focus();
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-league-season]')) {
      selectedSeason = event.target.value;
      selectedEvent = '';
      visible = 25;
      search = '';
      gender = 'all';
      activePanel = 'standings';
      updateHash();
      if (selectedSeason === 'season-1') render();
      else load(selectedSeason);
    }
    if (event.target.matches('[data-league-event-select]')) { selectedEvent = event.target.value; renderEvent(); }
    if (event.target.matches('[data-league-gender]')) { gender = event.target.value; visible = 25; renderStandings(); }
  });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-league-search]')) { search = event.target.value; visible = 25; renderStandings(); }
  });
  window.addEventListener('hashchange', () => {
    if (!routes[location.hash]) return;
    selectedSeason = ['#season-1', '#hall-of-fame'].includes(location.hash)
      ? 'season-1' : (data && data.season ? data.season.id : '');
    activePanel = routes[location.hash];
    render();
    document.getElementById('training-league').scrollIntoView({ block: 'start' });
  });
  document.addEventListener('site-language-change', event => {
    lang = event.detail.lang;
    render();
  });
  load();
  loadArchive();
})();
