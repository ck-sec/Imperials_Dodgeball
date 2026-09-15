/* Standalone public matchday. Drafts stay local; only a game's submit button writes scores. */
(function () {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DRAFT_KEY = 'vi_matchday_drafts';
  const text = {
    de: {
      title: 'Spieltag', choose: 'Spieltag auswählen', empty: 'Noch kein Donnerstag-Spieltag freigegeben.',
      loading: 'Wird aktualisiert …', live: 'Aktualisiert um', automatic: 'Automatisch alle 15 Sekunden',
      paused: 'Automatische Aktualisierung pausiert', network: 'Verbindung unterbrochen. Bitte erneut aktualisieren.',
      invalidLink: 'Ungültiger Spieltag-Link. Der aktuelle Spieltag wird angezeigt.',
      notFound: 'Dieser Spieltag ist nicht veröffentlicht oder nicht mehr verfügbar.',
      pending: 'Ausstehend', provisional: 'Vorläufig', finalized: 'Abgeschlossen',
      future: 'Ergebnisse können erst am Trainingstag eingetragen werden.',
      finalReadOnly: 'Abgeschlossen · Ergebnisse sind schreibgeschützt.',
      publicReadOnly: 'Öffentliche Ansicht · Head Refs melden sich mit ihrem normalen Konto an.',
      scoring: 'Ergebnisse pro Spiel speichern. Korrekturen sind bis zum Abschluss möglich.',
      noSchedule: 'Noch kein Spielplan freigegeben.', round: 'Runde', court: 'Feld', game: 'Spiel',
      bye: 'Pause', refTeam: 'Ref-Team', externalRef: 'Externer Head Ref / Admin',
      score: 'Punkte', save: 'Speichern', saving: 'Wird gespeichert …', saved: 'Gespeichert',
      program: 'Ablauf', meetWarmup: 'Treffpunkt & Aufwärmen', gamesWindow: 'Ligaspiele',
      finale: 'Last Man / Last Woman Standing', finaleAwards: 'Sieger +1 BP · Zweite +0,5 BP',
      finaleResults: 'Finale-Ergebnisse', winner: 'Sieger', runnerUp: 'Zweiter Platz',
      men: 'Last Man Standing', women: 'Last Woman Standing',
      unsaved: 'Nicht gespeichert', invalidScore: 'Beide Ergebnisse als ganze Zahlen von 0 bis 999 eingeben.',
      conflict: 'Inzwischen geändert. Deine Eingaben bleiben erhalten. Bitte aktuelle Ergebnisse prüfen.',
      unknownSave: 'Keine Speicherbestätigung. Bitte aktuelle Ergebnisse prüfen, bevor du erneut speicherst.',
      currentScore: 'Aktuell auf dem Server', loadLatest: 'Aktuellen Stand laden',
      useCurrent: 'Aktuelle Werte übernehmen', keepDraft: 'Meine Eingaben behalten',
      review: 'Erst vergleichen, dann bewusst übernehmen oder erneut speichern.',
      scheduleChanged: 'Der Spielplan wurde geändert. Ungespeicherte Eingaben bleiben sichtbar, bis du die aktuellen Werte übernimmst.',
      fixtureChanged: 'Spielplan geändert · Dieses Spiel ist bis zur aktualisierten Anzeige schreibgeschützt.',
      signIn: 'Ergebnisse eintragen', admin: 'Admin · angemeldet', scorekeeper: 'Head Ref · angemeldet',
      member: 'Mitglied · angemeldet',
      expired: 'Sitzung abgelaufen. Bitte erneut anmelden. Deine Eingaben bleiben erhalten.',
      restored: 'Sitzung erneuert. Bitte prüfen und erneut speichern.',
      forbidden: 'Keine Schreibberechtigung. Admins ernennen Head Refs; nur Head Refs und Admins können Ergebnisse ändern.',
      pendingApproval: 'Dein Konto wartet auf Freischaltung.',
      draftRestored: 'Ungespeicherte Eingaben wiederhergestellt. Bitte vor dem Speichern prüfen.',
      draftNewTab: 'Anmeldung in einem neuen Tab öffnen. Deine Eingaben bleiben hier erhalten.',
      retry: 'Bitte erneut versuchen in', seconds: 'Sekunden.', noStandings: 'Noch keine Saisonpunkte.',
      noResults: 'Keine Spieler gefunden.', copied: 'Spieltag-Link kopiert.',
      saveFailed: 'Nicht gespeichert. Bitte Eingaben prüfen und erneut versuchen.',
      otherDrafts: 'Ungespeicherte Eingaben auf einem anderen Spieltag bleiben in diesem Tab erhalten.',
      viewTimer: 'Live-Timer ansehen', startTimer: 'Spiel starten · Timer',
      itineraryPosterCreate: 'Spielplan-Bild', itineraryPosterShare: 'Spielplan teilen',
      resultsPosterCreate: 'Ergebnis-Bild', resultsPosterShare: 'Ergebnisse teilen', posterCreating: 'Bild wird gestaltet …',
      posterReady: 'Bild heruntergeladen und zum Teilen bereit. Tippe erneut auf „Bild teilen“.',
      posterDownloaded: 'Bild heruntergeladen.', posterShared: 'Bild zum Teilen geöffnet.',
      posterFailed: 'Das Bild konnte nicht erstellt werden. Bitte erneut versuchen.',
      posterChanged: 'Der Spieltag wurde während des Exports aktualisiert. Bitte das Bild erneut erstellen.',
      posterResultsUnavailable: 'Das Ergebnis-Bild ist nach dem Abschluss des Spieltags verfügbar.'
    },
    en: {
      title: 'Matchday', choose: 'Choose matchday', empty: 'No published Thursday matchday yet.',
      loading: 'Updating …', live: 'Updated at', automatic: 'Automatically every 15 seconds',
      paused: 'Automatic updates paused', network: 'Connection interrupted. Please refresh again.',
      invalidLink: 'Invalid matchday link. Showing the current matchday.',
      notFound: 'This matchday is unpublished or no longer available.',
      pending: 'Pending', provisional: 'Provisional', finalized: 'Finalized',
      future: 'Scores can be entered from the training day onwards.',
      finalReadOnly: 'Finalized · Scores are read-only.',
      publicReadOnly: 'Public view · Head Refs sign in with their normal account.',
      scoring: 'Save each game separately. Scores can be corrected until finalization.',
      noSchedule: 'No published schedule yet.', round: 'Round', court: 'Court', game: 'Game',
      bye: 'Rest', refTeam: 'Ref team', externalRef: 'External Head Ref / admin',
      score: 'Score', save: 'Save', saving: 'Saving …', saved: 'Saved',
      program: 'Itinerary', meetWarmup: 'Meet & warm-up', gamesWindow: 'League games',
      finale: 'Last Man / Last Woman Standing', finaleAwards: 'Winner +1 BP · runner-up +0.5 BP',
      finaleResults: 'Finale results', winner: 'Winner', runnerUp: 'Runner-up',
      men: 'Last Man Standing', women: 'Last Woman Standing',
      unsaved: 'Unsaved', invalidScore: 'Enter both scores as whole numbers from 0 to 999.',
      conflict: 'Changed elsewhere. Your entries are safe. Please review the current scores.',
      unknownSave: 'No save confirmation. Check the current scores before saving again.',
      currentScore: 'Current server score', loadLatest: 'Load latest scores',
      useCurrent: 'Use current scores', keepDraft: 'Keep my entries',
      review: 'Compare first, then choose the current scores or save your entries again.',
      scheduleChanged: 'The schedule changed. Unsaved entries remain visible until you choose the current scores.',
      fixtureChanged: 'Fixture changed · This game is read-only until the updated fixture is displayed.',
      signIn: 'Enter scores', admin: 'Admin · signed in', scorekeeper: 'Head Ref · signed in',
      member: 'Member · signed in',
      expired: 'Session expired. Sign in again. Your entries are safe.',
      restored: 'Session renewed. Please review and save again.',
      forbidden: 'No write permission. Admins appoint Head Refs; only Head Refs and admins can change scores.',
      pendingApproval: 'Your account is awaiting approval.',
      draftRestored: 'Unsaved entries restored. Please review before saving.',
      draftNewTab: 'Open sign-in in a new tab. Your entries remain safe here.',
      retry: 'Please try again in', seconds: 'seconds.', noStandings: 'No season points yet.',
      noResults: 'No players found.', copied: 'Matchday link copied.',
      saveFailed: 'Not saved. Please check your entries and try again.',
      otherDrafts: 'Unsaved entries on another matchday are kept in this tab.',
      viewTimer: 'View live timer', startTimer: 'Start game · timer',
      itineraryPosterCreate: 'Fixtures image', itineraryPosterShare: 'Share fixtures',
      resultsPosterCreate: 'Results image', resultsPosterShare: 'Share results', posterCreating: 'Designing image …',
      posterReady: 'Image downloaded and ready to share. Tap “Share image” again.',
      posterDownloaded: 'Image downloaded.', posterShared: 'Image sharing opened.',
      posterFailed: 'The image could not be created. Please try again.',
      posterChanged: 'The matchday changed during export. Please create the image again.',
      posterResultsUnavailable: 'The results image is available after the matchday is finalized.'
    }
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const scoreText = value => Number.isInteger(value) ? String(value) : '';
  const matches = event => event && event.schedule ? event.schedule.rounds.flatMap(round => round.matches) : [];
  const signature = match => match ? JSON.stringify([match.team_a, match.team_b, match.score_a, match.score_b]) : '';
  const pair = match => match ? JSON.stringify([match.team_a, match.team_b]) : '';
  const keyFor = (id, number) => id + ':' + number;
  const validScore = value => /^\d{1,3}$/.test(value) && Number(value) <= 999;

  function scheduleClock(event, offset) {
    const start = String(event?.schedule?.meetup_time || event?.start_time || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d/.test(start)) return '+' + offset + ' min';
    const [hours, minutes] = start.split(':').map(Number);
    const total = hours * 60 + minutes + offset;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function programMarkup(event, copy) {
    const schedule = event && event.schedule;
    if (!schedule || !schedule.referee_policy) return '';
    const finaleStart = schedule.finale_start_minute;
    const officiating = schedule.referee_policy === 'external_ref_v1'
      ? `<p class="matchday-ref-team"><strong>${esc(copy.externalRef)}</strong></p>` : '';
    return `<h3>${esc(copy.program)}</h3><div class="matchday-program-grid">
      <div><strong>${esc(scheduleClock(event, 0))}</strong><span>${esc(copy.meetWarmup)}</span><small>${esc(scheduleClock(event, schedule.warmup_minutes))}</small></div>
      <div><strong>${esc(scheduleClock(event, schedule.warmup_minutes))}</strong><span>${esc(copy.gamesWindow)}</span><small>${esc(scheduleClock(event, finaleStart))}</small></div>
      <div><strong>${esc(scheduleClock(event, finaleStart))}</strong><span>${esc(copy.finale)}</span><small>${esc(scheduleClock(event, schedule.total_duration_minutes))} · ${esc(copy.finaleAwards)}</small></div>
    </div>${officiating}`;
  }

  function finaleMarkup(event, copy) {
    const results = event && event.finale_results;
    if (!results) return '';
    const category = (key, label) => {
      const result = results[key];
      if (!result) return '';
      return `<article><h4>${esc(label)}</h4><p><strong>${esc(copy.winner)}:</strong> ${esc(result.winner.display_name)} · +${esc(result.winner.bonus_points)} BP</p>
        <p><strong>${esc(copy.runnerUp)}:</strong> ${esc(result.runner_up.display_name)} · +${esc(result.runner_up.bonus_points)} BP</p></article>`;
    };
    return `<h3>${esc(copy.finaleResults)}</h3><div class="matchday-finale-grid">${category('men', copy.men)}${category('women', copy.women)}</div>`;
  }

  function teamNames(event, match) {
    return ['a', 'b'].map(side => {
      const team = event.teams.find(team => team.number === match['team_' + side]);
      return team ? team.name : '';
    });
  }

  function fixtureIdentity(event, match) {
    if (!event || !match) return '';
    const round = event.schedule.rounds.find(round => round.matches.some(item => item.number === match.number));
    return JSON.stringify([event.id, match.number, match.team_a, match.team_b, teamNames(event, match),
      match.court, round.number, round.start_minute, round.end_minute, event.start_time]);
  }

  function readEvent(search) {
    const values = new URLSearchParams(search).getAll('event');
    return { id: values.length === 1 && UUID.test(values[0]) ? values[0].toLowerCase() : '',
      invalid: values.length > 0 && !(values.length === 1 && UUID.test(values[0])) };
  }

  function memberLoginHref(id) {
    const target = '/spieltag' + (UUID.test(id || '') ? '?event=' + id.toLowerCase() : '');
    return '/member?return_to=' + encodeURIComponent(target);
  }

  function timerPath(id, number) {
    return UUID.test(id || '') && Number.isInteger(Number(number)) && Number(number) >= 1 && Number(number) <= 10
      ? '/timer?event=' + encodeURIComponent(id.toLowerCase()) + '&match=' + encodeURIComponent(Number(number))
      : '';
  }

  function draftSnapshot(state) {
    const entries = [...state.drafts].filter(([, draft]) => draft.dirty).map(([key, draft]) => [key, {
      a: draft.a, b: draft.b, version: draft.version, identity: draft.identity, base: draft.base,
      pair: draft.pair, teamNames: draft.teamNames, court: draft.court
    }]);
    const value = JSON.stringify(entries);
    if (entries.length > 100 || value.length > 100000) throw new Error('Draft storage limit');
    return entries.length ? value : '';
  }

  function restoreDrafts(value) {
    const drafts = new Map();
    if (value === undefined || value === null || value === '') return drafts;
    if (typeof value !== 'string' || value.length > 100000) {
      console.error('Stored matchday drafts have an invalid size or type.');
      return drafts;
    }
    let rejected = 0;
    try {
      const entries = JSON.parse(value);
      if (!Array.isArray(entries) || entries.length > 100) {
        console.error('Stored matchday drafts have an invalid entry list.');
        return drafts;
      }
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2) { rejected++; continue; }
        const [key, draft] = entry;
        if (typeof key !== 'string' || !UUID.test(key.slice(0, 36)) || !/^:[1-9]\d{0,2}$/.test(key.slice(36))
          || !draft || !Number.isSafeInteger(draft.version) || draft.version < 1
          || !['a', 'b'].every(side => typeof draft[side] === 'string' && /^[0-9eE.+-]{0,16}$/.test(draft[side]))
          || !Array.isArray(draft.teamNames) || draft.teamNames.length !== 2
          || !draft.teamNames.every(name => typeof name === 'string' && name.length <= 200)
          || ![1, 2].includes(draft.court)
          || !['identity', 'base', 'pair'].every(field => typeof draft[field] === 'string' && draft[field].length <= 2000)) { rejected++; continue; }
        let identity;
        try { identity = JSON.parse(draft.identity); } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          rejected++;
          continue;
        }
        if (!Array.isArray(identity) || identity[0] !== key.slice(0, 36) || identity[1] !== Number(key.slice(37))
          || JSON.stringify(identity[4]) !== JSON.stringify(draft.teamNames)
          || identity[5] !== draft.court || JSON.stringify([identity[2], identity[3]]) !== draft.pair) { rejected++; continue; }
        drafts.set(key, {
          a: draft.a, b: draft.b, version: draft.version, identity: draft.identity, base: draft.base,
          pair: draft.pair, teamNames: draft.teamNames, court: draft.court,
          dirty: true, focused: false, conflict: true, reviewReady: false, remote: null, message: 'draftRestored'
        });
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.error('Stored matchday drafts could not be parsed:', error.name);
    }
    if (rejected) console.error('Invalid stored matchday drafts were ignored:', rejected);
    return drafts;
  }

  function publishedThursday(event) {
    return event && UUID.test(event.id) && ['published', 'finalized'].includes(event.status)
      && new Date(String(event.session_date).slice(0, 10) + 'T12:00:00Z').getUTCDay() === 4;
  }

  function retrySeconds(data) {
    return Math.min(86400, Math.max(1, Math.ceil(Number(data.retry_after || data.retryAfter) || 60)));
  }

  function createController(options) {
    const now = options.now || Date.now;
    let token = options.token || '';
    let epoch = 0;
    let readTask = null;
    let refreshTask = null;
    let readQueued = false;
    let refreshProbed = false;
    let refreshDenied = false;
    const state = {
      requested: UUID.test(options.eventId || '') ? options.eventId.toLowerCase() : '',
      data: null, drafts: restoreDrafts(options.drafts), loading: false, saving: null,
      memberKnown: false, authNotice: '', error: '', lastUpdated: 0, retryUntil: 0, authRetryUntil: 0
    };
    const notify = () => { if (options.onChange) options.onChange(state); };
    const event = () => state.data && state.data.event;
    const draftFor = number => event() && state.drafts.get(keyFor(event().id, number));
    const matchFor = number => matches(event()).find(match => match.number === Number(number));
    const canScore = () => !!(state.data && state.data.permissions && state.data.permissions.can_score
      && event() && event().status === 'published' && matches(event()).length);
    const matchesFixture = (number, identity) => !!matchFor(number) && identity === fixtureIdentity(event(), matchFor(number));
    const canEditMatch = (number, identity) => canScore() && !!draftFor(number)
      && matchesFixture(number, draftFor(number).identity)
      && (identity === undefined || matchesFixture(number, identity));
    const setToken = value => { token = value; if (options.storeToken) options.storeToken(value); };

    async function request(url, init = {}) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await options.fetch(url, { credentials: 'include', cache: 'no-store', ...init, signal: abort.signal });
        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
      } finally { clearTimeout(timer); }
    }

    function leagueRequest(init, anonymous = false) {
      return request('/api/league' + (init ? '' : '?view=scoring' + (state.requested ? '&event_id=' + encodeURIComponent(state.requested) : '')), {
        ...init, credentials: anonymous ? 'omit' : 'include',
        headers: { ...(init ? { 'Content-Type': 'application/json' } : {}), ...(!anonymous && token ? { Authorization: 'Bearer ' + token } : {}) }
      });
    }

    async function refresh() {
      if (refreshTask) return refreshTask;
      refreshTask = (async () => {
        const response = await request('/api/auth/refresh', { method: 'POST' });
        if (response.status === 429) {
          state.authRetryUntil = now() + retrySeconds(response.data) * 1000;
          throw new Error('rate');
        }
        if ([401, 403].includes(response.status)) { refreshDenied = true; return false; }
        if (!response.ok || !response.data.user) throw new Error('refresh');
        refreshDenied = false;
        state.memberKnown = true;
        return true;
      })();
      try { return await refreshTask; } finally { refreshTask = null; }
    }

    function merge(data) {
      if (!Array.isArray(data.events) || !data.permissions || !Array.isArray(data.standings)
        || (data.event && (!publishedThursday(data.event) || !Number.isInteger(data.event.version)))) {
        throw new Error('Invalid scoring response');
      }
      if (state.requested && data.event && data.event.id.toLowerCase() !== state.requested) throw new Error('Wrong event response');
      state.data = data;
      if (data.permissions.is_scorekeeper) { state.memberKnown = true; refreshDenied = false; }
      if ((data.permissions.is_admin || data.permissions.is_scorekeeper) && state.authNotice === 'expired') state.authNotice = '';
      if (data.event && !state.requested) {
        state.requested = data.event.id.toLowerCase();
        if (options.onDefaultEvent) options.onDefaultEvent(state.requested);
      }
      if (data.event) {
        const currentMatches = matches(data.event);
        for (const match of currentMatches) {
          const key = keyFor(data.event.id, match.number);
          const draft = state.drafts.get(key);
          if (draft && (draft.dirty || draft.focused)) {
            if (draft.version !== data.event.version || draft.base !== signature(match)
              || draft.identity !== fixtureIdentity(data.event, match)) {
              draft.conflict = true;
              draft.dirty = true;
            }
            draft.reviewReady = true;
            draft.remote = match;
          } else {
            state.drafts.set(key, {
              a: scoreText(match.score_a), b: scoreText(match.score_b), version: data.event.version,
              base: signature(match), pair: pair(match), dirty: false, conflict: false,
              identity: fixtureIdentity(data.event, match), teamNames: teamNames(data.event, match), court: match.court,
              reviewReady: true, remote: match,
              message: draft && draft.message === 'saved' && draft.a === scoreText(match.score_a)
                && draft.b === scoreText(match.score_b) ? 'saved' : ''
            });
          }
        }
        state.drafts.forEach((draft, key) => {
          if (key.startsWith(data.event.id + ':') && draft.dirty && !currentMatches.some(match => key === keyFor(data.event.id, match.number))) {
            draft.conflict = true;
            draft.reviewReady = true;
            draft.remote = null;
          }
        });
      }
      state.lastUpdated = now();
    }

    async function load(force = false) {
      if (now() < state.retryUntil) return false;
      if (state.saving) { readQueued = true; return false; }
      if (readTask) { if (force) readQueued = true; return readTask; }
      const generation = epoch;
      const wasScorekeeper = !!(state.data && state.data.permissions.is_scorekeeper);
      const hadToken = !!token;
      state.loading = true;
      state.error = '';
      notify();
      readTask = (async () => {
        try {
          let response = await leagueRequest();
          if (generation !== epoch) return false;
          if (hadToken && (response.status === 401 || (response.ok && !response.data.permissions.is_admin))) {
            setToken('');
            state.authNotice = 'expired';
            response = await leagueRequest();
          }
          if (generation !== epoch) return false;
          const missingMember = !token && !refreshDenied && (response.status === 401 || (response.ok && !response.data.permissions.is_scorekeeper
            && (!refreshProbed || wasScorekeeper || state.memberKnown)));
          if (missingMember && now() >= state.authRetryUntil) {
            refreshProbed = true;
            // Keep the anonymous table usable even if session renewal is unavailable.
            if (response.ok) { merge(response.data); notify(); }
            let renewed = false;
            try {
              const account = await request('/api/member/stats?view=account');
              if (account.ok && account.data.user) state.memberKnown = true;
              else if (account.status === 401) {
                state.memberKnown = false;
                renewed = await refresh();
              } else if (account.status === 403) {
                state.memberKnown = false;
                state.authNotice = 'pendingApproval';
              } else throw new Error('Session check unavailable');
            }
            catch { state.authNotice = 'network'; }
            if (generation !== epoch) return false;
            if (renewed) response = await leagueRequest();
            else if ((!state.memberKnown && wasScorekeeper) || response.status === 401) {
              state.authNotice = 'expired';
              if (!response.ok) response = await leagueRequest(undefined, true);
            }
          }
          if (generation !== epoch) return false;
          if (response.status === 401) {
            state.authNotice = 'expired';
            response = await leagueRequest(undefined, true);
          }
          if (generation !== epoch) return false;
          if (!response.ok) {
            if (response.status === 429) state.retryUntil = now() + retrySeconds(response.data) * 1000;
            state.error = response.status === 404 ? 'notFound' : 'network';
            return false;
          }
          merge(response.data);
          return true;
        } catch {
          if (generation === epoch) state.error = 'network';
          return false;
        } finally {
          readTask = null;
          state.loading = false;
          notify();
          if ((readQueued || generation !== epoch) && !state.saving) {
            readQueued = false;
            void load();
          }
        }
      })();
      return readTask;
    }

    function select(id) {
      if (id && !UUID.test(id)) return;
      state.requested = id.toLowerCase();
      state.data = null;
      state.error = '';
      epoch++;
      notify();
      void load(true);
    }

    function edit(number, side, value, identity) {
      if (!['a', 'b'].includes(side) || !canEditMatch(number, identity)
        || state.saving === keyFor(event().id, number)) return;
      const draft = draftFor(number);
      if (!draft) return;
      draft[side] = value;
      draft.dirty = draft.a !== scoreText(draft.remote && draft.remote.score_a)
        || draft.b !== scoreText(draft.remote && draft.remote.score_b) || draft.conflict;
      draft.message = '';
      notify();
    }

    function focus(number, focused, identity) {
      const draft = draftFor(number);
      if (draft && (!focused || canEditMatch(number, identity))) draft.focused = focused;
    }

    async function save(number, identity) {
      const selected = event();
      const draft = draftFor(number);
      if (!selected || !draft || !draft.dirty || draft.conflict || !canEditMatch(number, identity)
        || state.saving || now() < state.retryUntil) return false;
      if (!validScore(draft.a) || !validScore(draft.b)) { draft.message = 'invalidScore'; notify(); return false; }
      const key = keyFor(selected.id, number);
      state.saving = key;
      draft.message = '';
      notify();
      try {
        if (readTask) await readTask;
        if (!event() || selected.id !== event().id || draft.conflict || !canEditMatch(number, identity)) return false;
        const response = await leagueRequest({ method: 'POST', body: JSON.stringify({
          action: 'save_match', event_id: selected.id, version: draft.version,
          match_number: Number(number), score_a: Number(draft.a), score_b: Number(draft.b)
        }) });
        if (response.status === 409) {
          draft.conflict = true;
          draft.reviewReady = false;
          draft.message = 'conflict';
          return false;
        }
        if (response.status === 401) {
          if (state.data && state.data.event && state.data.event.id === selected.id) {
            state.data.permissions.can_score = false;
            state.data.permissions.is_scorekeeper = false;
          }
          refreshProbed = true;
          if (token) { setToken(''); state.authNotice = 'expired'; }
          else {
            try {
              const renewed = await refresh();
              state.memberKnown = renewed;
              state.authNotice = renewed ? 'restored' : 'expired';
            } catch { state.memberKnown = false; state.authNotice = 'expired'; }
          }
          return false;
        }
        if (response.status === 403) {
          if (state.data && state.data.event && state.data.event.id === selected.id) {
            state.data.permissions.can_score = false;
            state.data.permissions.is_scorekeeper = false;
          }
          refreshProbed = true;
          state.authNotice = 'forbidden';
          return false;
        }
        if (response.status === 429) {
          state.retryUntil = now() + retrySeconds(response.data) * 1000;
          draft.message = 'rate';
          return false;
        }
        if (response.status >= 500) throw new Error('No reliable save confirmation');
        if (!response.ok) { draft.message = 'saveFailed'; return false; }
        if (response.data.success !== true || response.data.event_id !== selected.id) throw new Error('Missing save confirmation');
        draft.dirty = false;
        draft.focused = false;
        draft.message = 'saved';
        return true;
      } catch {
        // A lost response can still mean a committed write. Never replay it automatically.
        draft.conflict = true;
        draft.reviewReady = false;
        draft.message = 'unknownSave';
        return false;
      } finally {
        state.saving = null;
        readQueued = false;
        notify();
        await load(true);
      }
    }

    function review(number, keep, identity) {
      const draft = draftFor(number);
      if (!draft || !draft.conflict || !draft.reviewReady || state.loading || state.saving) return;
      const remote = matchFor(number);
      if (keep && (!remote || pair(remote) !== draft.pair || !canEditMatch(number, identity))) return;
      if (!remote) { state.drafts.delete(keyFor(event().id, number)); notify(); return; }
      if (!keep) { draft.a = scoreText(remote.score_a); draft.b = scoreText(remote.score_b); }
      draft.base = signature(remote);
      draft.pair = pair(remote);
      draft.identity = fixtureIdentity(event(), remote);
      draft.teamNames = teamNames(event(), remote);
      draft.court = remote.court;
      draft.version = event().version;
      draft.remote = remote;
      draft.conflict = false;
      draft.message = '';
      draft.dirty = draft.a !== scoreText(remote.score_a) || draft.b !== scoreText(remote.score_b);
      notify();
    }

    return { state, load, select, edit, focus, save, review, canScore, canEditMatch, matchesFixture, draftFor,
      async waitForRead() { while (readTask) await readTask; },
      hasDrafts: () => [...state.drafts.values()].some(draft => draft.dirty) };
  }

  function clock(start, offset) {
    if (!start) return '+' + offset + ' min';
    const [hours, minutes] = start.split(':').map(Number);
    const total = hours * 60 + minutes + offset;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
      + (total >= 1440 ? ' (+' + Math.floor(total / 1440) + 'd)' : '');
  }

  function fixtures(event, lang) {
    const t = text[lang];
    const names = new Map(event.teams.map(team => [team.number, team.name]));
    return event.schedule.rounds.map(round => `<section class="matchday-round" data-round-number="${esc(round.number)}">
      <h3><span class="matchday-round-label">${esc(t.round)} ${esc(round.number)}</span><span>${esc(clock(event.schedule.meetup_time || event.start_time, round.start_minute))} – ${esc(clock(event.schedule.meetup_time || event.start_time, round.end_minute))}</span></h3>
      <div class="matchday-round-games">${round.matches.map(match => `<form class="matchday-game" data-match-number="${esc(match.number)}" data-fixture-identity="${esc(fixtureIdentity(event, match))}" novalidate>
        <div class="matchday-game-meta"><span class="matchday-game-label" data-court="${esc(match.court)}">${esc(t.game)} ${esc(match.number)} · ${esc(t.court)} ${esc(match.court)}</span><span class="matchday-game-status"></span></div>
        <div class="matchday-read-scores">
          <span class="matchday-team-name">${esc(names.get(match.team_a))}</span>
          <span class="matchday-score-center"><small aria-hidden="true">VS</small><strong></strong></span>
          <span class="matchday-team-name">${esc(names.get(match.team_b))}</span>
        </div>
        <div class="matchday-edit-scores" hidden>
          <div class="matchday-score-grid">${['a', 'b'].map(side => `<label for="matchday-score-${esc(match.number)}-${side}">
            <span class="matchday-team-name">${esc(names.get(match['team_' + side]))}</span>
            <span class="matchday-sr-only">${esc(t.score)}</span>
            <input id="matchday-score-${esc(match.number)}-${side}" data-side="${side}" type="number" inputmode="numeric" min="0" max="999" step="1" autocomplete="off" required aria-describedby="matchday-message-${esc(match.number)}">
          </label>`).join('')}</div>
          <button class="league-btn league-btn-primary matchday-save" type="submit" aria-label="${esc(t.save + ' · ' + t.game + ' ' + match.number)}">${esc(t.save)}</button>
        </div>
        <p class="matchday-game-message" id="matchday-message-${esc(match.number)}" role="status" aria-live="polite"></p>
        <div class="matchday-conflict" hidden>
          <p class="matchday-current-score"></p>
          <p class="matchday-review-hint">${esc(t.review)}</p>
          <div class="matchday-actions">
            <button class="league-btn" type="button" data-review="reload">${esc(t.loadLatest)}</button>
            <button class="league-btn" type="button" data-review="current">${esc(t.useCurrent)}</button>
            <button class="league-btn" type="button" data-review="keep">${esc(t.keepDraft)}</button>
          </div>
        </div>
        <div class="matchday-game-actions">
          <a class="league-btn matchday-timer-link" href="${esc(timerPath(event.id, match.number))}">${esc(t.viewTimer)}</a>
        </div>
      </form>`).join('')}</div>
      ${round.referee_team ? `<p class="matchday-ref-team"><strong>${esc(t.refTeam)}:</strong> ${esc(names.get(round.referee_team))}</p>`
        : event.schedule.referee_policy === 'external_ref_v1' ? `<p class="matchday-ref-team"><strong>${esc(t.externalRef)}</strong></p>` : ''}
      ${round.rest_teams && round.rest_teams.length ? `<p class="league-copy"><span class="matchday-bye-label">${esc(t.bye)}</span>: ${round.rest_teams.map(number => esc(names.get(number))).join(', ')}</p>` : ''}
    </section>`).join('');
  }

  function start() {
    const $ = id => document.getElementById(id);
    if (!$('matchdayPage')) return;
    const lang = () => window.SiteLanguage.get();
    const t = () => text[lang()];
    let structure = '';
    let renderedId = '';
    let renderedLanguage = '';
    let transientMessage = '';
    let pollTimer;
    let leavingForLogin = false;
    const initial = readEvent(window.location.search);
    const initialParams = new URLSearchParams(window.location.search);
    const requestedExport = initialParams.getAll('export').length === 1 ? initialParams.get('export') : '';
    let autoPoster = ['image', 'pdf', 'itinerary', 'results'].includes(requestedExport) ? requestedExport : '';
    let invalidLink = initial.invalid;
    let token = '';
    let storedDrafts = '';
    let draftStorageWarning = false;
    const posterStates = {
      itinerary: { key: '', result: null, file: null, busy: false },
      results: { key: '', result: null, file: null, busy: false }
    };
    try { token = sessionStorage.getItem('vi_admin_token') || ''; } catch { /* Existing admin sessions are optional. */ }
    try { storedDrafts = sessionStorage.getItem(DRAFT_KEY) || ''; } catch (error) {
      console.error('Stored matchday drafts could not be read:', error.name);
      draftStorageWarning = true;
    }
    function urlFor(id) { return '/spieltag' + (id ? '?event=' + encodeURIComponent(id) : ''); }
    function historyEvent(id, replace) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', urlFor(id));
    }
    function posterKey(event, mode) {
      return event ? [event.id, event.version, lang(), mode].join(':') : '';
    }
    const controller = createController({
      fetch: window.fetch.bind(window), eventId: initial.id, token, drafts: storedDrafts,
      storeToken(value) {
        try { if (value) sessionStorage.setItem('vi_admin_token', value); else sessionStorage.removeItem('vi_admin_token'); } catch { /* Never persist passwords. */ }
      },
      onDefaultEvent(id) { historyEvent(id, true); },
      onChange() { persistDrafts(); render(); }
    });
    const state = controller.state;
    function persistDrafts() {
      try {
        const value = draftSnapshot(controller.state);
        if (value) sessionStorage.setItem(DRAFT_KEY, value);
        else sessionStorage.removeItem(DRAFT_KEY);
        return true;
      } catch (error) {
        if (!draftStorageWarning) console.error('Matchday drafts could not be stored:', error.name);
        draftStorageWarning = true;
        return false;
      }
    }
    function message(code) {
      if (code === 'rate') return t().retry + ' ' + Math.max(1, Math.ceil((state.retryUntil - Date.now()) / 1000)) + ' ' + t().seconds;
      return t()[code] || '';
    }
    function setHTML(element, html) { if (element.innerHTML !== html) element.innerHTML = html; }
    function permissionNotice() {
      const event = state.data && state.data.event;
      if (!event) return '';
      if (event.status === 'finalized') return t().finalReadOnly;
      if (!event.schedule) return t().noSchedule;
      const dateParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const today = ['year', 'month', 'day'].map(type => dateParts.find(part => part.type === type).value).join('-');
      if (String(event.session_date).slice(0, 10) > today) return t().future;
      if (controller.canScore()) return t().scoring;
      return state.memberKnown ? t().forbidden : t().publicReadOnly;
    }
    function renderStandings() {
      const data = state.data;
      const search = $('matchdaySearch').value.trim().toLocaleLowerCase(lang());
      const players = (data && data.standings || []).filter(player => player.display_name.toLocaleLowerCase(lang()).includes(search));
      setHTML($('matchdayStandings'), players.length ? window.LeagueUI.standings(players, lang())
        : '<p class="league-copy">' + esc(search ? t().noResults : t().noStandings) + '</p>');
      $('matchdaySeasonName').textContent = data && data.season ? data.season.name : '';
      setHTML($('matchdayRules'), data && data.season ? window.LeagueUI.rules(data.season, lang()) : '');
    }
    function renderGames(event) {
      const host = $('matchdayMatches');
      const nextStructure = JSON.stringify(event.schedule ? event.schedule.rounds.map(round =>
        [round.number, round.start_minute, round.end_minute, round.bye_teams,
          round.matches.map(match => [match.number, match.court, match.team_a, match.team_b])]) : null)
        + JSON.stringify(event.teams.map(team => [team.number, team.name]));
      const editing = [...state.drafts.entries()].some(([key, draft]) => key.startsWith(event.id + ':') && draft.dirty);
      const focused = host.contains(document.activeElement);
      const changed = nextStructure !== structure;
      const staleCards = [...host.querySelectorAll('[data-match-number]')].some(form =>
        !controller.matchesFixture(Number(form.dataset.matchNumber), form.dataset.fixtureIdentity || ''));
      // Do not replace live form nodes under a typist, including during language changes.
      if (renderedId !== event.id || ((!editing && !focused) && (changed || staleCards || renderedLanguage !== lang()))) {
        host.innerHTML = event.schedule ? fixtures(event, lang()) : '';
        structure = nextStructure;
        renderedId = event.id;
        renderedLanguage = lang();
      }
      $('matchdayScheduleNotice').hidden = !!event.schedule && !changed;
      $('matchdayScheduleNotice').textContent = !event.schedule && !editing ? t().noSchedule : t().scheduleChanged;
      if (nextStructure === structure && event.schedule) $('matchdayScheduleNotice').hidden = true;
      host.querySelectorAll('[data-round-number]').forEach(round => {
        round.querySelector('.matchday-round-label').textContent = t().round + ' ' + round.dataset.roundNumber;
      });
      host.querySelectorAll('.matchday-bye-label').forEach(label => { label.textContent = t().bye; });
      const byNumber = new Map(matches(event).map(match => [match.number, match]));
      host.querySelectorAll('[data-match-number]').forEach(form => {
        const number = Number(form.dataset.matchNumber);
        const draft = controller.draftFor(number);
        const match = byNumber.get(number);
        if (!draft) return;
        // A retained card and a retained draft must both still describe this exact fixture.
        if (draft.dirty && !controller.matchesFixture(number, draft.identity)) {
          form.dataset.fixtureIdentity = draft.identity;
          form.querySelectorAll('.matchday-team-name').forEach((label, index) => { label.textContent = draft.teamNames[index % 2]; });
          form.querySelector('.matchday-game-label').dataset.court = draft.court;
        }
        const identity = form.dataset.fixtureIdentity || '';
        const stale = !controller.matchesFixture(number, identity) || !controller.matchesFixture(number, draft.identity);
        const saving = state.saving === keyFor(event.id, number);
        const canEdit = controller.canEditMatch(number, identity);
        const showInputs = canEdit || draft.dirty || form.contains(document.activeElement);
        const label = form.querySelector('.matchday-game-label');
        label.textContent = t().game + ' ' + number + ' · ' + t().court + ' ' + label.dataset.court;
        form.querySelectorAll('.matchday-sr-only').forEach(label => { label.textContent = t().score; });
        form.querySelector('.matchday-read-scores').hidden = showInputs;
        form.querySelector('.matchday-edit-scores').hidden = !showInputs;
        form.classList.toggle('is-dirty', draft.dirty);
        form.classList.toggle('is-conflict', draft.conflict);
        form.querySelector('.matchday-read-scores strong').textContent = !stale && match && match.score_a !== null && match.score_b !== null
          ? match.score_a + ' : ' + match.score_b : '– : –';
        form.querySelector('.matchday-game-status').textContent = stale ? t().fixtureChanged : event.status === 'finalized' ? t().finalized
          : match && match.score_a !== null && match.score_b !== null ? t().provisional : t().pending;
        form.querySelectorAll('input[data-side]').forEach(input => {
          if ((!stale || draft.dirty) && document.activeElement !== input && input.value !== draft[input.dataset.side]) input.value = draft[input.dataset.side];
          input.readOnly = !canEdit || saving;
          input.setAttribute('aria-invalid', String(draft.message === 'invalidScore' && !validScore(draft[input.dataset.side])));
        });
        const save = form.querySelector('.matchday-save');
        save.disabled = !canEdit || !draft.dirty || draft.conflict || !!state.saving || Date.now() < state.retryUntil;
        save.textContent = saving ? t().saving : t().save;
        save.setAttribute('aria-label', t().save + ' · ' + t().game + ' ' + number);
        save.setAttribute('aria-busy', String(saving));
        const note = form.querySelector('.matchday-game-message');
        note.textContent = stale ? t().fixtureChanged : message(draft.message) || (draft.conflict ? t().conflict : draft.dirty ? t().unsaved : '');
        note.classList.toggle('is-error', draft.conflict || ['invalidScore', 'saveFailed', 'rate'].includes(draft.message));
        form.querySelector('.matchday-conflict').hidden = !draft.conflict;
        form.querySelector('.matchday-review-hint').textContent = t().review;
        form.querySelector('.matchday-current-score').textContent = draft.reviewReady
          ? t().currentScore + ': ' + (match ? teamNames(event, match)[0] + ' ' + (scoreText(match.score_a) || '–')
            + ' : ' + (scoreText(match.score_b) || '–') + ' ' + teamNames(event, match)[1] : t().noSchedule)
          : t().loadLatest;
        form.querySelector('[data-review="reload"]').hidden = draft.reviewReady;
        form.querySelector('[data-review="reload"]').textContent = t().loadLatest;
        form.querySelector('[data-review="current"]').textContent = t().useCurrent;
        form.querySelector('[data-review="keep"]').textContent = t().keepDraft;
        form.querySelector('[data-review="reload"]').disabled = state.loading || !!state.saving;
        form.querySelector('[data-review="current"]').disabled = !draft.reviewReady || state.loading || !!state.saving;
        form.querySelector('[data-review="keep"]').disabled = !draft.reviewReady || !canEdit || pair(match) !== draft.pair || state.loading || !!state.saving;
        const timerLink = form.querySelector('.matchday-timer-link');
        if (stale) timerLink.removeAttribute('href');
        else timerLink.setAttribute('href', timerPath(event.id, number));
        timerLink.tabIndex = stale ? -1 : 0;
        timerLink.textContent = canEdit ? t().startTimer : t().viewTimer;
        timerLink.setAttribute('aria-disabled', String(stale));
        timerLink.classList.toggle('league-btn-primary', canEdit);
      });
    }
    function render() {
      const data = state.data;
      const event = data && data.event;
      const permissions = data && data.permissions || {};
      for (const mode of ['itinerary', 'results']) {
        const posterState = posterStates[mode];
        const nextPosterKey = posterKey(event, mode);
        if (posterState.key && posterState.key !== nextPosterKey) {
          posterState.key = '';
          posterState.result = null;
          posterState.file = null;
        }
      }
      const posterBusy = posterStates.itinerary.busy || posterStates.results.busy;
      $('matchdayRefresh').disabled = state.loading || !!state.saving || Date.now() < state.retryUntil;
      $('matchdayRefresh').setAttribute('aria-busy', String(state.loading));
      $('matchdaySelect').disabled = !data || !data.events.length || !!state.saving;
      $('matchdayShare').disabled = !event;
      const itineraryState = posterStates.itinerary;
      $('matchdayPoster').disabled = !event || !event.schedule || posterBusy;
      $('matchdayPoster').setAttribute('aria-busy', String(itineraryState.busy));
      $('matchdayPoster').textContent = itineraryState.busy ? t().posterCreating
        : itineraryState.file && window.LeaguePoster && window.LeaguePoster.canShare(itineraryState.file)
          ? t().itineraryPosterShare : t().itineraryPosterCreate;
      const resultsState = posterStates.results;
      $('matchdayResultsPoster').disabled = !event || !event.schedule || event.status !== 'finalized' || posterBusy;
      $('matchdayResultsPoster').setAttribute('aria-busy', String(resultsState.busy));
      $('matchdayResultsPoster').textContent = resultsState.busy ? t().posterCreating
        : resultsState.file && window.LeaguePoster && window.LeaguePoster.canShare(resultsState.file)
          ? t().resultsPosterShare : t().resultsPosterCreate;
      if (data) setHTML($('matchdaySelect'), '<option value="">' + esc(t().choose) + '</option>' + data.events.filter(publishedThursday).map(item =>
        '<option value="' + esc(item.id) + '">' + esc(window.LeagueUI.date(item.session_date, lang()) + ' · ' + item.title) + '</option>').join(''));
      $('matchdaySelect').value = state.requested;
      $('matchdaySync').textContent = state.loading ? t().loading : transientMessage || (document.hidden ? t().paused
        : (state.lastUpdated ? t().live + ' ' + new Date(state.lastUpdated).toLocaleTimeString(lang() === 'de' ? 'de-AT' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · ' : '') + t().automatic);
      const error = state.error || (invalidLink ? 'invalidLink' : '');
      $('matchdayError').hidden = !error && Date.now() >= state.retryUntil;
      $('matchdayError').textContent = Date.now() < state.retryUntil ? message('rate') : message(error);
      $('matchdayEvent').hidden = !event;
      $('matchdayEmpty').hidden = !!event || state.loading || !!state.error;
      $('matchdayEmpty').textContent = t().empty;
      if (event) {
        $('matchdayTitle').textContent = event.title;
        const recorded = matches(event).filter(match => Number.isInteger(match.score_a) && Number.isInteger(match.score_b)).length;
        $('matchdayStatus').textContent = (event.status === 'finalized' ? t().finalized : recorded ? t().provisional : t().pending)
          + (matches(event).length ? ' · ' + recorded + '/' + matches(event).length : '');
        $('matchdayMeta').textContent = [window.LeagueUI.date(event.session_date, lang()),
          event.start_time ? event.start_time.slice(0, 5) + (event.end_time ? ' – ' + event.end_time.slice(0, 5) : '') : '', event.location].filter(Boolean).join(' · ');
        $('matchdayReadOnly').textContent = permissionNotice();
        setHTML($('matchdayProgram'), programMarkup(event, t()));
        $('matchdayProgram').hidden = !event.schedule?.referee_policy;
        renderGames(event);
        setHTML($('matchdayTable'), window.LeagueUI.matchTable(event, lang()));
        const finale = finaleMarkup(event, t());
        setHTML($('matchdayFinale'), finale);
        $('matchdayFinale').hidden = !finale;
        if (autoPoster && !posterBusy) {
          const mode = ['pdf', 'image'].includes(autoPoster)
            ? (event.status === 'finalized' ? 'results' : 'itinerary') : autoPoster;
          autoPoster = '';
          if (mode === 'results' && event.status !== 'finalized') {
            transientMessage = t().posterResultsUnavailable;
            setTimeout(render, 0);
          }
          else setTimeout(() => { void exportPoster(mode, true); }, 0);
        }
      }
      const role = permissions.is_admin ? 'admin' : permissions.is_scorekeeper ? 'scorekeeper' : state.memberKnown ? 'member' : 'signIn';
      $('matchdayAuthSummary').textContent = t()[role];
      const authMessage = Date.now() < state.authRetryUntil
        ? t().retry + ' ' + Math.ceil((state.authRetryUntil - Date.now()) / 1000) + ' ' + t().seconds
        : message(state.authNotice);
      $('matchdayAuthMessage').textContent = authMessage || (state.memberKnown && !permissions.is_admin && !permissions.is_scorekeeper ? t().forbidden : '');
      const signedIn = !!permissions.is_admin || state.memberKnown;
      $('matchdayLoginLink').hidden = signedIn;
      $('matchdayLoginLink').href = memberLoginHref(state.requested);
      $('matchdayLoginLink').setAttribute('aria-disabled', String(!!state.saving));
      $('matchdayFooterLogin').href = signedIn ? '/member' : memberLoginHref(state.requested);
      $('matchdayMemberLink').hidden = !signedIn;
      $('matchdayAdmin').hidden = !permissions.is_admin;
      renderStandings();
    }
    function applyLanguage() {
      document.querySelectorAll('[data-de][data-en]').forEach(element => { element.textContent = element.dataset[lang()]; });
      document.title = t().title + ' — Vienna Imperials';
      render();
    }
    function poll() {
      clearTimeout(pollTimer);
      if (document.hidden) { render(); return; }
      pollTimer = setTimeout(async () => {
        if (!document.hidden && Date.now() >= state.retryUntil) await controller.load();
        poll();
      }, 15000);
    }
    $('matchdaySelect').addEventListener('change', () => {
      const id = $('matchdaySelect').value;
      if (!id || !UUID.test(id)) return;
      transientMessage = '';
      invalidLink = false;
      $('matchdayShareField').hidden = true;
      historyEvent(id, false);
      controller.select(id);
    });
    window.addEventListener('popstate', () => {
      transientMessage = '';
      $('matchdayShareField').hidden = true;
      const selected = readEvent(window.location.search);
      invalidLink = selected.invalid;
      controller.select(selected.id);
    });
    $('matchdayRefresh').addEventListener('click', () => { transientMessage = ''; void controller.load(true); });
    async function exportPoster(mode, forceDownload = false) {
      const data = state.data;
      const event = data && data.event;
      if (!['itinerary', 'results'].includes(mode) || !event || !event.schedule || !window.LeaguePoster) return;
      if (mode === 'results' && event.status !== 'finalized') {
        transientMessage = t().posterResultsUnavailable;
        render();
        return;
      }
      if (posterStates.itinerary.busy || posterStates.results.busy) return;
      const posterState = posterStates[mode];
      const key = posterKey(event, mode);
      if (posterState.result && posterState.key === key) {
        if (!forceDownload && posterState.file && window.LeaguePoster.canShare(posterState.file)) {
          try {
            await window.LeaguePoster.share(posterState.file, event.title);
            transientMessage = t().posterShared;
          } catch (error) {
            if (error.name !== 'AbortError') {
              console.error('League image sharing failed:', error.name);
              transientMessage = t().posterFailed;
            }
          }
        } else {
          window.LeaguePoster.save(posterState.result);
          transientMessage = t().posterDownloaded;
        }
        render();
        return;
      }
      posterState.busy = true;
      transientMessage = t().posterCreating;
      render();
      try {
        const result = await window.LeaguePoster.create(event, {
          lang: lang(),
          mode,
          standings: data.standings,
          publicUrl: new URL(urlFor(event.id), window.location.origin).href,
        });
        if (!state.data || posterKey(state.data.event, mode) !== key) {
          transientMessage = t().posterChanged;
          return;
        }
        posterState.key = key;
        posterState.result = result;
        posterState.file = window.LeaguePoster.asFile(result);
        window.LeaguePoster.save(result);
        transientMessage = !forceDownload && posterState.file && window.LeaguePoster.canShare(posterState.file)
          ? t().posterReady : t().posterDownloaded;
      } catch (error) {
        console.error('League image export failed:', error.name);
        transientMessage = t().posterFailed;
      } finally {
        posterState.busy = false;
        render();
      }
    }
    $('matchdayPoster').addEventListener('click', () => { void exportPoster('itinerary', false); });
    $('matchdayResultsPoster').addEventListener('click', () => { void exportPoster('results', false); });
    $('matchdaySearch').addEventListener('input', renderStandings);
    $('matchdayMatches').addEventListener('input', event => {
      const input = event.target.closest('input[data-side]');
      const form = input && input.closest('[data-match-number]');
      if (form) controller.edit(Number(form.dataset.matchNumber), input.dataset.side, input.value, form.dataset.fixtureIdentity || '');
    });
    $('matchdayMatches').addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target.closest('[data-match-number]');
      if (form) void controller.save(Number(form.dataset.matchNumber), form.dataset.fixtureIdentity || '');
    });
    $('matchdayMatches').addEventListener('click', event => {
      const button = event.target.closest('[data-review]');
      if (!button) return;
      if (button.dataset.review === 'reload') { void controller.load(true); return; }
      const form = button.closest('[data-match-number]');
      controller.review(Number(form.dataset.matchNumber), button.dataset.review === 'keep', form.dataset.fixtureIdentity || '');
    });
    $('matchdayMatches').addEventListener('focusin', event => {
      const input = event.target.closest('input[data-side]');
      const form = input && input.closest('[data-match-number]');
      if (form) controller.focus(Number(form.dataset.matchNumber), true, form.dataset.fixtureIdentity || '');
    });
    $('matchdayMatches').addEventListener('focusout', event => {
      const form = event.target.closest('[data-match-number]');
      setTimeout(() => {
        if (form) controller.focus(Number(form.dataset.matchNumber),
          !!document.activeElement && document.activeElement.matches('input[data-side]') && form.contains(document.activeElement),
          form.dataset.fixtureIdentity || '');
        render();
      }, 0);
    });
    async function openMemberLogin(event) {
      const link = event.currentTarget;
      if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (link.id === 'matchdayFooterLogin' && (state.memberKnown || (state.data && state.data.permissions.is_admin))) return;
      if (!state.saving && controller.hasDrafts() && !persistDrafts()) {
        link.target = '_blank';
        link.rel = 'noopener';
        state.authNotice = 'draftNewTab';
        render();
        return;
      }
      event.preventDefault();
      if (state.saving) return;
      clearTimeout(pollTimer);
      await controller.waitForRead();
      if (state.saving) { poll(); return; }
      const href = memberLoginHref(state.requested);
      if (!persistDrafts() && controller.hasDrafts()) {
        link.target = '_blank';
        link.rel = 'noopener';
        state.authNotice = 'draftNewTab';
        render();
        poll();
        return;
      }
      leavingForLogin = true;
      window.location.assign(href);
    }
    $('matchdayLoginLink').addEventListener('click', openMemberLogin);
    $('matchdayFooterLogin').addEventListener('click', openMemberLogin);
    $('matchdayShare').addEventListener('click', async () => {
      const event = state.data && state.data.event;
      if (!event) return;
      $('matchdayShareField').hidden = true;
      const url = new URL(urlFor(event.id), window.location.origin).href;
      try {
        if (navigator.share) { await navigator.share({ title: event.title, url }); return; }
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
        transientMessage = t().copied;
        render();
      } catch (error) {
        if (error.name === 'AbortError') return;
        $('matchdayShareField').hidden = false;
        $('matchdayShareUrl').value = url;
        $('matchdayShareUrl').focus();
        $('matchdayShareUrl').select();
      }
    });
    document.addEventListener('site-language-change', applyLanguage);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { transientMessage = ''; void controller.load(); }
      poll();
    });
    window.addEventListener('beforeunload', event => {
      if (!controller.hasDrafts() || leavingForLogin) return;
      event.preventDefault();
      event.returnValue = '';
    });
    applyLanguage();
    void controller.load();
    poll();
    function updateCooldown() {
      if (!document.hidden && (state.retryUntil || state.authRetryUntil)) {
        if (Date.now() >= state.retryUntil) state.retryUntil = 0;
        if (Date.now() >= state.authRetryUntil) state.authRetryUntil = 0;
        render();
      }
    }
    let cooldown = setInterval(updateCooldown, 1000);
    window.addEventListener('pagehide', () => { clearTimeout(pollTimer); clearInterval(cooldown); });
    window.addEventListener('pageshow', event => {
      if (event.persisted) { cooldown = setInterval(updateCooldown, 1000); void controller.load(); poll(); }
    });
  }

  window.Matchday = { createController, readEvent, memberLoginHref, timerPath, draftSnapshot, restoreDrafts,
    publishedThursday, validScore, fixtureIdentity, fixtures, retrySeconds, scheduleClock, programMarkup, finaleMarkup, start };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
