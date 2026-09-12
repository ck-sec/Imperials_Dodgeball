/* Runs before other page resources: reset credentials never remain in the URL. */
(function () {
  'use strict';
  let present = false;
  let token = null;
  let revision = 0;

  function captureResetFragment() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (!fragment.has('reset')) return;
    const candidate = fragment.get('reset');
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    token = /^[a-f0-9]{64}$/i.test(candidate) ? candidate : null;
    present = true;
    revision++;
    document.dispatchEvent(new Event('member-reset-link'));
  }

  window.MemberRecovery = {
    get present() { return present; },
    getToken: function () { return token; },
    getRevision: function () { return revision; },
    clear: function () { token = null; present = false; revision++; }
  };
  window.addEventListener('hashchange', captureResetFragment);
  captureResetFragment();
})();
