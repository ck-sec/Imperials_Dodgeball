let sessionExpiredShown = false;

function authError(id, data = {}) {
  const errors = {
    VALIDATION_ERROR: ['Bitte prüfe deine Eingaben.', 'Please check your details.'],
    INVALID_CONTENT_TYPE: ['Bitte lade die Seite neu und versuche es erneut.', 'Please reload the page and try again.'],
    WEAK_PASSWORD: ['8–128 Zeichen, mit Buchstabe und Zahl.', 'Use 8–128 characters, including a letter and a number.'],
    INVALID_RESET_TOKEN: ['Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen an.', 'This link is invalid or expired. Request a new one.'],
    SERVICE_UNAVAILABLE: ['Der Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen.', 'The service is temporarily unavailable. Please try again later.'],
    PENDING_APPROVAL: ['Dein Konto wartet auf Freischaltung.', 'Your account is awaiting approval.'],
    FORBIDDEN: ['Dein Konto ist nicht freigeschaltet. Bitte kontaktiere den Club.', 'Your account is not approved. Please contact the club.']
  };
  const text = errors[data.code] || ['Anfrage fehlgeschlagen. Bitte erneut versuchen.', 'The request failed. Please try again.'];
  fieldError(id, text[0], text[1]);
}

function rateLimit(buttonId, errorId, data) {
  const seconds = Math.min(86400, Math.max(1, Math.ceil(Number(data.retry_after) || 60)));
  const button = byId(buttonId);
  button.dataset.retryUntil = String(Date.now() + seconds * 1000);
  fieldError(errorId, `Bitte in ${seconds} Sekunden erneut versuchen.`, `Please try again in ${seconds} seconds.`);
  setBusy(buttonId, true);
  setTimeout(() => {
    if (Number(button.dataset.retryUntil) <= Date.now()) {
      delete button.dataset.retryUntil;
      setBusy(buttonId, false);
    }
  }, seconds * 1000);
}

function finishAuthRequest(buttonId) {
  setBusy(buttonId, Number(byId(buttonId).dataset.retryUntil || 0) > Date.now());
}

function checkEmail(inputId, errorId) {
  const email = byId(inputId).value.trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    fieldError(errorId, 'Bitte gib eine gültige E-Mail-Adresse ein.', 'Please enter a valid email address.', inputId);
    return false;
  }
  return true;
}

function checkNewPassword(prefix) {
  const password = byId(prefix + 'Password').value;
  const confirm = byId(prefix + 'Confirm').value;
  let valid = true;
  if (!validPassword(password)) {
    fieldError(prefix + 'PasswordError', '8–128 Zeichen, mit Buchstabe und Zahl.', 'Use 8–128 characters, including a letter and a number.', prefix + 'Password');
    valid = false;
  }
  if (!confirm || password !== confirm) {
    fieldError(prefix + 'ConfirmError', 'Die Passwörter stimmen nicht überein.', 'The passwords do not match.', prefix + 'Confirm');
    valid = false;
  }
  return valid;
}

async function submitSignIn(event, reauth = false) {
  event.preventDefault();
  const prefix = reauth ? 'reAuth' : 'login';
  const formId = prefix + 'Form';
  const buttonId = prefix + 'Btn';
  if (byId(buttonId).disabled) return;
  clearErrors(formId);
  const email = byId(prefix + 'Email').value.trim();
  const password = byId(prefix + 'Password').value;
  let valid = true;
  if (!EMAIL_RE.test(email)) {
    fieldError(reauth ? 'reAuthError' : 'loginEmailError', 'Bitte gib eine gültige E-Mail-Adresse ein.', 'Please enter a valid email address.', prefix + 'Email');
    valid = false;
  }
  if (!password) {
    fieldError(reauth ? 'reAuthError' : 'loginPasswordError', 'Bitte gib dein Passwort ein.', 'Please enter your password.', prefix + 'Password');
    valid = false;
  }
  if (!valid) { focusInvalid(formId); return; }
  setBusy(buttonId, true);
  const view = currentView;
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ email, password, remember_me: reauth || byId('rememberMe').checked })
    });
    const data = await response.json();
    if (currentView !== view) return;
    if (response.status === 429) { rateLimit(buttonId, prefix + 'Error', data); return; }
    if (!response.ok) {
      if (data.code === 'PENDING_APPROVAL') { showView('pending'); return; }
      if (response.status === 401) {
        fieldError(prefix + 'Error', 'E-Mail oder Passwort ist nicht korrekt.', 'The email or password is incorrect.');
      } else authError(prefix + 'Error', data);
      return;
    }
    if (!data.user) throw new Error('Missing sign-in user');
    clearMemberState();
    currentUser = data.user;
    sessionExpiredShown = false;
    byId(prefix + 'Password').value = '';
    enterDashboard();
  } catch (error) {
    console.error('Member sign-in failed:', error);
    fieldError(prefix + 'Error', 'Anmeldung nicht erreichbar. Bitte erneut versuchen.', 'Sign-in is unavailable. Please try again.');
  } finally { finishAuthRequest(buttonId); }
}

function handleLogin(event) { return submitSignIn(event); }
function handleReAuth(event) { return submitSignIn(event, true); }

async function handleRegister(event) {
  event.preventDefault();
  if (byId('registerBtn').disabled) return;
  clearErrors('registerForm');
  const name = byId('regName').value.trim();
  let valid = checkEmail('regEmail', 'regEmailError');
  if (name.length < 2 || name.length > 50) {
    fieldError('regNameError', 'Bitte verwende 2–50 Zeichen.', 'Please use 2–50 characters.', 'regName');
    valid = false;
  }
  if (!checkNewPassword('reg')) valid = false;
  if (!valid) { focusInvalid('registerForm'); return; }
  setBusy('registerBtn', true);
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ display_name: name, email: byId('regEmail').value.trim(), password: byId('regPassword').value })
    });
    const data = await response.json();
    if (currentView !== 'register') return;
    if (response.status === 429) { rateLimit('registerBtn', 'registerError', data); return; }
    if (response.status === 409) {
      fieldError('regEmailError', 'Diese E-Mail ist bereits registriert. Melde dich an oder setze dein Passwort zurück.', 'This email is already registered. Sign in or reset your password.', 'regEmail');
      return;
    }
    if (!response.ok) { authError('registerError', data); return; }
    byId('regPassword').value = '';
    byId('regConfirm').value = '';
    if (data.pending === true) { showView('pending'); return; }
    if (!data.user) throw new Error('Missing registration state');
    clearMemberState();
    currentUser = data.user;
    sessionExpiredShown = false;
    enterDashboard();
  } catch (error) {
    console.error('Member registration failed:', error);
    fieldError('registerError', 'Registrierung nicht erreichbar. Bitte erneut versuchen.', 'Registration is unavailable. Please try again.');
  } finally { finishAuthRequest('registerBtn'); }
}

function showSessionExpired() {
  if (sessionExpiredShown) return;
  sessionExpiredShown = true;
  byId('reAuthEmail').value = currentUser ? currentUser.email : '';
  byId('reAuthEmail').readOnly = !!currentUser;
  byId('reAuthPassword').value = '';
  clearErrors('reAuthForm');
  byId('sessionOverlay').showModal();
  byId(currentUser ? 'reAuthPassword' : 'reAuthEmail').focus();
}

async function handleLogout() {
  const inDialog = byId('sessionOverlay').open;
  const buttonId = inDialog ? 'fullLogoutLink' : 'navLogoutBtn';
  if (byId(buttonId).disabled) return;
  setBusy(buttonId, true);
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error('Logout rejected');
    clearMemberState();
    sessionExpiredShown = false;
    window.MemberRecovery.clear();
    showView('login');
    setMessage('loginMessage', 'Du bist abgemeldet.', 'You are signed out.');
  } catch (error) {
    console.error('Member logout failed:', error);
    setMessage(inDialog ? 'reAuthError' : 'accountMessage',
      'Abmelden fehlgeschlagen. Bitte erneut versuchen; deine Sitzung ist noch aktiv.',
      'Sign-out failed. Please try again; your session is still active.', true);
  } finally { setBusy(buttonId, false); }
}

async function handleRecovery(event) {
  event.preventDefault();
  if (byId('recoveryBtn').disabled) return;
  clearErrors('recoveryForm');
  if (!checkEmail('recoveryEmail', 'recoveryEmailError')) { focusInvalid('recoveryForm'); return; }
  setBusy('recoveryBtn', true);
  try {
    const response = await fetch('/api/auth/password-reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', email: byId('recoveryEmail').value.trim() })
    });
    const data = await response.json();
    if (response.status === 429 || data.code === 'RATE_LIMITED') { rateLimit('recoveryBtn', 'recoveryError', data); return; }
    if (!response.ok) { authError('recoveryError', data); return; }
    byId('recoveryForm').hidden = true;
    setMessage('recoveryMessage',
      'Falls ein berechtigtes Konto existiert, erhältst du eine E-Mail mit dem Link. Prüfe auch deinen Spam-Ordner.',
      'If an eligible account exists, you’ll receive an email with a reset link. Check your spam folder too.');
    byId('recoveryMessage').focus();
  } catch (error) {
    console.error('Password recovery request failed:', error);
    fieldError('recoveryError', 'Der Dienst ist nicht erreichbar. Bitte erneut versuchen.', 'The service is unavailable. Please try again.');
  } finally { finishAuthRequest('recoveryBtn'); }
}

function invalidateReset() {
  window.MemberRecovery.clear();
  setBusy('resetBtn', false);
  byId('resetPassword').value = '';
  byId('resetConfirm').value = '';
  byId('resetForm').hidden = true;
  authError('resetError', { code: 'INVALID_RESET_TOKEN' });
}

async function handleResetPassword(event) {
  event.preventDefault();
  if (byId('resetBtn').disabled) return;
  clearErrors('resetForm');
  byId('resetError').hidden = true;
  const token = window.MemberRecovery.getToken();
  if (!token) { invalidateReset(); return; }
  if (!checkNewPassword('reset')) { focusInvalid('resetForm'); return; }
  const revision = window.MemberRecovery.getRevision();
  setBusy('resetBtn', true);
  try {
    const response = await fetch('/api/auth/password-reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', token, password: byId('resetPassword').value })
    });
    const data = await response.json();
    if (revision !== window.MemberRecovery.getRevision()) return;
    if (response.status === 429 || data.code === 'RATE_LIMITED') { rateLimit('resetBtn', 'resetError', data); return; }
    if (!response.ok) {
      if (data.code === 'INVALID_RESET_TOKEN') invalidateReset();
      else authError('resetError', data);
      return;
    }
    setBusy('resetBtn', false);
    window.MemberRecovery.clear();
    clearMemberState();
    sessionExpiredShown = false;
    showView('login');
    setMessage('loginMessage', 'Passwort gespeichert. Bitte melde dich neu an.', 'Password saved. Please sign in again.');
  } catch (error) {
    if (revision !== window.MemberRecovery.getRevision()) return;
    console.error('Password reset failed:', error);
    fieldError('resetError', 'Der Dienst ist nicht erreichbar. Bitte erneut versuchen.', 'The service is unavailable. Please try again.');
  } finally {
    if (revision === window.MemberRecovery.getRevision()) finishAuthRequest('resetBtn');
  }
}
