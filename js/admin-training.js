/* ═══════════════════════════════════════
   ADMIN TRAINING — Vienna Imperials
   Training session CRUD, recurring generation, attendance matrix
═══════════════════════════════════════ */

let adminTrainingSessions = [];

function switchAdminTrainingTab(tab, btn) {
  document.querySelectorAll('.at-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('atSessionsView').style.display = tab === 'sessions' ? '' : 'none';
  document.getElementById('atMatrixView').style.display = tab === 'matrix' ? '' : 'none';
  if (tab === 'matrix') loadAdminMatrix();
}

async function loadAdminTrainingSessions() {
  const container = document.getElementById('atSessionsList');
  container.innerHTML = '<p style="color:#8899bb; font-size:.9rem;">Loading sessions...</p>';
  try {
    const res = await adminFetch('/api/admin/training?view=overview&range=month');
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    adminTrainingSessions = data.sessions || [];
    renderAdminSessions();
  } catch {
    container.innerHTML = '<p style="color:#E8193C; font-size:.9rem;">Failed to load sessions.</p>';
  }
}

function renderAdminSessions() {
  const container = document.getElementById('atSessionsList');
  if (adminTrainingSessions.length === 0) {
    container.innerHTML = '<p style="color:#8899bb; font-size:.9rem; padding:.5rem 0;">No sessions found. Create one to get started.</p>';
    return;
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  container.innerHTML = adminTrainingSessions.map(s => {
    const dateOnly = typeof s.session_date === 'string' ? s.session_date.slice(0, 10) : s.session_date.toISOString().slice(0, 10);
    const d = new Date(dateOnly + 'T00:00:00');
    const dateStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    const att = parseInt(s.attending_count) || 0;
    const notAtt = parseInt(s.not_attending_count) || 0;
    const noResp = Math.max(0, parseInt(s.no_response_count) || 0);
    const cancelled = s.is_cancelled;
    return `
      <div class="at-session-card${cancelled ? ' cancelled' : ''}" data-id="${s.id}">
        <div class="at-session-top">
          <div class="at-session-info">
            <div class="at-session-date">${esc(dateStr)}${cancelled ? ' &mdash; CANCELLED' : ''}</div>
            <div class="at-session-title">${esc(s.title)}</div>
            <div class="at-session-meta">${fmtTime(s.start_time)} &ndash; ${fmtTime(s.end_time)}${s.location ? ' &middot; ' + esc(s.location) : ''}</div>
            <div class="at-counts">
              <span class="at-count-yes">${att} attending</span>
              <span class="at-count-no">${notAtt} not attending</span>
              <span class="at-count-pending">${noResp} no response</span>
            </div>
          </div>
          <div class="at-session-actions">
            <button class="at-action-btn" data-detail="${s.id}">Detail</button>
            <button class="at-action-btn" data-edit="${s.id}">Edit</button>
            ${!cancelled ? `<button class="at-action-btn danger" data-cancel="${s.id}">Cancel</button>` : ''}
            <button class="at-action-btn danger" data-delete="${s.id}">Delete</button>
          </div>
        </div>
        <div class="at-attendee-detail" id="at-detail-${s.id}"></div>
      </div>`;
  }).join('');

  // Wire action buttons via event delegation
  container.querySelectorAll('[data-detail]').forEach(function(btn) {
    btn.addEventListener('click', function() { toggleAdminDetail(btn.dataset.detail); });
  });
  container.querySelectorAll('[data-edit]').forEach(function(btn) {
    btn.addEventListener('click', function() { openEditSessionModal(btn.dataset.edit); });
  });
  container.querySelectorAll('[data-cancel]').forEach(function(btn) {
    btn.addEventListener('click', function() { cancelSession(btn.dataset.cancel); });
  });
  container.querySelectorAll('[data-delete]').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteSession(btn.dataset.delete); });
  });
}

function fmtTime(t) { if (!t) return ''; const p = t.split(':'); return p[0] + ':' + p[1]; }

async function toggleAdminDetail(id) {
  const el = document.getElementById('at-detail-' + id);
  if (!el) return;
  if (el.classList.contains('open')) { el.classList.remove('open'); return; }
  el.innerHTML = '<p style="color:#8899bb; font-size:.8rem;">Loading...</p>';
  el.classList.add('open');
  try {
    const res = await adminFetch('/api/admin/training?view=detail&id=' + id);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    const att = data.attendees.filter(a => a.status === 'attending');
    const notAtt = data.attendees.filter(a => a.status === 'not_attending');
    const none = data.attendees.filter(a => a.status === 'pending');
    let html = '';
    if (att.length) {
      html += `<div class="at-att-group-label at-att-yes">Attending (${att.length})</div>`;
      html += `<div class="at-att-names">${att.map(a => esc(a.display_name)).join(', ')}</div>`;
    }
    if (notAtt.length) {
      html += `<div class="at-att-group-label at-att-no">Not Attending (${notAtt.length})</div>`;
      html += `<div class="at-att-names">${notAtt.map(a => esc(a.display_name)).join(', ')}</div>`;
    }
    if (none.length) {
      html += `<div class="at-att-group-label at-att-none">No Response (${none.length})</div>`;
      html += `<div class="at-att-names">${none.map(a => esc(a.display_name)).join(', ')}</div>`;
    }
    el.innerHTML = html || '<p style="color:#8899bb; font-size:.8rem;">No members found.</p>';
  } catch {
    el.innerHTML = '<p style="color:#E8193C; font-size:.8rem;">Failed to load details.</p>';
  }
}

// ── Create / Edit session modal
function openCreateSessionModal() {
  document.getElementById('atModalTitle').textContent = 'CREATE SESSION';
  document.getElementById('atEditId').value = '';
  document.getElementById('atTitle').value = '';
  document.getElementById('atDate').value = '';
  document.getElementById('atStart').value = '19:00';
  document.getElementById('atEnd').value = '21:00';
  document.getElementById('atLocation').value = '';
  document.getElementById('atCapacity').value = '';
  document.getElementById('atDesc').value = '';
  document.getElementById('atSubmitBtn').textContent = 'Create';
  document.getElementById('atSessionModal').classList.add('open');
}

function openEditSessionModal(id) {
  const s = adminTrainingSessions.find(x => x.id === id);
  if (!s) return;
  document.getElementById('atModalTitle').textContent = 'EDIT SESSION';
  document.getElementById('atEditId').value = id;
  document.getElementById('atTitle').value = s.title || '';
  document.getElementById('atDate').value = s.session_date || '';
  document.getElementById('atStart').value = fmtTime(s.start_time);
  document.getElementById('atEnd').value = fmtTime(s.end_time);
  document.getElementById('atLocation').value = s.location || '';
  document.getElementById('atCapacity').value = s.max_capacity || '';
  document.getElementById('atDesc').value = s.description || '';
  document.getElementById('atSubmitBtn').textContent = 'Save Changes';
  document.getElementById('atSessionModal').classList.add('open');
}

function closeSessionModal() {
  document.getElementById('atSessionModal').classList.remove('open');
}

async function submitSession() {
  const editId = document.getElementById('atEditId').value;
  const title = document.getElementById('atTitle').value.trim();
  const session_date = document.getElementById('atDate').value;
  const start_time = document.getElementById('atStart').value;
  const end_time = document.getElementById('atEnd').value;
  const sessionLocation = document.getElementById('atLocation').value.trim();
  const description = document.getElementById('atDesc').value.trim();
  const max_capacity = document.getElementById('atCapacity').value ? parseInt(document.getElementById('atCapacity').value) : null;

  if (!title || !session_date || !start_time || !end_time) {
    toast('Title, date, and times are required', 'danger');
    return;
  }

  const btn = document.getElementById('atSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const body = editId
    ? { action: 'update', id: editId, title, session_date, start_time, end_time, location: sessionLocation, description, max_capacity }
    : { action: 'create', title, session_date, start_time, end_time, location: sessionLocation, description, max_capacity };

  try {
    const res = await adminFetch('/api/admin/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Failed');
    closeSessionModal();
    toast(editId ? 'Session updated' : 'Session created', 'success');
    await loadAdminTrainingSessions();
  } catch {
    toast('Failed to save session', 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = editId ? 'Save Changes' : 'Create';
  }
}

async function cancelSession(id) {
  if (!confirm('Cancel this session? Members will see it as cancelled.')) return;
  try {
    const res = await adminFetch('/api/admin/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', id })
    });
    if (!res.ok) throw new Error('Failed');
    toast('Session cancelled', 'info');
    await loadAdminTrainingSessions();
  } catch {
    toast('Failed to cancel session', 'danger');
  }
}

async function deleteSession(id) {
  if (!confirm('Permanently delete this session and all attendance data?')) return;
  try {
    const res = await adminFetch('/api/admin/training?id=' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');
    toast('Session deleted', 'info');
    await loadAdminTrainingSessions();
  } catch {
    toast('Failed to delete session', 'danger');
  }
}

// ── Recurring generation
function openRecurringModal() {
  document.getElementById('atRecurringModal').classList.add('open');
}
function closeRecurringModal() {
  document.getElementById('atRecurringModal').classList.remove('open');
}

async function submitRecurring() {
  const title = document.getElementById('atRecTitle').value.trim() || null;
  const recurring_day = parseInt(document.getElementById('atRecDay').value);
  const weeks = parseInt(document.getElementById('atRecWeeks').value);
  const start_time = document.getElementById('atRecStart').value;
  const end_time = document.getElementById('atRecEnd').value;
  const sessionLocation = document.getElementById('atRecLocation').value.trim() || null;

  if (!start_time || !end_time || !weeks) {
    toast('Times and weeks are required', 'danger');
    return;
  }

  const btn = document.getElementById('atRecSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const res = await adminFetch('/api/admin/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', title, recurring_day, weeks, start_time, end_time, location: sessionLocation })
    });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    closeRecurringModal();
    toast(`Generated ${data.count} sessions`, 'success');
    await loadAdminTrainingSessions();
  } catch {
    toast('Failed to generate sessions', 'danger');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

// ── Attendance matrix
async function loadAdminMatrix() {
  const container = document.getElementById('atMatrixContent');
  container.innerHTML = '<p style="color:#8899bb; font-size:.9rem;">Loading matrix...</p>';
  try {
    const res = await adminFetch('/api/admin/training?view=matrix');
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    const { sessions, matrix, attendance_rate } = data;

    if (!sessions.length || !matrix.length) {
      container.innerHTML = '<p style="color:#8899bb; font-size:.9rem;">No data available yet.</p>';
      return;
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const statusIcon = { attending: '\u2705', not_attending: '\u274C', pending: '\u23F3' };

    let html = '<div class="at-matrix-wrap"><table class="at-matrix"><thead><tr><th>Member</th>';
    sessions.forEach(s => {
      const sd = typeof s.session_date === 'string' ? s.session_date.slice(0, 10) : s.session_date.toISOString().slice(0, 10);
      const d = new Date(sd + 'T00:00:00');
      html += `<th>${d.getDate()} ${months[d.getMonth()]}</th>`;
    });
    html += '</tr></thead><tbody>';

    matrix.forEach(m => {
      html += `<tr><td>${esc(m.display_name)}</td>`;
      m.sessions.forEach(s => {
        html += `<td>${statusIcon[s.status] || '\u23F3'}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += `<div class="at-rate">Overall Attendance Rate: ${attendance_rate}%</div>`;
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<p style="color:#E8193C; font-size:.9rem;">Failed to load matrix.</p>';
  }
}
