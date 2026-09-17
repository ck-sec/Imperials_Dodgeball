/* Imperials Social League statistics for administrators. */

let adminStatisticsData = null;
let adminStatisticsRequest = 0;
let adminStatisticsPlayerId = '';

function adminStatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Vienna'
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
}

function adminStatValue(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '0';
}

async function adminStatisticsResponseError(response) {
  try {
    const data = await response.json();
    return new Error(data.error || 'Statistics could not be loaded.');
  } catch {
    return new Error(`Statistics could not be loaded (HTTP ${response.status}).`);
  }
}

function renderAdminStatistics() {
  const root = document.getElementById('adminStatisticsContent');
  const data = adminStatisticsData;
  if (!root || !data) return;
  if (!data.season) {
    root.innerHTML = '<p class="as-empty">No league season is configured yet.</p>';
    return;
  }
  const players = Array.isArray(data.players) ? data.players : [];
  const finalizedEvents = (data.events || []).filter(event => event.status === 'finalized');
  const participations = players.reduce((sum, player) => sum + Number(player.played || 0), 0);
  const points = players.reduce((sum, player) => sum + Number(player.points || 0), 0);
  const maxPoints = Math.max(1, ...players.map(player => Number(player.points || 0)));
  const placementCounts = {};
  players.forEach(player => Object.entries(player.placement_counts || {}).forEach(([place, count]) => {
    placementCounts[place] = (placementCounts[place] || 0) + Number(count);
  }));
  const maxPlacementCount = Math.max(1, ...Object.values(placementCounts));
  const topPlayers = players.slice(0, 10);
  const teammatePlayer = players.find(player => player.id === adminStatisticsPlayerId) || players[0] || null;
  adminStatisticsPlayerId = teammatePlayer ? teammatePlayer.id : '';
  const teammates = teammatePlayer && Array.isArray(teammatePlayer.teammates) ? teammatePlayer.teammates : [];
  const maxTeammateTrainings = Math.max(1, ...teammates.map(teammate => Number(teammate.played_together || 0)));

  root.innerHTML = `
    <div class="as-toolbar">
      <label for="adminStatisticsSeason">Season
        <select id="adminStatisticsSeason">
          ${(data.seasons || []).map(season =>
            `<option value="${esc(season.id)}"${season.id === data.season.id ? ' selected' : ''}>${esc(season.name)}</option>`).join('')}
        </select>
      </label>
      <button class="at-btn" type="button" data-admin-stat-refresh>Refresh statistics</button>
    </div>
    <div class="as-metrics">
      <div class="as-metric"><strong>${players.length}</strong><span>Scored players</span></div>
      <div class="as-metric"><strong>${data.finalized_event_count || 0}</strong><span>Finalized trainings</span></div>
      <div class="as-metric"><strong>${participations}</strong><span>Player results recorded</span></div>
      <div class="as-metric"><strong>${adminStatValue(points)}</strong><span>Total points awarded</span></div>
    </div>
    ${players.length ? `
      <div class="as-grid">
        <section class="as-card">
          <h3>Points leaders</h3>
          <div class="as-chart" role="img" aria-label="Top player points">
            ${topPlayers.map(player => `<div class="as-bar-row">
              <span title="${esc(player.display_name)}">${esc(player.display_name)}</span>
              <div class="as-track"><i style="width:${Math.max(3, Number(player.points || 0) / maxPoints * 100)}%"></i></div>
              <strong>${adminStatValue(player.points)}</strong>
            </div>`).join('')}
          </div>
        </section>
        <section class="as-card">
          <h3>Placement distribution</h3>
          <div class="as-chart" role="img" aria-label="Recorded player placements">
            ${Object.keys(placementCounts).sort((a, b) => Number(a) - Number(b)).map(place => `<div class="as-bar-row">
              <span>Place ${esc(place)}</span>
              <div class="as-track as-track-place"><i style="width:${Math.max(3, placementCounts[place] / maxPlacementCount * 100)}%"></i></div>
              <strong>${placementCounts[place]}</strong>
            </div>`).join('')}
          </div>
        </section>
      </div>
      <section class="as-card">
        <div class="as-heading as-heading-picker">
          <div><h3>Played together</h3><p>Shared teams in finalized trainings from ${esc(data.season.name)}.</p></div>
          <label class="as-player-picker" for="adminStatisticsPlayer">Player
            <select id="adminStatisticsPlayer">
              ${players.map(player => `<option value="${esc(player.id)}"${player.id === teammatePlayer.id ? ' selected' : ''}>${esc(player.display_name)}</option>`).join('')}
            </select>
          </label>
        </div>
        ${teammates.length ? `<div class="as-chart" role="img" aria-label="Trainings played with each teammate">
          ${teammates.map(teammate => `<div class="as-bar-row">
            <span title="${esc(teammate.display_name)}">${esc(teammate.display_name)}</span>
            <div class="as-track"><i style="width:${Math.max(3, Number(teammate.played_together || 0) / maxTeammateTrainings * 100)}%"></i></div>
            <strong title="${teammate.wins_together} shared win${teammate.wins_together === 1 ? '' : 's'}">${teammate.played_together}×</strong>
          </div>`).join('')}
        </div>` : '<p class="as-empty">No shared finalized team lineups recorded for this player yet.</p>'}
      </section>
      <section class="as-card">
        <div class="as-heading"><div><h3>Player performance</h3><p>Every finalized placement stored for ${esc(data.season.name)}.</p></div></div>
        <div class="as-table-wrap"><table class="as-table">
          <thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Played</th><th>Wins</th><th>Win rate</th><th>Avg place</th><th>Best</th><th>Podiums</th></tr></thead>
          <tbody>${players.map(player => `<tr>
            <td>#${player.rank}</td><th scope="row">${esc(player.display_name)}</th>
            <td>${adminStatValue(player.points)}</td><td>${player.played}</td><td>${player.wins}</td>
            <td>${adminStatValue(player.win_rate)}%</td><td>${adminStatValue(player.average_placement)}</td>
            <td>${player.best_placement ? '#' + player.best_placement : '—'}</td><td>${player.podiums}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="as-card">
        <h3>Recorded training results</h3>
        <div class="as-events">${finalizedEvents.length ? finalizedEvents.map(event => `
          <article class="as-event">
            <div><strong>${esc(event.title)}</strong><span>${adminStatDate(event.session_date)}</span></div>
            <ol>${[...event.teams].sort((a, b) => a.placement - b.placement).map(team =>
              `<li><span><b>#${team.placement}</b> ${esc(team.name)}</span><span>${adminStatValue(team.points)} pts · ${team.players.length} ${team.players.length === 1 ? 'player' : 'players'}</span></li>`).join('')}</ol>
          </article>`).join('') : '<p class="as-empty">No finalized training results yet.</p>'}</div>
      </section>` :
      '<p class="as-empty">No finalized player results exist for this season yet. Finalize placements in the Social League tab and they will appear here automatically.</p>'}`;
}

async function loadAdminStatistics(seasonId = '') {
  const root = document.getElementById('adminStatisticsContent');
  if (!root) return;
  const request = ++adminStatisticsRequest;
  const selectedSeason = seasonId || (adminStatisticsData && adminStatisticsData.season && adminStatisticsData.season.id) || '';
  root.innerHTML = '<p class="as-empty">Loading recorded league results…</p>';
  try {
    const response = await adminFetch('/api/league?view=admin_stats' +
      (selectedSeason ? '&season_id=' + encodeURIComponent(selectedSeason) : ''), { cache: 'no-store' });
    if (!response.ok) throw await adminStatisticsResponseError(response);
    const data = await response.json();
    if (request !== adminStatisticsRequest) return;
    if (!Array.isArray(data.seasons) || !Array.isArray(data.players) || !Array.isArray(data.events)) {
      throw new Error('The statistics response is incomplete.');
    }
    adminStatisticsData = data;
    renderAdminStatistics();
  } catch (error) {
    if (request !== adminStatisticsRequest || error.message === 'ADMIN_SESSION_EXPIRED') return;
    console.error('Admin statistics load failed:', error);
    root.innerHTML = `<p class="as-error" role="alert">${esc(error.message || 'Statistics could not be loaded.')}</p>`;
  }
}

const adminStatisticsRoot = document.getElementById('adminStatisticsContent');
if (adminStatisticsRoot) {
  adminStatisticsRoot.addEventListener('change', event => {
    if (event.target.id === 'adminStatisticsSeason') {
      adminStatisticsPlayerId = '';
      loadAdminStatistics(event.target.value);
    }
    if (event.target.id === 'adminStatisticsPlayer') {
      adminStatisticsPlayerId = event.target.value;
      renderAdminStatistics();
    }
  });
  adminStatisticsRoot.addEventListener('click', event => {
    if (event.target.closest('[data-admin-stat-refresh]')) loadAdminStatistics();
  });
}
