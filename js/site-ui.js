/* ═══════════════════════════════════════
   SITE UI — Vienna Imperials
   Scroll effects, reveal animations, mobile menu
═══════════════════════════════════════ */

// ── Scroll progress bar + sticky nav
const progressBar = document.getElementById('progress-bar');
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (progressBar) progressBar.style.width = (docHeight > 0 ? scrollTop / docHeight * 100 : 0) + '%';
  if (navbar) navbar.classList.toggle('scrolled', scrollTop > 40);
}, { passive: true });

// ── Reveal on scroll
const reveals = document.querySelectorAll('.reveal');
const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible', 'revealVisible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }) : null;

reveals.forEach(el => revealObserver ? revealObserver.observe(el) : el.classList.add('visible', 'revealVisible'));

// ── Gold underline reveal
const underlines = document.querySelectorAll('.gold-underline');
const underlineObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      underlineObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 }) : null;
underlines.forEach(el => underlineObserver ? underlineObserver.observe(el) : el.classList.add('visible'));

// ── Trigger hero reveals immediately
document.querySelectorAll('#hero .reveal').forEach((el, i) => {
  setTimeout(() => el.classList.add('visible', 'revealVisible'), i * 120);
});

// ── Mobile menu toggle
function toggleMenu(e) {
  if (e) e.stopPropagation();
  document.body.classList.toggle('nav-open');
  const expanded = document.body.classList.contains('nav-open');
  document.querySelector('.nav-toggle').setAttribute('aria-expanded', expanded);
}
document.getElementById('navToggleBtn')?.addEventListener('click', toggleMenu);

function closeMenu() {
  document.body.classList.remove('nav-open');
  document.getElementById('navToggleBtn')?.setAttribute('aria-expanded', 'false');
}

// ── Close mobile menu on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('nav') && document.body.classList.contains('nav-open')) {
    closeMenu();
  }
});

// ── Close mobile menu on link click
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    closeMenu();
  });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    closeMenu();
    document.getElementById('navToggleBtn')?.focus();
  }
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) closeMenu();
});
