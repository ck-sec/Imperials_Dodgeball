/* ═══════════════════════════════════════
   ADMIN AUTH — Vienna Imperials
   Admin login/logout, session management, UI state
   Used on admin.html (standalone admin dashboard)
═══════════════════════════════════════ */

const SESSION_KEY = 'vi_admin_token';
const ADMIN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
let adminRefreshTimer = null;
let adminRefreshPromise = null;

function isAdmin() { return !!sessionStorage.getItem(SESSION_KEY); }
function getToken() { return sessionStorage.getItem(SESSION_KEY) || ''; }

function adminTokenExpiresAt(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)));
    if (payload.role !== 'admin' || payload.iss !== 'vienna-admin' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) return 0;
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

function clearAdminRefreshTimer() {
  if (adminRefreshTimer !== null) clearTimeout(adminRefreshTimer);
  adminRefreshTimer = null;
}

function scheduleAdminRefresh(token = getToken()) {
  clearAdminRefreshTimer();
  const expiresAt = adminTokenExpiresAt(token);
  if (!expiresAt) return;
  const delay = Math.max(1000, expiresAt - Date.now() - ADMIN_REFRESH_BUFFER_MS);
  adminRefreshTimer = setTimeout(() => {
    refreshAdminSession().catch(error => {
      console.error('Admin session refresh failed:', error);
      toast('Admin session refresh failed. Retrying…', 'danger');
      scheduleAdminRefreshRetry();
    });
  }, delay);
}

function scheduleAdminRefreshRetry() {
  if (!getToken()) return;
  clearAdminRefreshTimer();
  adminRefreshTimer = setTimeout(() => {
    refreshAdminSession().catch(error => {
      console.error('Admin session refresh retry failed:', error);
      scheduleAdminRefreshRetry();
    });
  }, 60000);
}

function storeAdminToken(token) {
  if (typeof token !== 'string' || !token || !adminTokenExpiresAt(token)) {
    throw new Error('The server returned an invalid admin session.');
  }
  sessionStorage.setItem(SESSION_KEY, token);
  scheduleAdminRefresh(token);
}

function setAdminAccessStatus(message, tone = 'info') {
  const status = document.getElementById('adminAccessStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function expireAdminSession(message = 'Sign in with an approved member account to continue.', tone = 'info') {
  sessionStorage.removeItem(SESSION_KEY);
  clearAdminRefreshTimer();
  adminRefreshPromise = null;
  updateAdminUI();
  setAdminAccessStatus(message, tone);
}

async function refreshAdminSession() {
  if (adminRefreshPromise) return adminRefreshPromise;
  const pending = (async () => {
    const response = await fetch('/api/admin-refresh', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) {
        expireAdminSession('Your member account no longer has administrator access.', 'error');
      } else if (response.status === 503) {
        expireAdminSession('Admin access is not configured yet. Run the admin access migration before using this page.', 'error');
      } else if (response.status === 401) {
        expireAdminSession('Your admin session ended. Sign in with your member account to continue.');
      } else {
        if (data.code) console.error('Admin refresh failed:', data.code);
        throw new Error(`Admin refresh failed (HTTP ${response.status}).`);
      }
      return false;
    }
    const data = await response.json();
    storeAdminToken(data.token);
    return true;
  })();
  adminRefreshPromise = pending;
  try {
    return await pending;
  } finally {
    if (adminRefreshPromise === pending) adminRefreshPromise = null;
  }
}

async function adminFetch(url, options = {}, retried = false) {
  const token = getToken();
  if (!token) {
    expireAdminSession();
    throw new Error('ADMIN_SESSION_EXPIRED');
  }
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token }
  });
  if (response.status !== 401) return response;
  if (!retried && await refreshAdminSession()) return adminFetch(url, options, true);
  expireAdminSession();
  throw new Error('ADMIN_SESSION_EXPIRED');
}

/* ── Toast & escape utilities (self-contained for admin page) ── */
let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const dot = document.getElementById('toastDot');
  document.getElementById('toastMsg').textContent = msg;
  dot.className = `toast-dot ${type}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Tab switching ── */
function switchAdminDashTab(tab, btn) {
  document.querySelectorAll('.dash-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.classList.add('active');

  // Load data for tab on first visit
  if (tab === 'approvals') loadPendingMembers();
  if (tab === 'member-management') loadMemberManagement();
  if (tab === 'training') loadAdminTrainingSessions();
  if (tab === 'league') loadAdminLeague();
  if (tab === 'statistics') loadAdminStatistics();
  if (tab === 'rankings') { loadPlayersFromAPI().then(render); }
}

/* ── UI state: show login or dashboard ── */
function updateAdminUI() {
  const admin = isAdmin();
  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashboardView');
  const navRight = document.getElementById('navRight');

  if (loginView) loginView.style.display = admin ? 'none' : 'flex';
  if (dashView) dashView.classList.toggle('active', admin);
  if (navRight) navRight.style.display = admin ? 'flex' : 'none';

  if (admin) {
    document.body.classList.add('admin-mode');
    // Load default tab data
    loadPendingMembers();
    loadPlayersFromAPI().then(render);
    scheduleAdminRefresh();
  } else {
    document.body.classList.remove('admin-mode');
  }
}

/* ── Member-account admin access ── */
async function requestAdminElevation(allowMemberRefresh = true) {
  let response = await fetch('/api/admin-login', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store'
  });
  if (response.status !== 401 || !allowMemberRefresh) return response;

  const refreshed = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store'
  });
  if (!refreshed.ok) return response;
  return fetch('/api/admin-login', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store'
  });
}

async function attemptAdminLogin(options = {}) {
  const silent = options && options.silent === true;
  const loginBtn = document.getElementById('loginBtn');
  const loginLink = document.getElementById('adminMemberLoginLink');
  loginBtn.disabled = true;
  loginLink.hidden = true;
  loginBtn.textContent = 'Checking…';
  setAdminAccessStatus('Checking your member account…');
  try {
    const res = await requestAdminElevation(true);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      storeAdminToken(data.token);
      setAdminAccessStatus('Administrator access confirmed.', 'success');
      updateAdminUI();
      if (!silent) toast(`Welcome${data.admin && data.admin.display_name ? `, ${data.admin.display_name}` : ''}`, 'success');
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      updateAdminUI();
      if (res.status === 401) {
        setAdminAccessStatus('No active member session was found. Sign in through the member portal first.');
      } else if (res.status === 403) {
        setAdminAccessStatus('Access denied. This member account is not one of the approved administrators.', 'error');
      } else if (res.status === 503 || data.code === 'ADMIN_ACCESS_NOT_CONFIGURED') {
        setAdminAccessStatus('Admin access is not configured yet. Run the admin access migration before using this page.', 'error');
      } else {
        setAdminAccessStatus('Admin access could not be checked. Please try again.', 'error');
      }
    }
  } catch (err) {
    console.error('Admin access check failed:', err);
    setAdminAccessStatus('Admin access could not be checked. Check your connection and try again.', 'error');
    if (!silent) toast('Access check failed — network error', 'danger');
  } finally {
    loginBtn.disabled = false;
    loginLink.hidden = false;
    loginBtn.textContent = 'Check access again';
  }
}

/* ── Logout ── */
function adminLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  clearAdminRefreshTimer();
  adminRefreshPromise = null;
  updateAdminUI();
  setAdminAccessStatus('Admin mode ended. Your member account remains signed in.');
  toast('Logged out', 'info');
  fetch('/api/admin-refresh', { method: 'DELETE', credentials: 'include' }).then(response => {
    if (!response.ok) console.error('Admin refresh session could not be cleared on the server.');
  }).catch(error => console.error('Admin refresh session cleanup failed:', error));
}

/* ── Keyboard handlers ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (typeof closeModal === 'function') closeModal();
    if (typeof closeConfirm === 'function') closeConfirm();
    if (typeof closeImport === 'function') closeImport();
    if (typeof closeSessionModal === 'function') closeSessionModal();
    if (typeof closeRecurringModal === 'function') closeRecurringModal();
  }
});

/* ── Boot ── */
// Session restoration needs the dashboard modules loaded by later deferred scripts.
async function initializeAdminSession() {
  const token = getToken();
  if (token && adminTokenExpiresAt(token) > Date.now()) {
    updateAdminUI();
    return;
  }
  if (token) sessionStorage.removeItem(SESSION_KEY);

  try {
    if (await refreshAdminSession()) {
      updateAdminUI();
      return;
    }
  } catch (error) {
    console.error('Admin session restoration failed:', error);
  }

  try {
    await attemptAdminLogin({ silent: true });
  } catch (error) {
    console.error('Member admin access restoration failed:', error);
    expireAdminSession('Admin access could not be checked. Check your connection and try again.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', initializeAdminSession, { once: true });
