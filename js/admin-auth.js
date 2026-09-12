/* ═══════════════════════════════════════
   ADMIN AUTH — Vienna Imperials
   Admin login/logout, session management, UI state
   Used on admin.html (standalone admin dashboard)
═══════════════════════════════════════ */

const SESSION_KEY = 'vi_admin_token';

function isAdmin() { return !!sessionStorage.getItem(SESSION_KEY); }
function getToken() { return sessionStorage.getItem(SESSION_KEY) || ''; }

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
  if (tab === 'members') loadPendingMembers();
  if (tab === 'training') loadAdminTrainingSessions();
  if (tab === 'league') loadAdminLeague();
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
  } else {
    document.body.classList.remove('admin-mode');
  }
}

/* ── Login ── */
async function attemptAdminLogin() {
  const val = document.getElementById('adminLoginPass').value;
  const loginBtn = document.getElementById('loginBtn');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Verifying…';
  try {
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: val })
    });
    if (res.ok) {
      const { token } = await res.json();
      sessionStorage.setItem(SESSION_KEY, token);
      updateAdminUI();
      toast('Welcome back, Admin', 'success');
    } else {
      const card = document.getElementById('adminLoginCard');
      const error = document.getElementById('adminLoginError');
      error.classList.add('show');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      document.getElementById('adminLoginPass').value = '';
      document.getElementById('adminLoginPass').focus();
    }
  } catch (err) {
    toast('Login failed — network error', 'danger');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Enter Admin Mode';
  }
}

/* ── Logout ── */
function adminLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  updateAdminUI();
  toast('Logged out', 'info');
}

/* ── Keyboard handlers ── */
document.getElementById('adminLoginPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') attemptAdminLogin();
});

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
document.addEventListener('DOMContentLoaded', updateAdminUI, { once: true });
