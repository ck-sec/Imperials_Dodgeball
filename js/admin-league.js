/* Imperials Social League administration. Ratings stay in the authenticated dashboard. */
(function () {
  'use strict';

  const root = document.getElementById('tab-league');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const state = {
    data: { seasons: [], players: [], members: [], sessions: [], events: [] },
    loaded: false, busy: false, conflict: false,
    seasonId: '', sessionId: '', selected: new Set(), attending: new Set(),
    teams: [], dirtyTeams: false, dirtyRoster: false, dirtyResults: false,
    size: 'auto', maxTeams: 5, search: '', selectedOnly: false,
    scheduleSettings: { courts: 2, match_minutes: 20, break_minutes: 5, available_minutes: 120 },
    dirtySchedule: false, matchEdits: {},
    profileId: '', profileSearch: '', newSeason: false, seasonOpen: false,
    profilesOpen: false, guestOpen: false, attendanceError: ''
  };
  const dateOnly = value => String(value || '').slice(0, 10);
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const season = () => state.data.seasons.find(s => s.id === state.seasonId);
  const event = () => state.data.events.find(e => e.session_id === state.sessionId);
  const session = () => sessions().find(s => s.id === state.sessionId);
  const allMatches = () => event()?.schedule?.rounds.flatMap(round => round.matches) || [];
  const gamesStarted = () => allMatches().some(match => match.score_a != null || match.score_b != null);
  const lineupStarted = () => !!event()?.roster_locked || gamesStarted();
  const isLocked = () => !!event() && (event().status !== 'draft' || lineupStarted());
  const futureTraining = () => dateOnly(session()?.session_date || event()?.session_date) > today();
  const needsRosterReview = () => state.dirtyRoster || !!event()?.roster_stale;
  const minimumRoster = () => state.size === 'auto' ? 8 : Number(state.size) * 2;
  const hasChanges = () => state.dirtyRoster || state.dirtyTeams || state.dirtyResults ||
    state.dirtySchedule || Object.keys(state.matchEdits).length > 0;
  const selectedAttr = (a, b) => String(a) === String(b) ? ' selected' : '';
  const disabled = condition => condition ? ' disabled' : '';
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rating = player => Math.round(number(player.rating, number(player.initial_rating, 1000)));
  const label = (id, text) => `<label class="al-label" for="${id}">${text}</label>`;
  const option = (value, text, selected) => `<option value="${esc(value)}"${selectedAttr(value, selected)}>${esc(text)}</option>`;
  const action = (name, text, extra = '') => `<button type="button" class="al-button al-secondary" data-al-action="${name}"${extra}>${text}</button>`;
  const heading = (step, title) => `<div class="al-card-heading"><span class="al-step-number" aria-hidden="true">${step}</span><h3>${title}</h3></div>`;

  function players() {
    const profiles = state.data.players.slice();
    const knownIds = new Set(profiles.map(p => p.id));
    for (const team of event()?.teams || []) {
      for (const player of team.players || []) {
        if (!knownIds.has(player.id)) {
          profiles.push(player);
          knownIds.add(player.id);
        }
      }
    }
    const linked = new Set(profiles.map(p => p.user_id).filter(Boolean));
    state.data.members.forEach(m => {
      if (!linked.has(m.id)) profiles.push({
        id: `member:${m.id}`, user_id: m.id, display_name: m.display_name,
        gender: 'unspecified', is_rookie: false, initial_rating: season()?.default_rating ?? 1000,
        rating: season()?.default_rating ?? 1000, uncreated: true
      });
    });
    return profiles.sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  function sessions() {
    const all = new Map(state.data.sessions.map(s => [s.id, s]));
    state.data.events.forEach(e => {
      if (!all.has(e.session_id)) all.set(e.session_id, { ...e, id: e.session_id });
    });
    const selectedSeason = season();
    if (!selectedSeason) return [];
    return [...all.values()].filter(s => {
      const existing = state.data.events.find(e => e.session_id === s.id);
      if (existing) return existing.season_id === selectedSeason.id;
      const date = dateOnly(s.session_date);
      return date >= dateOnly(selectedSeason.start_date) && date <= dateOnly(selectedSeason.end_date);
    }).sort((a, b) => dateOnly(b.session_date).localeCompare(dateOnly(a.session_date)) ||
      String(b.start_time || '').localeCompare(String(a.start_time || '')));
  }

  function setBusy(value, message = '') {
    state.busy = value;
    root.setAttribute('aria-busy', String(value));
    $('al-progress').textContent = message;
    $('al-refresh').disabled = value;
    const workspace = $('al-workspace');
    if (workspace) workspace.disabled = value || state.conflict;
  }

  function clearNotice() {
    state.conflict = false;
    $('al-notice').hidden = true;
    $('al-notice').replaceChildren();
  }

  function showError(error, conflict = false) {
    state.conflict = conflict;
    const notice = $('al-notice');
    notice.replaceChildren();
    const p = document.createElement('p');
    p.textContent = error.message || String(error);
    notice.append(p);
    if (conflict) {
      const help = document.createElement('p');
      help.textContent = 'Refresh the latest saved version before making more changes. Refresh discards unsaved local edits. Do not repeat the previous request until you have checked the refreshed state.';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'al-button al-secondary';
      button.dataset.alAction = 'reload';
      button.textContent = 'Refresh latest league';
      notice.append(help, button);
    }
    notice.hidden = false;
    notice.focus();
    toast(p.textContent, 'danger');
  }

  async function request(url, body) {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + getToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store'
    });
    let data;
    try { data = await response.json(); }
    catch {
      const error = new Error(`The server returned an unreadable response (HTTP ${response.status}). Refresh to check whether your change was saved.`);
      error.status = response.status;
      error.unconfirmed = true;
      throw error;
    }
    if (!response.ok || data.success === false) {
      const error = new Error(typeof data.error === 'string' ? data.error :
        data.error?.message || data.message || `League request failed (HTTP ${response.status}). Please try again.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function loadData({ preserve = false, seasonId, addPlayerId } = {}) {
    const previousEvent = event();
    preserve = preserve && hasChanges();
    const data = await request('/api/league?view=admin');
    for (const key of ['seasons', 'players', 'members', 'sessions', 'events']) {
      if (!Array.isArray(data[key])) throw new Error(`League response is missing ${key}. Refresh and try again.`);
    }
    const nextEvent = data.events.find(e => e.session_id === state.sessionId);
    if (preserve && (previousEvent?.id !== nextEvent?.id || previousEvent?.version !== nextEvent?.version)) {
      const error = new Error('This training changed while you were editing. Refresh and review its latest roster and teams before applying your edits.');
      error.status = 409;
      throw error;
    }
    state.data = data;
    state.loaded = true;
    if (seasonId) state.seasonId = seasonId;
    if (!season()) {
      const active = data.seasons.find(s => dateOnly(s.start_date) <= today() && dateOnly(s.end_date) >= today());
      state.seasonId = (active || data.seasons[0])?.id || '';
    }
    const available = sessions();
    if (!available.some(s => s.id === state.sessionId)) {
      const upcoming = available.filter(s => !s.is_cancelled && dateOnly(s.session_date) >= today()).reverse();
      state.sessionId = (upcoming[0] || available[0])?.id || '';
      preserve = false;
    }
    await loadRoster(preserve);
    if (addPlayerId && !isLocked()) {
      state.selected.add(addPlayerId);
      state.dirtyRoster = true;
    }
    state.newSeason = !state.seasonId;
  }

  async function loadRoster(preserve = false) {
    const existing = event();
    state.attending = new Set();
    state.attendanceError = '';
    if (state.sessionId) {
      const currentIds = Array.isArray(session()?.attending_player_ids) ? session().attending_player_ids :
        Array.isArray(existing?.current_rsvp_player_ids) ? existing.current_rsvp_player_ids : null;
      if (currentIds !== null) {
        state.attending = new Set(currentIds);
      } else {
        try {
          const detail = await request('/api/admin/training?view=detail&id=' + encodeURIComponent(state.sessionId));
          if (!Array.isArray(detail.attendees)) throw new Error('Attendance response is incomplete.');
          const memberIds = new Set(detail.attendees.filter(a => a.status === 'attending').map(a => a.id));
          players().forEach(p => { if (memberIds.has(p.user_id)) state.attending.add(p.id); });
        } catch (error) {
          state.attendanceError = `RSVPs could not be loaded: ${error.message} Use “Refresh RSVPs” or select the roster manually; no players have been silently added.`;
        }
      }
    }
    if (!preserve) {
      state.teams = existing ? existing.teams.map(t => ({
        number: t.number, name: t.name || `Team ${t.number}`, placement: t.placement,
        player_ids: (t.players || []).map(p => p.id)
      })) : [];
      state.selected = existing ? new Set(state.teams.flatMap(t => t.player_ids)) : new Set(state.attending);
      state.size = existing ? String(existing.team_size) : 'auto';
      state.maxTeams = existing?.max_teams ?? 5;
      state.scheduleSettings = existing?.schedule ? {
        courts: existing.schedule.courts, match_minutes: existing.schedule.match_minutes,
        break_minutes: existing.schedule.break_minutes, available_minutes: existing.schedule.available_minutes
      } : { courts: 2, match_minutes: 20, break_minutes: 5, available_minutes: 120 };
      state.dirtySchedule = false;
      state.matchEdits = {};
      state.dirtyTeams = false;
      state.dirtyRoster = false;
      state.dirtyResults = false;
      state.search = '';
    }
    const validIds = new Set(players().map(p => p.id));
    state.selected = new Set([...state.selected].filter(id => validIds.has(id)));
  }

  async function reload(ask = true) {
    if (state.busy) return;
    if (ask && hasChanges() && !window.confirm('Refresh and discard unsaved roster, team or result edits?')) return;
    clearNotice();
    setBusy(true, 'Loading seasons, players and training RSVPs…');
    try {
      await loadData();
      render();
    } catch (error) {
      state.conflict = true;
      showError(new Error(`Could not load the latest league. ${error.message}`), true);
    } finally { setBusy(false); }
  }

  async function write(actionName, payload, { preserve = false, message = 'League updated.', after, focus, retainMatchEdits } = {}) {
    if (state.busy || state.conflict) return false;
    clearNotice();
    setBusy(true, 'Saving… Please wait.');
    let saved = false;
    const priorScores = allMatches().map(match => ({ ...match }));
    try {
      const result = await request('/api/league', { action: actionName, ...payload });
      saved = true;
      const options = { preserve };
      if (after) Object.assign(options, after(result) || {});
      await loadData(options);
      if (retainMatchEdits) {
        for (const matchNumber of Object.keys(retainMatchEdits)) {
          const before = priorScores.find(match => String(match.number) === matchNumber);
          const current = allMatches().find(match => String(match.number) === matchNumber);
          if (!current || !before || current.score_a !== before.score_a || current.score_b !== before.score_b) {
            throw new Error('Another edited match changed on the server. Refresh and review saved scores before entering your remaining changes.');
          }
        }
        state.matchEdits = retainMatchEdits;
      }
      render();
      toast(message, 'success');
      $('al-progress').textContent = message;
      return true;
    } catch (error) {
      const unconfirmed = !saved && (error.unconfirmed || !error.status);
      showError(saved ? new Error(`Your change was saved, but refreshing failed. Do not submit it again. ${error.message}`) :
        unconfirmed ? new Error(`Could not confirm whether the change was saved. Refresh before trying again. ${error.message}`) : error,
        saved || unconfirmed || (error.status === 409 && ['generate', 'save_teams', 'publish', 'unpublish', 'results', 'generate_schedule', 'save_match', 'reopen_results'].includes(actionName)));
      return false;
    } finally {
      setBusy(false, saved && !state.conflict ? message : '');
      if (saved && !state.conflict && focus) $(focus)?.focus();
    }
  }

  function seasonForm() {
    const current = state.newSeason ? null : season();
    const defaults = {
      name: 'Season 2', start_date: '2026-09-14', end_date: '2027-07-02',
      placement_points: [3, 2.5, 2, 1, 0.5], scoring_mode: 'relative', points_step: 0.5,
      k_factor: 24, default_rating: 1000, rookie_rating: 800
    };
    const s = current || defaults;
    return `<details class="al-details" id="al-season-details"${state.seasonOpen || !current ? ' open' : ''}>
      <summary>${current ? 'Edit season settings' : 'Create a season'}</summary>
      <form data-al-form="season">
        <input type="hidden" name="id" value="${esc(current?.id || '')}">
        <div class="al-grid">
          <div class="al-field al-wide">${label('al-season-name', 'Season name')}
            <input id="al-season-name" name="name" value="${esc(s.name)}" required maxlength="100" autocomplete="off" placeholder="Season 2"></div>
          <div class="al-field">${label('al-season-start', 'Start date')}
            <input type="date" id="al-season-start" name="start_date" value="${esc(dateOnly(s.start_date))}" min="2000-01-01" max="2199-12-31" required></div>
          <div class="al-field">${label('al-season-end', 'End date')}
            <input type="date" id="al-season-end" name="end_date" value="${esc(dateOnly(s.end_date))}" min="2000-01-01" max="2199-12-31" required></div>
          <div class="al-field">${label('al-season-scoring', 'Placement scoring mode')}
            <select id="al-season-scoring" name="scoring_mode" aria-describedby="al-scoring-help">
              ${option('relative', 'Relative · scale the curve to all teams', s.scoring_mode || 'fixed')}
              ${option('fixed', 'Fixed · award by exact placement', s.scoring_mode || 'fixed')}
            </select></div>
          <div class="al-field">${label('al-season-step', 'Relative points rounding')}
            <select id="al-season-step" name="points_step" aria-describedby="al-scoring-help">
              ${[0.1, 0.25, 0.5, 1].map(step => option(step, `Nearest ${step} point${step === 1 ? '' : 's'}`, s.points_step ?? 0.5)).join('')}
            </select></div>
          <p class="al-small al-wide" id="al-scoring-help">Relative mode stretches the base five-award curve across the actual number of teams, interpolates between its awards, then rounds to your chosen step. Base awards must be multiples of that step: a step of 1 needs whole-number awards. Fixed mode uses each listed award exactly and repeats the last value for lower places; rounding does not change fixed awards.</p>
          <div class="al-field al-wide">${label('al-season-points', 'Base placement awards, first to last')}
            <input id="al-season-points" name="placement_points" value="${esc(s.placement_points.join(', '))}" required aria-describedby="al-points-help">
            <p class="al-small" id="al-points-help">Default curve: 3, 2.5, 2, 1, 0.5. Custom curves may use any number of descending or equal awards. Every player earns their team’s points, including rotating substitutes. Season points sum EVERY finalized training, not just the best results.</p></div>
          <div class="al-callout al-wide">
            <h4>Points per player, first place to last</h4>
            <p class="al-small">Preview of these form settings. Existing trainings keep their captured rules.</p>
            <div id="al-season-awards" role="status" aria-live="polite">${scoringPreview(s)}</div>
          </div>
          <div class="al-field">${label('al-season-k', 'Private ELO K-factor')}
            <input type="number" id="al-season-k" name="k_factor" value="${number(s.k_factor, 24)}" min="0" max="200" step="any" required>
            <p class="al-small">How quickly private skill changes from final team placements. 0 disables adjustments. Match scores determine places; skill changes only when results are finalized.</p></div>
          <div class="al-field">${label('al-season-default', 'New player starting rating')}
            <input type="number" id="al-season-default" name="default_rating" value="${number(s.default_rating, 1000)}" min="0" max="10000" step="any" required></div>
          <div class="al-field">${label('al-season-rookie', 'Really-rookie starting rating')}
            <input type="number" id="al-season-rookie" name="rookie_rating" value="${number(s.rookie_rating, 800)}" min="0" max="10000" step="any" required></div>
        </div>
        ${!current ? '<p class="al-small">Season 2 starts Monday 14 September 2026 and ends Friday 2 July 2027, before Vienna’s summer holidays. Eligible Thursdays run from 17 September to 1 July. These defaults are editable; saving a season does not create training sessions.</p>' : ''}
        <p class="al-callout">Scoring mode, rounding, awards, K-factor and skill ratings are captured when teams are generated. These settings apply to future drafts: regenerate an existing draft to adopt changes. Published and finalized trainings keep their saved rules. Season defaults never reset player profiles or silently re-award completed trainings.</p>
        <div class="al-actions"><button class="al-button" type="submit">${current ? 'Save season settings' : 'Create season'}</button>
          ${state.newSeason && season() ? action('cancel-season', 'Cancel new season') : ''}</div>
      </form>
    </details>`;
  }

  function renderSetup() {
    const available = sessions();
    const s = season();
    const selectedSession = session();
    return `<section class="al-card" id="al-setup">${heading(1, 'Choose season & training')}
      <div class="al-grid">
        <div class="al-field">${label('al-season-select', 'Season')}
          <select id="al-season-select"${disabled(!state.data.seasons.length)}>
            ${state.data.seasons.length ? state.data.seasons.map(s => option(s.id, s.name, state.seasonId)).join('') : '<option>No seasons yet</option>'}
          </select></div>
        <div class="al-field">${label('al-session-select', 'Training session — upcoming or past')}
          <select id="al-session-select"${disabled(!available.length)}>
            ${available.length ? available.map(t => {
              const e = state.data.events.find(e => e.session_id === t.id);
              return option(t.id, `${dateOnly(t.session_date)} · ${String(t.start_time || '').slice(0, 5)} · ${t.title}${t.is_cancelled ? ' · Cancelled' : ''}${e ? ` · ${e.status}` : ''}`, state.sessionId);
            }).join('') : '<option>No training sessions in this season</option>'}
          </select></div>
      </div>
      ${selectedSession ? `<p class="al-small al-form-actions">${esc(selectedSession.location || 'No location specified')} · Members RSVP in the Training area. Select a past finalized training here to correct its results.</p>` : '<p class="al-callout">First create a season, then schedule sessions in the Training tab within its dates. Return here and refresh.</p>'}
      ${s ? `<div class="al-actions">${action('new-season', '+ Create another season')}</div>` : ''}
      ${seasonForm()}
    </section>`;
  }

  function profileFields(prefix, player) {
    return `<div class="al-grid">
      <div class="al-field">${label(`al-${prefix}-gender`, 'Gender for team balance — admin only')}
        <select id="al-${prefix}-gender" name="gender">
          ${[['unspecified', 'Unspecified'], ['female', 'Female'], ['male', 'Male']].map(([v, l]) => option(v, l, player.gender)).join('')}
        </select></div>
      <div class="al-field">${label(`al-${prefix}-rating`, 'Initial skill rating — admin only')}
        <input type="number" id="al-${prefix}-rating" name="initial_rating" value="${number(player.initial_rating, 1000)}" min="0" max="10000" step="any" required></div>
    </div>
    <label class="al-check" for="al-${prefix}-rookie">
      <input type="checkbox" id="al-${prefix}-rookie" name="is_rookie"${player.is_rookie ? ' checked' : ''}>
      <span>Really rookie — private tag to spread beginners across teams</span>
    </label>`;
  }

  function profileEditor() {
    const list = players();
    const filtered = list.filter(p => p.display_name.toLocaleLowerCase().includes(state.profileSearch.toLocaleLowerCase()));
    const player = list.find(p => p.id === state.profileId);
    return `<details class="al-details" id="al-profiles-details"${state.profilesOpen ? ' open' : ''}>
      <summary>Player profiles & private skill</summary>
      <p class="al-muted">Use gender, real beginner experience and private skill together for fair teams. Do not infer gender from a name. Profiles persist across trainings and seasons.</p>
      <div class="al-grid">
        <div class="al-field">${label('al-profile-search', 'Find a player profile')}
          <input type="search" id="al-profile-search" value="${esc(state.profileSearch)}" autocomplete="off" placeholder="Search names"></div>
        <div class="al-field">${label('al-profile-select', 'Player to edit')}
          <select id="al-profile-select">${option('', 'Choose a player', state.profileId)}${filtered.map(p => option(p.id, `${p.display_name}${p.user_id ? '' : ' (guest)'}`, state.profileId)).join('')}</select></div>
      </div>
      <div id="al-profile-editor">${player ? `<form data-al-form="profile" class="al-form-actions">
        <input type="hidden" name="player_id" value="${esc(player.id)}">
        ${!player.user_id ? `<div class="al-field">${label('al-profile-name', 'Guest display name — public after publishing')}<input id="al-profile-name" name="display_name" value="${esc(player.display_name)}" maxlength="100" required></div>` : `<h4>${esc(player.display_name)}</h4>`}
        <p class="al-small">Current private ELO: <strong>${rating(player)}</strong>. Editing the initial rating calibrates private skill, not public points. Saved training snapshots stay unchanged; regenerate an editable draft to use updated skill and balancing tags.</p>
        ${profileFields('profile', player)}
        <button type="submit" class="al-button">Save player profile</button>
      </form>
      ${!player.user_id ? `<form data-al-form="link" class="al-details">
        <h4>Link this guest to a member account</h4>
        <input type="hidden" name="player_id" value="${esc(player.id)}">
        <div class="al-field">${label('al-link-member', 'Member account')}
          <select id="al-link-member" name="user_id" required>${option('', 'Choose the matching member', '')}${state.data.members.map(m => option(m.id, m.display_name, '')).join('')}</select>
          <p class="al-small">Preserves the guest’s stats and connects future RSVPs. If both profiles played the same training, linking is refused to prevent duplicate points.</p></div>
        <button type="submit" class="al-button al-secondary al-form-actions">Link guest & preserve stats</button>
      </form>` : ''}` : '<p class="al-small al-form-actions">Choose one player above to review or update their profile.</p>'}</div>
    </details>`;
  }

  function rosterRows() {
    const list = players().filter(p =>
      p.display_name.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()) &&
      (!state.selectedOnly || state.selected.has(p.id)));
    return list.length ? list.map(p => `<label class="al-roster-row" for="al-roster-${esc(p.id)}">
      <input type="checkbox" id="al-roster-${esc(p.id)}" data-al-player="${esc(p.id)}"${state.selected.has(p.id) ? ' checked' : ''}${disabled(isLocked() || !state.sessionId)}>
      <span class="al-player-info"><strong>${esc(p.display_name)}</strong>
        <span class="al-roster-meta">
          <span class="al-chip">${state.attending.has(p.id) ? 'RSVP attending' : p.user_id ? 'Member · manual add' : 'Guest'}</span>
          <span>${esc(p.gender || 'unspecified')} · private ${rating(p)}</span>
          ${p.is_rookie ? '<span class="al-chip al-rookie">Really rookie</span>' : ''}
        </span>
      </span>
    </label>`).join('') : '<p class="al-empty">No matching players. Clear the search or add a named guest below.</p>';
  }

  function renderRoster() {
    return `<section class="al-card" id="al-roster">${heading(2, 'Confirm everyone playing')}
      <p class="al-muted">Start with member RSVPs, then check or uncheck anyone for last-minute changes. Guests need no account; use their existing profile next time to keep their stats together.</p>
      ${isLocked() ? `<p class="al-callout">${event().status === 'finalized' ? 'Finalized: the roster and teams are locked. Results can still be corrected below.' : lineupStarted() ? 'Games have started or results were finalized: roster, guest additions to this training and team changes are permanently locked. Score corrections remain available.' : 'Published: the roster is locked. Before any match is scored, use “Edit lineup” in step 5 to hide public teams and return to a draft.'}</p>` : ''}
      ${state.attendanceError ? `<p class="al-notice">${esc(state.attendanceError)}</p>` : ''}
      ${event()?.roster_stale && !isLocked() ? '<p class="al-notice">Member RSVPs changed after this draft was generated. Review the latest attending labels below, then regenerate before publishing. Your checked guest and manual selections are kept unless you explicitly change them.</p>' : ''}
      <div class="al-actions">
        ${action('add-rsvp', 'Include all attending members · keep guests', disabled(isLocked() || !state.sessionId || !!state.attendanceError))}
        ${action('rsvp', 'Reset to RSVPs only', disabled(isLocked() || !state.sessionId || !!state.attendanceError))}
        ${action('retry-rsvp', 'Refresh RSVPs', disabled(!state.sessionId))}
        ${action('clear-roster', 'Clear selection', disabled(isLocked() || !state.sessionId))}
      </div>
      <div class="al-field al-form-actions">${label('al-roster-search', 'Search roster names')}
        <input type="search" id="al-roster-search" value="${esc(state.search)}" placeholder="Member or guest name" autocomplete="off"></div>
      <label class="al-check" for="al-selected-only"><input type="checkbox" id="al-selected-only"${state.selectedOnly ? ' checked' : ''}><span>Show selected players only</span></label>
      <p class="al-roster-count" id="al-roster-count" role="status">${state.selected.size} players selected · ${state.attending.size} RSVP attending</p>
      <div class="al-roster-list" id="al-roster-list">${rosterRows()}</div>
      <details class="al-details" id="al-guest-details"${state.guestOpen ? ' open' : ''}>
        <summary>Add a named guest — no account needed</summary>
        <form data-al-form="guest">
          <p class="al-small">Creates a persistent league profile. Search above first to avoid duplicates.${isLocked() ? ' This training is locked; the new guest will be available for future drafts.' : ' The new guest is selected for this draft automatically.'}</p>
          <p class="al-callout" id="al-guest-public-warning">Guest names become public when teams are published and can appear in season standings after results. Let the guest know before publishing. Ratings, gender and rookie tags stay admin-only.</p>
          <div class="al-field">${label('al-guest-name', 'Guest display name — public after publishing')}
            <input id="al-guest-name" name="display_name" autocomplete="off" maxlength="100" required placeholder="First and last name" aria-describedby="al-guest-public-warning"></div>
          <div class="al-form-actions">${profileFields('guest', { gender: 'unspecified', is_rookie: false, initial_rating: season()?.default_rating ?? 1000 })}</div>
          <button type="submit" class="al-button">Create guest profile${!isLocked() && state.sessionId ? ' & add to roster' : ''}</button>
        </form>
      </details>
      ${profileEditor()}
    </section>`;
  }

  function planText() {
    const n = state.selected.size;
    if (n < minimumRoster()) return `${n} selected. Select at least ${minimumRoster()} players for two ${state.size === 'auto' ? '4' : state.size}-a-side teams${state.size === 'auto' ? ' (auto can also choose 5 or 6)' : ''}.`;
    if (n > 500) return `${n} selected. A training supports at most 500 players. Reduce this roster before drafting.`;
    const size = state.size === 'auto'
      ? [6, 5, 4].find(size => n >= size * 2 && n % size === 0) || [6, 5, 4].find(size => n >= size * 2)
      : Number(state.size);
    const count = Math.min(state.maxTeams, Math.floor(n / size));
    const min = Math.floor(n / count);
    const max = Math.ceil(n / count);
    return `${n} players → ${count} teams of ${min === max ? min : `${min}–${max}`}. ${state.size === 'auto' ? 'Auto selects ' : ''}${size} on court per team; ${max > size ? 'larger squads rotate substitutes — nobody is left out.' : 'everyone plays, nobody is left out.'}`;
  }

  function playerFor(id) {
    return players().find(p => p.id === id) ||
      event()?.teams.flatMap(t => t.players || []).find(p => p.id === id) ||
      { id, display_name: 'Player unavailable — refresh league', gender: 'unspecified', rating: 1000 };
  }

  function teamPlayer(id) {
    return event()?.teams.flatMap(t => t.players || []).find(p => p.id === id) || playerFor(id);
  }

  function teamCards() {
    return state.teams.map(t => {
      const list = t.player_ids.map(teamPlayer);
      const female = list.filter(p => p.gender === 'female').length;
      const male = list.filter(p => p.gender === 'male').length;
      const rookie = list.filter(p => p.is_rookie).length;
      const avg = list.length ? Math.round(list.reduce((sum, p) => sum + rating(p), 0) / list.length) : 0;
      const subs = Math.max(0, list.length - Number(event()?.team_size || 6));
      return `<article class="al-team" aria-labelledby="al-team-heading-${t.number}">
        <h4 id="al-team-heading-${t.number}">${esc(t.name || `Team ${t.number}`)}</h4>
        <p class="al-small">Squad ${t.number}</p>
        ${!isLocked() ? `<div class="al-field">${label(`al-team-name-${t.number}`, 'Public team name')}<input id="al-team-name-${t.number}" data-al-team-name="${t.number}" value="${esc(t.name)}" maxlength="80" required></div>` : ''}
        <div class="al-team-stat">
          <span class="al-chip">${list.length} players</span><span class="al-chip">Private avg ${avg} · draft snapshot</span>
          <span class="al-chip">${female} female · ${male} male${list.length - female - male ? ` · ${list.length - female - male} unspecified` : ''}</span>
          <span class="al-chip al-rookie">${rookie} really rookie</span>
        </div>
        ${subs ? `<p class="al-small">${subs} rotating substitute${subs === 1 ? '' : 's'} — all ${list.length} players receive this team’s placement points.</p>` : ''}
        <ul class="al-team-players">${list.map(p => `<li><span>${esc(p.display_name)}${p.is_rookie ? ' <span class="al-chip al-rookie">Rookie</span>' : ''}</span><span class="al-small">Private ${rating(p)}</span></li>`).join('')}</ul>
      </article>`;
    }).join('');
  }

  function editTools() {
    const all = state.teams.flatMap(t => t.player_ids.map(id => ({ id, text: `${teamPlayer(id).display_name} · ${t.name}` })));
    return `<div class="al-edit-tools">
      <h4>Adjust the draft — no dragging needed</h4>
      <p class="al-small">Swap any two players. Moves must leave enough players on court and keep squad sizes within one player of each other; otherwise use a swap. Roster additions/removals take effect when you regenerate.</p>
      <div class="al-grid">
        <div class="al-field">${label('al-move-player', 'Player to move or swap')}
          <select id="al-move-player">${option('', 'Choose a player', '')}${all.map(p => option(p.id, p.text, '')).join('')}</select></div>
        <div class="al-field">${label('al-swap-player', 'Swap with player')}
          <select id="al-swap-player">${option('', 'Choose the other player', '')}${all.map(p => option(p.id, p.text, '')).join('')}</select></div>
      </div>
      <div class="al-actions al-form-actions">${action('swap', 'Swap these players', disabled(needsRosterReview()))}</div>
      <div class="al-field al-form-actions">${label('al-move-team', 'Or move to team')}
        <select id="al-move-team">${option('', 'Choose destination team', '')}${state.teams.map(t => option(t.number, t.name, '')).join('')}</select></div>
      <div class="al-actions al-form-actions">${action('move', 'Move player', disabled(needsRosterReview()))}</div>
    </div>`;
  }

  function renderDraft() {
    const locked = isLocked();
    const cancelled = session()?.is_cancelled;
    return `<section class="al-card" id="al-draft">${heading(3, 'Balance & review teams')}
      <div class="al-grid"><div class="al-field">${label('al-team-size', 'Players on court per team')}
        <select id="al-team-size"${disabled(locked)}>
          ${[['auto', 'Auto · choose 4, 5 or 6'], ['4', '4 on court'], ['5', '5 on court'], ['6', '6 on court']].map(([v, l]) => option(v, l, state.size)).join('')}
        </select></div>
        <div class="al-field">${label('al-max-teams', 'Maximum squads for this training')}
          <select id="al-max-teams"${disabled(locked)}>${[2, 3, 4, 5].map(count => option(count, `${count} squads maximum`, state.maxTeams)).join('')}</select>
          <p class="al-small">Maximum five squads for this round robin. Extra players rotate as substitutes, never excluded.</p></div></div>
      <p class="al-callout" id="al-plan" role="status">${planText()}</p>
      <p class="al-small">A draft includes everyone. Gender and really-rookie distribution are balanced alongside hidden ELO. With the five-squad limit, 30 players at size 6 gives five teams of six; 36 gives five squads of seven or eight.</p>
      <p class="al-small">Team names are chosen when the draft is generated and stay saved until you edit or regenerate them. Refreshing does not redraw names.</p>
      ${cancelled ? '<p class="al-notice">This training is cancelled. Choose an active training to generate or publish teams.</p>' : ''}
      <div class="al-actions">
        <button type="button" class="al-button" data-al-action="generate" id="al-generate"${disabled(locked || cancelled || !state.sessionId || state.selected.size < minimumRoster() || state.selected.size > 500)}>${event() ? 'Regenerate balanced draft' : 'Generate balanced draft'}</button>
      </div>
      <p class="al-dirty" id="al-dirty-roster"${needsRosterReview() ? '' : ' hidden'}>${event()?.roster_stale ? 'RSVPs changed since generation. Review your checked roster and generate again before publishing.' : 'Roster or team size changed. Generate again to apply this selection before publishing.'}</p>
      ${state.teams.length ? `<div class="al-team-grid" id="al-teams">${teamCards()}</div>
        ${!locked ? `${editTools()}<p class="al-dirty" id="al-dirty-teams"${state.dirtyTeams ? '' : ' hidden'}>Team edits are not saved yet.</p>
        <div class="al-actions"><button type="button" class="al-button" id="al-save-teams" data-al-action="save-teams"${disabled(!state.dirtyTeams || needsRosterReview())}>Save draft edits</button>${action('discard-teams', 'Discard team edits', disabled(!state.dirtyTeams))}</div>` : ''}` :
        '<p class="al-empty al-form-actions">No teams yet. Confirm the roster, then generate a private draft. Names stay hidden from the public until you publish.</p>'}
    </section>`;
  }

  function teamName(teamNumber) {
    return state.teams.find(team => Number(team.number) === Number(teamNumber))?.name || `Team ${teamNumber}`;
  }

  function scheduleTime(offset) {
    const start = String(session()?.start_time || event()?.start_time || '');
    if (!/^\d{2}:\d{2}/.test(start)) return `${offset} min from start`;
    const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + offset;
    const days = Math.floor(total / 1440);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}${days ? ` (+${days} day)` : ''}`;
  }

  function scheduleEstimate(settings) {
    const count = state.teams.length;
    if (count < 2 || count > 5) throw new Error('Generate two to five squads before planning this round robin.');
    for (const [key, minimum, maximum] of [['courts', 1, 2], ['match_minutes', 1, 60], ['break_minutes', 0, 30], ['available_minutes', 1, 480]]) {
      if (!Number.isInteger(settings[key]) || settings[key] < minimum || settings[key] > maximum) {
        throw new Error(`${key.replace(/_/g, ' ')} must be a whole number from ${minimum} to ${maximum}.`);
      }
    }
    const rounds = (count % 2 ? count : count - 1) * Math.ceil(Math.floor(count / 2) / settings.courts);
    return {
      slots: rounds, matches: count * (count - 1) / 2,
      duration: rounds * settings.match_minutes + (rounds - 1) * settings.break_minutes
    };
  }

  function schedulePreviewText() {
    try {
      const estimate = scheduleEstimate(state.scheduleSettings);
      const buffer = state.scheduleSettings.available_minutes - estimate.duration;
      return `${estimate.slots} slots · ${estimate.matches} matches · ${estimate.duration} minutes (${scheduleTime(0)}–${scheduleTime(estimate.duration)}). No changeover after the final slot. ${buffer < 0 ? `Does not fit: ${-buffer} minutes over the available time. Shorten games/changeovers or reduce teams.` : buffer === 0 ? 'No buffer: this uses every available minute. With five teams, 18-minute games leave 10 minutes of buffer.' : `${buffer} minutes of buffer remain.`}`;
    } catch (error) { return error.message; }
  }

  function updateSchedulePreview() {
    const preview = $('al-schedule-preview');
    if (preview) preview.textContent = schedulePreviewText();
    if ($('al-schedule-unsaved')) $('al-schedule-unsaved').hidden = !state.dirtySchedule;
    if ($('al-discard-schedule')) $('al-discard-schedule').disabled = !state.dirtySchedule;
  }

  function renderSchedule() {
    const e = event();
    const editable = e?.status === 'draft' && !isLocked() && !state.dirtyTeams && !needsRosterReview();
    return `<section class="al-card" id="al-schedule">
      ${heading(4, 'Plan the round robin')}
      <p class="al-muted" id="al-schedule-heading" tabindex="-1">Two courts, 120 minutes, at most five squads. Every pair plays once. Twenty-minute games and five-minute changeovers fill five slots exactly; choose 18-minute games for a 10-minute buffer with five squads.</p>
      ${!e ? '<p class="al-empty">Generate and save your balanced teams first.</p>' : `
        ${state.dirtyTeams || needsRosterReview() ? '<p class="al-notice">Save or regenerate the lineup first. Lineup changes can clear its saved schedule; generate the schedule again after those changes.</p>' : ''}
        ${e.status !== 'draft' ? `<p class="al-callout">${lineupStarted() || e.status === 'finalized' ? 'Games have started or results are final: the schedule and lineup are locked.' : 'The schedule is published. Before the first recorded score, use Edit lineup to return to a private draft and change the schedule.'}</p>` : ''}
        <form data-al-form="schedule">
          <fieldset id="al-schedule-fields"${disabled(!editable)}>
            <legend class="al-sr-only">Schedule settings</legend>
            <div class="al-grid">
              <div class="al-field">${label('al-schedule-courts', 'Available courts')}
                <select id="al-schedule-courts" name="courts" data-al-schedule="courts">${[1, 2].map(count => option(count, `${count} court${count === 1 ? '' : 's'}`, state.scheduleSettings.courts)).join('')}</select></div>
              ${[['match_minutes', 'Game length (minutes)', 1, 60], ['break_minutes', 'Changeover between slots (minutes)', 0, 30], ['available_minutes', 'Total hall time (minutes)', 1, 480]].map(([key, text, min, max]) => `<div class="al-field">${label(`al-schedule-${key}`, text)}<input type="number" id="al-schedule-${key}" name="${key}" data-al-schedule="${key}" value="${state.scheduleSettings[key]}" min="${min}" max="${max}" step="1" required></div>`).join('')}
            </div>
            <p class="al-callout" id="al-schedule-preview" role="status">${schedulePreviewText()}</p>
            <p class="al-dirty" id="al-schedule-unsaved"${state.dirtySchedule ? '' : ' hidden'}>Unsaved timing changes. Generate the schedule or discard these edits before publishing.</p>
            <div class="al-actions"><button type="submit" class="al-button">${e.schedule ? 'Regenerate match schedule' : 'Generate match schedule'}</button>
              ${action('discard-schedule', 'Discard timing edits', ` id="al-discard-schedule"${disabled(!state.dirtySchedule)}`)}</div>
          </fieldset>
        </form>
        ${e.schedule ? `<p class="al-small al-form-actions">Saved schedule: ${e.schedule.rounds.length} slots, ${allMatches().length} matches, ${e.schedule.duration_minutes} minutes. <a href="#al-matches">Review fixtures and court times</a> before publishing.</p>` : '<p class="al-small al-form-actions">No schedule saved. Schedule a round robin for automatic placements, or use the separate manual-placement flow for a training without match scores.</p>'}`}
    </section>`;
  }

  function renderMatchTable() {
    const table = event()?.match_standings;
    if (!table?.standings) return '<p class="al-empty">The saved match table is not available yet. Refresh after saving a score.</p>';
    return `<div class="al-match-table">
      <h4>Match table — saved scores only</h4>
      <p class="al-small">Win 2 · draw 1 · loss 0. Order: table points, then score difference, then points scored. These are NOT season points; relative season awards still come from final placements.</p>
      <div class="al-team-grid">${table.standings.map(row => `<article class="al-team">
        <h4>${row.rank}. ${esc(teamName(row.team_number))}</h4>
        <p class="al-roster-count">${row.table_points} match-table points</p>
        <dl class="al-match-stats">
          <div><dt>Played</dt><dd>${row.played}</dd></div>
          <div><dt>Won / drawn / lost</dt><dd>${row.won} / ${row.drawn} / ${row.lost}</dd></div>
          <div><dt>Scored / conceded</dt><dd>${row.score_for} / ${row.score_against}</dd></div>
          <div><dt>Score difference</dt><dd>${row.score_difference > 0 ? '+' : ''}${row.score_difference}</dd></div>
        </dl>
      </article>`).join('')}</div>
      <p class="al-callout">${event()?.status === 'finalized' ? table.has_ties ? 'Finalized: this match table still shows exact statistical ties. The final winner and season awards use the saved, resolved placements in step 7.' : 'Finalized: the final winner and season awards follow the saved placements in step 7.' : !table.complete ? 'Provisional table: finish every match before finalizing season points.' : table.has_ties ? 'All matches finished. Exact ties remain after all three tiebreak metrics; resolve only those tied places in step 7.' : 'All matches finished. Final placements are automatic; review and finalize them in step 7.'}</p>
    </div>`;
  }

  function renderMatches() {
    const e = event();
    if (!e?.schedule) return `<section class="al-card" id="al-matches">${heading(6, 'Fixtures & match scores')}<p class="al-empty">Generate a schedule in step 4 to record scores and calculate placements automatically. Trainings without a schedule can still use manual placements in step 7.</p></section>`;
    const editable = e.status === 'published' && !futureTraining();
    const completed = allMatches().filter(match => match.score_a != null && match.score_b != null).length;
    return `<section class="al-card" id="al-matches">
      ${heading(6, 'Fixtures & match scores')}
      <p class="al-muted" id="al-matches-heading" tabindex="-1">${completed} / ${allMatches().length} matches scored. ${e.status === 'draft' ? 'Private schedule preview. Publish teams and this schedule before recording scores.' : e.status === 'finalized' ? 'Finalized scores are read-only. Reopen results in step 7 to make a correction.' : futureTraining() ? `This is a future training. Scores can be entered from ${esc(dateOnly(session()?.session_date || e.session_date))}, using the Vienna calendar date. Teams and fixtures can be published in advance.` : 'Enter the final points scored by each team, then save that match. Saving the first score permanently locks the lineup.'}</p>
      ${e.schedule.rounds.map(round => `<section class="al-round" aria-labelledby="al-round-${round.number}">
        <h4 id="al-round-${round.number}">Slot ${round.number} · ${esc(scheduleTime(round.start_minute))}–${esc(scheduleTime(round.end_minute))}</h4>
        ${round.bye_teams.length ? `<p class="al-small">Resting: ${round.bye_teams.map(team => esc(teamName(team))).join(', ')}</p>` : ''}
        <div class="al-match-grid">${round.matches.map(match => {
          const draft = state.matchEdits[String(match.number)];
          const scored = match.score_a != null && match.score_b != null;
          const result = scored ? match.score_a === match.score_b ? 'Draw' : `${teamName(match.score_a > match.score_b ? match.team_a : match.team_b)} won` : 'Not scored';
          return `<article class="al-team">
            <h4>Match ${match.number} · Court ${match.court}</h4>
            <p class="al-small">${esc(teamName(match.team_a))} vs ${esc(teamName(match.team_b))}</p>
            ${editable ? `<form data-al-form="match">
              <input type="hidden" name="match_number" value="${match.number}">
              <div class="al-grid al-score-fields">
                <div class="al-field">${label(`al-score-${match.number}-a`, `${esc(teamName(match.team_a))} score`)}
                  <input id="al-score-${match.number}-a" name="score_a" type="number" min="0" max="999" step="1" inputmode="numeric" required data-al-match="${match.number}" data-al-score="score_a" value="${esc(draft?.score_a ?? match.score_a ?? '')}"></div>
                <div class="al-field">${label(`al-score-${match.number}-b`, `${esc(teamName(match.team_b))} score`)}
                  <input id="al-score-${match.number}-b" name="score_b" type="number" min="0" max="999" step="1" inputmode="numeric" required data-al-match="${match.number}" data-al-score="score_b" value="${esc(draft?.score_b ?? match.score_b ?? '')}"></div>
              </div>
              <p class="al-small" id="al-score-state-${match.number}">${draft ? 'Unsaved score changes' : `Saved state: ${esc(result)}`}</p>
              <button type="submit" class="al-button al-secondary" id="al-save-match-${match.number}">Save match ${match.number} score</button>
              ${action(`discard-match:${match.number}`, 'Discard score edits', ` id="al-discard-match-${match.number}"${disabled(!draft)}`)}
            </form>` : `<p class="al-match-score">${scored ? `${match.score_a} – ${match.score_b}` : 'Awaiting scores'}</p><p class="al-small">${esc(result)}</p>`}
          </article>`;
        }).join('')}</div>
      </section>`).join('')}
      ${renderMatchTable()}
    </section>`;
  }

  function renderPublish() {
    const e = event();
    const status = e?.status || 'not generated';
    const text = status === 'finalized'
      ? 'Finalized: teams and results are public. Roster changes are locked; use step 7 for results corrections.'
      : status === 'published'
        ? lineupStarted() ? 'Games have started or results were finalized. Teams and any guests in this lineup are locked; you cannot unpublish or change the roster. Record or correct match scores below.' : 'Teams and the saved schedule are public. Before any score is entered, reopen the lineup below to edit. This temporarily hides public teams until you publish again.'
        : 'Not published: public visitors see that teams are not yet published, not this draft or its names. Save your draft, then publish when ready.';
    return `<section class="al-card" id="al-publish">${heading(5, 'Publish for players')}
      <div class="al-status"><span class="al-chip ${status === 'draft' || !e ? 'al-draft' : 'al-live'}">${esc(status)}</span>${e ? `<span class="al-small">Saved version ${number(e.version, 0)}</span>` : ''}</div>
      <p class="al-callout">${text}</p>
      ${eventAwardsSummary()}
      <div class="al-actions">
        ${status === 'published' ? lineupStarted() ? '<a class="al-button al-secondary" href="#al-matches">Record or correct match scores</a>' : action('unpublish', 'Edit lineup — temporarily hide published teams') :
          status === 'finalized' ? '<a class="al-button al-secondary" href="#al-results">Correct final placements</a>' :
            `<button type="button" class="al-button" id="al-publish-button" data-al-action="publish"${disabled(!e || state.dirtyTeams || state.dirtySchedule || needsRosterReview() || session()?.is_cancelled)}>Publish teams (public names)</button>`}
      </div>
      <p class="al-small al-form-actions">Publishing makes all selected player names public, including named guests. Let guests know before publishing. Ratings, gender labels and rookie tags remain admin-only and are never included in the public team view.</p>
    </section>`;
  }

  function placementAwards(settings, teamCount) {
    if (!window.LeagueScoring?.placementPoints) throw new Error('League scoring helper did not load. Refresh this page before editing league settings.');
    return window.LeagueScoring.placementPoints({
      ...settings, scoring_mode: settings.scoring_mode || 'fixed', points_step: settings.points_step ?? 0.5
    }, teamCount);
  }

  function scoringPreview(settings) {
    return `<ul class="al-scoring-preview">${[2, 3, 4, 5, 6].map(count =>
      `<li><strong>${count} teams</strong><span>${placementAwards(settings, count).join(' / ')}</span></li>`).join('')}</ul>`;
  }

  function updateScoringPreview() {
    const values = $('al-season-points').value.split(',').map(value => value.trim());
    const points = values.map(Number);
    if (values.some(value => !value) || points.length > 100 ||
      points.some((point, i) => !Number.isFinite(point) || point < 0 || point > 10000 || (i && point > points[i - 1]))) {
      $('al-season-awards').textContent = 'Enter valid descending or equal placement awards to preview.';
      return;
    }
    const mode = $('al-season-scoring').value;
    const step = Number($('al-season-step').value);
    if (mode === 'relative' && points.some(point => Math.abs(point / step - Math.round(point / step)) >= 1e-8)) {
      $('al-season-awards').textContent = `Relative base awards must be multiples of ${step}. Edit the awards or choose a finer rounding step.`;
      return;
    }
    $('al-season-awards').innerHTML = scoringPreview({ placement_points: points, scoring_mode: mode, points_step: step });
  }

  function eventScoring() {
    const e = event();
    const points = e?.placement_points || e?.settings?.placement_points;
    if (!points) return null;
    return {
      placement_points: points,
      scoring_mode: e.scoring_mode || e.settings?.scoring_mode || 'fixed',
      points_step: e.points_step ?? e.settings?.points_step ?? 0.5
    };
  }

  function eventAwardsSummary() {
    const rules = eventScoring();
    if (!rules || !state.teams.length) return '';
    return `<p class="al-callout">This training’s saved ${rules.scoring_mode === 'relative' ? `relative rules · rounded to ${rules.points_step}` : 'fixed awards'}: <strong>${placementAwards(rules, state.teams.length).join(' / ')}</strong> points per player, from first place to last.</p>`;
  }

  function awardPoints(placement) {
    const rules = eventScoring();
    return rules && placement > 0 ? placementAwards(rules, state.teams.length)[placement - 1] ?? null : null;
  }

  function awardText(placement) {
    if (!placement) return 'Choose a place to preview points';
    const points = awardPoints(placement);
    return points === null ? 'Points use this training’s saved season settings.' : `${points} season points per player`;
  }

  function allowedPlaces(teamNumber) {
    if (!event()?.schedule) return state.teams.map((_, index) => index + 1);
    const rows = event().match_standings?.standings || [];
    const row = rows.find(item => Number(item.team_number) === Number(teamNumber));
    if (!row) return [];
    const tiedCount = rows.filter(other => other.table_points === row.table_points &&
      other.score_difference === row.score_difference && other.score_for === row.score_for).length;
    return Array.from({ length: tiedCount }, (_, index) => Number(row.rank) + index);
  }

  function resultPlacement(team) {
    const choices = allowedPlaces(team.number);
    if (event()?.schedule && choices.length === 1) return choices[0];
    return choices.includes(Number(team.placement)) ? Number(team.placement) : '';
  }

  function renderResults() {
    const e = event();
    const enabled = e && ['published', 'finalized'].includes(e.status);
    const scheduled = !!e?.schedule;
    const finished = !scheduled || !!e.match_standings?.complete;
    const finalizedSchedule = scheduled && e.status === 'finalized';
    const winner = e?.status === 'finalized' ? e.teams.find(team => Number(team.placement) === 1) :
      scheduled && finished ? state.teams.find(team => {
        const choices = allowedPlaces(team.number);
        return choices.length === 1 && choices[0] === 1;
      }) : null;
    return `<section class="al-card" id="al-results">${heading(7, e?.status === 'finalized' ? 'Final results & corrections' : 'Review & finalize placements')}
      <p class="al-muted">${scheduled ? 'Final places follow match-table points, score difference and points scored. Non-tied places are filled automatically. Only teams exactly tied on all three metrics can be reordered within their shared places.' : `Manual-placement training: use each place from 1 to ${state.teams.length || 'the number of teams'} exactly once. For automatic placements from scores, generate a schedule before publishing.`}</p>
      ${winner ? `<p class="al-callout"><strong>${e.status === 'finalized' ? 'Final winner' : 'Automatic winner'}: ${esc(winner.name)}</strong>${e.status === 'finalized' ? ' — from saved final placements.' : ' — finalize below to award season points.'}</p>` : ''}
      ${eventAwardsSummary()}
      ${enabled && finished ? `<form data-al-form="results">
        <div class="al-team-grid">${state.teams.map(t => {
          const choices = allowedPlaces(t.number);
          const placement = resultPlacement(t);
          const automatic = scheduled && choices.length === 1;
          return `<div class="al-team">
          <h4>${esc(t.name)}</h4><p class="al-small">${t.player_ids.length} players, including substitutes</p>
          <div class="al-field">${label(`al-placement-${t.number}`, `Final place for ${esc(t.name)}`)}
            ${automatic || finalizedSchedule ? `<input type="number" id="al-placement-${t.number}" name="placement_${t.number}" value="${placement}" readonly aria-describedby="al-award-${t.number}"><p class="al-small">${finalizedSchedule ? 'Finalized placement' : 'Automatically calculated from match results'}</p>` :
              `<select id="al-placement-${t.number}" data-al-placement="${t.number}" name="placement_${t.number}" required>
                ${option('', scheduled ? 'Resolve this exact tie' : 'Choose final place', placement)}${choices.map(rank => option(rank, `${rank}${rank === 1 ? ' · first' : ''}`, placement)).join('')}
              </select>${scheduled ? `<p class="al-small">Exact tie: assign an unused place from ${choices.join(', ')}.</p>` : ''}`}
          </div>
          <p class="al-result-preview" id="al-award-${t.number}">${awardText(Number(placement))}</p>
        </div>`; }).join('')}</div>
        <p class="al-callout">${finalizedSchedule ? 'To correct match scores or resolve ties differently, reopen results below. Previous season awards are temporarily removed until you finalize again; match scores are retained and the roster stays locked.' : e.status === 'finalized' ? 'Correction replaces this training’s previous awards — it never adds points twice. The roster stays locked. Private ELO is recalculated from final placements.' : 'Saving finalizes this training. Every team member, including rotating substitutes, receives season placement points. Hidden ELO changes only from these final placements.'}</p>
        ${finalizedSchedule ? action('reopen-results', 'Reopen results — temporarily remove awards') : `<button type="submit" class="al-button">${e.status === 'finalized' ? 'Save corrected results' : 'Save results & finalize training'}</button>`}
      </form>` : enabled && scheduled ? '<p class="al-empty">Finish and save both scores for every match before finalizing. <a href="#al-matches">Continue entering match scores</a>.</p>' : '<p class="al-empty">Publish the teams first. Then save match scores for automatic places, or enter manual placements for a training without a schedule.</p>'}
    </section>`;
  }

  function render() {
    $('al-app').innerHTML = `<fieldset id="al-workspace"${disabled(state.busy || state.conflict)}>
      <legend class="al-sr-only">Imperials Social League administration</legend>
      <ol class="al-steps" aria-label="League administration steps">
        ${[['setup', '1 · Season'], ['roster', '2 · Roster'], ['draft', '3 · Teams'], ['schedule', '4 · Schedule'], ['publish', '5 · Publish'], ['matches', '6 · Scores'], ['results', '7 · Finalize']].map(([id, text]) => `<li><a href="#al-${id}">${text}</a></li>`).join('')}
      </ol>
      ${renderSetup()}${renderRoster()}${renderDraft()}${renderSchedule()}${renderPublish()}${renderMatches()}${renderResults()}
    </fieldset>`;
  }

  function updateRoster() {
    $('al-roster-list').innerHTML = rosterRows();
    updateDraftControls();
  }

  function updateDraftControls() {
    $('al-roster-count').textContent = `${state.selected.size} players selected · ${state.attending.size} RSVP attending`;
    $('al-plan').textContent = planText();
    $('al-dirty-roster').hidden = !needsRosterReview();
    $('al-generate').disabled = isLocked() || session()?.is_cancelled || !state.sessionId || state.selected.size < minimumRoster() || state.selected.size > 500;
    const save = $('al-save-teams');
    if (save) save.disabled = !state.dirtyTeams || needsRosterReview();
    const publish = $('al-publish-button');
    if (publish) publish.disabled = !event() || state.dirtyTeams || state.dirtySchedule || needsRosterReview() || session()?.is_cancelled;
    if ($('al-schedule-fields')) $('al-schedule-fields').disabled = !event() || isLocked() || state.dirtyTeams || needsRosterReview();
    root.querySelectorAll('[data-al-action="swap"], [data-al-action="move"]').forEach(b => { b.disabled = needsRosterReview(); });
  }

  function markTeamDirty() {
    state.dirtyTeams = true;
    $('al-dirty-teams').hidden = false;
    root.querySelector('[data-al-action="discard-teams"]').disabled = false;
    updateDraftControls();
  }

  async function changeSelection(kind, value) {
    if (hasChanges() && !window.confirm('Switch selection and discard unsaved roster, team or result edits?')) {
      $(kind === 'season' ? 'al-season-select' : 'al-session-select').value = kind === 'season' ? state.seasonId : state.sessionId;
      return;
    }
    clearNotice();
    setBusy(true, 'Loading this training’s roster…');
    if (kind === 'season') {
      state.seasonId = value;
      const available = sessions();
      state.sessionId = (available.filter(s => !s.is_cancelled && dateOnly(s.session_date) >= today()).reverse()[0] || available[0])?.id || '';
      state.newSeason = false;
    } else state.sessionId = value;
    try { await loadRoster(); render(); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
    $(kind === 'season' ? 'al-season-select' : 'al-session-select')?.focus();
  }

  function validateTeams() {
    const ids = state.teams.flatMap(t => t.player_ids);
    if (new Set(ids).size !== ids.length || ids.length !== state.selected.size || ids.some(id => !state.selected.has(id))) {
      throw new Error('Each selected player must appear exactly once. Regenerate the draft to apply roster changes.');
    }
    const sizes = state.teams.map(t => t.player_ids.length);
    if (Math.min(...sizes) < Number(event()?.team_size || 4) || Math.max(...sizes) - Math.min(...sizes) > 1) throw new Error('Keep enough players on court and squad sizes within one player of each other. Swap players instead, or regenerate the draft.');
    if (state.teams.some(t => !t.name.trim())) throw new Error('Give every team a visible public name before saving.');
  }

  function adjustTeams(swap) {
    const playerId = $('al-move-player').value;
    const source = state.teams.find(t => t.player_ids.includes(playerId));
    if (!source) throw new Error('Choose the player you want to move or swap.');
    const secondId = $('al-swap-player').value;
    const destination = swap ? state.teams.find(t => t.player_ids.includes(secondId)) :
      state.teams.find(t => String(t.number) === $('al-move-team').value);
    if (!destination) throw new Error(swap ? 'Choose a second player to swap with.' : 'Choose a destination team.');
    if (source === destination) throw new Error('Choose players or a destination on different teams.');
    if (swap) {
      source.player_ids[source.player_ids.indexOf(playerId)] = secondId;
      destination.player_ids[destination.player_ids.indexOf(secondId)] = playerId;
    } else {
      const sizes = state.teams.map(t => t.player_ids.length + (t === source ? -1 : t === destination ? 1 : 0));
      if (Math.min(...sizes) < Number(event()?.team_size || 4) || Math.max(...sizes) - Math.min(...sizes) > 1) throw new Error('That move would leave too few players on court or unbalance squad sizes. Swap two players instead.');
      source.player_ids = source.player_ids.filter(id => id !== playerId);
      destination.player_ids.push(playerId);
    }
    state.dirtyTeams = true;
    render();
    $('al-save-teams').focus();
    $('al-progress').textContent = swap ? 'Players swapped locally. Save draft edits when ready.' : 'Player moved locally. Save draft edits when ready.';
  }

  async function generate() {
    if (!season() || !state.sessionId || isLocked()) throw new Error('Choose a season and an editable training first.');
    if (state.selected.size < minimumRoster() || state.selected.size > 500) throw new Error(`Select ${minimumRoster()}–500 players for this team size.`);
    if (!Number.isInteger(state.maxTeams) || state.maxTeams < 2 || state.maxTeams > 5) throw new Error('Choose a maximum of two to five squads.');
    if (event() && !window.confirm(`Regenerate this draft for the selected roster? Team names will be redrawn, including any manually edited names. Existing assignments and pending team edits will be replaced.${event().schedule || state.dirtySchedule ? ' The saved schedule and pending timing edits will be cleared; generate the schedule again after changing teams.' : ''} Everyone selected will be included.`)) return;
    const uncreated = players().filter(p => p.uncreated && state.selected.has(p.id));
    for (const p of uncreated) {
      const oldId = p.id;
      const ok = await write('save_player', {
        user_id: p.user_id, gender: p.gender, is_rookie: p.is_rookie, initial_rating: p.initial_rating
      }, { preserve: true, message: `League profile ready for ${p.display_name}.` });
      if (!ok) return;
      const created = state.data.players.find(profile => profile.user_id === p.user_id);
      if (!created) throw new Error('A member league profile was not returned. Refresh before generating teams.');
      state.selected.delete(oldId);
      state.selected.add(created.id);
    }
    await write('generate', {
      season_id: state.seasonId, session_id: state.sessionId, team_size: state.size === 'auto' ? 'auto' : Number(state.size),
      ...(event() ? { version: event().version } : {}),
      player_ids: [...state.selected], max_teams: state.maxTeams
    }, { message: 'Balanced draft saved. Review teams, plan matches, then publish.', focus: 'al-schedule-heading' });
  }

  async function handleAction(name) {
    if (name === 'reload') { await reload(); return; }
    if (state.busy || state.conflict || !state.loaded) return;
    clearNotice();
    if (name.startsWith('discard-match:')) {
      const matchNumber = name.slice('discard-match:'.length);
      delete state.matchEdits[matchNumber];
      render();
      $(`al-score-${matchNumber}-a`)?.focus();
      return;
    }
    switch (name) {
      case 'new-season':
        state.newSeason = true; state.seasonOpen = true; render(); $('al-season-name').focus(); break;
      case 'cancel-season':
        state.newSeason = false; state.seasonOpen = false; render(); break;
      case 'add-rsvp':
        if (isLocked() || state.attendanceError) return;
        state.attending.forEach(id => state.selected.add(id));
        state.dirtyRoster = true; updateRoster(); break;
      case 'rsvp':
        if (isLocked() || state.attendanceError) return;
        if (state.selected.size && !window.confirm('Replace the current selection with attending member RSVPs? Manually selected guests or other members will be unchecked.')) return;
        state.selected = new Set(state.attending); state.dirtyRoster = true; updateRoster(); break;
      case 'clear-roster':
        if (isLocked()) return;
        if (state.selected.size && !window.confirm('Uncheck everyone in this local roster? Existing saved teams are unchanged until you regenerate.')) return;
        state.selected.clear(); state.dirtyRoster = true; updateRoster(); break;
      case 'retry-rsvp':
        setBusy(true, 'Refreshing RSVPs and saved league data…');
        try { await loadData({ preserve: true }); render(); }
        catch (error) { showError(error, error.status === 409); }
        finally { setBusy(false); }
        break;
      case 'generate': await generate(); break;
      case 'discard-schedule':
        state.scheduleSettings = event()?.schedule ? {
          courts: event().schedule.courts, match_minutes: event().schedule.match_minutes,
          break_minutes: event().schedule.break_minutes, available_minutes: event().schedule.available_minutes
        } : { courts: 2, match_minutes: 20, break_minutes: 5, available_minutes: 120 };
        state.dirtySchedule = false; render(); break;
      case 'swap': if (!isLocked() && !needsRosterReview()) adjustTeams(true); break;
      case 'move': if (!isLocked() && !needsRosterReview()) adjustTeams(false); break;
      case 'discard-teams':
        if (!window.confirm('Discard unsaved team names, swaps and moves? Your roster selection will be kept.')) return;
        state.teams = event().teams.map(t => ({ number: t.number, name: t.name, placement: t.placement, player_ids: t.players.map(p => p.id) }));
        state.dirtyTeams = false; render(); break;
      case 'save-teams':
        if (isLocked() || needsRosterReview()) return;
        validateTeams();
        if (event().schedule && !window.confirm('Save these lineup changes? This can clear the match schedule. Generate the schedule again before republishing.')) return;
        await write('save_teams', { event_id: event().id, version: event().version, teams: state.teams.map(t => ({ number: t.number, name: t.name.trim(), player_ids: t.player_ids })) },
          { message: 'Draft edits saved. Publish when ready.' });
        break;
      case 'publish':
        if (!event() || isLocked() || needsRosterReview() || state.dirtyTeams || state.dirtySchedule) return;
        validateTeams();
        if (!window.confirm(`Publish ${state.teams.length} teams and ${state.selected.size} player names publicly, including named guests? Let guests know their names will be public. Ratings, gender and rookie tags remain admin-only.`)) return;
        await write('publish', { event_id: event().id, version: event().version }, { message: 'Teams are now public.' });
        break;
      case 'unpublish':
        if (event()?.status !== 'published') return;
        if (lineupStarted()) throw new Error('The lineup cannot be reopened after a match score or finalized results. Correct scores instead; players and teams remain locked.');
        if (Object.keys(state.matchEdits).length) throw new Error('Save or discard your unsaved match score edits before reopening the lineup.');
        if (state.dirtyResults && !window.confirm('Discard unsaved final placements and reopen the lineup?')) return;
        if (!window.confirm('Edit published teams? This immediately hides teams from the public and returns them to a draft. After editing, you must publish again.')) return;
        await write('unpublish', { event_id: event().id, version: event().version }, { message: 'Lineup is now a private draft. Republish after editing.', focus: 'al-generate' });
        break;
      case 'reopen-results':
        if (event()?.status !== 'finalized' || !event().schedule) return;
        if (!window.confirm('Reopen this training’s results? Its previous season awards and rating adjustments will be temporarily removed. Match scores are retained and the roster stays locked. Correct scores or exact ties, then finalize again to restore updated awards.')) return;
        await write('reopen_results', { event_id: event().id, version: event().version }, {
          message: 'Results reopened. Previous awards removed temporarily; correct scores and finalize again.', focus: 'al-matches-heading'
        });
        break;
    }
  }

  async function submit(form) {
    if (state.busy || state.conflict || !form.reportValidity()) return;
    clearNotice();
    const data = new FormData(form);
    const type = form.dataset.alForm;
    if (type === 'season') {
      const points = String(data.get('placement_points')).split(',').map(s => s.trim());
      if (points.some(p => !p || !Number.isFinite(Number(p)) || Number(p) < 0)) throw new Error('Enter placement points as non-negative numbers separated by commas, for example 3, 2.5, 2, 1, 0.5.');
      if (points.length > 100 || points.some(p => Number(p) > 10000 || Math.round(Number(p) * 1e6) / 1e6 !== Number(p))) throw new Error('Use at most 100 placement awards, each between 0 and 10,000 with at most six decimal places.');
      if (points.some((p, i) => i > 0 && Number(p) > Number(points[i - 1]))) throw new Error('Placement points must stay the same or decrease from first place down.');
      if (String(data.get('start_date')) > String(data.get('end_date'))) throw new Error('The season end date must be on or after its start date.');
      const name = String(data.get('name')).trim();
      if (!name) throw new Error('Enter a season name.');
      const scoringMode = data.get('scoring_mode');
      const pointsStep = Number(data.get('points_step'));
      if (!['relative', 'fixed'].includes(scoringMode) || ![0.1, 0.25, 0.5, 1].includes(pointsStep)) throw new Error('Choose a valid scoring mode and rounding step.');
      if (scoringMode === 'relative' && points.some(point => Math.abs(Number(point) / pointsStep - Math.round(Number(point) / pointsStep)) >= 1e-8)) {
        throw new Error(`Relative base awards must be multiples of ${pointsStep}. Edit the awards or choose a finer rounding step.`);
      }
      const id = String(data.get('id') || '');
      const knownIds = new Set(state.data.seasons.map(s => s.id));
      await write('save_season', {
        ...(id ? { id } : {}), name, start_date: data.get('start_date'), end_date: data.get('end_date'),
        placement_points: points.map(Number), scoring_mode: scoringMode, points_step: pointsStep,
        k_factor: Number(data.get('k_factor')),
        default_rating: Number(data.get('default_rating')), rookie_rating: Number(data.get('rookie_rating'))
      }, {
        preserve: !!id, message: id ? 'Season settings saved.' : 'Season created. Choose its training session.',
        after: result => ({ seasonId: result.season?.id || result.season_id || id }),
        focus: 'al-session-select'
      });
      if (!id && !state.conflict) {
        const added = state.data.seasons.find(s => !knownIds.has(s.id));
        if (added && state.seasonId !== added.id) await changeSelection('season', added.id);
      }
    } else if (type === 'schedule') {
      if (!event() || isLocked() || state.dirtyTeams || needsRosterReview()) throw new Error('Save a private draft with its final roster before generating the schedule.');
      const settings = Object.fromEntries(['courts', 'match_minutes', 'break_minutes', 'available_minutes'].map(key => [key, Number(data.get(key))]));
      const estimate = scheduleEstimate(settings);
      if (estimate.duration > settings.available_minutes) throw new Error(`This round robin needs ${estimate.duration} minutes, but only ${settings.available_minutes} are available. Shorten games or changeovers, or reduce the number of teams.`);
      if (event().schedule && !window.confirm('Replace the saved schedule with these court and timing settings? Review the new fixtures before publishing.')) return;
      await write('generate_schedule', { event_id: event().id, version: event().version, ...settings }, {
        message: `Schedule saved: ${estimate.matches} matches in ${estimate.duration} minutes. Review fixtures, then publish.`,
        focus: 'al-matches-heading'
      });
    } else if (type === 'match') {
      if (event()?.status !== 'published' || !event().schedule) throw new Error('Publish the scheduled training before scoring. For finalized training, reopen results first.');
      if (futureTraining()) throw new Error('Match scores can only be entered on the training date or afterwards, using the Vienna calendar date.');
      const matchNumber = Number(data.get('match_number'));
      const match = allMatches().find(item => item.number === matchNumber);
      if (!match) throw new Error('This match is no longer in the schedule. Refresh before scoring.');
      const rawA = String(data.get('score_a') ?? '').trim();
      const rawB = String(data.get('score_b') ?? '').trim();
      const scoreA = Number(rawA);
      const scoreB = Number(rawB);
      if (!rawA || !rawB || ![scoreA, scoreB].every(score => Number.isInteger(score) && score >= 0 && score <= 999)) {
        throw new Error('Enter both match scores as whole numbers from 0 to 999. Use 0 explicitly; a blank score means not played.');
      }
      if (state.dirtyResults && !window.confirm('Saving a score recalculates placements and discards any unsaved tie resolutions. Continue?')) return;
      if (match.score_a != null && (match.score_a !== scoreA || match.score_b !== scoreB) &&
        !window.confirm(`Replace match ${matchNumber} score ${match.score_a}–${match.score_b} with ${scoreA}–${scoreB}? The match table and automatic places will update.`)) return;
      const remainingEdits = { ...state.matchEdits };
      delete remainingEdits[String(matchNumber)];
      const button = $(`al-save-match-${matchNumber}`);
      if (button) button.textContent = 'Saving score…';
      const saved = await write('save_match', {
        event_id: event().id, version: event().version, match_number: matchNumber, score_a: scoreA, score_b: scoreB
      }, { message: `Match ${matchNumber} score saved. Match table updated.`, retainMatchEdits: remainingEdits, focus: `al-save-match-${matchNumber}` });
      if (!saved && $(`al-save-match-${matchNumber}`)) $(`al-save-match-${matchNumber}`).textContent = `Save match ${matchNumber} score`;
    } else if (type === 'profile' || type === 'guest') {
      const p = players().find(p => p.id === data.get('player_id'));
      const name = String(data.get('display_name') || '').trim();
      if ((!p?.user_id || type === 'guest') && !name) throw new Error('Enter the player’s display name.');
      if (type === 'guest' && players().some(p => p.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !window.confirm('A profile with this name already exists. Create a separate guest anyway? For the same person, use the existing profile to preserve their stats.')) return;
      const oldIds = new Set(state.data.players.map(p => p.id));
      await write('save_player', {
        ...(p ? p.uncreated ? { user_id: p.user_id } : { player_id: p.id } : {}),
        ...(name ? { display_name: name } : {}),
        gender: data.get('gender'), is_rookie: data.has('is_rookie'), initial_rating: Number(data.get('initial_rating'))
      }, {
        preserve: true, message: type === 'guest' ? 'Guest profile saved for this and future trainings.' : 'Player profile saved.',
        after: result => ({ addPlayerId: type === 'guest' && state.sessionId && !isLocked() ? result.player?.id || result.player_id : undefined })
      });
      if (!state.conflict && type === 'guest') {
        const added = state.data.players.find(p => !oldIds.has(p.id) && !p.user_id && p.display_name === name);
        if (added && state.sessionId && !isLocked()) {
          state.selected.add(added.id); state.dirtyRoster = true; state.guestOpen = false; render();
        }
      }
    } else if (type === 'link') {
      if (hasChanges() && !window.confirm('Linking refreshes profile IDs. Discard unsaved roster, team or result edits and continue?')) return;
      const p = playerFor(String(data.get('player_id')));
      const member = state.data.members.find(m => m.id === data.get('user_id'));
      if (!member) throw new Error('Choose a member account to link.');
      if (!window.confirm(`Link guest “${p.display_name}” to member “${member.display_name}”? Their persistent league stats will be connected to that account.`)) return;
      await write('link_player', { player_id: data.get('player_id'), user_id: data.get('user_id') }, { message: 'Guest linked to member account; stats preserved.' });
    } else if (type === 'results') {
      if (event()?.schedule) {
        if (event().status === 'finalized') throw new Error('Reopen results before correcting a finalized scheduled training.');
        if (!event().match_standings?.complete) throw new Error('Finish and save every match before finalizing results.');
        if (Object.keys(state.matchEdits).length) throw new Error('Save or discard all unsaved match score edits before finalizing results.');
      }
      const placements = state.teams.map(t => ({ team_number: t.number, placement: Number(data.get(`placement_${t.number}`)) }));
      if (placements.some(p => p.placement < 1 || p.placement > state.teams.length) || new Set(placements.map(p => p.placement)).size !== state.teams.length) throw new Error(`Use each final place from 1 to ${state.teams.length} once. Two teams cannot share a place.`);
      if (event()?.schedule && placements.some(p => !allowedPlaces(p.team_number).includes(p.placement))) {
        throw new Error('Final places must follow table points, score difference and points scored. Only exact ties may be reordered within their shared places.');
      }
      const correcting = event().status === 'finalized';
      const count = state.teams.reduce((total, t) => total + t.player_ids.length, 0);
      const summary = placements.map(p => `${state.teams.find(t => t.number === p.team_number).name}: place ${p.placement}`).join('\n');
      if (!window.confirm(`${correcting ? 'Replace this training’s results?' : 'Finalize these results and lock the roster?'}\n\n${summary}\n\nCounts all ${count} players, including substitutes. ${correcting ? 'Previous awards are replaced, never added twice.' : 'Placement points count toward the season total.'} Private ELO is recalculated from final placements.`)) return;
      await write('results', { event_id: event().id, version: event().version, placements }, { message: correcting ? 'Results corrected. Previous awards replaced, not duplicated.' : 'Results finalized for every player.' });
    }
  }

  root.addEventListener('click', e => {
    const button = e.target.closest('[data-al-action]');
    if (button && root.contains(button)) handleAction(button.dataset.alAction).catch(error => showError(error));
  });
  $('al-refresh').addEventListener('click', () => reload());
  root.addEventListener('submit', e => {
    const form = e.target.closest('form[data-al-form]');
    if (!form) return;
    e.preventDefault();
    submit(form).catch(error => showError(error));
  });
  root.addEventListener('input', e => {
    const input = e.target;
    if (state.busy || state.conflict) return;
    if (input.id === 'al-season-points') updateScoringPreview();
    if (input.dataset.alSchedule) {
      state.scheduleSettings[input.dataset.alSchedule] = Number(input.value);
      state.dirtySchedule = true;
      updateSchedulePreview();
      updateDraftControls();
    }
    if (input.dataset.alMatch && event()?.status === 'published' && !futureTraining()) {
      const match = allMatches().find(item => String(item.number) === input.dataset.alMatch);
      if (match) {
        const values = state.matchEdits[input.dataset.alMatch] || {
          score_a: String(match.score_a ?? ''), score_b: String(match.score_b ?? '')
        };
        values[input.dataset.alScore] = input.value;
        const changed = values.score_a !== String(match.score_a ?? '') || values.score_b !== String(match.score_b ?? '');
        if (changed) state.matchEdits[input.dataset.alMatch] = values;
        else delete state.matchEdits[input.dataset.alMatch];
        $(`al-score-state-${match.number}`).textContent = changed ? 'Unsaved score changes — not in the table yet' : 'Saved scores unchanged';
        $(`al-discard-match-${match.number}`).disabled = !changed;
      }
    }
    if (input.id === 'al-roster-search') { state.search = input.value; updateRoster(); }
    if (input.id === 'al-profile-search') {
      state.profileSearch = input.value;
      const matching = players().filter(p => p.display_name.toLocaleLowerCase().includes(input.value.toLocaleLowerCase()));
      $('al-profile-select').innerHTML = option('', 'Choose a player', '') + matching.map(p => option(p.id, `${p.display_name}${p.user_id ? '' : ' (guest)'}`, state.profileId)).join('');
    }
    if (input.dataset.alTeamName && !isLocked()) {
      const team = state.teams.find(t => String(t.number) === input.dataset.alTeamName);
      if (team) {
        team.name = input.value;
        $(`al-team-heading-${team.number}`).textContent = team.name || `Team ${team.number}`;
        markTeamDirty();
      }
    }
  });
  root.addEventListener('change', e => {
    if (state.busy || state.conflict) return;
    const input = e.target;
    if (input.id === 'al-season-scoring' || input.id === 'al-season-step') updateScoringPreview();
    else if (input.id === 'al-season-select') changeSelection('season', input.value).catch(error => showError(error));
    else if (input.id === 'al-session-select') changeSelection('session', input.value).catch(error => showError(error));
    else if (input.dataset.alPlayer && !isLocked()) {
      if (input.checked) state.selected.add(input.dataset.alPlayer);
      else state.selected.delete(input.dataset.alPlayer);
      state.dirtyRoster = true;
      updateDraftControls();
      if (state.selectedOnly && !input.checked) updateRoster();
    } else if (input.id === 'al-selected-only') { state.selectedOnly = input.checked; updateRoster(); }
    else if (input.id === 'al-team-size' && !isLocked()) { state.size = input.value; state.dirtyRoster = true; updateDraftControls(); }
    else if (input.id === 'al-max-teams' && !isLocked()) { state.maxTeams = Number(input.value); state.dirtyRoster = true; updateDraftControls(); }
    else if (input.id === 'al-profile-select') {
      state.profileId = input.value; state.profilesOpen = true;
      const holder = document.createElement('div');
      holder.innerHTML = profileEditor();
      $('al-profile-editor').replaceChildren(...holder.querySelector('#al-profile-editor').childNodes);
    } else if (input.id === 'al-guest-rookie') {
      const field = $('al-guest-rating');
      const regular = number(season()?.default_rating, 1000);
      const rookie = number(season()?.rookie_rating, 800);
      if ([regular, rookie].includes(Number(field.value))) field.value = input.checked ? rookie : regular;
    } else if (input.dataset.alPlacement) {
      state.dirtyResults = true;
      const team = state.teams.find(t => String(t.number) === input.dataset.alPlacement);
      if (team) team.placement = Number(input.value) || null;
      $(`al-award-${input.dataset.alPlacement}`).textContent = awardText(Number(input.value));
    }
  });
  root.addEventListener('toggle', e => {
    if (e.target.id === 'al-season-details') state.seasonOpen = e.target.open;
    if (e.target.id === 'al-profiles-details') state.profilesOpen = e.target.open;
    if (e.target.id === 'al-guest-details') state.guestOpen = e.target.open;
  }, true);
  window.addEventListener('beforeunload', e => {
    if (!hasChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.loadAdminLeague = function () {
    if (state.busy || (state.loaded && hasChanges())) return;
    return reload(false);
  };
})();
