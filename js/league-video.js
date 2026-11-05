// Social League intro video: loads only near the viewport, plays muted while visible,
// stays on the poster for reduced-motion / data-saver users until they press play.
(function () {
  'use strict';
  const root = document.querySelector('[data-league-video]');
  if (!root) return;
  const video = root.querySelector('video');
  const pauseBtn = root.querySelector('[data-video-pause]');
  const soundBtn = root.querySelector('[data-video-sound]');
  if (!video || !pauseBtn || !soundBtn) return;

  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  let userPaused = !!(reduceMotion && reduceMotion.matches) || saveData;
  let visible = false;
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    video.querySelectorAll('source[data-src]').forEach(function (source) {
      source.src = source.dataset.src;
      source.removeAttribute('data-src');
    });
    video.load();
  }

  function sync() {
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    soundBtn.setAttribute('aria-pressed', String(!video.muted));
    if (visible && !userPaused) {
      load();
      const playing = video.play();
      if (playing && typeof playing.catch === 'function') {
        playing.catch(function (error) {
          // Autoplay blocked: stay on the poster until the visitor presses play.
          // (AbortError just means a pause() interrupted play() while scrolling past.)
          if (error && error.name === 'NotAllowedError') { userPaused = true; sync(); }
        });
      }
    } else if (!video.paused) {
      video.pause();
    }
  }

  pauseBtn.addEventListener('click', function () {
    userPaused = !userPaused;
    sync();
  });

  soundBtn.addEventListener('click', function () {
    video.muted = !video.muted;
    if (!video.muted) userPaused = false;
    sync();
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting && !userPaused) load(); });
    }, { rootMargin: '300px 0px' }).observe(root);
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible = entry.isIntersecting && entry.intersectionRatio >= 0.5; sync(); });
    }, { threshold: [0, 0.5] }).observe(root);
  } else {
    visible = true;
    sync();
  }

  if (reduceMotion && typeof reduceMotion.addEventListener === 'function') {
    reduceMotion.addEventListener('change', function (event) {
      if (event.matches) { userPaused = true; sync(); }
    });
  }
})();
