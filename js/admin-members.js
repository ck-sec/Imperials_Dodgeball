/* ═══════════════════════════════════════
   ADMIN MEMBERS — Vienna Imperials
   Approvals, account status and player identity links
═══════════════════════════════════════ */

const memberManagementState = {
  members: [],
  leaguePlayers: [],
  rankings: [],
  search: '',
  status: 'all',
  loaded: false
};
let memberManagementRequest = 0;

async function adminResponseError(response, fallback) {
  try {
    const data = await response.json();
    return new Error(data.error || fallback);
  } catch {
    return new Error(`${fallback} (HTTP ${response.status})`);
  }
}

async function loadPendingMembers() {
  const container = document.getElementById('pendingMembersList');
  if (!container) return;
  container.innerHTML = '<p class="am-empty">Loading pending accounts…</p>';

  try {
    const [membersRes, rankingsRes] = await Promise.all([
      adminFetch('/api/admin/members?status=pending', { cache: 'no-store' }),
      fetch('/api/rankings', { cache: 'no-store' })
    ]);
    if (!membersRes.ok) throw await adminResponseError(membersRes, 'Failed to load pending members.');
    if (!rankingsRes.ok) throw await adminResponseError(rankingsRes, 'Failed to load Season 1 rankings.');

    const { members } = await membersRes.json();
    const rankingsData = await rankingsRes.json();
    const players = Array.isArray(rankingsData) ? rankingsData : (rankingsData.players || []);

    if (!members || members.length === 0) {
      container.innerHTML = '<p class="am-empty">No pending member accounts.</p>';
      return;
    }

    const playerOptions = players.map(player =>
      `<option value="${esc(player.name)}">${esc(player.name)}</option>`
    ).join('');

    container.innerHTML = members.map(member => `
      <article class="am-card" id="member-row-${esc(member.id)}">
        <div class="am-card-main">
          <div>
            <strong class="am-name">${esc(member.display_name)}</strong>
            <span class="am-email">${esc(member.email)}</span>
            <span class="am-meta">Registered ${new Date(member.created_at).toLocaleDateString('de-AT')}</span>
          </div>
          <div class="am-actions">
            <label class="am-field" for="player-select-${esc(member.id)}">
              <span>Season 1 archive result</span>
              <select id="player-select-${esc(member.id)}">
                <option value="">No archived player link</option>
                ${playerOptions}
              </select>
            </label>
            <button class="am-button am-approve" data-member-id="${esc(member.id)}" data-action="approve">Approve</button>
            <button class="am-button am-reject" data-member-id="${esc(member.id)}" data-action="reject">Reject</button>
          </div>
        </div>
      </article>
    `).join('');

    if (!container._delegated) {
      container._delegated = true;
      container.addEventListener('click', event => {
        const button = event.target.closest('[data-member-id][data-action]');
        if (button) handleMemberAction(button.dataset.memberId, button.dataset.action);
      });
    }
  } catch (error) {
    if (error.message === 'ADMIN_SESSION_EXPIRED') return;
    console.error('Pending member load failed:', error);
    container.innerHTML = `<p class="am-error" role="alert">${esc(error.message || 'Failed to load pending members.')}</p>`;
  }
}

async function handleMemberAction(userId, action) {
  const select = document.getElementById('player-select-' + userId);
  const rankingPlayerName = select ? select.value : '';

  if (action === 'approve' && !rankingPlayerName &&
    !confirm('Approve this account without linking a Season 1 archived result?')) return;

  try {
    const response = await adminFetch('/api/admin/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, action, ranking_player_name: rankingPlayerName })
    });
    if (!response.ok) throw await adminResponseError(response, 'Member action failed.');
    toast(action === 'approve' ? 'Member approved' : 'Member rejected', action === 'approve' ? 'success' : 'danger');
    memberManagementState.loaded = false;
    await loadPendingMembers();
  } catch (error) {
    if (error.message === 'ADMIN_SESSION_EXPIRED') return;
    console.error('Member action failed:', error);
    toast(error.message || 'Member action failed.', 'danger');
  }
}

function memberStatusLabel(member) {
  if (member.status === 'approved' && member.is_active) return 'Approved';
  if (member.status === 'pending') return 'Pending';
  if (member.status === 'rejected') return 'Rejected';
  return member.is_active ? member.status : 'Inactive';
}

function renderMemberManagement() {
  const container = document.getElementById('memberManagementList');
  if (!container || !memberManagementState.loaded) return;
  const search = memberManagementState.search.trim().toLocaleLowerCase();
  const filtered = memberManagementState.members.filter(member => {
    const matchesSearch = !search || [member.display_name, member.email, member.ranking_player_name]
      .some(value => String(value || '').toLocaleLowerCase().includes(search));
    const matchesStatus = memberManagementState.status === 'all' ||
      memberStatusLabel(member).toLocaleLowerCase() === memberManagementState.status;
    return matchesSearch && matchesStatus;
  });
  const leagueOwners = new Map(memberManagementState.leaguePlayers
    .filter(player => player.user_id).map(player => [player.user_id, player]));
  const archiveOwners = new Map(memberManagementState.members
    .filter(member => member.ranking_player_name)
    .map(member => [member.ranking_player_name.toLocaleLowerCase(), member.id]));

  container.innerHTML = `
    <div class="am-toolbar">
      <label class="am-field" for="memberManagementSearch">
        <span>Search accounts</span>
        <input type="search" id="memberManagementSearch" value="${esc(memberManagementState.search)}" placeholder="Name, email or player">
      </label>
      <label class="am-field" for="memberManagementStatus">
        <span>Account status</span>
        <select id="memberManagementStatus">
          ${['all', 'approved', 'pending', 'rejected', 'inactive'].map(status =>
            `<option value="${status}"${memberManagementState.status === status ? ' selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="am-help">Link an approved account to the player identity that owns its Social League history. Choosing an unlinked guest merges the account’s existing league history into that durable guest identity; finalized points and placements are preserved.</p>
    <div class="am-summary">${filtered.length} of ${memberManagementState.members.length} accounts</div>
    ${filtered.length ? filtered.map(member => {
      const currentLeaguePlayer = leagueOwners.get(member.id);
      const eligibleLeaguePlayers = memberManagementState.leaguePlayers.filter(player =>
        player.user_id === null || player.user_id === member.id);
      const approved = member.status === 'approved' && member.is_active;
      const leagueOptions = eligibleLeaguePlayers.map(player => {
        const suffix = player.user_id === member.id ? ' — current account player' : ' — unlinked guest/player';
        return `<option value="${esc(player.id)}"${currentLeaguePlayer?.id === player.id ? ' selected' : ''}>${esc(player.display_name + suffix)}</option>`;
      }).join('');
      const archiveOptions = memberManagementState.rankings.map(player => {
        const owner = archiveOwners.get(String(player.name).toLocaleLowerCase());
        const unavailable = owner && owner !== member.id;
        return `<option value="${esc(player.name)}"${member.ranking_player_name === player.name ? ' selected' : ''}${unavailable ? ' disabled' : ''}>${esc(player.name)}${unavailable ? ' — linked to another account' : ''}</option>`;
      }).join('');
      return `
        <article class="am-card" data-managed-member="${esc(member.id)}">
          <div class="am-card-heading">
            <div>
              <strong class="am-name">${esc(member.display_name)}</strong>
              <span class="am-email">${esc(member.email)}</span>
            </div>
            <span class="am-status am-status-${esc(memberStatusLabel(member).toLocaleLowerCase())}">${esc(memberStatusLabel(member))}</span>
          </div>
          <div class="am-link-grid">
            <div class="am-link-card">
              <h4>Social League player</h4>
              <p>Current: <strong>${esc(currentLeaguePlayer ? currentLeaguePlayer.display_name : 'Not linked')}</strong></p>
              <label class="am-field" for="league-player-${esc(member.id)}">
                <span>Player identity</span>
                <select id="league-player-${esc(member.id)}"${approved && eligibleLeaguePlayers.length ? '' : ' disabled'}>
                  ${eligibleLeaguePlayers.length ? leagueOptions : '<option value="">No eligible player identities</option>'}
                </select>
              </label>
              <button class="am-button" data-management-action="league-link" data-member-id="${esc(member.id)}"
                ${approved && eligibleLeaguePlayers.length ? '' : 'disabled'}>Save league link</button>
            </div>
            <div class="am-link-card">
              <h4>Season 1 archive</h4>
              <p>Current: <strong>${esc(member.ranking_player_name || 'Not linked')}</strong></p>
              <label class="am-field" for="archive-player-${esc(member.id)}">
                <span>Archived ranking player</span>
                <select id="archive-player-${esc(member.id)}"${approved ? '' : ' disabled'}>
                  <option value="">No archived result</option>
                  ${archiveOptions}
                </select>
              </label>
              <button class="am-button am-secondary" data-management-action="archive-link" data-member-id="${esc(member.id)}"
                ${approved ? '' : 'disabled'}>Save archive link</button>
            </div>
          </div>
        </article>`;
    }).join('') : '<p class="am-empty">No accounts match these filters.</p>'}`;
}

async function loadMemberManagement() {
  const container = document.getElementById('memberManagementList');
  if (!container) return;
  const request = ++memberManagementRequest;
  container.innerHTML = '<p class="am-empty">Loading member accounts and player identities…</p>';
  try {
    const [membersResponse, leagueResponse, rankingsResponse] = await Promise.all([
      adminFetch('/api/admin/members?status=all', { cache: 'no-store' }),
      adminFetch('/api/league?view=admin', { cache: 'no-store' }),
      fetch('/api/rankings', { cache: 'no-store' })
    ]);
    if (!membersResponse.ok) throw await adminResponseError(membersResponse, 'Failed to load member accounts.');
    if (!leagueResponse.ok) throw await adminResponseError(leagueResponse, 'Failed to load league player identities.');
    if (!rankingsResponse.ok) throw await adminResponseError(rankingsResponse, 'Failed to load archived rankings.');
    const membersData = await membersResponse.json();
    const leagueData = await leagueResponse.json();
    const rankingsData = await rankingsResponse.json();
    if (request !== memberManagementRequest) return;
    if (!Array.isArray(membersData.members) || !Array.isArray(leagueData.players)) {
      throw new Error('The member-management response is incomplete.');
    }
    memberManagementState.members = membersData.members;
    memberManagementState.leaguePlayers = leagueData.players;
    memberManagementState.rankings = Array.isArray(rankingsData) ? rankingsData : (rankingsData.players || []);
    memberManagementState.loaded = true;
    renderMemberManagement();
  } catch (error) {
    if (request !== memberManagementRequest || error.message === 'ADMIN_SESSION_EXPIRED') return;
    console.error('Member management load failed:', error);
    container.innerHTML = `<p class="am-error" role="alert">${esc(error.message || 'Member management could not be loaded.')}</p>`;
  }
}

async function saveLeagueMemberLink(userId) {
  const select = document.getElementById('league-player-' + userId);
  const playerId = select && select.value;
  const member = memberManagementState.members.find(item => item.id === userId);
  const current = memberManagementState.leaguePlayers.find(player => player.user_id === userId);
  const target = memberManagementState.leaguePlayers.find(player => player.id === playerId);
  if (!member || !target || current?.id === target.id) return;
  const message = current
    ? `Link ${member.display_name}'s account to ${target.display_name}? The two player histories will be merged into ${target.display_name}; finalized points and placements are preserved.`
    : `Link ${member.display_name}'s account to ${target.display_name}?`;
  if (!confirm(message)) return;
  const response = await adminFetch('/api/league', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'link_player', player_id: playerId, user_id: userId })
  });
  if (!response.ok) throw await adminResponseError(response, 'The league player could not be linked.');
  toast('League player linked', 'success');
  await loadMemberManagement();
}

async function saveArchiveMemberLink(userId) {
  const select = document.getElementById('archive-player-' + userId);
  const rankingPlayerName = select ? select.value : '';
  const member = memberManagementState.members.find(item => item.id === userId);
  if (!member || (member.ranking_player_name || '') === rankingPlayerName) return;
  const response = await adminFetch('/api/admin/members', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, action: 'link', ranking_player_name: rankingPlayerName })
  });
  if (!response.ok) throw await adminResponseError(response, 'The Season 1 result could not be linked.');
  toast(rankingPlayerName ? 'Season 1 result linked' : 'Season 1 result unlinked', 'success');
  if (typeof membersList !== 'undefined') membersList = null;
  await loadMemberManagement();
}

const memberManagementContainer = document.getElementById('memberManagementList');
if (memberManagementContainer) {
  memberManagementContainer.addEventListener('input', event => {
    if (event.target.id !== 'memberManagementSearch') return;
    memberManagementState.search = event.target.value;
    renderMemberManagement();
    const input = document.getElementById('memberManagementSearch');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  memberManagementContainer.addEventListener('change', event => {
    if (event.target.id !== 'memberManagementStatus') return;
    memberManagementState.status = event.target.value;
    renderMemberManagement();
  });
  memberManagementContainer.addEventListener('click', event => {
    const button = event.target.closest('[data-management-action][data-member-id]');
    if (!button || button.disabled) return;
    const action = button.dataset.managementAction === 'league-link'
      ? saveLeagueMemberLink(button.dataset.memberId)
      : saveArchiveMemberLink(button.dataset.memberId);
    action.catch(error => {
      if (error.message === 'ADMIN_SESSION_EXPIRED') return;
      console.error('Member link failed:', error);
      toast(error.message || 'Member link failed.', 'danger');
    });
  });
}
