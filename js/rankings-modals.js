/* ═══════════════════════════════════════
   RANKINGS MODALS — Vienna Imperials
   Add/Edit player modal, delete confirmation modal
═══════════════════════════════════════ */

// ── Edit / Add Modal
let membersList = null; // cached approved members

async function rankingLinkRequest(body) {
  const response = await adminFetch('/api/admin/members', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (response.ok) return;
  let message = 'Member link could not be saved.';
  try {
    const data = await response.json();
    if (data.error) message = data.error;
  } catch {
    message += ` HTTP ${response.status}.`;
  }
  throw new Error(message);
}

async function loadMembersForLinking() {
  if (membersList) return membersList;
  try {
    const res = await adminFetch('/api/admin/members?status=approved');
    if (!res.ok) throw new Error(`Member accounts could not be loaded (HTTP ${res.status}).`);
    const data = await res.json();
    membersList = data.members || [];
    return membersList;
  } catch (error) {
    console.error('Ranking member links could not be loaded:', error);
    toast(error.message || 'Member accounts could not be loaded.', 'danger');
    return [];
  }
}

async function openModal(id = null) {
  editId = id;
  const linkGroup = document.getElementById('fMemberLinkGroup');
  const linkSelect = document.getElementById('fMemberLink');

  if (id !== null) {
    const p = players.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modalEyebrow').textContent = 'Edit Player';
    document.getElementById('modalTitle').textContent   = p.name;
    document.getElementById('saveBtn').textContent      = 'Save Changes';
    document.getElementById('fName').value   = p.name;
    document.getElementById('fGender').value = p.gender;
    document.getElementById('fTier').value   = p.tier;
    document.getElementById('fPoints').value = p.points;
    document.getElementById('fGain').value   = p.gain ?? '';
    document.getElementById('fPlayed').value = p.played;
    document.getElementById('fStreak').value = p.streak;
    document.getElementById('fRef').value    = p.bp;
    document.getElementById('fChange').value = p.change;

    // Show member link dropdown for admins
    if (isAdmin()) {
      linkGroup.style.display = '';
      linkSelect.innerHTML = '<option value="">— No member linked —</option><option disabled>Loading...</option>';
      const members = await loadMembersForLinking();
      linkSelect.innerHTML = '<option value="">— No member linked —</option>' +
        members.map(m => `<option value="${m.id}">${esc(m.display_name)} (${esc(m.email)})</option>`).join('');
      // Pre-select the member currently linked to this player
      const linked = members.find(m => m.ranking_player_name && m.ranking_player_name.toLowerCase() === p.name.toLowerCase());
      if (linked) linkSelect.value = linked.id;
    }
  } else {
    document.getElementById('modalEyebrow').textContent = 'Add Player';
    document.getElementById('modalTitle').textContent   = 'New Entry';
    document.getElementById('saveBtn').textContent      = 'Add Player';
    document.getElementById('playerForm').reset();
    linkGroup.style.display = 'none';
  }
  document.getElementById('modalBackdrop').classList.add('open');
  setTimeout(() => document.getElementById('fName').focus(), 60);
}

function closeModal() { document.getElementById('modalBackdrop').classList.remove('open'); editId = null; }
function backdropClick(e) { if (e.target === document.getElementById('modalBackdrop')) closeModal(); }

async function savePlayer(e) {
  e.preventDefault();
  const gainRaw = document.getElementById('fGain').value;
  const data = {
    name:   document.getElementById('fName').value.trim(),
    gender: document.getElementById('fGender').value,
    tier:   document.getElementById('fTier').value,
    points: parseFloat(document.getElementById('fPoints').value) || 0,
    gain:   gainRaw === '' ? null : parseFloat(gainRaw),
    played: parseInt(document.getElementById('fPlayed').value) || 0,
    streak: parseInt(document.getElementById('fStreak').value) || 0,
    bp:     parseInt(document.getElementById('fRef').value) || 0,
    change: parseInt(document.getElementById('fChange').value) || 0,
  };
  if (editId !== null) {
    const idx = players.findIndex(p => p.id === editId);
    const oldName = idx !== -1 ? players[idx].name : null;
    if (idx !== -1) players[idx] = { ...players[idx], ...data };

    // Handle member linking
    if (isAdmin()) {
      const linkSelect = document.getElementById('fMemberLink');
      const selectedUserId = linkSelect.value;

      // Unlink any member previously linked to this player (by old name)
      if (membersList) {
        const prevLinked = membersList.find(m => m.ranking_player_name && m.ranking_player_name.toLowerCase() === (oldName || '').toLowerCase());
        if (prevLinked && prevLinked.id !== selectedUserId) {
          await rankingLinkRequest({ user_id: prevLinked.id, action: 'link', ranking_player_name: '' });
          prevLinked.ranking_player_name = null;
        }
      }

      // Link the newly selected member
      if (selectedUserId) {
        await rankingLinkRequest({ user_id: selectedUserId, action: 'link', ranking_player_name: data.name });
        if (membersList) {
          const m = membersList.find(x => x.id === selectedUserId);
          if (m) m.ranking_player_name = data.name;
        }
      }
    }

    toast('Player updated', 'success');
  } else {
    players.push({ id: nextId++, ...data });
    toast('Player added to rankings', 'success');
  }
  save(); render(); closeModal();
}

// ── Delete Confirmation
function askDelete(id, name) {
  deleteId = id;
  document.getElementById('confirmName').textContent = name;
  document.getElementById('confirmBackdrop').classList.add('open');
}
function closeConfirm() { document.getElementById('confirmBackdrop').classList.remove('open'); deleteId = null; }
function confirmBdClick(e) { if (e.target === document.getElementById('confirmBackdrop')) closeConfirm(); }
function confirmDelete() {
  const p = players.find(x => x.id === deleteId);
  players = players.filter(x => x.id !== deleteId);
  save(); render(); closeConfirm();
  toast(`${p?.name || 'Player'} removed`, 'danger');
}
