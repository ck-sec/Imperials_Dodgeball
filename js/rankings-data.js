/* ═══════════════════════════════════════
   RANKINGS DATA — Vienna Imperials
   Player data, localStorage sync, API persistence
═══════════════════════════════════════ */

let players  = JSON.parse(localStorage.getItem('vi_players') || '[]');
let nextId   = players.length ? Math.max(0, ...players.map(p => p.id)) + 1 : 1;

async function loadPlayersFromAPI() {
  try {
    const res = await fetch('/api/rankings');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        players = data;
        nextId = Math.max(0, ...players.map(p => p.id)) + 1;
        localStorage.setItem('vi_players', JSON.stringify(players));
      }
    }
  } catch (e) { /* fall back to localStorage cache */ }
}

let filter   = 'all';
let sortKey  = 'points';
let editId   = null;
let deleteId = null;
let rankVisible = 25;

function save() {
  localStorage.setItem('vi_players', JSON.stringify(players));
  if (typeof isAdmin === 'function' && isAdmin()) {
    adminFetch('/api/rankings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(players)
    }).catch(err => console.error('Rankings save failed:', err));
  }
}
