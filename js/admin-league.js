/* Imperials Social League administration. Ratings stay in the authenticated dashboard. */
(function () {
  'use strict';

  const root = document.getElementById('tab-league');
  if (!root) return;
  const ROTATING_REF_POLICY = 'rotating_team_v1';
  const EXTERNAL_REF_POLICY = 'external_ref_v1';
  const $ = id => document.getElementById(id);
  const state = {
    data: { seasons: [], players: [], members: [], sessions: [], events: [] },
    loaded: false, busy: false, conflict: false,
    stage: 'players', flowSessionId: '', namesReviewed: false, refereeReviewed: false, manualPlacements: false,
    seasonId: '', sessionId: '', selected: new Set(), attending: new Set(),
    teams: [], dirtyTeams: false, dirtyRoster: false, dirtyResults: false,
    draftUndo: [], pickedPlayer: '', bonusAwards: {}, dirtyBonus: false, bonusSearch: '',
    size: 'auto', maxTeams: 5, search: '', selectedOnly: false,
    scheduleSettings: {
      courts: 2, match_minutes: 17, break_minutes: 5, meetup_time: '18:00',
      warmup_minutes: 15, available_minutes: 120, finale_minutes: 10
    },
    dirtySchedule: false, matchEdits: {},
    profileId: '', profileSearch: '', scorekeeperSearch: '', seasonOpen: false, timingOpen: false, adminOptionsOpen: false,
    profilesOpen: false, guestOpen: false, rosterToolsOpen: false, teamOptionsOpen: false, teamToolsOpen: false,
    fixturePreviewOpen: false,
    attendanceError: '', formEdits: {}
  };
  const dateOnly = value => {
    const text = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const date = new Date(value);
    return text && Number.isFinite(date.getTime()) ? date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) : '';
  };
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const season = () => state.data.seasons.find(s => s.id === state.seasonId);
  const event = () => state.data.events.find(e => e.session_id === state.sessionId);
  const session = () => sessions().find(s => s.id === state.sessionId);
  const allMatches = () => event()?.schedule?.rounds.flatMap(round => round.matches) || [];
  const gamesStarted = () => allMatches().some(match => match.score_a != null || match.score_b != null);
  const lineupStarted = () => !!event()?.roster_locked || gamesStarted();
  const cancelled = () => !!session()?.is_cancelled || !!event()?.is_cancelled;
  const isLocked = () => cancelled() || (!!event() && (event().status !== 'draft' || lineupStarted()));
  const futureTraining = () => dateOnly(session()?.session_date || event()?.session_date) > today();
  const needsRosterReview = () => state.dirtyRoster || !!event()?.roster_stale;
  const minimumRoster = () => state.size === 'auto'
    ? (state.maxTeams === 2 ? 4 : 6) : Number(state.size) * (state.maxTeams === 2 ? 2 : 3);
  const draftSize = () => {
    if (state.size !== 'auto') return Number(state.size);
    if (state.maxTeams === 2) {
      return [6, 5, 4].find(size => state.selected.size >= size * 2 && state.selected.size % size === 0)
        || [6, 5, 4, 3, 2].find(size => state.selected.size >= size * 2) || 2;
    }
    return Math.min(6, Math.floor(state.selected.size / (state.maxTeams >= 5 && state.selected.size >= 10 ? 5 : 3)));
  };
  const hasChanges = () => state.dirtyRoster || state.dirtyTeams || state.dirtyResults ||
    state.dirtySchedule || state.dirtyBonus || Object.keys(state.matchEdits).length > 0 || Object.keys(state.formEdits).length > 0;
  const selectedAttr = (a, b) => String(a) === String(b) ? ' selected' : '';
  const disabled = condition => condition ? ' disabled' : '';
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rating = player => Math.round(number(player.rating, number(player.initial_rating, 1000)));
  const label = (id, text) => `<label class="al-label" for="${id}">${text}</label>`;
  const option = (value, text, selected) => `<option value="${esc(value)}"${selectedAttr(value, selected)}>${esc(text)}</option>`;
  const action = (name, text, extra = '') => `<button type="button" class="al-button al-secondary" data-al-action="${name}"${extra}>${text}</button>`;
  const heading = (step, title) => `<div class="al-card-heading">${step ? `<span class="al-step-number" aria-hidden="true">${step}</span>` : ''}<h3>${title}</h3></div>`;
  const stages = [
    { id: 'players', title: 'Players', hint: 'Confirm everyone playing, including guests and late changes.' },
    { id: 'teams', title: 'Teams', hint: 'Review a balanced draft. Save manual edits without reshuffling everyone.' },
    { id: 'schedule', title: 'Schedule', hint: 'Check court times and referee coverage before going public.' },
    { id: 'publish', title: 'Publish', hint: 'Complete the checks below, then make the teams visible to players.' },
    { id: 'results', title: 'Results', hint: 'Add late arrivals, save scores, award bonus points, then confirm the final standings.' }
  ];

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
      const date = dateOnly(s.session_date);
      const existing = state.data.events.find(e => e.session_id === s.id);
      return (!existing || existing.season_id === selectedSeason.id) &&
        date >= dateOnly(selectedSeason.start_date) && date <= dateOnly(selectedSeason.end_date) &&
        new Date(`${date}T12:00:00Z`).getUTCDay() === 4;
    }).sort((a, b) => dateOnly(a.session_date).localeCompare(dateOnly(b.session_date)) ||
      String(a.start_time || '').localeCompare(String(b.start_time || '')));
  }

  const nextTraining = () => sessions().find(s => !s.is_cancelled && dateOnly(s.session_date) >= today());
  const savedBonus = () => {
    const awards = event()?.bonus_points || {};
    return Array.isArray(awards) ? Object.fromEntries(awards.map(a => [a.player_id, a.points])) : awards;
  };

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
    const response = await adminFetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
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

  async function loadData({ preserve = false, addPlayerId } = {}) {
    const previousEvent = event();
    preserve = preserve && hasChanges();
    const data = await request('/api/league?view=admin');
    for (const key of ['seasons', 'players', 'members', 'sessions', 'events']) {
      if (!Array.isArray(data[key])) throw new Error(`League response is missing ${key}. Refresh and try again.`);
    }
    const matches = data.seasons.filter(s => s.name === 'Season 2');
    if (matches.length !== 1) {
      throw new Error(matches.length ? 'Season 2 is ambiguous: more than one record has this exact name. Resolve the duplicate records before continuing.' :
        'Season 2 is missing. An administrator must initialize the existing Season 2 calendar before this dashboard can be used. No other season was selected.');
    }
    const nextEvent = data.events.find(e => e.session_id === state.sessionId);
    if (preserve && (previousEvent?.id !== nextEvent?.id || previousEvent?.version !== nextEvent?.version)) {
      const error = new Error('This training changed while you were editing. Refresh and review its latest roster and teams before applying your edits.');
      error.status = 409;
      throw error;
    }
    state.data = data;
    state.loaded = true;
    state.seasonId = matches[0].id;
    const available = sessions();
    if (!available.some(s => s.id === state.sessionId)) {
      if (preserve) throw Object.assign(new Error('The selected Thursday is no longer available in Season 2. Your edits were not applied. Refresh to review the latest calendar.'), { status: 409 });
      state.sessionId = (nextTraining() || available.filter(s => !s.is_cancelled).at(-1) || available[0])?.id || '';
      preserve = false;
    }
    if (preserve) {
      for (const p of data.players.filter(p => p.user_id)) {
        const oldId = `member:${p.user_id}`;
        if (state.selected.delete(oldId)) state.selected.add(p.id);
        state.teams.forEach(t => { t.player_ids = t.player_ids.map(id => id === oldId ? p.id : id); });
        state.draftUndo.forEach(snapshot => {
          snapshot.selected = snapshot.selected.map(id => id === oldId ? p.id : id);
          snapshot.teams.forEach(t => { t.player_ids = t.player_ids.map(id => id === oldId ? p.id : id); });
        });
        if (state.pickedPlayer === oldId) state.pickedPlayer = p.id;
      }
    }
    await loadRoster(preserve);
    if (addPlayerId && !isLocked()) {
      changeRoster(new Set([...state.selected, addPlayerId]));
    }
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
          state.attendanceError = `RSVPs could not be loaded: ${error.message} You can prepare a private roster manually, but use “Refresh RSVPs” before publishing. No players have been silently added.`;
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
      state.scheduleSettings = savedScheduleSettings();
      state.dirtySchedule = false;
      state.matchEdits = {};
      state.dirtyTeams = false;
      state.dirtyRoster = false;
      state.dirtyResults = false;
      state.bonusAwards = { ...savedBonus() };
      state.dirtyBonus = false;
      state.draftUndo = [];
      state.pickedPlayer = '';
      state.search = '';
      state.namesReviewed = false;
      state.refereeReviewed = false;
      state.manualPlacements = false;
      if (state.flowSessionId !== state.sessionId) {
        state.stage = existing && existing.status !== 'draft' ? 'results' : existing ? 'teams' : 'players';
        state.flowSessionId = state.sessionId;
      }
    }
    const validIds = new Set(players().map(p => p.id));
    if (preserve && [...state.selected].some(id => !validIds.has(id))) {
      throw Object.assign(new Error('A selected player profile is no longer available. Refresh and review the latest roster before saving.'), { status: 409 });
    }
    state.selected = new Set([...state.selected].filter(id => validIds.has(id)));
  }

  async function reload(ask = true) {
    if (state.busy) return;
    if (ask && hasChanges() && !window.confirm('Refresh and discard all unsaved roster, team, BP, result and form edits?')) return;
    state.formEdits = {};
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

  async function write(actionName, payload, { preserve = false, message = 'League updated.', after, focus, stage, retainMatchEdits, clearFormKey } = {}) {
    if (state.busy || state.conflict) return false;
    clearNotice();
    setBusy(true, 'Saving… Please wait.');
    let saved = false;
    const priorScores = allMatches().map(match => ({ ...match }));
    const pendingBonus = !preserve && actionName !== 'save_bonus_points' && state.dirtyBonus ? { ...state.bonusAwards } : null;
    const priorBonus = { ...savedBonus() };
    try {
      const result = await request('/api/league', { action: actionName, ...payload });
      saved = true;
      if (clearFormKey) delete state.formEdits[clearFormKey];
      const options = { preserve };
      if (after) Object.assign(options, after(result) || {});
      await loadData(options);
      if (pendingBonus) {
        for (const id of state.selected) {
          if (Number(savedBonus()[id] || 0) !== Number(priorBonus[id] || 0)) {
            throw new Error('Bonus points changed on the server. Refresh and review the saved awards before applying your remaining edits.');
          }
        }
        state.bonusAwards = Object.fromEntries([...state.selected].map(id => [id, pendingBonus[id] ?? '0']));
        state.dirtyBonus = [...state.selected].some(id => String(state.bonusAwards[id]) !== String(savedBonus()[id] || 0));
      }
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
      if (stage) state.stage = stage;
      render();
      toast(message, 'success');
      $('al-progress').textContent = message;
      return true;
    } catch (error) {
      const unconfirmed = !saved && (error.unconfirmed || !error.status);
      showError(saved ? new Error(`Your change was saved, but refreshing failed. Do not submit it again. ${error.message}`) :
        unconfirmed ? new Error(`Could not confirm whether the change was saved. Refresh before trying again. ${error.message}`) : error,
        saved || unconfirmed || error.status === 409);
      return false;
    } finally {
      setBusy(false, saved && !state.conflict ? message : '');
      if (saved && !state.conflict && focus) focusInFlow(focus);
    }
  }

  function seasonForm() {
    const s = season();
    if (!s) return '';
    return `<details class="al-details" id="al-season-details"${state.seasonOpen ? ' open' : ''}>
      <summary>Season 2 settings — future drafts</summary>
      <form data-al-form="season">
        <input type="hidden" name="id" value="${esc(s.id)}">
        <div class="al-grid">
          <input type="hidden" name="name" value="Season 2">
          <div class="al-field">${label('al-season-start', 'Start date')}
            <input type="date" id="al-season-start" name="start_date" value="${esc(dateOnly(s.start_date))}" min="2000-01-01" max="2199-12-31" required></div>
          <div class="al-field">${label('al-season-end', 'End date')}
            <input type="date" id="al-season-end" name="end_date" value="${esc(dateOnly(s.end_date))}" min="2000-01-01" max="2199-12-31" required></div>
          <div class="al-field">${label('al-season-scoring', 'Placement scoring mode')}
            <select id="al-season-scoring" name="scoring_mode" aria-describedby="al-scoring-help">
              ${option('beaten', 'Teams beaten · participation + field-size reward', s.scoring_mode || 'fixed')}
              ${option('relative', 'Relative · scale the curve to all teams', s.scoring_mode || 'fixed')}
              ${option('fixed', 'Fixed · award by exact placement', s.scoring_mode || 'fixed')}
            </select></div>
          <div class="al-field">${label('al-season-step', 'Point increment / rounding')}
            <select id="al-season-step" name="points_step" aria-describedby="al-scoring-help">
              ${[0.1, 0.25, 0.5, 1].map(step => option(step, `Nearest ${step} point${step === 1 ? '' : 's'}`, s.points_step ?? 0.5)).join('')}
            </select></div>
          <p class="al-small al-wide" id="al-scoring-help">Teams-beaten mode awards the first value for participating plus the second value for every team your team finishes ahead of. Relative mode stretches a placement curve across the actual team count. Fixed mode uses each listed place exactly and repeats the last value. Calculated modes require values that are multiples of the selected increment.</p>
          <div class="al-field al-wide">${label('al-season-points', 'Scoring values')}
            <input id="al-season-points" name="placement_points" value="${esc(s.placement_points.join(', '))}" required aria-describedby="al-points-help">
            <p class="al-small" id="al-points-help">Season 2 teams-beaten values: 1, 0.5 = 1 participation point + 0.5 per team beaten. Relative/fixed curves list awards from first to last. Every player earns their team’s points, including rotating substitutes. Season points sum EVERY finalized training.</p></div>
          <div class="al-field">${label('al-season-bonus-max', 'Bonus points (BP) maximum per player / training')}
            <input id="al-season-bonus-max" name="bonus_points_max" type="number" min="0" max="10000" step="any" value="${number(s.bonus_points_max, 1)}" required></div>
          <div class="al-field">${label('al-season-bonus-step', 'BP award step')}
            <select id="al-season-bonus-step" name="bonus_points_step">${[0.1, 0.25, 0.5, 1].map(step => option(step, `${step} BP`, s.bonus_points_step ?? 0.5)).join('')}</select>
            <p class="al-small">Admin-only awards. Each training keeps its saved BP cap and step.</p></div>
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
        <p class="al-callout">Scoring mode, rounding, awards, K-factor and skill ratings are captured when teams are generated. These settings apply to future drafts: regenerate an existing draft to adopt changes. Published and finalized trainings keep their saved rules. Season defaults never reset player profiles or silently re-award completed trainings.</p>
        <div class="al-actions"><button class="al-button" type="submit">Save Season 2 settings</button></div>
      </form>
    </details>`;
  }

  function renderSetup() {
    const available = sessions();
    const s = season();
    const selectedSession = session();
    const next = nextTraining();
    const renderOption = t => {
      const e = state.data.events.find(e => e.session_id === t.id);
      return option(t.id, `${t.id === next?.id ? '★ Next · ' : ''}Thu ${dateOnly(t.session_date)} · ${String(t.start_time || '').slice(0, 5)} · ${t.title || 'Training'}${t.is_cancelled ? ' · Cancelled' : ''}${e ? ` · ${e.status}` : ''}`, state.sessionId);
    };
    const upcoming = available.filter(t => dateOnly(t.session_date) >= today());
    const past = available.filter(t => dateOnly(t.session_date) < today()).reverse();
    return `<section class="al-card al-setup" id="al-setup">${heading('', 'Choose a Thursday')}
      <div class="al-field">${label('al-session-select', 'Season 2 training')}
        <select id="al-session-select"${disabled(!available.length)}>
          ${upcoming.length ? `<optgroup label="Upcoming Thursdays">${upcoming.map(renderOption).join('')}</optgroup>` : ''}
          ${past.length ? `<optgroup label="Past Thursdays — results / corrections">${past.map(renderOption).join('')}</optgroup>` : ''}
          ${!available.length ? '<option>No Thursday trainings in Season 2</option>' : ''}
        </select></div>
      ${selectedSession ? `<p class="al-small al-form-actions">Season 2 · ${esc(dateOnly(s?.start_date))}–${esc(dateOnly(s?.end_date))} · ${esc(selectedSession.location || 'No location specified')} · Europe/Vienna</p>
        <div class="al-quick-guide"><strong>Normal Thursday</strong><span>Confirm players → generate balanced teams → use the recommended schedule → publish.</span></div>` : '<p class="al-callout">Schedule a Thursday within the existing Season 2 dates in the Training tab, then refresh.</p>'}
      ${next && next.id !== state.sessionId ? `<p class="al-small">Next active Thursday is ${esc(dateOnly(next.session_date))}; your selected training has been kept.</p>` : ''}
      ${cancelled() ? '<p class="al-notice" role="status">Cancelled training — read-only. Roster, bonus points, match scores and results cannot be changed here.</p>' : ''}
      <details class="al-details" id="al-admin-options"${state.adminOptionsOpen ? ' open' : ''}><summary>Advanced: season settings & Head Ref access</summary>
        ${scorekeeperRoles()}${seasonForm()}
      </details>
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

  function eligibleScorekeeper(member) {
    // The admin member list is already filtered by the API; honor explicit flags if supplied.
    return member.id && (!('status' in member) || member.status === 'approved') &&
      (!('is_active' in member) || member.is_active === true);
  }

  function scorekeeperRoles() {
    const members = state.data.members.filter(eligibleScorekeeper).filter(m =>
      m.display_name.toLocaleLowerCase().includes(state.scorekeeperSearch.toLocaleLowerCase()));
    const assigned = state.data.members.filter(member => eligibleScorekeeper(member) && member.league_scorekeeper).length;
    return `<details class="al-details" id="al-head-ref-details" open>
      <summary>Account access · Head Refs</summary>
      <p class="al-small">Grant this permanent account-level role to an approved active member below. The member keeps using the same normal website login to save match scores for published Thursday trainings and to operate the live timer on that matchday. Head Refs cannot edit teams, BP, settings or final results. Access ends immediately when an admin removes the role; guests cannot receive it.</p>
      <div class="al-field al-form-actions">${label('al-scorekeeper-search', 'Find a registered member account')}
        <input type="search" id="al-scorekeeper-search" value="${esc(state.scorekeeperSearch)}" autocomplete="off" placeholder="Search approved members">
        <p class="al-small">${assigned} active Head Ref account${assigned === 1 ? '' : 's'}</p>
      </div>
      <div class="al-role-list" id="al-role-list">${members.map(m => `<label class="al-check al-role-row" for="al-role-${esc(m.id)}">
        <input type="checkbox" id="al-role-${esc(m.id)}" data-al-scorekeeper="${esc(m.id)}"${m.league_scorekeeper ? ' checked' : ''}>
        <span>${esc(m.display_name)} <span class="al-small">· Head Ref</span></span>
      </label>`).join('') || '<p class="al-small">No matching approved active members.</p>'}</div>
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

  function selectedRosterSummary() {
    const selected = players().filter(player => state.selected.has(player.id));
    if (!selected.length) return '<p class="al-empty">Nobody is selected yet. Open roster adjustments to add players.</p>';
    return `<div class="al-player-summary" aria-label="Selected players">${selected.map(player =>
      `<span class="al-player-pill">${esc(player.display_name)}${player.user_id ? '' : ' · guest'}</span>`
    ).join('')}</div>`;
  }

  function renderRoster() {
    return `<section class="al-card" id="al-roster">${heading('', 'Confirm everyone playing')}
      <p class="al-muted">Attending member RSVPs are selected automatically. If the list is right, continue directly to Teams.</p>
      ${isLocked() ? `<p class="al-callout">${cancelled() ? 'Cancelled: this training is read-only.' : event()?.status === 'finalized' ? 'Finalized: full roster edits are locked. An omitted last-minute player can still be appended to one team in Results; that training’s ledger is recalculated once.' : lineupStarted() ? 'Games have started: full roster and team edits are locked. Use “Last-minute player” in Results to append a late arrival to one team; score corrections remain available.' : 'Published: the roster is locked. Before any match is scored, use “Edit lineup” in Publish for full changes, or append one late arrival in Results.'}</p>` : ''}
      ${state.attendanceError ? `<p class="al-notice">${esc(state.attendanceError)}</p>` : ''}
      ${event()?.roster_stale && !isLocked() ? '<p class="al-notice">RSVPs changed. Review the attending labels and explicitly save this draft roster before publishing. No guests or manual selections have been changed.</p>' : ''}
      <p class="al-roster-count" id="al-roster-count" role="status">${state.selected.size} players selected · ${state.attending.size} RSVP attending</p>
      ${selectedRosterSummary()}
      <details class="al-details al-toolbox" id="al-roster-tools"${state.rosterToolsOpen ? ' open' : ''}>
        <summary>Adjust roster, add a guest or edit a player profile</summary>
        <p class="al-small">Use this only for no-shows, late changes, guests or profile maintenance.</p>
        <div class="al-actions">
          ${action('add-rsvp', 'Include all attending · keep guests', disabled(isLocked() || !state.sessionId || !!state.attendanceError))}
          ${action('rsvp', 'Reset to RSVPs only', disabled(isLocked() || !state.sessionId || !!state.attendanceError))}
          ${action('retry-rsvp', 'Refresh RSVPs', disabled(!state.sessionId))}
          ${action('clear-roster', 'Clear selection', disabled(isLocked() || !state.sessionId))}
        </div>
        <div class="al-field al-form-actions">${label('al-roster-search', 'Search roster names')}
          <input type="search" id="al-roster-search" value="${esc(state.search)}" placeholder="Member or guest name" autocomplete="off"></div>
        <label class="al-check" for="al-selected-only"><input type="checkbox" id="al-selected-only"${state.selectedOnly ? ' checked' : ''}><span>Show selected players only</span></label>
        <div class="al-roster-list" id="al-roster-list">${rosterRows()}</div>
        <details class="al-details" id="al-guest-details"${state.guestOpen ? ' open' : ''}>
          <summary>Add a named guest — no account needed</summary>
          <form data-al-form="guest">
            <p class="al-small">Creates a persistent league profile. Search above first to avoid duplicates.${isLocked() ? cancelled() ? ' This training is cancelled; the new guest will be available for future drafts.' : ' Full lineup editing is locked; the new guest will be available for “Last-minute player” in Results.' : ' The new guest is selected for this draft automatically.'}</p>
            <p class="al-callout" id="al-guest-public-warning">Guest names become public when teams are published and can appear in season standings after results. Let the guest know before publishing. Ratings, gender and rookie tags stay admin-only.</p>
            <div class="al-field">${label('al-guest-name', 'Guest display name — public after publishing')}
              <input id="al-guest-name" name="display_name" autocomplete="off" maxlength="100" required placeholder="First and last name" aria-describedby="al-guest-public-warning"></div>
            <div class="al-form-actions">${profileFields('guest', { gender: 'unspecified', is_rookie: false, initial_rating: season()?.default_rating ?? 1000 })}</div>
            <button type="submit" class="al-button">Create guest profile${!isLocked() && state.sessionId ? ' & add to roster' : ''}</button>
          </form>
        </details>
        ${profileEditor()}
      </details>
    </section>`;
  }

  function planText() {
    const n = state.selected.size;
    const teamCount = state.maxTeams === 2 ? 2 : 3;
    if (n < minimumRoster()) return `${n} selected. At least ${minimumRoster()} players are needed for ${teamCount === 2 ? 'two' : 'three'} ${state.size === 'auto' ? '2' : state.size}-a-side teams. You may save an understrength draft, but not publish it.`;
    if (n > 500) return `${n} selected. A training supports at most 500 players. Reduce this roster before drafting.`;
    const size = draftSize();
    const feasible = Math.min(state.maxTeams, Math.floor(n / size));
    const count = state.maxTeams === 2 ? 2 : feasible >= 5 ? 5 : feasible >= 3 ? 3 : feasible;
    const min = Math.floor(n / count);
    const max = Math.ceil(n / count);
    const format = count === 2
      ? 'head-to-head teams; an external Head Ref/admin must officiate.'
      : count === 5 ? 'referee-safe teams; two courts can run while the fifth team refs.'
        : 'referee-safe teams; one court runs while the third team refs.';
    return `${n} players → ${count} ${format} Squads have ${min === max ? min : `${min}–${max}`} players. ${state.size === 'auto' ? 'Auto selects ' : ''}${size} on court per team. ${max > size ? 'Larger squads rotate substitutes — nobody is left out.' : 'Everyone plays, nobody is left out.'}`;
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
      const subs = Math.max(0, list.length - draftSize());
      return `<article class="al-team" data-al-drop-team="${t.number}" aria-labelledby="al-team-heading-${t.number}">
        <h4 id="al-team-heading-${t.number}">${esc(t.name || `Team ${t.number}`)}</h4>
        <p class="al-small">Squad ${t.number}</p>
        ${!isLocked() ? `<div class="al-field">${label(`al-team-name-${t.number}`, 'Public team name')}<input id="al-team-name-${t.number}" data-al-team-name="${t.number}" value="${esc(t.name)}" maxlength="80" required></div>` : ''}
        <div class="al-team-stat">
          <span class="al-chip">${list.length} players</span>${state.teamToolsOpen ? `<span class="al-chip">Private avg ${avg} · draft snapshot</span>
          <span class="al-chip">${female} female · ${male} male${list.length - female - male ? ` · ${list.length - female - male} unspecified` : ''}</span>
          <span class="al-chip al-rookie">${rookie} really rookie</span>` : ''}
        </div>
        ${subs ? `<p class="al-small">${subs} rotating substitute${subs === 1 ? '' : 's'} — all ${list.length} players receive this team’s placement points.</p>` : ''}
        <ul class="al-team-players">${list.map(p => `<li class="al-draft-player" data-al-drop-player="${esc(p.id)}">
          ${!isLocked() && state.teamToolsOpen ? playerHandle(p) : ''}
          <span class="al-player-info">${esc(p.display_name)}${state.teamToolsOpen && p.is_rookie ? ' <span class="al-chip al-rookie">Rookie</span>' : ''}${state.teamToolsOpen ? `<span class="al-small"> · private ${rating(p)}</span>` : ''}</span>
          ${!isLocked() && state.teamToolsOpen ? action(`remove-player:${p.id}`, 'Remove', ` aria-label="Remove ${esc(p.display_name)} from this training only"`) : ''}
        </li>`).join('') || '<li class="al-small">Empty team — add players before publishing.</li>'}</ul>
        ${!isLocked() && state.teamToolsOpen ? action(`place-player:${t.number}`, 'Move selected player here', ` data-al-place-team="${t.number}"${disabled(!state.pickedPlayer)}`) : ''}
      </article>`;
    }).join('');
  }

  function balanceSummary() {
    const squads = state.teams.map(t => t.player_ids.map(teamPlayer));
    if (!squads.length || squads.some(list => !list.length)) return '';
    const means = squads.map(list => list.reduce((sum, p) => sum + rating(p), 0) / list.length);
    const sizes = squads.map(list => list.length);
    return `<p class="al-callout"><strong>Balance check:</strong> ${Math.min(...sizes)}–${Math.max(...sizes)} players per squad;
      ${Math.round(Math.max(...means) - Math.min(...means))} private ELO points between the highest and lowest squad average.
      The balancer also considers gender and rookies. This is a best-effort draft, not a guarantee of equal match results.</p>`;
  }

  function editTools() {
    const assigned = new Set(state.teams.flatMap(t => t.player_ids));
    const unassigned = [...state.selected].filter(id => !assigned.has(id));
    const all = [...state.selected].map(id => ({ id, text: `${teamPlayer(id).display_name} · ${state.teams.find(t => t.player_ids.includes(id))?.name || 'Unassigned'}` }));
    return `<div class="al-edit-tools">
      <h4>Adjust this draft — keep everyone else in place</h4>
      <p class="al-small" id="al-drag-help">Drag a player’s ↕ handle onto another player to swap, or onto a team to move; hold near the screen edge to scroll. On touch or keyboard, activate a handle, then another handle to swap or “Move selected player here”. Escape cancels selection. The controls below also work without dragging.</p>
      <p class="al-small">Remove only takes a player out of this training roster, never deletes their account or profile. Changes stay local until Save draft. Undo or discard restores the saved lineup; rebalancing is a separate choice.</p>
      <p id="al-drag-status" class="al-callout" role="status" aria-live="polite">${state.pickedPlayer ? `${esc(teamPlayer(state.pickedPlayer).display_name)} selected. Choose a different player or destination team.` : 'No player selected for a move or swap.'}</p>
      ${unassigned.length ? `<div class="al-callout"><h4>Assign ${unassigned.length} selected player${unassigned.length === 1 ? '' : 's'} before saving</h4>
        <ul class="al-team-players">${unassigned.map(id => `<li>${playerHandle(playerFor(id))}<span>${esc(playerFor(id).display_name)}</span>${action(`remove-player:${id}`, 'Remove')}</li>`).join('')}</ul></div>` : ''}
      <div class="al-grid">
        <div class="al-field">${label('al-move-player', 'Player to move or swap')}
          <select id="al-move-player">${option('', 'Choose a player', '')}${all.map(p => option(p.id, p.text, '')).join('')}</select></div>
        <div class="al-field">${label('al-swap-player', 'Swap with player')}
          <select id="al-swap-player">${option('', 'Choose the other player', '')}${all.map(p => option(p.id, p.text, '')).join('')}</select></div>
      </div>
      <div class="al-actions al-form-actions">${action('swap', 'Swap these players')}</div>
      <div class="al-field al-form-actions">${label('al-move-team', 'Or move to team')}
        <select id="al-move-team">${option('', 'Choose destination team', '')}${state.teams.map(t => option(t.number, t.name, '')).join('')}</select></div>
      <div class="al-actions al-form-actions">${action('move', 'Move player')}</div>
    </div>`;
  }

  function renderDraft() {
    const locked = isLocked();
    return `<section class="al-card" id="al-draft">${heading('', 'Balance & review teams')}
      <p class="al-muted">The automatic setup balances every selected player and keeps one team free to referee whenever possible.</p>
      <p class="al-callout" id="al-plan" role="status">${planText()}</p>
      ${cancelled() ? '<p class="al-notice">This training is cancelled. Choose an active Thursday to edit.</p>' : ''}
      <div class="al-actions">
        <button type="button" class="al-button${event() ? ' al-secondary' : ''}" data-al-action="generate" id="al-generate"${disabled(locked || !state.sessionId || state.selected.size < minimumRoster() || state.selected.size > 500)}>${event() ? 'Rebalance teams — optional, replaces assignments' : 'Generate balanced draft'}</button>
      </div>
      <details class="al-details al-toolbox" id="al-team-options"${state.teamOptionsOpen ? ' open' : ''}>
        <summary>Advanced team-generation options</summary>
        <div class="al-grid"><div class="al-field">${label('al-team-size', 'Players on court per team')}
          <select id="al-team-size"${disabled(locked)}>
            ${[['auto', 'Auto · choose 2–6'], ...[2, 3, 4, 5, 6].map(n => [String(n), `${n} on court`])].map(([v, l]) => option(v, l, state.size)).join('')}
          </select></div>
          <div class="al-field">${label('al-max-teams', 'Maximum squads for next rebalance')}
            <select id="al-max-teams"${disabled(locked)}>${[2, 3, 4, 5].map(count => option(count, `${count} squads maximum`, state.maxTeams)).join('')}</select></div></div>
        <p class="al-small">Auto uses five squads for two courts or three for one court when feasible, so a full team can referee. Choose two only for a head-to-head evening with an external Head Ref/admin. Extra players rotate as substitutes.</p>
      </details>
      <p class="al-dirty" id="al-dirty-roster"${needsRosterReview() ? '' : ' hidden'}>Roster or team size needs review. Assign any new players, then Save draft — no rebalance required.</p>
      ${state.teams.length ? `<div class="al-team-grid" id="al-teams">${teamCards()}</div>
        <details class="al-details al-toolbox" id="al-team-tools"${state.teamToolsOpen ? ' open' : ''}>
          <summary>Advanced balance details & manual team changes</summary>
          ${balanceSummary()}${!locked ? editTools() : '<p class="al-small">This lineup is locked.</p>'}
        </details>
        ${!locked ? `<p class="al-dirty" id="al-dirty-teams"${state.dirtyTeams ? '' : ' hidden'}>Team edits are not saved yet.</p>
        <div class="al-actions"><button type="button" class="al-button" id="al-save-teams" data-al-action="save-draft"${disabled(!state.dirtyTeams && !needsRosterReview())}>Save draft</button>
        ${action('undo-draft', 'Undo last draft change', ` id="al-undo-draft"${disabled(!state.draftUndo.length)}`)}
        ${action('discard-teams', 'Discard draft changes', disabled(!state.dirtyTeams && !state.dirtyRoster))}</div>` : ''}` :
        '<p class="al-empty al-form-actions">No teams yet. Confirm the roster, then generate a private draft. Names stay hidden from the public until you publish.</p>'}
    </section>`;
  }

  function teamName(teamNumber) {
    return state.teams.find(team => Number(team.number) === Number(teamNumber))?.name || `Team ${teamNumber}`;
  }

  function scheduleTime(offset, meetupTime) {
    const start = String(meetupTime || event()?.schedule?.meetup_time || state.scheduleSettings.meetup_time
      || session()?.start_time || event()?.start_time || '');
    if (!/^\d{2}:\d{2}/.test(start)) return `${offset} min from start`;
    const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + offset;
    const days = Math.floor(total / 1440);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}${days ? ` (+${days} day)` : ''}`;
  }

  function scheduleSlots(count, courts) {
    const activeCourts = count === 2 ? 1 : Math.min(courts, Math.floor((count - 1) / 2));
    return {
      activeCourts,
      slots: (count % 2 ? count : count - 1) * Math.ceil(Math.floor(count / 2) / activeCourts)
    };
  }

  function recommendedScheduleSettings(count) {
    const teams = count >= 2 && count <= 5 ? count : 5;
    const courts = teams <= 3 ? 1 : 2;
    const { slots } = scheduleSlots(teams, courts);
    const breakMinutes = teams === 2 ? 0 : slots <= 3 ? 7 : slots <= 5 ? 5 : slots <= 6 ? 3 : 1;
    const booking = sessionBooking();
    const start = booking.error ? null : Math.ceil(booking.startMinute);
    const available = booking.error ? 120 : Math.max(1, Math.min(120, Math.floor(booking.endMinute - start) - 10));
    return {
      courts,
      match_minutes: Math.max(1, Math.min(60, Math.floor((available - 15 - (slots - 1) * breakMinutes) / slots))),
      break_minutes: breakMinutes,
      meetup_time: start === null ? '' : `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
      warmup_minutes: 15,
      available_minutes: available,
      finale_minutes: 10
    };
  }

  function sessionBooking() {
    if (!window.LeagueSchedule) return { error: 'Booking validation did not load. Refresh this page before planning or publishing.' };
    try { return { ...window.LeagueSchedule.bookingWindow(session()), error: '' }; }
    catch (error) { return { error: error.message }; }
  }

  function bookingWarning(settings) {
    if (!window.LeagueSchedule) return 'Booking validation did not load. Refresh this page before planning or publishing.';
    try { window.LeagueSchedule.validateBookingSchedule(session(), settings); return ''; }
    catch (error) { return error.message; }
  }

  function savedScheduleSettings() {
    const saved = event()?.schedule;
    return saved ? {
      courts: saved.courts, match_minutes: saved.match_minutes, break_minutes: saved.break_minutes,
      meetup_time: saved.meetup_time ?? '', warmup_minutes: saved.warmup_minutes ?? 0,
      available_minutes: saved.available_minutes, finale_minutes: saved.finale_minutes ?? 0
    } : recommendedScheduleSettings(state.teams.length || 5);
  }

  function scheduleEstimate(settings) {
    const count = state.teams.length;
    if (count < 2 || count > 5) throw new Error('Generate two to five squads before planning this round robin.');
    const bookingError = sessionBooking().error;
    if (bookingError) throw new Error(bookingError);
    if (typeof settings.meetup_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.meetup_time)) {
      throw new Error('Meetup time must use HH:MM.');
    }
    for (const [key, minimum, maximum] of [
      ['courts', 1, 2], ['match_minutes', 1, 60], ['break_minutes', 0, 30],
      ['warmup_minutes', 0, 120], ['available_minutes', 1, 480], ['finale_minutes', 1, 10]
    ]) {
      if (!Number.isInteger(settings[key]) || settings[key] < minimum || settings[key] > maximum) {
        throw new Error(`${key.replace(/_/g, ' ')} must be a whole number from ${minimum} to ${maximum}.`);
      }
    }
    if (settings.warmup_minutes >= settings.available_minutes) throw new Error('Warm-up must finish before the games cutoff.');
    const warning = bookingWarning(settings);
    if (warning) throw new Error(warning);
    const { activeCourts, slots } = scheduleSlots(count, settings.courts);
    return {
      slots, activeCourts, matches: count * (count - 1) / 2,
      duration: settings.warmup_minutes + slots * settings.match_minutes + (slots - 1) * settings.break_minutes
    };
  }

  function schedulePreviewText() {
    try {
      const estimate = scheduleEstimate(state.scheduleSettings);
      const buffer = state.scheduleSettings.available_minutes - estimate.duration;
      const topology = state.teams.length === 2
        ? 'One court runs head-to-head; assign an external Head Ref/admin because neither team is free.'
        : estimate.activeCourts < state.scheduleSettings.courts
        ? `${state.scheduleSettings.courts} courts are available, but only ${estimate.activeCourts} runs per slot so a team is always free to ref.`
        : `${estimate.activeCourts} court${estimate.activeCourts === 1 ? '' : 's'} run per slot with exactly one assigned ref team.`;
      return `Meet ${scheduleTime(0)} · warm-up to ${scheduleTime(state.scheduleSettings.warmup_minutes)} · ${estimate.slots} game slots / ${estimate.matches} matches until ${scheduleTime(estimate.duration)} · games cutoff ${scheduleTime(state.scheduleSettings.available_minutes)} · Last Man/Woman Standing ${scheduleTime(state.scheduleSettings.available_minutes)}–${scheduleTime(state.scheduleSettings.available_minutes + state.scheduleSettings.finale_minutes)}. ${topology} ${buffer < 0 ? `Does not fit: ${-buffer} minutes over the games window.` : `${buffer} minutes of game-window buffer remain.`}`;
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
    const externalRef = e?.teams?.length === 2;
    return `<section class="al-card" id="al-schedule">
      ${heading('', 'Plan the round robin')}
      <p class="al-muted" id="al-schedule-heading" tabindex="-1">Include warm-up, games and the maximum 10-minute Last Man / Last Woman Standing finale inside the booked training time. ${externalRef ? 'With two teams, assign an external Head Ref/admin.' : 'Every match slot assigns one non-playing team to referee.'}</p>
      <p class="al-callout">Booked training: <strong>${esc(String(session()?.start_time || '').slice(0, 5) || 'Start time missing')} – ${esc(String(session()?.end_time || '').slice(0, 5) || 'End time missing')}</strong>. Correct the booking in the Training tab if necessary.</p>
      ${!e ? '<p class="al-empty">Generate and save your balanced teams first.</p>' : `
        ${state.dirtyTeams || needsRosterReview() ? '<p class="al-notice">Save or regenerate the lineup first. Lineup changes can clear its saved schedule; generate the schedule again after those changes.</p>' : ''}
        ${e.status !== 'draft' ? `<p class="al-callout">${lineupStarted() || e.status === 'finalized' ? 'Games have started or results are final: the schedule and lineup are locked.' : 'The schedule is published. Before the first recorded score, you can delete it below or use Edit lineup; either action returns this event to a private draft.'}</p>` : ''}
        <form data-al-form="schedule">
          <fieldset id="al-schedule-fields"${disabled(!editable)}>
            <legend class="al-sr-only">Recommended schedule</legend>
            <p class="al-callout" id="al-schedule-preview" role="status">${schedulePreviewText()}</p>
            <div class="al-actions">
              <button type="submit" class="al-button">${e.schedule ? 'Regenerate current schedule' : 'Create recommended schedule'}</button>
            </div>
            <details class="al-details al-toolbox" id="al-timing-details"${state.timingOpen ? ' open' : ''}><summary>Advanced: change courts or timing</summary>
              <div class="al-grid">
                <div class="al-field">${label('al-schedule-meetup_time', 'Meet & warm-up time')}
                  <input type="time" id="al-schedule-meetup_time" name="meetup_time" data-al-schedule="meetup_time" value="${esc(state.scheduleSettings.meetup_time)}" required></div>
                <div class="al-field">${label('al-schedule-courts', 'Available courts')}
                  <select id="al-schedule-courts" name="courts" data-al-schedule="courts">${[1, 2].map(count => option(count, `${count} court${count === 1 ? '' : 's'}`, state.scheduleSettings.courts)).join('')}</select></div>
              </div>
              <div class="al-grid">
              ${[
                ['warmup_minutes', 'Warm-up before games (minutes)', 0, 120],
                ['match_minutes', 'Game length (minutes)', 1, 60],
                ['break_minutes', 'Changeover between slots (minutes)', 0, 30],
                ['available_minutes', 'Minutes from meetup to games cutoff (excludes finale)', 1, 480],
                ['finale_minutes', 'Last Man/Woman finale (max 10 minutes)', 1, 10]
              ].map(([key, text, min, max]) => `<div class="al-field">${label(`al-schedule-${key}`, text)}<input type="number" id="al-schedule-${key}" name="${key}" data-al-schedule="${key}" value="${state.scheduleSettings[key]}" min="${min}" max="${max}" step="1" required></div>`).join('')}
              </div>
              <div class="al-actions al-form-actions">
                <button type="submit" class="al-button al-secondary">Apply custom schedule</button>
                ${action('discard-schedule', 'Discard timing edits', ` id="al-discard-schedule"${disabled(!state.dirtySchedule)}`)}
              </div>
            </details>
            <p class="al-dirty" id="al-schedule-unsaved"${state.dirtySchedule ? '' : ' hidden'}>Unsaved timing changes. Apply the custom schedule or discard the edits under Advanced.</p>
          </fieldset>
        </form>
        ${e.schedule ? [ROTATING_REF_POLICY, EXTERNAL_REF_POLICY].includes(e.schedule.referee_policy)
          ? `<p class="al-small al-form-actions">Saved schedule: ${e.schedule.rounds.length} slots, ${allMatches().length} matches, games ending at ${esc(scheduleTime(e.schedule.duration_minutes, e.schedule.meetup_time))}; finale ${esc(scheduleTime(e.schedule.finale_start_minute, e.schedule.meetup_time))}–${esc(scheduleTime(e.schedule.total_duration_minutes, e.schedule.meetup_time))}. <a href="#al-matches">Review fixtures, ${e.schedule.referee_policy === EXTERNAL_REF_POLICY ? 'the external-ref requirement' : 'ref teams'} and court times</a> before publishing.</p>`
          : '<p class="al-notice al-form-actions">This is a legacy schedule without assigned ref teams. Regenerate it before republishing.</p>'
          : '<p class="al-small al-form-actions">No schedule saved. Generate the referee-safe round robin before publishing the itinerary.</p>'}
        ${!e.schedule && editable ? `<details class="al-details"><summary>Advanced: publish without a match schedule</summary>
          <label class="al-check"><input type="checkbox" id="al-manual-placements"${state.manualPlacements ? ' checked' : ''}>
            Use manual final placements for this training instead of scheduled matches.</label>
          <p class="al-small">No court times or referee assignments will be published. The admin must organise games and enter every team's final placement manually.</p>
        </details>` : ''}`}
        ${e?.schedule && ['draft', 'published'].includes(e.status) && !lineupStarted()
          ? `<div class="al-actions al-form-actions">${action('delete-schedule', e.status === 'published' ? 'Delete published schedule' : 'Delete saved schedule', ' id="al-delete-schedule"')}</div>` : ''}
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
      <p class="al-callout">${event()?.status === 'finalized' ? table.has_ties ? 'Finalized: this match table still shows exact statistical ties. The final winner and season awards use the saved, resolved placements in Results.' : 'Finalized: the final winner and season awards follow the saved placements in Results.' : !table.complete ? 'Provisional table: finish every match before finalizing season points.' : table.has_ties ? 'All matches finished. Exact ties remain after all three tiebreak metrics; resolve only those tied places in Results.' : 'All matches finished. Final placements are automatic; review and finalize them in Results.'}</p>
    </div>`;
  }

  function renderMatches() {
    const e = event();
    if (!e?.schedule) return `<section class="al-card" id="al-matches" tabindex="-1">${heading('', 'Fixtures & match scores')}<p class="al-empty">Generate a schedule in Schedule to record scores and calculate placements automatically. Trainings without a schedule can still use manual placements in Results.</p></section>`;
    const editable = e.status === 'published' && !futureTraining() && !cancelled();
    const completed = allMatches().filter(match => match.score_a != null && match.score_b != null).length;
    return `<section class="al-card" id="al-matches" tabindex="-1">
      ${heading('', 'Fixtures & match scores')}
      <p class="al-muted" id="al-matches-heading" tabindex="-1">${completed} / ${allMatches().length} matches scored. ${e.status === 'draft' ? 'Private schedule preview. Publish teams and this schedule before recording scores.' : e.status === 'finalized' ? 'Finalized scores are read-only. Reopen results to make a correction.' : futureTraining() ? `This is a future training. Scores can be entered from ${esc(dateOnly(session()?.session_date || e.session_date))}, using the Vienna calendar date. Teams and fixtures can be published in advance.` : 'Enter the final points scored by each team, then save that match. Saving the first score permanently locks the lineup.'}</p>
      ${e.schedule.rounds.map(round => `<section class="al-round" aria-labelledby="al-round-${round.number}">
        <h4 id="al-round-${round.number}">Slot ${round.number} · ${esc(scheduleTime(round.start_minute))}–${esc(scheduleTime(round.end_minute))}</h4>
        ${round.referee_team ? `<p class="al-callout"><strong>Ref team:</strong> ${esc(teamName(round.referee_team))}</p>`
          : e.schedule.referee_policy === EXTERNAL_REF_POLICY
            ? '<p class="al-callout"><strong>External ref:</strong> Head Ref/admin required — both teams are playing.</p>'
            : '<p class="al-notice">Legacy slot: no ref team assigned. Regenerate before republishing.</p>'}
        ${round.rest_teams?.length ? `<p class="al-small">Resting: ${round.rest_teams.map(team => esc(teamName(team))).join(', ')}</p>` : ''}
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
            ${['published', 'finalized'].includes(e.status) ? `<a class="al-button al-secondary" href="/timer?event=${encodeURIComponent(e.id)}&match=${encodeURIComponent(match.number)}">Open match ${match.number} timer</a>` : ''}
          </article>`;
        }).join('')}</div>
      </section>`).join('')}
      ${renderMatchTable()}
    </section>`;
  }

  function renderPublish() {
    const e = event();
    const status = e?.status || 'not generated';
    const checks = publicationChecks();
    const readyChecks = checks.filter(check => check.ready).length;
    const text = status === 'finalized'
      ? 'Finalized: teams and results are public. Roster changes are locked; use Results for corrections.'
      : status === 'published'
        ? lineupStarted() ? 'Games have started or results were finalized. Teams and any guests in this lineup are locked; you cannot unpublish or change the roster. Record or correct match scores below.' : 'Teams and the saved schedule are public. Before any score is entered, reopen the lineup below to edit. This temporarily hides public teams until you publish again.'
        : 'Not published: public visitors see that teams are not yet published, not this draft or its names. Save your draft, then publish when ready.';
    return `<section class="al-card" id="al-publish">${heading('', 'Publish for players')}
      <div class="al-status"><span class="al-chip ${status === 'draft' || !e ? 'al-draft' : 'al-live'}">${esc(status)}</span>${e ? `<span class="al-small">Saved version ${number(e.version, 0)}</span>` : ''}</div>
      <p class="al-callout">${text}</p>
      ${eventAwardsSummary()}
      ${!e || status === 'draft' ? `<p class="al-publish-progress" id="al-publish-progress"><strong>${readyChecks}/${checks.length} checks ready</strong> · Any remaining blocker is shown below.</p>
        <details class="al-details al-toolbox" id="al-publication-checklist-details"><summary>View all publication checks</summary><div id="al-publication-checklist">${publicationChecklist()}</div></details>
        ${e?.schedule?.referee_policy === EXTERNAL_REF_POLICY ? `<label class="al-check">
          <input type="checkbox" id="al-referee-reviewed"${state.refereeReviewed ? ' checked' : ''}${disabled(isLocked())}>
          I have arranged an external Head Ref/admin for this two-team game.</label>` : ''}
        <details class="al-details"><summary>Preview public team and player names</summary>
          <div class="al-team-grid">${state.teams.map(team => `<div><h4>${esc(team.name)}</h4>
            <ul>${team.player_ids.map(id => `<li>${esc(teamPlayer(id).display_name)}</li>`).join('')}</ul></div>`).join('')}</div>
        </details>
        <label class="al-check al-form-actions"><input type="checkbox" id="al-names-reviewed"${state.namesReviewed ? ' checked' : ''}${disabled(!e || isLocked())}>
          I reviewed the public team and player names and let named guests know they will be visible.</label>` : ''}
      <p class="al-notice" id="al-publish-warning"${publishWarning() ? '' : ' hidden'}>${esc(publishWarning())}</p>
      <div class="al-actions">
        ${status === 'published' ? lineupStarted() ? '<a class="al-button al-secondary" href="#al-matches">Record or correct match scores</a>' : action('unpublish', 'Edit lineup — temporarily hide published teams', disabled(cancelled())) :
          status === 'finalized' ? '<a class="al-button al-secondary" href="#al-results">Correct final placements</a>' :
            `<button type="button" class="al-button" id="al-publish-button" data-al-action="publish"${disabled(!e || isLocked() || state.dirtyTeams || state.dirtySchedule || needsRosterReview() || !!publishWarning())}>Publish teams (public names)</button>`}
        ${e ? `<a class="al-button al-secondary" href="/spieltag?event=${encodeURIComponent(e.id)}" target="_blank" rel="noopener">Live-Spieltag / Ergebnisse <span class="al-sr-only">(opens a new tab; sign in there to enter scores)</span></a>` : ''}
        ${e && ['published', 'finalized'].includes(status) ? `<a class="al-button" data-al-poster="itinerary" href="/spieltag?event=${encodeURIComponent(e.id)}&export=itinerary" target="_blank" rel="noopener">Download / share fixtures image <span class="al-sr-only">(opens the public matchday and downloads the portrait itinerary image)</span></a>` : ''}
        ${e && status === 'finalized' ? `<a class="al-button" data-al-poster="results" href="/spieltag?event=${encodeURIComponent(e.id)}&export=results" target="_blank" rel="noopener">Download / share results image <span class="al-sr-only">(opens the public matchday and downloads the portrait results image)</span></a>` : ''}
      </div>
      <p class="al-small al-form-actions">Publishing makes all selected player names public, including named guests. Let guests know before publishing. Ratings, gender labels and rookie tags remain admin-only and are never included in the public team view.</p>
    </section>`;
  }

  function rosterPublishWarning() {
    if (!event()) return 'Save a team draft first.';
    if (state.teams.length < 2 || state.teams.length > 5) return 'Cannot publish: use two to five teams.';
    const requiredPlayers = state.teams.length * draftSize();
    if (state.selected.size < requiredPlayers) return `Cannot publish: ${state.selected.size} players; at least ${requiredPlayers} are required for ${state.teams.length} on-court teams. An understrength draft can still be saved.`;
    const ids = state.teams.flatMap(t => t.player_ids);
    if (new Set(ids).size !== ids.length || ids.length !== state.selected.size || ids.some(id => !state.selected.has(id))) {
      return 'Cannot publish: assign every selected player to exactly one team.';
    }
    if (state.teams.some(t => !t.name.trim())) return 'Cannot publish: give every team a public name.';
    const short = state.teams.find(t => t.player_ids.length < draftSize());
    if (short) return `Cannot publish: ${short.name || `Team ${short.number}`} has ${short.player_ids.length} players; needs ${draftSize()}. Add players, move players or choose a smaller on-court size.`;
    const sizes = state.teams.map(t => t.player_ids.length);
    if (Math.max(...sizes) - Math.min(...sizes) > 1) return 'Cannot publish: team sizes may differ by at most one player. Move a player or rebalance.';
    return '';
  }

  function publicationChecks() {
    const e = event();
    const rosterWarning = rosterPublishWarning();
    const schedule = e?.schedule;
    const expectedPolicy = state.teams.length === 2 ? EXTERNAL_REF_POLICY : ROTATING_REF_POLICY;
    const timeWarning = schedule ? bookingWarning(schedule) : '';
    return [
      { title: 'Players assigned once; squads are playable and even', stage: 'teams',
        ready: !rosterWarning, detail: rosterWarning || 'Each squad has enough players; squad sizes differ by at most one.' },
      { title: 'Active training and current attendance', stage: 'players',
        ready: !!session() && !cancelled() && !state.attendanceError && !needsRosterReview(),
        detail: cancelled() ? 'This training is cancelled.' : state.attendanceError || (needsRosterReview() ? 'Review current RSVPs and save the roster before publishing.' : 'RSVP changes are also rechecked by the server when publishing.') },
      { title: 'Latest lineup and timing saved', stage: state.dirtySchedule ? 'schedule' : 'teams',
        ready: !!e && !state.dirtyTeams && !state.dirtySchedule && !state.dirtyRoster,
        detail: state.dirtySchedule ? 'Generate the schedule or discard timing edits in Schedule.' :
          !e || state.dirtyTeams || state.dirtyRoster ? 'Save manual team edits without rebalancing; do not publish unsaved changes.' : 'The lineup and timing match the saved draft.' },
      { title: schedule ? 'Full program fits the training booking' : 'Match schedule or deliberate manual placements', stage: 'schedule',
        ready: !!schedule && !timeWarning || !!e && !schedule && state.manualPlacements,
        detail: schedule ? timeWarning || 'Meetup, warm-up, games and finale stay inside the booked time.' : state.manualPlacements ? 'Manual placements chosen: no match itinerary will be published.' : 'Generate a schedule, or explicitly choose manual placements under Advanced in Schedule.' },
      { title: schedule?.referee_policy === EXTERNAL_REF_POLICY ? 'External referee required' : 'Referee coverage planned',
        stage: schedule?.referee_policy === expectedPolicy && expectedPolicy === EXTERNAL_REF_POLICY ? 'publish' : 'schedule',
        ready: !!schedule && schedule.referee_policy === expectedPolicy && (expectedPolicy !== EXTERNAL_REF_POLICY || state.refereeReviewed) || !!e && !schedule && state.manualPlacements,
        detail: !schedule ? 'Without a schedule, organise court and referee assignments yourself.' :
          schedule.referee_policy !== expectedPolicy ? 'Regenerate this schedule for the current squad format.' :
            expectedPolicy === EXTERNAL_REF_POLICY ? 'Two teams cannot referee themselves. Arrange an external Head Ref/admin, then confirm in Publish.' : 'The saved schedule assigns a non-playing referee team to each slot.' },
      { title: 'Public names reviewed', stage: 'publish', ready: state.namesReviewed,
        detail: state.namesReviewed ? 'Names reviewed for this draft. Private ELO and profile labels stay hidden.' :
          'Review the team and player names, including guests, then confirm below. Private ELO and profile labels stay hidden.' }
    ];
  }

  function publicationChecklist() {
    return `<h4>Publication checklist</h4><ul class="al-checklist">${publicationChecks().map(check =>
      `<li class="${check.ready ? 'al-check-ready' : 'al-check-pending'}"><span class="al-check-state">${check.ready ? 'Ready' : 'Review'}</span>
        <div><strong>${esc(check.title)}</strong><p class="al-small">${esc(check.detail)}</p>
        ${!check.ready && check.stage !== 'publish' ? action(`stage:${check.stage}`, `Go to ${stages.find(stage => stage.id === check.stage).title}`) : ''}</div></li>`
    ).join('')}</ul>`;
  }

  function publishWarning() {
    if (!event() || event().status !== 'draft') return '';
    return publicationChecks().find(check => !check.ready)?.detail || '';
  }

  function bonusSettings() {
    const e = event();
    return {
      max: number(e?.bonus_points_max ?? e?.settings?.bonus_points_max, 1),
      step: number(e?.bonus_points_step ?? e?.settings?.bonus_points_step, 0.5)
    };
  }

  function bonusRows() {
    const rules = bonusSettings();
    const locked = cancelled() || event()?.status === 'finalized';
    return [...state.selected].map(playerFor).filter(p => p.display_name.toLocaleLowerCase().includes(state.bonusSearch.toLocaleLowerCase()))
      .sort((a, b) => a.display_name.localeCompare(b.display_name)).map(p => `<div class="al-bonus-row">
        <label for="al-bonus-${esc(p.id)}">${esc(p.display_name)}<span class="al-small">${esc(state.teams.find(t => t.player_ids.includes(p.id))?.name || 'Unassigned')}</span></label>
        <input id="al-bonus-${esc(p.id)}" data-al-bonus="${esc(p.id)}" type="number" inputmode="decimal" min="0" max="${rules.max}" step="${rules.step}" value="${esc(state.bonusAwards[p.id] ?? 0)}" required${disabled(locked)} aria-label="${esc(p.display_name)} bonus points">
      </div>`).join('') || '<p class="al-small">No matching roster players.</p>';
  }

  function finalePlayers(gender) {
    return [...state.selected].map(playerFor).filter(player => player.gender === gender)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  function finaleSelection(gender, points) {
    const matches = finalePlayers(gender).filter(player => Number(state.bonusAwards[player.id] || 0) === points);
    return matches.length === 1 ? matches[0].id : '';
  }

  function validateFinaleAwards(requireComplete) {
    for (const [gender, label] of [['male', 'Last Man Standing'], ['female', 'Last Woman Standing']]) {
      const eligible = finalePlayers(gender);
      if (eligible.length < 2) continue;
      const winners = eligible.filter(player => Number(state.bonusAwards[player.id] || 0) === 1);
      const runners = eligible.filter(player => Number(state.bonusAwards[player.id] || 0) === 0.5);
      if (winners.length > 1 || runners.length > 1) throw new Error(`${label}: choose only one winner and one runner-up.`);
      if (requireComplete && (winners.length !== 1 || runners.length !== 1)) {
        throw new Error(`${label}: save one +1 BP winner and one +0.5 BP runner-up before finalizing.`);
      }
    }
  }

  function finaleAwardsPanel(locked, rules) {
    const supported = rules.max >= 1 && Math.abs(0.5 / rules.step - Math.round(0.5 / rules.step)) < 1e-8;
    const select = (gender, points, caption) => {
      const selected = finaleSelection(gender, points);
      return `<div class="al-field">${label(`al-finale-${gender}-${String(points).replace('.', '-')}`, caption)}
        <select id="al-finale-${gender}-${String(points).replace('.', '-')}" data-al-finale="${gender}:${points}"${disabled(locked || !supported)}>
          ${option('', 'Choose roster player', selected)}
          ${finalePlayers(gender).map(player => option(player.id, `${player.display_name} · ${state.teams.find(team => team.player_ids.includes(player.id))?.name || 'Unassigned'}`, selected)).join('')}
        </select></div>`;
    };
    return `<div class="al-callout">
      <h4>20:00 · Last Man / Last Woman Standing · max 10 minutes</h4>
      <p class="al-small">Save the finale awards before finalizing: each winner receives +1 BP and each runner-up +0.5 BP. Only admins can assign these awards.</p>
      ${supported ? `<div class="al-grid">
        ${select('male', 1, 'Last Man winner · +1 BP')}
        ${select('male', 0.5, 'Last Man runner-up · +0.5 BP')}
        ${select('female', 1, 'Last Woman winner · +1 BP')}
        ${select('female', 0.5, 'Last Woman runner-up · +0.5 BP')}
      </div>` : '<p class="al-notice">This training’s BP rules do not support +1 / +0.5. Set the season BP maximum to at least 1 and use a step that includes 0.5 before generating the training.</p>'}
    </div>`;
  }

  function setFinaleAward(specification, playerId) {
    const [gender, pointsText] = String(specification).split(':');
    const points = Number(pointsText);
    if (!['male', 'female'].includes(gender) || ![0.5, 1].includes(points)) {
      throw new Error('Invalid finale award control.');
    }
    const eligible = finalePlayers(gender);
    eligible.filter(player => Number(state.bonusAwards[player.id] || 0) === points)
      .forEach(player => { state.bonusAwards[player.id] = 0; });
    if (playerId) {
      const player = eligible.find(candidate => candidate.id === playerId);
      if (!player) throw new Error('Choose an eligible roster player for this finale award.');
      state.bonusAwards[player.id] = points;
    }
    state.dirtyBonus = [...state.selected].some(id =>
      String(state.bonusAwards[id] ?? 0) !== String(savedBonus()[id] || 0));
  }

  function renderBonus() {
    const e = event();
    const rules = bonusSettings();
    return `<section class="al-card" id="al-bonus"><h3>Bonus points (BP) · admin only</h3>
      <p class="al-muted">Individual awards for this training, added to each player’s season total when results are finalized. Head Refs cannot award BP.</p>
      ${!e ? '<p class="al-empty">Generate a draft first to award BP.</p>' : `
        <p class="al-callout">Saved training rules: maximum <strong>${rules.max} BP</strong> per player, in <strong>${rules.step} BP</strong> steps. Later Season 2 setting changes do not alter this training.</p>
        ${e.status === 'finalized' ? `<p class="al-notice">Finalized BP are read-only. Reopen results before editing; finalize again when corrections are complete.</p>${action('reopen-results', 'Reopen results to correct BP', disabled(cancelled()))}` : ''}
        ${e.schedule?.referee_policy ? finaleAwardsPanel(cancelled() || e.status === 'finalized', rules) : ''}
        <div class="al-field">${label('al-bonus-search', 'Find a player to award BP')}<input type="search" id="al-bonus-search" value="${esc(state.bonusSearch)}" placeholder="Filter this roster"></div>
        <form data-al-form="bonus">
          <div class="al-bonus-list" id="al-bonus-list">${bonusRows()}</div>
          <p class="al-small">0 means no award. Saving replaces the complete BP list, including players hidden by the filter. It never adds the same award twice.</p>
          <p class="al-dirty" id="al-bonus-dirty"${state.dirtyBonus ? '' : ' hidden'}>Unsaved bonus points — save or discard before finalizing.</p>
          <div class="al-actions"><button class="al-button" type="submit" id="al-bonus-save"${disabled(cancelled() || e.status === 'finalized' || !state.dirtyBonus)}>Save bonus points</button>
          ${action('discard-bonus', 'Discard BP edits', ` id="al-bonus-discard"${disabled(!state.dirtyBonus)}`)}</div>
        </form>`}
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
    const mode = $('al-season-scoring').value;
    if (values.some(value => !value) || points.length > 100 ||
      points.some((point, i) => !Number.isFinite(point) || point < 0 || point > 10000 ||
        (mode !== 'beaten' && i && point > points[i - 1]))) {
      $('al-season-awards').textContent = mode === 'beaten'
        ? 'Enter valid non-negative participation and per-team values to preview.'
        : 'Enter valid descending or equal placement awards to preview.';
      return;
    }
    const step = Number($('al-season-step').value);
    if (mode === 'beaten' && points.length !== 2) {
      $('al-season-awards').textContent = 'Teams-beaten mode requires exactly two values: participation points, then points per team beaten.';
      return;
    }
    if (mode !== 'fixed' && points.some(point => Math.abs(point / step - Math.round(point / step)) >= 1e-8)) {
      $('al-season-awards').textContent = `Calculated scoring values must be multiples of ${step}. Edit the values or choose a finer increment.`;
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
    const description = rules.scoring_mode === 'beaten'
      ? `${rules.placement_points[0]} participation + ${rules.placement_points[1]} per team beaten`
      : rules.scoring_mode === 'relative' ? `relative rules · rounded to ${rules.points_step}` : 'fixed awards';
    return `<p class="al-callout">This training’s saved ${description}: <strong>${placementAwards(rules, state.teams.length).join(' / ')}</strong> points per player, from first place to last.</p>`;
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

  function renderLatePlayerAssignment() {
    const e = event();
    if (!e || cancelled() || !['published', 'finalized'].includes(e.status)) return '';
    const assigned = new Set(state.teams.flatMap(team => team.player_ids));
    const available = players().filter(player => !player.uncreated && !assigned.has(player.id));
    const finalized = e.status === 'finalized';
    return `<div class="al-late-player" id="al-late-player">
      <h4>Last-minute player</h4>
      <p class="al-small">${finalized
        ? 'Add a player who was omitted from the saved result. Their chosen team placement is applied immediately, and this training’s points and private ELO ledger are atomically recalculated without double-counting.'
        : 'Assign a late arrival without changing the published fixtures or any saved match scores. They receive the chosen team’s placement when results are finalized.'}</p>
      <form data-al-form="late-player" class="al-late-player-form">
        <div class="al-field">${label('al-late-player-select', 'Player')}
          <select id="al-late-player-select" name="player_id" required${disabled(!available.length)}>
            ${option('', available.length ? 'Choose player' : 'No unassigned profiles', '')}
            ${available.map(player => option(player.id, player.display_name, '')).join('')}
          </select></div>
        <div class="al-field">${label('al-late-team-select', 'Team')}
          <select id="al-late-team-select" name="team_number" required>
            ${option('', 'Choose team', '')}
            ${state.teams.map(team => option(team.number, `${team.name} · ${team.player_ids.length} players`, '')).join('')}
          </select></div>
        <button type="submit" class="al-button"${disabled(!available.length)}>Assign player to team</button>
      </form>
      <div class="al-actions">${action('open-late-guest', 'Create a new guest profile')}</div>
    </div>`;
  }

  function renderResults() {
    const e = event();
    const enabled = e && !cancelled() && ['published', 'finalized'].includes(e.status);
    const scheduled = !!e?.schedule;
    const finished = !scheduled || !!e.match_standings?.complete;
    const finalizedSchedule = e?.status === 'finalized';
    const winner = e?.status === 'finalized' ? e.teams.find(team => Number(team.placement) === 1) :
      scheduled && finished ? state.teams.find(team => {
        const choices = allowedPlaces(team.number);
        return choices.length === 1 && choices[0] === 1;
      }) : null;
    return `<section class="al-card" id="al-results" tabindex="-1">${heading('', e?.status === 'finalized' ? 'Final results & corrections' : 'Review & finalize placements')}
      <p class="al-muted">${scheduled ? 'Final places follow match-table points, score difference and points scored. Non-tied places are filled automatically. Only teams exactly tied on all three metrics can be reordered within their shared places.' : `Manual-placement training: use each place from 1 to ${state.teams.length || 'the number of teams'} exactly once. For automatic placements from scores, generate a schedule before publishing.`}</p>
      ${renderLatePlayerAssignment()}
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
    stopDrag();
    const draftFixtures = event()?.status === 'draft';
    const content = {
      players: renderRoster(), teams: renderDraft(),
      schedule: renderSchedule() + (draftFixtures ? `<details class="al-details al-toolbox al-fixture-preview" id="al-fixture-preview"${state.fixturePreviewOpen ? ' open' : ''}>
        <summary>Preview generated fixtures${event()?.schedule ? ` · ${allMatches().length} matches` : ''}</summary>${renderMatches()}</details>` : ''),
      publish: renderPublish(),
      results: (draftFixtures ? '' : renderMatches()) + renderBonus() + renderResults()
    };
    $('al-app').innerHTML = `<fieldset id="al-workspace"${disabled(state.busy || state.conflict)}>
      <legend class="al-sr-only">Imperials Social League administration</legend>
      ${renderSetup()}
      <div class="al-flow-context" id="al-flow-context" role="status">${workflowContext()}</div>
      <nav aria-label="League administration steps"><ol class="al-steps">
        ${stages.map((stage, index) => `<li><button type="button" class="al-button al-secondary" id="al-step-${stage.id}"
          data-al-action="stage:${stage.id}" aria-controls="al-stage-${stage.id}" aria-current="${state.stage === stage.id ? 'step' : 'false'}">${index + 1} · ${stage.title}</button></li>`).join('')}
      </ol></nav>
      ${stages.map((stage, index) => `<section data-al-stage="${stage.id}" id="al-stage-${stage.id}" aria-labelledby="al-stage-title-${stage.id}"${state.stage === stage.id ? '' : ' hidden'}>
        <h2 id="al-stage-title-${stage.id}" class="al-stage-title" tabindex="-1">${index + 1} · ${stage.title}</h2>
        <p class="al-muted">${stage.hint}</p>${content[stage.id]}
        <div class="al-actions al-stage-actions">
          ${index ? action(`stage:${stages[index - 1].id}`, `Back: ${stages[index - 1].title}`) : ''}
          ${index < stages.length - 1 ? `<button type="button" class="al-button${stageReady(stage.id) ? '' : ' al-secondary'}"
            data-al-action="stage:${stages[index + 1].id}">Continue: ${stages[index + 1].title}</button>` : ''}
        </div>
      </section>`).join('')}
    </fieldset>`;
    restoreFormEdits();
  }

  function workflowContext() {
    const e = event();
    const training = session();
    return `<strong>${training ? `Thu ${esc(dateOnly(training.session_date))}` : 'Select a Thursday'}</strong>
      <span>${esc(String(training?.start_time || '').slice(0, 5))}–${esc(String(training?.end_time || '').slice(0, 5))}</span>
      <span>${state.selected.size} players · ${state.teams.length} teams</span>
      <span>${esc(cancelled() ? 'Cancelled' : e?.status || 'Not generated')}${e ? ` · v${number(e.version, 0)}` : ''}${hasChanges() ? ' · Unsaved edits' : ''}</span>`;
  }

  function stageReady(id) {
    if (id === 'players') return !!session() && !cancelled() && state.selected.size > 0;
    if (id === 'teams') return !!event() && !state.dirtyTeams && !needsRosterReview() && !rosterPublishWarning();
    if (id === 'schedule') return !!event() && !state.dirtySchedule && (!!event().schedule || state.manualPlacements);
    return ['published', 'finalized'].includes(event()?.status);
  }

  function showStage(id, focus = true) {
    if (!stages.some(stage => stage.id === id)) throw new Error('Unknown league administration step.');
    state.stage = id;
    for (const stage of stages) {
      $(`al-stage-${stage.id}`).hidden = stage.id !== id;
      $(`al-step-${stage.id}`).setAttribute('aria-current', stage.id === id ? 'step' : 'false');
    }
    if (focus) $(`al-stage-title-${id}`)?.focus();
  }

  function focusInFlow(id) {
    const target = $(id);
    const panel = target?.closest('[data-al-stage]');
    if (panel) showStage(panel.dataset.alStage, false);
    target?.focus();
  }

  function restoreFormEdits() {
    root.querySelectorAll('form[data-al-form]').forEach(form => {
      const edits = state.formEdits[formKey(form)];
      if (!edits) return;
      for (const field of form.elements) {
        if (!(field.name in edits)) continue;
        if (field.type === 'checkbox') field.checked = edits[field.name];
        else field.value = edits[field.name];
      }
    });
    if (state.formEdits['season:']) updateScoringPreview();
  }

  function formKey(form) {
    return `${form.dataset.alForm}:${form.dataset.alForm === 'profile' || form.dataset.alForm === 'link' ? state.profileId : ''}`;
  }

  function rememberFormInput(input) {
    const form = input.closest('form[data-al-form]');
    if (!form || !['season', 'profile', 'guest', 'link'].includes(form.dataset.alForm) || !input.name) return;
    const key = formKey(form);
    if (!state.formEdits[key]) state.formEdits[key] = {};
    state.formEdits[key][input.name] = input.type === 'checkbox' ? input.checked : input.value;
  }

  function updateRoster() {
    $('al-roster-list').innerHTML = rosterRows();
    updateDraftControls();
  }

  function updateDraftControls() {
    if ($('al-flow-context')) $('al-flow-context').innerHTML = workflowContext();
    if ($('al-publication-checklist')) $('al-publication-checklist').innerHTML = publicationChecklist();
    if ($('al-publish-progress')) {
      const checks = publicationChecks();
      $('al-publish-progress').innerHTML = `<strong>${checks.filter(check => check.ready).length}/${checks.length} checks ready</strong> · Any remaining blocker is shown below.`;
    }
    $('al-roster-count').textContent = `${state.selected.size} players selected · ${state.attending.size} RSVP attending`;
    $('al-plan').textContent = planText();
    $('al-dirty-roster').hidden = !needsRosterReview();
    $('al-generate').disabled = isLocked() || session()?.is_cancelled || !state.sessionId || state.selected.size < minimumRoster() || state.selected.size > 500;
    const save = $('al-save-teams');
    if (save) save.disabled = isLocked() || (!state.dirtyTeams && !needsRosterReview());
    const publish = $('al-publish-button');
    if (publish) publish.disabled = !event() || isLocked() || state.dirtyTeams || state.dirtySchedule || needsRosterReview() || !!publishWarning();
    if ($('al-publish-warning')) {
      $('al-publish-warning').textContent = publishWarning();
      $('al-publish-warning').hidden = !publishWarning();
    }
    if ($('al-schedule-fields')) $('al-schedule-fields').disabled = !event() || isLocked() || state.dirtyTeams || needsRosterReview();
    if ($('al-undo-draft')) $('al-undo-draft').disabled = !state.draftUndo.length;
  }

  function markTeamDirty() {
    state.dirtyTeams = true;
    $('al-dirty-teams').hidden = false;
    root.querySelector('[data-al-action="discard-teams"]').disabled = false;
    updateDraftControls();
  }

  async function changeSelection(value) {
    if (!sessions().some(s => s.id === value)) throw new Error('Choose a Thursday within Season 2.');
    if (hasChanges() && !window.confirm('Switch training and discard all unsaved roster, team, BP, result and form edits?')) {
      $('al-session-select').value = state.sessionId;
      return;
    }
    clearNotice();
    setBusy(true, 'Loading this training’s roster…');
    state.formEdits = {};
    state.sessionId = value;
    try { await loadRoster(); render(); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
    $('al-session-select')?.focus();
  }

  function validateTeams() {
    const ids = state.teams.flatMap(t => t.player_ids);
    if (new Set(ids).size !== ids.length || ids.length !== state.selected.size || ids.some(id => !state.selected.has(id))) {
      throw new Error('Assign every selected player to exactly one team before saving. Use “Move selected player here” for unassigned players.');
    }
    if (state.teams.length < 2 || state.teams.length > 5) throw new Error('Use two to five teams.');
    if (![2, 3, 4, 5, 6].includes(draftSize())) throw new Error('Choose an on-court size from 2 to 6.');
    if (state.teams.some(t => !t.name.trim())) throw new Error('Give every team a visible public name before saving.');
  }

  function rememberDraft() {
    state.draftUndo.push({
      teams: state.teams.map(t => ({ ...t, player_ids: [...t.player_ids] })),
      selected: [...state.selected], size: state.size, dirtyTeams: state.dirtyTeams, dirtyRoster: state.dirtyRoster
    });
    if (state.draftUndo.length > 30) state.draftUndo.shift();
  }

  function changeRoster(ids) {
    rememberDraft();
    state.selected = new Set(ids);
    state.teams.forEach(t => { t.player_ids = t.player_ids.filter(id => state.selected.has(id)); });
    state.dirtyRoster = true;
    if (event()) state.dirtyTeams = true;
    if (!state.selected.has(state.pickedPlayer)) state.pickedPlayer = '';
  }

  function playerHandle(p) {
    return `<button type="button" class="al-player-handle" data-al-action="pick-player:${esc(p.id)}" data-al-handle="${esc(p.id)}" aria-pressed="${state.pickedPlayer === p.id}" aria-describedby="al-drag-help" aria-label="Select or drag ${esc(p.display_name)} to move or swap">↕</button>`;
  }

  function updatePickedPlayer() {
    root.querySelectorAll('[data-al-handle]').forEach(handle => {
      handle.setAttribute('aria-pressed', String(handle.dataset.alHandle === state.pickedPlayer));
    });
    root.querySelectorAll('[data-al-place-team]').forEach(button => { button.disabled = !state.pickedPlayer; });
    if ($('al-drag-status')) $('al-drag-status').textContent = state.pickedPlayer
      ? `${teamPlayer(state.pickedPlayer).display_name} selected. Choose another player to swap, or a team destination to move. Escape cancels.`
      : 'No player selected for a move or swap.';
  }

  function editLineup(playerId, { secondId, teamNumber } = {}) {
    if (state.busy || state.conflict || isLocked() || !event()) return;
    if (!state.selected.has(playerId)) throw new Error('Choose a player in this training roster.');
    const source = state.teams.find(t => t.player_ids.includes(playerId));
    const destination = secondId ? state.teams.find(t => t.player_ids.includes(secondId)) :
      state.teams.find(t => String(t.number) === String(teamNumber));
    if (!destination) throw new Error('Choose an assigned player to swap with, or a destination team.');
    if (source === destination) throw new Error('Choose a different team or a player on another team.');
    if (secondId && !source) throw new Error('Move an unassigned player to a team first. Use a team destination, not a swap.');
    rememberDraft();
    if (secondId) {
      source.player_ids[source.player_ids.indexOf(playerId)] = secondId;
      destination.player_ids[destination.player_ids.indexOf(secondId)] = playerId;
    } else {
      if (source) source.player_ids = source.player_ids.filter(id => id !== playerId);
      destination.player_ids.push(playerId);
    }
    state.dirtyTeams = true;
    state.pickedPlayer = '';
    render();
    focusInFlow('al-save-teams');
    $('al-progress').textContent = secondId ? 'Players swapped locally. Save draft when ready.' : 'Player moved locally. Save draft when ready.';
  }

  function adjustTeams(swap) {
    const playerId = $('al-move-player').value;
    const secondId = $('al-swap-player').value;
    if (swap && !secondId) throw new Error('Choose the second player to swap with.');
    editLineup(playerId, swap ? { secondId } : { teamNumber: $('al-move-team').value });
  }

  async function prepareProfiles() {
    const uncreated = players().filter(p => p.uncreated && state.selected.has(p.id));
    for (const p of uncreated) {
      const oldId = p.id;
      const ok = await write('save_player', {
        user_id: p.user_id, gender: p.gender, is_rookie: p.is_rookie, initial_rating: p.initial_rating
      }, { preserve: true, message: `League profile ready for ${p.display_name}.` });
      if (!ok) return false;
      const created = state.data.players.find(profile => profile.user_id === p.user_id);
      if (!created) throw new Error('A member league profile was not returned. Refresh before generating teams.');
      state.selected.delete(oldId);
      state.selected.add(created.id);
      state.teams.forEach(t => { t.player_ids = t.player_ids.map(id => id === oldId ? created.id : id); });
    }
    return true;
  }

  async function generate() {
    if (!season() || !state.sessionId || isLocked()) throw new Error('Choose an editable Season 2 Thursday first.');
    if (state.selected.size < minimumRoster() || state.selected.size > 500) throw new Error(`Select ${minimumRoster()}–500 players for this team size.`);
    if (!Number.isInteger(state.maxTeams) || state.maxTeams < 2 || state.maxTeams > 5) throw new Error('Choose a maximum of two to five squads.');
    if (event() && !window.confirm(`Rebalance this draft? Team names and all assignments will be replaced. To keep other players in place, cancel and use Save draft instead.${event().schedule || state.dirtySchedule ? ' The saved schedule and timing edits will be cleared.' : ''}`)) return;
    if (!await prepareProfiles()) return;
    await write('generate', {
      season_id: state.seasonId, session_id: state.sessionId, team_size: state.size === 'auto' ? 'auto' : Number(state.size),
      ...(event() ? { version: event().version } : {}),
      player_ids: [...state.selected], max_teams: state.maxTeams
    }, { message: 'Balanced draft saved. Review teams, plan matches, then publish.', stage: 'teams', focus: 'al-stage-title-teams' });
  }

  async function handleAction(name) {
    if (name === 'reload') { await reload(); return; }
    if (state.busy || state.conflict || !state.loaded) return;
    if (name.startsWith('stage:')) { showStage(name.slice('stage:'.length)); return; }
    clearNotice();
    if (/^(pick-player:|place-player:|remove-player:)/.test(name)) {
      if (isLocked() || !event()) return;
      const id = name.slice(name.indexOf(':') + 1);
      if (name.startsWith('remove-player:')) {
        if (!state.selected.has(id)) return;
        changeRoster(new Set([...state.selected].filter(playerId => playerId !== id)));
        render();
        focusInFlow('al-undo-draft');
        $('al-progress').textContent = `${playerFor(id).display_name} removed from this draft only. Account/profile unchanged. Undo or Save draft.`;
      } else if (name.startsWith('place-player:')) {
        editLineup(state.pickedPlayer, { teamNumber: id });
      } else if (state.pickedPlayer && state.pickedPlayer !== id) {
        editLineup(state.pickedPlayer, { secondId: id });
      } else {
        state.pickedPlayer = state.pickedPlayer === id ? '' : id;
        updatePickedPlayer();
      }
      return;
    }
    if (name.startsWith('discard-match:')) {
      const matchNumber = name.slice('discard-match:'.length);
      delete state.matchEdits[matchNumber];
      render();
      focusInFlow(`al-score-${matchNumber}-a`);
      return;
    }
    switch (name) {
      case 'add-rsvp':
        if (isLocked() || state.attendanceError) return;
        changeRoster(new Set([...state.selected, ...state.attending])); render(); break;
      case 'rsvp':
        if (isLocked() || state.attendanceError) return;
        if (state.selected.size && !window.confirm('Replace the current selection with attending member RSVPs? Manually selected guests or other members will be unchecked.')) return;
        changeRoster(state.attending); render(); break;
      case 'clear-roster':
        if (isLocked()) return;
        if (state.selected.size && !window.confirm('Remove everyone from this local draft roster? No account or profile is deleted. The saved lineup stays unchanged until Save draft.')) return;
        changeRoster(new Set()); render(); break;
      case 'open-late-guest':
        if (cancelled() || !['published', 'finalized'].includes(event()?.status)) return;
        state.guestOpen = true;
        render();
        focusInFlow('al-guest-details');
        break;
      case 'retry-rsvp':
        setBusy(true, 'Refreshing RSVPs and saved league data…');
        try { await loadData({ preserve: true }); render(); }
        catch (error) { showError(error, error.status === 409); }
        finally { setBusy(false); }
        break;
      case 'generate': await generate(); break;
      case 'discard-schedule':
        state.scheduleSettings = savedScheduleSettings();
        state.dirtySchedule = false; render(); break;
      case 'delete-schedule': {
        const current = event();
        if (!current?.schedule || !['draft', 'published'].includes(current.status)) return;
        if (lineupStarted()) throw new Error('A schedule cannot be deleted after a score was saved or results were finalized.');
        if (state.dirtySchedule || state.dirtyTeams || state.dirtyRoster || state.dirtyBonus
          || state.dirtyResults || Object.keys(state.matchEdits).length) {
          throw new Error('Save or discard all local lineup, timing, BP and score edits before deleting the schedule.');
        }
        const published = current.status === 'published';
        if (!window.confirm(`${published ? 'Delete this published schedule and hide the matchday?' : 'Delete this saved schedule?'} Timer state is removed too. The teams remain in a private draft so you can create and publish a replacement.`)) return;
        await write('delete_schedule', { event_id: current.id, version: current.version }, {
          message: 'Schedule deleted. Teams remain in a private draft; create a new schedule and publish again.',
          focus: 'al-schedule-heading'
        });
        break;
      }
      case 'swap': if (!isLocked()) adjustTeams(true); break;
      case 'move': if (!isLocked()) adjustTeams(false); break;
      case 'undo-draft': {
        if (isLocked()) return;
        const prior = state.draftUndo.pop();
        if (!prior) return;
        Object.assign(state, { ...prior, selected: new Set(prior.selected), pickedPlayer: '' });
        render(); focusInFlow('al-save-teams'); break;
      }
      case 'discard-teams':
        if (isLocked() || !event()) return;
        if (!window.confirm('Discard all local draft changes, including roster removals/additions, names, swaps and moves? Restore the saved roster and teams without changing accounts or profiles.')) return;
        state.teams = event().teams.map(t => ({ number: t.number, name: t.name, placement: t.placement, player_ids: t.players.map(p => p.id) }));
        state.selected = new Set(state.teams.flatMap(t => t.player_ids));
        state.size = String(event().team_size);
        state.dirtyTeams = false; state.dirtyRoster = false; state.draftUndo = []; state.pickedPlayer = ''; render(); break;
      case 'save-draft':
        if (isLocked() || !event()) return;
        validateTeams();
        if (state.dirtySchedule) throw new Error('Generate or discard your unsaved timing edits before saving a lineup change.');
        if (event().schedule && !window.confirm('Save these lineup changes? This can clear the match schedule. Generate the schedule again before republishing.')) return;
        if (!await prepareProfiles()) return;
        await write('save_draft', { event_id: event().id, version: event().version, team_size: draftSize(), teams: state.teams.map(t => ({ number: t.number, name: t.name.trim(), player_ids: t.player_ids })) },
          { message: 'Draft saved without rebalancing. Check the roster warning before publishing.' });
        break;
      case 'publish':
        if (!event() || isLocked() || needsRosterReview() || state.dirtyTeams || state.dirtySchedule) return;
        validateTeams();
        if (publishWarning()) throw new Error(publishWarning());
        if (!window.confirm(`Publish ${state.teams.length} teams and ${state.selected.size} player names publicly, including named guests? Let guests know their names will be public. Ratings, gender and rookie tags remain admin-only.`)) return;
        await write('publish', { event_id: event().id, version: event().version }, {
          message: 'Teams are now public. Record scores in Results.', stage: 'results', focus: 'al-stage-title-results'
        });
        break;
      case 'unpublish':
        if (event()?.status !== 'published' || cancelled()) return;
        if (lineupStarted()) throw new Error('The lineup cannot be reopened after a match score or finalized results. Correct scores instead; players and teams remain locked.');
        if (Object.keys(state.matchEdits).length) throw new Error('Save or discard your unsaved match score edits before reopening the lineup.');
        if (state.dirtyResults && !window.confirm('Discard unsaved final placements and reopen the lineup?')) return;
        if (!window.confirm('Edit published teams? This immediately hides teams from the public and returns them to a draft. After editing, you must publish again.')) return;
        await write('unpublish', { event_id: event().id, version: event().version }, { message: 'Lineup is now a private draft. Republish after editing.', stage: 'teams', focus: 'al-generate' });
        break;
      case 'reopen-results':
        if (event()?.status !== 'finalized' || cancelled()) return;
        if (!window.confirm('Reopen this training’s results? Its previous season awards and rating adjustments will be temporarily removed. Match scores are retained and the roster stays locked. Correct scores or exact ties, then finalize again to restore updated awards.')) return;
        await write('reopen_results', { event_id: event().id, version: event().version }, {
          message: 'Results reopened. Previous awards removed temporarily; correct scores and finalize again.', focus: 'al-matches-heading'
        });
        break;
      case 'discard-bonus':
        state.bonusAwards = { ...savedBonus() };
        state.dirtyBonus = false; render(); focusInFlow('al-bonus-search'); break;
    }
  }

  async function submit(form) {
    if (state.busy || state.conflict || !form.reportValidity()) return;
    clearNotice();
    const data = new FormData(form);
    const type = form.dataset.alForm;
    const clearFormKey = formKey(form);
    if (cancelled() && ['schedule', 'match', 'results', 'bonus', 'late-player'].includes(type)) throw new Error('Cancelled training — read-only. Choose an active Thursday.');
    if (type === 'season') {
      const points = String(data.get('placement_points')).split(',').map(s => s.trim());
      const scoringMode = data.get('scoring_mode');
      const pointsStep = Number(data.get('points_step'));
      if (points.some(p => !p || !Number.isFinite(Number(p)) || Number(p) < 0)) throw new Error('Enter non-negative scoring values separated by commas, for example 1, 0.5.');
      if (points.length > 100 || points.some(p => Number(p) > 10000 || Math.round(Number(p) * 1e6) / 1e6 !== Number(p))) throw new Error('Use at most 100 placement awards, each between 0 and 10,000 with at most six decimal places.');
      if (scoringMode !== 'beaten' && points.some((p, i) => i > 0 && Number(p) > Number(points[i - 1]))) throw new Error('Placement points must stay the same or decrease from first place down.');
      if (String(data.get('start_date')) > String(data.get('end_date'))) throw new Error('The season end date must be on or after its start date.');
      if (!['beaten', 'relative', 'fixed'].includes(scoringMode) || ![0.1, 0.25, 0.5, 1].includes(pointsStep)) throw new Error('Choose a valid scoring mode and rounding step.');
      if (scoringMode === 'beaten' && points.length !== 2) {
        throw new Error('Teams-beaten mode requires exactly two values: participation points, then points per team beaten.');
      }
      if (scoringMode !== 'fixed' && points.some(point => Math.abs(Number(point) / pointsStep - Math.round(Number(point) / pointsStep)) >= 1e-8)) {
        throw new Error(`Calculated scoring values must be multiples of ${pointsStep}. Edit the values or choose a finer increment.`);
      }
      const id = String(data.get('id') || '');
      if (!season() || id !== season().id) throw new Error('Only the existing Season 2 settings can be edited here.');
      const bonusMax = Number(data.get('bonus_points_max'));
      const bonusStep = Number(data.get('bonus_points_step'));
      if (![0.1, 0.25, 0.5, 1].includes(bonusStep) || !Number.isFinite(bonusMax) || bonusMax < 0 || bonusMax > 10000 ||
        Math.abs(bonusMax / bonusStep - Math.round(bonusMax / bonusStep)) > 1e-8) {
        throw new Error('The BP maximum must be 0–10,000 and a multiple of the selected BP step.');
      }
      await write('save_season', {
        id, name: 'Season 2', start_date: data.get('start_date'), end_date: data.get('end_date'),
        placement_points: points.map(Number), scoring_mode: scoringMode, points_step: pointsStep,
        bonus_points_max: bonusMax, bonus_points_step: bonusStep,
        k_factor: Number(data.get('k_factor')),
        default_rating: Number(data.get('default_rating')), rookie_rating: Number(data.get('rookie_rating'))
      }, {
        preserve: true, message: 'Season 2 settings saved. Existing training snapshots are unchanged.',
        clearFormKey,
        focus: 'al-session-select'
      });
    } else if (type === 'bonus') {
      if (!event() || !['draft', 'published'].includes(event().status)) throw new Error('Reopen finalized results before changing bonus points.');
      if (state.dirtyTeams || state.dirtyRoster || state.dirtySchedule || state.dirtyResults || Object.keys(state.matchEdits).length) {
        throw new Error('Save or discard your draft, timing and result edits first. Your BP edits are kept.');
      }
      const rules = bonusSettings();
      validateFinaleAwards(false);
      const awards = [...state.selected].map(id => {
        const raw = String(state.bonusAwards[id] ?? 0).trim();
        const points = Number(raw);
        if (!raw || !Number.isFinite(points) || points < 0 || points > rules.max ||
          Math.abs(points / rules.step - Math.round(points / rules.step)) > 1e-8) {
          throw new Error(`${playerFor(id).display_name}: enter 0–${rules.max} BP in ${rules.step} steps.`);
        }
        return { player_id: id, points };
      });
      await write('save_bonus_points', { event_id: event().id, version: event().version, awards },
        { message: 'Bonus points saved for this training. Finalize results to update season totals.', focus: 'al-bonus-search' });
    } else if (type === 'schedule') {
      if (!event() || isLocked() || state.dirtyTeams || needsRosterReview()) throw new Error('Save a private draft with its final roster before generating the schedule.');
      const settings = {
        meetup_time: String(data.get('meetup_time') || ''),
        ...Object.fromEntries(['courts', 'match_minutes', 'break_minutes', 'warmup_minutes', 'available_minutes', 'finale_minutes']
          .map(key => [key, Number(data.get(key))]))
      };
      const estimate = scheduleEstimate(settings);
      if (estimate.duration > settings.available_minutes) throw new Error(`This round robin needs ${estimate.duration} minutes from meetup, but games must finish by minute ${settings.available_minutes}. Shorten games or changeovers.`);
      if (event().schedule && !window.confirm('Replace the saved schedule with these court and timing settings? Review the new fixtures before publishing.')) return;
      await write('generate_schedule', { event_id: event().id, version: event().version, ...settings }, {
        message: `Schedule saved: ${estimate.matches} match${estimate.matches === 1 ? '' : 'es'}, ${state.teams.length === 2 ? 'external Head Ref required' : 'one ref team per slot'}, games ending ${scheduleTime(estimate.duration, settings.meetup_time)}, then the Last Man/Woman finale.`,
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
    } else if (type === 'late-player') {
      const current = event();
      if (!current || !['published', 'finalized'].includes(current.status)) {
        throw new Error('Publish this training before assigning a last-minute player.');
      }
      if (state.dirtyTeams || state.dirtyRoster || state.dirtySchedule || state.dirtyBonus ||
        state.dirtyResults || Object.keys(state.matchEdits).length) {
        throw new Error('Save or discard all lineup, BP, score and placement edits before assigning a last-minute player.');
      }
      const playerId = String(data.get('player_id') || '');
      const teamNumber = Number(data.get('team_number'));
      const assigned = new Set(state.teams.flatMap(team => team.player_ids));
      const player = players().find(candidate => !candidate.uncreated && candidate.id === playerId && !assigned.has(candidate.id));
      const team = state.teams.find(candidate => candidate.number === teamNumber);
      if (!player) throw new Error('Choose an available player who is not already assigned.');
      if (!team) throw new Error('Choose the team the player joined.');
      const finalized = current.status === 'finalized';
      if (!window.confirm(`Assign “${player.display_name}” to “${team.name}”?\n\n${finalized
        ? 'This finalized training’s saved points and private ELO adjustments will be replaced once using the existing final places. No points are added twice.'
        : 'Published fixtures and saved match scores stay unchanged. The player will receive this team’s placement when the training is finalized.'}`)) return;
      await write('add_late_player', {
        event_id: current.id, version: current.version, player_id: player.id, team_number: team.number
      }, {
        clearFormKey,
        message: `${player.display_name} assigned to ${team.name}.${finalized ? ' Finalized awards were recalculated without duplication.' : ' Existing fixtures and scores were preserved.'}`,
        focus: 'al-late-player'
      });
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
        clearFormKey,
        after: result => ({ addPlayerId: type === 'guest' && state.sessionId && !isLocked() ? result.player?.id || result.player_id : undefined })
      });
      if (!state.conflict && type === 'guest') {
        const added = state.data.players.find(p => !oldIds.has(p.id) && !p.user_id && p.display_name === name);
        if (added && state.sessionId && !isLocked()) {
          if (!state.selected.has(added.id)) changeRoster(new Set([...state.selected, added.id]));
          state.guestOpen = false; render();
        }
      }
    } else if (type === 'link') {
      if (hasChanges() && !window.confirm('Linking refreshes profile IDs. Discard unsaved roster, team or result edits and continue?')) return;
      const p = playerFor(String(data.get('player_id')));
      const member = state.data.members.find(m => m.id === data.get('user_id'));
      if (!member) throw new Error('Choose a member account to link.');
      if (!window.confirm(`Link guest “${p.display_name}” to member “${member.display_name}”? Their persistent league stats will be connected to that account.`)) return;
      await write('link_player', { player_id: data.get('player_id'), user_id: data.get('user_id') }, { clearFormKey, message: 'Guest linked to member account; stats preserved.' });
    } else if (type === 'results') {
      if (event()?.status !== 'published') throw new Error('Publish this training, or reopen finalized results, before finalizing.');
      if (state.dirtyBonus) throw new Error('Save or discard bonus point edits before finalizing results.');
      if (event()?.schedule?.referee_policy) validateFinaleAwards(true);
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

  let drag = null;
  let dragFrame = null;
  let suppressPointerClickUntil = 0;

  function updateDragTarget() {
    if (!drag) return;
    const hit = document.elementFromPoint(drag.clientX, drag.clientY);
    const target = hit?.closest('[data-al-drop-player], [data-al-drop-team]');
    drag.target?.classList.remove('al-drop-target');
    drag.target = target && root.contains(target) ? target : null;
    drag.target?.classList.add('al-drop-target');
  }

  function scrollDuringDrag() {
    dragFrame = null;
    if (!drag?.moved) return;
    const edge = 64;
    const delta = drag.clientY < edge ? -14 : drag.clientY > window.innerHeight - edge ? 14 : 0;
    if (delta) {
      window.scrollBy({ top: delta, behavior: 'instant' });
      updateDragTarget();
    }
    dragFrame = window.requestAnimationFrame(scrollDuringDrag);
  }

  function stopDrag() {
    const current = drag;
    drag = null;
    if (dragFrame !== null) window.cancelAnimationFrame(dragFrame);
    dragFrame = null;
    if (!current) return;
    current.handle.classList.remove('al-dragging');
    current.target?.classList.remove('al-drop-target');
    if (current.handle.hasPointerCapture?.(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    updatePickedPlayer();
  }

  root.addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-al-handle]');
    if (!handle || !root.contains(handle) || e.button !== 0 || e.isPrimary === false ||
      state.busy || state.conflict || isLocked() || !event()) return;
    drag = { handle, playerId: handle.dataset.alHandle, pointerId: e.pointerId, x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, moved: false, target: null };
    handle.setPointerCapture?.(e.pointerId);
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.moved = true;
    drag.clientX = e.clientX;
    drag.clientY = e.clientY;
    e.preventDefault();
    drag.handle.classList.add('al-dragging');
    updateDragTarget();
    if (dragFrame === null && window.requestAnimationFrame) dragFrame = window.requestAnimationFrame(scrollDuringDrag);
    if ($('al-drag-status')) $('al-drag-status').textContent = `Dragging ${teamPlayer(drag.playerId).display_name}. Drop on a player to swap or a team to move; release outside to cancel.`;
  });
  root.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const current = drag;
    stopDrag();
    if (!current.moved) return;
    suppressPointerClickUntil = Date.now() + 600;
    e.preventDefault();
    if (!current.target) return;
    try {
      const secondId = current.target.dataset.alDropPlayer;
      if (secondId === current.playerId) return;
      editLineup(current.playerId, secondId ? { secondId } : { teamNumber: current.target.dataset.alDropTeam });
    } catch (error) { showError(error); }
  });
  const cancelDrag = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    suppressPointerClickUntil = Date.now() + 600;
    stopDrag();
  };
  root.addEventListener('pointercancel', cancelDrag);
  root.addEventListener('lostpointercapture', cancelDrag);
  root.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || (!drag && !state.pickedPlayer)) return;
    e.preventDefault();
    suppressPointerClickUntil = Date.now() + 600;
    stopDrag();
    state.pickedPlayer = '';
    updatePickedPlayer();
  });
  root.addEventListener('click', e => {
    const link = e.target.closest('a[href^="#al-"]');
    if (link && root.contains(link)) {
      const id = link.getAttribute('href').slice(1);
      const target = $(id);
      if (target?.closest('[data-al-stage]')) {
        e.preventDefault();
        const disclosure = target.closest('details');
        if (disclosure && !disclosure.open) disclosure.open = true;
        focusInFlow(id);
        target.scrollIntoView({ block: 'start' });
      }
      return;
    }
    const button = e.target.closest('[data-al-action]');
    if (e.detail > 0 && Date.now() < suppressPointerClickUntil && button?.dataset.alAction.startsWith('pick-player:')) {
      e.preventDefault();
      return;
    }
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
    if (input.dataset.alFinale && !cancelled() && ['draft', 'published'].includes(event()?.status)) {
      try {
        setFinaleAward(input.dataset.alFinale, input.value);
        render();
        $(`al-finale-${input.dataset.alFinale.replace(':', '-').replace('.', '-')}`)?.focus();
      } catch (error) { showError(error); }
      return;
    }
    rememberFormInput(input);
    if (input.id === 'al-season-points') updateScoringPreview();
    if (input.dataset.alSchedule) {
      state.scheduleSettings[input.dataset.alSchedule] = input.dataset.alSchedule === 'meetup_time'
        ? input.value : Number(input.value);
      state.dirtySchedule = true;
      updateSchedulePreview();
      updateDraftControls();
    }
    if (input.dataset.alBonus && !cancelled() && ['draft', 'published'].includes(event()?.status)) {
      state.bonusAwards[input.dataset.alBonus] = input.value;
      state.dirtyBonus = [...state.selected].some(id => String(state.bonusAwards[id] ?? 0) !== String(savedBonus()[id] || 0));
      $('al-bonus-dirty').hidden = !state.dirtyBonus;
      $('al-bonus-save').disabled = !state.dirtyBonus;
      $('al-bonus-discard').disabled = !state.dirtyBonus;
    }
    if (input.id === 'al-bonus-search') { state.bonusSearch = input.value; $('al-bonus-list').innerHTML = bonusRows(); }
    if (input.dataset.alMatch && event()?.status === 'published' && !futureTraining() && !cancelled()) {
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
    if (input.id === 'al-scorekeeper-search') {
      state.scorekeeperSearch = input.value;
      const holder = document.createElement('div');
      holder.innerHTML = scorekeeperRoles();
      $('al-role-list').replaceChildren(...holder.querySelector('#al-role-list').childNodes);
    }
    if (input.dataset.alTeamName && !isLocked()) {
      const team = state.teams.find(t => String(t.number) === input.dataset.alTeamName);
      if (team) {
        rememberDraft();
        team.name = input.value;
        $(`al-team-heading-${team.number}`).textContent = team.name || `Team ${team.number}`;
        markTeamDirty();
      }
    }
  });
  root.addEventListener('change', e => {
    if (state.busy || state.conflict) return;
    const input = e.target;
    rememberFormInput(input);
    if (['al-names-reviewed', 'al-referee-reviewed', 'al-manual-placements'].includes(input.id)) {
      if (isLocked()) return;
      if (input.id === 'al-names-reviewed') state.namesReviewed = input.checked;
      else if (input.id === 'al-referee-reviewed') state.refereeReviewed = input.checked;
      else state.manualPlacements = input.checked;
      updateDraftControls();
    } else if (input.id === 'al-season-scoring' || input.id === 'al-season-step') updateScoringPreview();
    else if (input.id === 'al-session-select') changeSelection(input.value).catch(error => showError(error));
    else if (input.dataset.alPlayer && !isLocked()) {
      const ids = new Set(state.selected);
      if (input.checked) ids.add(input.dataset.alPlayer);
      else ids.delete(input.dataset.alPlayer);
      changeRoster(ids);
      render();
      $(input.id)?.focus();
    } else if (input.id === 'al-selected-only') { state.selectedOnly = input.checked; updateRoster(); }
    else if (input.id === 'al-team-size' && !isLocked()) {
      rememberDraft(); state.size = input.value; state.dirtyRoster = true; render(); $('al-team-size')?.focus();
    }
    else if (input.id === 'al-max-teams' && !isLocked()) { state.maxTeams = Number(input.value); updateDraftControls(); }
    else if (input.dataset.alScorekeeper) {
      const member = state.data.members.find(m => m.id === input.dataset.alScorekeeper && eligibleScorekeeper(m));
      if (!member) { input.checked = false; return; }
      const enabled = input.checked;
      if (!window.confirm(`${enabled ? 'Grant' : 'Remove'} the permanent Head Ref role ${enabled ? 'for' : 'from'} ${member.display_name}? This controls match-score entry and the live match timer through the member's normal website login.`)) {
        input.checked = !!member.league_scorekeeper;
        return;
      }
      write('set_scorekeeper', { user_id: member.id, enabled }, { preserve: true, message: 'Head Ref role updated.' })
        .then(saved => { if (!saved) input.checked = !!member.league_scorekeeper; }).catch(error => {
          input.checked = !!member.league_scorekeeper; showError(error);
        });
    }
    else if (input.id === 'al-profile-select') {
      state.profileId = input.value; state.profilesOpen = true;
      const holder = document.createElement('div');
      holder.innerHTML = profileEditor();
      $('al-profile-editor').replaceChildren(...holder.querySelector('#al-profile-editor').childNodes);
      restoreFormEdits();
    } else if (input.id === 'al-guest-rookie') {
      const field = $('al-guest-rating');
      const regular = number(season()?.default_rating, 1000);
      const rookie = number(season()?.rookie_rating, 800);
      if ([regular, rookie].includes(Number(field.value))) {
        field.value = input.checked ? rookie : regular;
        rememberFormInput(field);
      }
    } else if (input.dataset.alPlacement) {
      state.dirtyResults = true;
      const team = state.teams.find(t => String(t.number) === input.dataset.alPlacement);
      if (team) team.placement = Number(input.value) || null;
      $(`al-award-${input.dataset.alPlacement}`).textContent = awardText(Number(input.value));
    }
  });
  root.addEventListener('toggle', e => {
    if (e.target.id === 'al-admin-options') state.adminOptionsOpen = e.target.open;
    if (e.target.id === 'al-timing-details') state.timingOpen = e.target.open;
    if (e.target.id === 'al-season-details') state.seasonOpen = e.target.open;
    if (e.target.id === 'al-profiles-details') state.profilesOpen = e.target.open;
    if (e.target.id === 'al-guest-details') state.guestOpen = e.target.open;
    if (e.target.id === 'al-roster-tools') state.rosterToolsOpen = e.target.open;
    if (e.target.id === 'al-team-options') state.teamOptionsOpen = e.target.open;
    if (e.target.id === 'al-team-tools' && state.teamToolsOpen !== e.target.open) {
      state.teamToolsOpen = e.target.open;
      render();
    }
    if (e.target.id === 'al-fixture-preview') state.fixturePreviewOpen = e.target.open;
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
