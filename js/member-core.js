let currentUser = null;
let currentView = 'login';
let activeTab = 'training';
let memberEpoch = 0;
let trainingSessions = [];
let trainingLoaded = false;
let refreshPromise = null;
const rsvpInFlight = new Set();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEMBER_RETURN_KEY = 'vi_member_return';
let memberReturnTo = '';

function safeMemberReturn(value) {
  if (typeof value !== 'string' || /[\s\\#]/.test(value)) return '';
  const matchday = /^\/spieltag(?:\?event=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i.exec(value);
  if (matchday) return '/spieltag' + (matchday[1] ? '?event=' + matchday[1].toLowerCase() : '');
  const timer = /^\/timer\?event=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})&match=([1-9]|10)$/i.exec(value);
  return timer ? `/timer?event=${timer[1].toLowerCase()}&match=${Number(timer[2])}` : '';
}

function initMemberReturn() {
  const values = new URLSearchParams(window.location.search).getAll('return_to');
  memberReturnTo = values.length === 1 ? safeMemberReturn(values[0]) : '';
  if (values.length && !memberReturnTo) console.error('Ignored invalid match return target.');
  try {
    if (values.length) {
      if (memberReturnTo) sessionStorage.setItem(MEMBER_RETURN_KEY, JSON.stringify({ target: memberReturnTo, expires: Date.now() + 30 * 60 * 1000 }));
      else sessionStorage.removeItem(MEMBER_RETURN_KEY);
    } else if (window.MemberRecovery.present) {
      const saved = JSON.parse(sessionStorage.getItem(MEMBER_RETURN_KEY) || 'null');
      if (saved && Number.isFinite(saved.expires) && saved.expires > Date.now()) memberReturnTo = safeMemberReturn(saved.target);
    }
  } catch (error) {
    console.error('Member return state could not be stored or restored:', error.name);
  }
  byId('memberReturnNotice').hidden = !memberReturnTo;
  byId('memberReturnLink').href = memberReturnTo || '/spieltag';
}

function completeMemberReturn() {
  const target = safeMemberReturn(memberReturnTo);
  if (!currentUser || !target || window.MemberRecovery.present) return false;
  memberReturnTo = '';
  try { sessionStorage.removeItem(MEMBER_RETURN_KEY); } catch (error) {
    console.error('Member return state could not be cleared:', error.name);
  }
  window.location.replace(target);
  return true;
}

function memberLang() { return window.SiteLanguage.get(); }
function mt(de, en) { return memberLang() === 'de' ? de : en; }
function byId(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
function formatTime(value) { return value ? String(value).slice(0, 5) : ''; }
function viennaNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const part = name => parts.find(item => item.type === name).value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, minutes: Number(part('hour')) * 60 + Number(part('minute')) };
}
function setMessage(id, de, en, error = false) {
  const element = byId(id);
  element.dataset.de = de;
  element.dataset.en = en;
  element.textContent = mt(de, en);
  element.hidden = false;
  element.classList.toggle('member-error', error);
}
function applyMemberLanguage() {
  document.querySelectorAll('[data-de][data-en]').forEach(element => {
    element.textContent = element.dataset[memberLang()];
  });
  document.title = mt('Mitglieder', 'Members') + ' — Vienna Imperials';
  document.querySelectorAll('.password-toggle').forEach(button => {
    const visible = byId(button.getAttribute('aria-controls')).type === 'text';
    button.textContent = visible ? mt('Verbergen', 'Hide') : mt('Zeigen', 'Show');
  });
}

async function api(url, opts = {}) {
  const epoch = memberEpoch;
  const { _retried, _suppressExpired, ...request } = opts;
  const response = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...request });
  if (epoch !== memberEpoch) throw new Error('STALE_REQUEST');
  if (response.status !== 401) return response;
  const refreshed = !_retried && await silentRefresh();
  if (epoch !== memberEpoch) throw new Error('STALE_REQUEST');
  if (refreshed) return api(url, { ...opts, _retried: true });
  if (!_suppressExpired && currentView === 'dashboard') showSessionExpired();
  throw new Error('SESSION_EXPIRED');
}

async function silentRefresh() {
  if (refreshPromise) return refreshPromise;
  const epoch = memberEpoch;
  const pending = (async () => {
    const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) throw new Error('REFRESH_UNAVAILABLE');
    const data = await response.json();
    if (epoch !== memberEpoch) return false;
    if (data.user) currentUser = data.user;
    return true;
  })();
  refreshPromise = pending;
  try { return await pending; }
  finally { if (refreshPromise === pending) refreshPromise = null; }
}

function showView(view) {
  if (currentView === 'reset' && view !== 'reset') {
    window.MemberRecovery.clear();
    byId('resetPassword').value = '';
    byId('resetConfirm').value = '';
  }
  currentView = view;
  ['login', 'register', 'pending', 'recovery', 'reset', 'dashboard'].forEach(name => {
    byId(name + 'View').hidden = name !== view;
  });
  const dialog = byId('sessionOverlay');
  if (dialog.open) dialog.close();
  const focus = { login: 'loginEmail', register: 'regName', pending: 'pendingHeading', recovery: 'recoveryEmail', reset: 'resetPassword' }[view];
  if (focus) byId(focus).focus();
}

function switchTab(tab, focus = false) {
  if (!['training', 'league', 'account'].includes(tab)) tab = 'training';
  activeTab = tab;
  document.querySelectorAll('.dash-tab').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== 'tab-' + tab; });
  if (tab === 'training' && !trainingLoaded && !trainingLoading) loadTrainingSessions();
}

function clearErrors(formId) {
  const form = byId(formId);
  form.querySelectorAll('.field-error').forEach(element => { element.hidden = true; });
  form.querySelectorAll('[aria-invalid]').forEach(element => element.removeAttribute('aria-invalid'));
}
function fieldError(id, de, en, inputId) {
  setMessage(id, de, en, true);
  if (inputId) byId(inputId).setAttribute('aria-invalid', 'true');
}
function focusInvalid(formId) {
  const input = byId(formId).querySelector('[aria-invalid="true"]');
  if (input) input.focus();
}
function validPassword(value) {
  return value.length >= 8 && value.length <= 128 && /[a-z]/i.test(value) && /\d/.test(value);
}
function setBusy(id, busy) {
  const button = byId(id);
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}
function togglePasswordVisibility(button) {
  const input = byId(button.getAttribute('aria-controls'));
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.textContent = visible ? mt('Verbergen', 'Hide') : mt('Zeigen', 'Show');
}

function clearMemberState() {
  memberEpoch++;
  refreshPromise = null;
  currentUser = null;
  trainingLoaded = false;
  trainingLoading = false;
  trainingSessions = [];
  rsvpInFlight.clear();
  Object.keys(attendeeCache).forEach(key => delete attendeeCache[key]);
  Object.keys(trainingErrors).forEach(key => delete trainingErrors[key]);
  memberLeagueData = null;
  memberCurrentLeagueData = null;
  memberEvents = [];
  memberLeagueRequest++;
  trainingRequest++;
  archiveData = null;
  archiveLoaded = false;
  archiveLoading = false;
  archiveVisible = 20;
  byId('seasonOneArchive').open = false;
  byId('emailNotifToggle').disabled = false;
  setBusy('savePrefsBtn', false);
  ['accountMessage', 'settingsSaved', 'loginMessage', 'trainingLoading'].forEach(id => { byId(id).hidden = true; });
  ['trainingList', 'otherMemberEvents', 'memberLeagueContent', 'trainingLeagueSummary', 'memberArchiveContent', 'accountName', 'accountEmail', 'dashName'].forEach(id => { byId(id).textContent = ''; });
  document.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
}
