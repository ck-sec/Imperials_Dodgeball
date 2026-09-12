(function () {
  'use strict';
  const sticky = document.getElementById('stickyCta');
  const hero = document.querySelector('.lp-hero');
  const contact = document.getElementById('lp-cta');
  if (!sticky || !hero || !contact) return;

  function update() {
    const show = hero.getBoundingClientRect().bottom < 0 &&
      contact.getBoundingClientRect().top > window.innerHeight;
    sticky.style.display = show ? 'block' : 'none';
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
