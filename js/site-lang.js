(function () {
  'use strict';
  const originals = new WeakMap();
  const originalAttributes = new WeakMap();

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
    ['placeholder', 'aria-label'].forEach(function (attribute) {
      document.querySelectorAll('[data-en-' + attribute + ']').forEach(function (element) {
        if (!originalAttributes.has(element)) originalAttributes.set(element, {});
        const saved = originalAttributes.get(element);
        if (!(attribute in saved)) saved[attribute] = element.getAttribute(attribute);
        element.setAttribute(attribute, lang === 'en' ? element.getAttribute('data-en-' + attribute) : saved[attribute]);
      });
    });
  }

  document.addEventListener('site-language-change', function (event) {
    translate(event.detail.lang);
  });
  translate(window.SiteLanguage ? window.SiteLanguage.get() : 'de');
})();
