/* ═══════════════════════════════════════
   SITE FORMS — Vienna Imperials
   Join form signup
═══════════════════════════════════════ */

document.getElementById('joinForm')?.addEventListener('submit', submitJoinForm);

async function submitJoinForm(e) {
  e.preventDefault();
  const text = (de, en) => window.SiteLanguage.get() === 'en' ? en : de;
  const nameEl  = document.getElementById('joinName');
  const emailEl = document.getElementById('joinEmail');
  const name  = nameEl?.value.trim();
  const email = emailEl?.value.trim();
  const level  = document.getElementById('joinLevel')?.value || '';
  const source = document.getElementById('joinSource')?.value || '';
  if (!name || !email) { toast(text('Bitte Name und E-Mail ausfüllen.', 'Please enter your name and email.'), 'danger'); return; }
  const btn = document.getElementById('joinSubmitBtn');
  const resetButton = () => {
    if (btn) { btn.disabled = false; btn.textContent = text('Anfrage senden', 'Send enquiry'); }
  };
  if (btn) { btn.disabled = true; btn.textContent = text('Wird gesendet…', 'Sending…'); }
  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, level, source, type: 'join' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      const form = document.getElementById('joinForm');
      form.reset();
      form.style.display = 'none';
      const s = document.getElementById('joinSuccess');
      s.style.display = 'block';
    } else {
      toast(text('Die Anfrage konnte nicht gesendet werden. Bitte erneut versuchen.', 'Could not send your enquiry. Please try again.'), 'danger');
      resetButton();
    }
  } catch {
    toast(text('Verbindungsfehler. Bitte erneut versuchen.', 'Connection error. Please try again.'), 'danger');
    resetButton();
  }
}
