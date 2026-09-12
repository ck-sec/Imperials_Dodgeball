/* One language preference shared by public pages and member tools. */
(function () {
  'use strict';
  if (window.SiteLanguage) return;

  const key = 'vi_site_language';
  let lang = 'de';
  let storageWarning = false;

  function warn(error) {
    if (storageWarning) return;
    storageWarning = true;
    console.warn('Language preference could not be saved or read. Using this page’s in-memory preference.', error);
  }

  try {
    const saved = localStorage.getItem(key);
    if (saved === 'de' || saved === 'en') lang = saved;
  } catch (error) {
    warn(error);
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-site-language]').forEach(function (button) {
      const active = button.dataset.siteLanguage === lang;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
    document.dispatchEvent(new CustomEvent('site-language-change', { detail: { lang: lang } }));
  }

  window.SiteLanguage = {
    get: function () { return lang; },
    set: function (next) {
      if (next !== 'de' && next !== 'en') return;
      lang = next;
      try {
        localStorage.setItem(key, lang);
      } catch (error) {
        warn(error);
      }
      apply();
    }
  };

  document.addEventListener('click', function (event) {
    const button = event.target.closest && event.target.closest('[data-site-language]');
    if (button) window.SiteLanguage.set(button.dataset.siteLanguage);
  });
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== null) return;
    lang = event.newValue === 'en' ? 'en' : 'de';
    apply();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
