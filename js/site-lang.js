(function () {
  'use strict';
  const originals = new WeakMap();

  function translate(lang) {
    document.querySelectorAll('.lang-content[data-lang], [data-public-language], .lang-de, .lang-en').forEach(function (element) {
      const language = element.dataset.publicLanguage || element.dataset.lang || (element.classList.contains('lang-de') ? 'de' : 'en');
      element.hidden = language !== lang;
      element.style.removeProperty('display');
      element.lang = language;
    });
    document.querySelectorAll('[data-en]').forEach(function (element) {
      if (!originals.has(element)) originals.set(element, element.textContent);
      element.textContent = lang === 'en' ? element.dataset.en : originals.get(element);
    });
  }

  document.addEventListener('site-language-change', function (event) {
    translate(event.detail.lang);
  });
  translate(window.SiteLanguage ? window.SiteLanguage.get() : 'de');
})();
