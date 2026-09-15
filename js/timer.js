/* Shared per-fixture WDBF-style timer for the public Imperials matchday. */
(function () {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const text = {
    de: {
      loading: 'Timer wird geladen …',
      updated: 'Synchronisiert um',
      automatic: 'Live-Abgleich alle 5 Sekunden',
      hidden: 'Live-Abgleich pausiert',
      invalid: 'Dieser Timer-Link ist ungültig.',
      notFound: 'Dieses veröffentlichte Spiel wurde nicht gefunden.',
      network: 'Verbindung zur Spieluhr unterbrochen. Bitte aktualisieren.',
      conflict: 'Die Spieluhr wurde anderswo geändert. Der aktuelle Stand wurde geladen.',
      unauthorized: 'Deine Sitzung ist abgelaufen. Bitte erneut anmelden.',
      forbidden: 'Nur ernannte Head Refs und Admins können diese Spieluhr bedienen.',
      unavailable: 'Die Spieluhr kann nur am veröffentlichten Spieltag bedient werden.',
      ready: 'Bereit',
      live: 'Live Play',
      paused: 'Spiel pausiert',
      set_expired: 'Set Clock abgelaufen',
      match_expired: 'Match Clock abgelaufen',
      expired: 'Match & Set abgelaufen',
      publicRole: 'Öffentliche Live-Ansicht · Steuerung gesperrt',
      headRefRole: 'Head Ref · Steuerung aktiv',
      adminRole: 'Admin · Steuerung aktiv',
      headRefWaitingRole: 'Head Ref · Steuerung nur am Spieltag',
      adminWaitingRole: 'Admin · Steuerung nur am Spieltag',
      publicAccess: 'Alle Timer-Funktionen sind sichtbar, aber für Zuschauer gesperrt. Melde dich als Head Ref oder Admin an, um sie zu bedienen.',
      memberAccess: 'Alle Timer-Funktionen sind sichtbar, aber dein Konto hat keine Timer-Berechtigung. Admins können die dauerhafte Head-Ref-Rolle vergeben.',
      unavailableAccess: 'Alle Timer-Funktionen sind sichtbar. Sie werden für Head Refs und Admins am veröffentlichten Spieltag freigeschaltet.',
      copied: 'Timer-Link kopiert.',
      fullscreenFailed: 'Vollbild konnte nicht geöffnet werden.',
      configInvalid: 'Minuten müssen zwischen 0 und 99, Sekunden zwischen 0 und 59 liegen.',
      saving: 'Änderung wird gespeichert …',
      match: 'Spiel',
      court: 'Feld',
      round: 'Runde',
      refTeam: 'Ref-Team',
      externalRef: 'Externer Head Ref / Admin',
      scheduled: 'Geplant',
    },
    en: {
      loading: 'Loading timer …',
      updated: 'Synchronized at',
      automatic: 'Live sync every 5 seconds',
      hidden: 'Live sync paused',
      invalid: 'This timer link is invalid.',
      notFound: 'This published match could not be found.',
      network: 'Connection to the match timer was lost. Please refresh.',
      conflict: 'The timer changed elsewhere. The latest state has been loaded.',
      unauthorized: 'Your session expired. Please sign in again.',
      forbidden: 'Only appointed Head Refs and admins can control this timer.',
      unavailable: 'Timer controls are available only on the published matchday.',
      ready: 'Ready',
      live: 'Live Play',
      paused: 'Play paused',
      set_expired: 'Set Clock expired',
      match_expired: 'Match Clock expired',
      expired: 'Match & Set expired',
      publicRole: 'Public live view · controls locked',
      headRefRole: 'Head Ref · controls enabled',
      adminRole: 'Admin · controls enabled',
      headRefWaitingRole: 'Head Ref · controls available on matchday',
      adminWaitingRole: 'Admin · controls available on matchday',
      publicAccess: 'Every timer feature is visible but locked for spectators. Sign in as a Head Ref or admin to operate it.',
      memberAccess: 'Every timer feature is visible, but your account has no timer permission. Admins can grant the permanent Head Ref role.',
      unavailableAccess: 'Every timer feature is visible. Controls unlock for Head Refs and admins on the published matchday.',
      copied: 'Timer link copied.',
      fullscreenFailed: 'Fullscreen could not be opened.',
      configInvalid: 'Minutes must be 0–99 and seconds 0–59.',
      saving: 'Saving change …',
      match: 'Match',
      court: 'Court',
      round: 'Round',
      refTeam: 'Ref team',
      externalRef: 'External Head Ref / admin',
      scheduled: 'Scheduled',
    }
  };

  function parseRoute(search) {
    const params = new URLSearchParams(search);
    const events = params.getAll('event');
    const matches = params.getAll('match');
    const eventId = events.length === 1 && UUID.test(events[0]) ? events[0].toLowerCase() : '';
    const matchNumber = matches.length === 1 && /^[1-9]\d*$/.test(matches[0]) && Number(matches[0]) <= 10
      ? Number(matches[0]) : 0;
    return {
      eventId,
      matchNumber,
      invalid: events.length !== 1 || matches.length !== 1 || !eventId || !matchNumber,
    };
  }

  function timerPath(eventId, matchNumber) {
    return '/timer?event=' + encodeURIComponent(eventId) + '&match=' + encodeURIComponent(matchNumber);
  }

  function memberLoginHref(eventId, matchNumber) {
    return '/member?return_to=' + encodeURIComponent(timerPath(eventId, matchNumber));
  }

  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
    const minutes = Math.floor(seconds / 60);
    return String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  function projectedTimer(timer, now = Date.now(), clockOffset = 0) {
    if (!timer) return null;
    const asOf = Date.parse(timer.as_of);
    const elapsed = timer.phase === 'running' && Number.isFinite(asOf)
      ? Math.max(0, now + clockOffset - asOf) : 0;
    const matchRemainingMs = Math.max(0, timer.match_remaining_ms - elapsed);
    const setRemainingMs = Math.max(0, timer.set_remaining_ms - elapsed);
    let status = matchRemainingMs === 0 && setRemainingMs === 0 ? 'expired'
      : matchRemainingMs === 0 ? 'match_expired'
        : setRemainingMs === 0 ? 'set_expired'
          : timer.phase === 'ready' ? 'ready'
            : timer.phase === 'running' ? 'live' : 'paused';
    const phase = timer.phase === 'running' && status === 'expired' ? 'paused' : timer.phase;
    return { ...timer, phase, status, match_remaining_ms: matchRemainingMs, set_remaining_ms: setRemainingMs };
  }

  function validPayload(data, eventId, matchNumber) {
    return data && data.event && data.event.id === eventId
      && data.match && data.match.number === matchNumber
      && data.match.team_a && data.match.team_b
      && data.timer && Number.isInteger(data.timer.revision)
      && ['ready', 'running', 'paused'].includes(data.timer.phase)
      && Number.isFinite(data.timer.match_remaining_ms)
      && Number.isFinite(data.timer.set_remaining_ms)
      && data.permissions && typeof data.permissions.can_control === 'boolean';
  }

  function createController(options) {
    const now = options.now || Date.now;
    let token = options.token || '';
    let readTask = null;
    let queuedRead = false;
    const state = {
      data: null,
      loading: false,
      saving: false,
      error: '',
      notice: '',
      lastUpdated: 0,
      clockOffset: 0,
    };
    const notify = () => { if (options.onChange) options.onChange(state); };

    async function request(url, init = {}) {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 12000);
      const sentAt = now();
      try {
        const response = await options.fetch(url, {
          credentials: 'include',
          cache: 'no-store',
          ...init,
          headers: {
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...(init.headers || {}),
          },
          signal: abort.signal,
        });
        let data;
        try { data = await response.json(); } catch {
          throw new Error('UNREADABLE_RESPONSE');
        }
        return { response, data, sentAt, receivedAt: now() };
      } finally {
        clearTimeout(timeout);
      }
    }

    function merge(result) {
      if (!validPayload(result.data, options.eventId, options.matchNumber)) throw new Error('INVALID_RESPONSE');
      const serverNow = Date.parse(result.data.timer.as_of);
      state.clockOffset = Number.isFinite(serverNow)
        ? serverNow - (result.sentAt + result.receivedAt) / 2 : 0;
      state.data = result.data;
      state.lastUpdated = result.receivedAt;
      state.error = '';
      if (token && !result.data.permissions.is_admin && options.storeToken) {
        token = '';
        options.storeToken('');
      }
    }

    async function load() {
      if (state.saving) {
        queuedRead = true;
        return false;
      }
      if (readTask) {
        queuedRead = true;
        return readTask;
      }
      state.loading = true;
      notify();
      readTask = (async () => {
        try {
          const query = '?event_id=' + encodeURIComponent(options.eventId)
            + '&match_number=' + encodeURIComponent(options.matchNumber);
          const result = await request('/api/timer' + query);
          if (result.response.status === 404) { state.error = 'notFound'; return false; }
          if (!result.response.ok) { state.error = 'network'; return false; }
          merge(result);
          return true;
        } catch {
          state.error = 'network';
          return false;
        } finally {
          readTask = null;
          state.loading = false;
          notify();
          if (queuedRead && !state.saving) {
            queuedRead = false;
            void load();
          }
        }
      })();
      return readTask;
    }

    async function command(action, fields = {}) {
      const data = state.data;
      if (!data || !data.permissions.can_control || state.saving) return false;
      state.saving = true;
      state.error = '';
      state.notice = '';
      notify();
      let reloadAfter = false;
      try {
        if (readTask) await readTask;
        if (!state.data || !state.data.permissions.can_control) return false;
        const result = await request('/api/timer', {
          method: 'POST',
          body: JSON.stringify({
            action,
            event_id: options.eventId,
            match_number: options.matchNumber,
            revision: state.data.timer.revision,
            ...fields,
          }),
        });
        if (result.response.status === 401) { state.error = 'unauthorized'; return false; }
        if (result.response.status === 403) {
          state.data.permissions.can_control = false;
          state.error = 'forbidden';
          return false;
        }
        if (result.response.status === 409) {
          state.notice = 'conflict';
          reloadAfter = true;
          return false;
        }
        if (!result.response.ok || result.data.success !== true) {
          state.error = result.response.status >= 500 ? 'network' : 'unavailable';
          return false;
        }
        merge(result);
        return true;
      } catch {
        state.error = 'network';
        return false;
      } finally {
        state.saving = false;
        notify();
        if (reloadAfter || queuedRead) {
          queuedRead = false;
          await load();
        }
      }
    }

    return {
      state,
      load,
      command,
      current: () => state.data ? projectedTimer(state.data.timer, now(), state.clockOffset) : null,
    };
  }

  function scheduledTime(start, offset) {
    if (!start) return '+' + offset + ' min';
    const [hours, minutes] = String(start).split(':').map(Number);
    const total = hours * 60 + minutes + offset;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function start() {
    const page = document.getElementById('timerPage');
    if (!page) return;
    const $ = id => document.getElementById(id);
    const route = parseRoute(window.location.search);
    const lang = () => window.SiteLanguage.get();
    const t = () => text[lang()];
    let token = '';
    let pollHandle;
    let displayHandle;
    let transient = '';
    try { token = sessionStorage.getItem('vi_admin_token') || ''; } catch { /* Admin access is optional. */ }

    function showRouteError() {
      $('timerError').hidden = false;
      $('timerError').textContent = t().invalid;
      $('timerSync').textContent = '';
    }

    if (route.invalid) {
      showRouteError();
      document.addEventListener('site-language-change', showRouteError);
      return;
    }

    const controller = createController({
      eventId: route.eventId,
      matchNumber: route.matchNumber,
      token,
      fetch: window.fetch.bind(window),
      storeToken(value) {
        try {
          if (value) sessionStorage.setItem('vi_admin_token', value);
          else sessionStorage.removeItem('vi_admin_token');
        } catch { /* A blocked store only removes admin controls from the next page load. */ }
      },
      onChange: render,
    });

    function replacePlayers(element, players) {
      const signature = JSON.stringify(players.map(player => player.display_name));
      if (element.dataset.players === signature) return;
      element.replaceChildren(...players.map(player => {
        const item = document.createElement('li');
        item.textContent = player.display_name;
        return item;
      }));
      element.dataset.players = signature;
    }

    function updateDurationInputs(timer) {
      const active = document.activeElement;
      if (!timer || (active && active.matches && active.matches('.timer-config input'))) return;
      $('timerMatchMinutes').value = Math.floor(timer.match_default_seconds / 60);
      $('timerMatchSeconds').value = timer.match_default_seconds % 60;
      $('timerSetMinutes').value = Math.floor(timer.set_default_seconds / 60);
      $('timerSetSeconds').value = timer.set_default_seconds % 60;
    }

    function render() {
      const state = controller.state;
      const data = state.data;
      const clock = controller.current();
      $('timerRefresh').disabled = state.loading || state.saving;
      $('timerShare').disabled = !data;
      $('timerError').hidden = !state.error && !state.notice;
      $('timerError').textContent = state.error ? t()[state.error] : state.notice ? t()[state.notice] : '';
      $('timerShell').hidden = !data;
      $('timerSync').textContent = state.saving ? t().saving : state.loading && !data ? t().loading
        : transient || (document.hidden ? t().hidden
          : (state.lastUpdated ? t().updated + ' ' + new Date(state.lastUpdated).toLocaleTimeString(
            lang() === 'de' ? 'de-AT' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · ' : '') + t().automatic);
      if (!data || !clock) return;

      const permissions = data.permissions;
      const role = permissions.is_admin ? (permissions.can_control ? t().adminRole : t().adminWaitingRole)
        : permissions.is_scorekeeper ? (permissions.can_control ? t().headRefRole : t().headRefWaitingRole)
          : t().publicRole;
      $('timerEvent').textContent = data.event.title;
      $('timerMatchMeta').textContent = [
        t().match + ' ' + data.match.number,
        t().court + ' ' + data.match.court,
        t().round + ' ' + data.match.round_number,
        t().scheduled + ' ' + scheduledTime(data.event.start_time, data.match.start_minute),
        data.match.referee_team ? t().refTeam + ' ' + data.match.referee_team.name
          : data.match.external_referee ? t().externalRef : '',
      ].filter(Boolean).join(' · ');
      $('timerRole').textContent = role;
      $('timerTeamA').textContent = data.match.team_a.name;
      $('timerTeamB').textContent = data.match.team_b.name;
      replacePlayers($('timerPlayersA'), data.match.team_a.players || []);
      replacePlayers($('timerPlayersB'), data.match.team_b.players || []);
      $('timerScore').textContent = Number.isInteger(data.match.score_a) && Number.isInteger(data.match.score_b)
        ? data.match.score_a + ' : ' + data.match.score_b : '– : –';
      $('timerBack').href = '/spieltag?event=' + encodeURIComponent(data.event.id);
      $('timerLogin').href = memberLoginHref(data.event.id, data.match.number);
      $('timerMember').hidden = !permissions.signed_in;
      $('timerLogin').hidden = permissions.signed_in;
      $('timerAccessCopy').textContent = permissions.is_admin || permissions.is_scorekeeper
        ? t().unavailableAccess : permissions.signed_in ? t().memberAccess : t().publicAccess;
      $('timerAccess').hidden = permissions.can_control;
      $('timerShell').classList.toggle('timer-controls-locked', !permissions.can_control);

      $('timerMatchClock').textContent = formatClock(clock.match_remaining_ms);
      $('timerSetClock').textContent = formatClock(clock.set_remaining_ms);
      $('timerStatus').textContent = t()[clock.status];
      page.classList.remove('timer-is-ready', 'timer-is-live', 'timer-is-paused',
        'timer-is-set_expired', 'timer-is-match_expired', 'timer-is-expired');
      page.classList.add('timer-is-' + clock.status);
      $('timerStart').disabled = !permissions.can_control || state.saving || clock.phase === 'running'
        || (clock.match_remaining_ms === 0 && clock.set_remaining_ms === 0);
      $('timerPause').disabled = !permissions.can_control || state.saving || clock.phase !== 'running';
      document.querySelectorAll('[data-timer-action="adjust"], [data-timer-action="reset"]').forEach(button => {
        button.disabled = !permissions.can_control || state.saving;
      });
      document.querySelectorAll('.timer-config input, .timer-config button[type="submit"]').forEach(control => {
        control.disabled = !permissions.can_control || state.saving;
      });
      updateDurationInputs(clock);
      document.title = t().match + ' ' + data.match.number + ' Timer — Vienna Imperials';
    }

    function schedulePoll() {
      clearTimeout(pollHandle);
      if (document.hidden) { render(); return; }
      pollHandle = setTimeout(async () => {
        await controller.load();
        schedulePoll();
      }, 5000);
    }

    document.addEventListener('click', event => {
      const button = event.target.closest('[data-timer-action]');
      if (!button) return;
      const fields = {};
      if (button.dataset.clock) fields.clock = button.dataset.clock;
      if (button.dataset.delta) fields.delta_seconds = Number(button.dataset.delta);
      void controller.command(button.dataset.timerAction, fields);
    });

    for (const config of [
      { form: 'timerMatchConfigForm', clock: 'match', minutes: 'timerMatchMinutes', seconds: 'timerMatchSeconds' },
      { form: 'timerSetConfigForm', clock: 'set', minutes: 'timerSetMinutes', seconds: 'timerSetSeconds' },
    ]) {
      $(config.form).addEventListener('submit', event => {
        event.preventDefault();
        const minutes = Number($(config.minutes).value);
        const seconds = Number($(config.seconds).value);
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 99
          || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) {
          controller.state.error = 'configInvalid';
          render();
          return;
        }
        void controller.command('configure', {
          clock: config.clock,
          default_seconds: minutes * 60 + seconds,
        });
      });
    }

    $('timerRefresh').addEventListener('click', () => {
      transient = '';
      void controller.load();
    });

    $('timerFullscreen').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        controller.state.error = 'fullscreenFailed';
        render();
      }
    });

    $('timerShare').addEventListener('click', async () => {
      const data = controller.state.data;
      if (!data) return;
      const url = new URL(timerPath(data.event.id, data.match.number), window.location.origin).href;
      try {
        if (navigator.share) await navigator.share({ title: document.title, url });
        else {
          await navigator.clipboard.writeText(url);
          transient = t().copied;
          render();
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          controller.state.error = 'network';
          render();
        }
      }
    });

    function applyLanguage() {
      document.querySelectorAll('[data-de][data-en]').forEach(element => {
        element.textContent = element.dataset[lang()];
      });
      render();
    }

    document.addEventListener('site-language-change', applyLanguage);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void controller.load();
      schedulePoll();
    });
    window.addEventListener('pagehide', () => {
      clearTimeout(pollHandle);
      clearInterval(displayHandle);
    });
    applyLanguage();
    void controller.load();
    displayHandle = setInterval(render, 200);
    schedulePoll();
  }

  window.MatchTimer = {
    parseRoute,
    timerPath,
    memberLoginHref,
    formatClock,
    projectedTimer,
    createController,
    start,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
