/* Shared presentation for public league results and member history. */
window.LeagueUI = (function() {
  const escape = typeof escapeHtml === 'function' ? escapeHtml : esc;
  const text = {
    de: {
      season: 'Saison', refresh: 'Aktualisieren', loading: 'Liga wird geladen...',
      empty: 'Noch keine Teams freigegeben. Sobald die Admins eine Liga freigeben, erscheinen hier Teams und Rangliste.',
      error: 'Die Trainingsliga konnte nicht geladen werden. Bitte versuche es erneut.',
      standings: 'Saison-Rangliste', search: 'Spieler suchen', searchHint: 'Name eingeben',
      noResults: 'Keine Spieler gefunden.', noScores: 'Noch keine Ergebnisse. Punkte erscheinen nach der ersten gewerteten Einheit.',
      points: 'Punkte', played: 'Trainings', wins: 'Siege', more: 'Mehr anzeigen',
      movementCompared: 'Durch das letzte gewertete Training',
      newRank: 'Neu', rankUnchanged: 'Rang unver\u00e4ndert',
      rankUp: 'Pl\u00e4tze gestiegen', rankUpOne: 'Platz gestiegen',
      rankDown: 'Pl\u00e4tze gefallen', rankDownOne: 'Platz gefallen',
      teams: 'Teams', training: 'Training ausw\u00e4hlen', members: 'Spieler',
      schedule: 'Spielplan', round: 'Runde', court: 'Feld', bye: 'Pause',
      noSchedule: 'Noch kein Spielplan freigegeben.', pendingMatch: 'Ausstehend',
      matchTable: 'Spieltagstabelle', matchPoints: 'Matchpunkte',
      matchRules: 'Sieg 2 / Unentschieden 1 / Niederlage 0. Danach z\u00e4hlen Punktedifferenz und erzielte Punkte. Diese Matchpunkte sind keine Saisonpunkte.',
      unresolved: 'Noch exakt punktgleiche Teams: Die Admins m\u00fcssen die Platzierung best\u00e4tigen.',
      resolved: 'Die Platzierungen bei Punktgleichstand wurden von den Admins best\u00e4tigt.',
      winner: 'Sieger',
      provisional: 'Vorl\u00e4ufig, bis alle Ergebnisse best\u00e4tigt sind.',
      noBuffer: 'Keine Zeitreserve f\u00fcr Aufw\u00e4rmen oder Verz\u00f6gerungen eingeplant.',
      substitutes: 'rotierende Ersatzspieler', published: 'Teams freigegeben', finalized: 'Ergebnis best\u00e4tigt',
      place: 'Platz', rules: 'Punkte pro Platzierung', rest: 'Weitere Pl\u00e4tze',
      total: 'Alle Trainings z\u00e4hlen zur Saison. Gleiche Punktzahl = gleicher Rang.',
      rotated: 'Alle spielen mit. Gr\u00f6\u00dfere Kader wechseln durch; auf dem Feld bleibt es bei',
      noTeams: 'Noch keine freigegebenen Teams in dieser Saison.',
      noHistory: 'Noch keine gewerteten Trainings in dieser Saison.'
    },
    en: {
      season: 'Season', refresh: 'Refresh', loading: 'Loading league...',
      empty: 'No teams published yet. Once admins release a league, teams and standings will appear here.',
      error: 'The training league could not be loaded. Please try again.',
      standings: 'Season standings', search: 'Find a player', searchHint: 'Search by name',
      noResults: 'No players found.', noScores: 'No results yet. Points appear after the first scored training.',
      points: 'Points', played: 'Trainings', wins: 'Wins', more: 'Show more',
      movementCompared: 'From the last scored training',
      newRank: 'New', rankUnchanged: 'Rank unchanged',
      rankUp: 'places up', rankUpOne: 'place up',
      rankDown: 'places down', rankDownOne: 'place down',
      teams: 'Teams', training: 'Choose training', members: 'players',
      schedule: 'Schedule', round: 'Round', court: 'Court', bye: 'Rest',
      noSchedule: 'No published match schedule yet.', pendingMatch: 'Pending',
      matchTable: 'Match standings', matchPoints: 'Match points',
      matchRules: 'Win 2 / Draw 1 / Loss 0, then score difference and points scored. These match-table points are not season points.',
      unresolved: 'Teams are still exactly tied: admins must confirm their final placements.',
      resolved: 'Admins have confirmed the placements for teams with identical match statistics.',
      winner: 'Winner',
      provisional: 'Provisional until all results are confirmed.',
      noBuffer: 'No time buffer for warm-up or delays is included.',
      substitutes: 'rotating substitutes', published: 'Teams published', finalized: 'Result confirmed',
      place: 'Place', rules: 'Points by placement', rest: 'Further places',
      total: 'Every training counts towards the season. Equal points share the same rank.',
      rotated: 'Everyone plays. Larger squads rotate substitutes; on court it stays',
      noTeams: 'No published teams in this season.',
      noHistory: 'No scored trainings in this season yet.'
    }
  };

  function date(value, lang = 'en') {
    const day = String(value).slice(0, 10);
    return new Date(day + 'T12:00:00Z').toLocaleDateString(lang === 'de' ? 'de-AT' : 'en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Vienna'
    });
  }

  function seasonOptions(seasons, selected) {
    return seasons.map(s => `<option value="${escape(s.id)}"${s.id === selected ? ' selected' : ''}>${escape(s.name)}</option>`).join('');
  }

  function rules(season, lang) {
    const t = text[lang];
    const awards = season.placement_points;
    const relative = season.scoring_mode !== 'fixed';
    const step = season.points_step === undefined ? 0.5 : season.points_step;
    const format = value => value.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB');
    const scale = relative
      ? `<p class="league-copy">${lang === 'de'
        ? 'Relative Platzierung, gerundet auf ' + format(step) + ' Punkte. Reihenfolge: 1. bis letzter Platz.'
        : 'Relative finish, rounded to ' + format(step) + ' points. Listed from first to last place.'}</p>
        <dl class="league-score-examples">${[2, 3, 4, 5, 6].map(count => `<div>
          <dt>${count} Teams</dt><dd>${window.LeagueScoring.placementPoints(season, count).map(points => '+' + format(points)).join(' / ')}</dd>
        </div>`).join('')}</dl>`
      : `<div class="league-rules">${awards.map((points, i) =>
        `<span class="league-chip">${i + 1}. ${escape(t.place)}: ${escape(format(points))} ${escape(t.points)}</span>`
      ).join('')}<span class="league-chip">${escape(t.rest)}: ${escape(format(awards[awards.length - 1]))} ${escape(t.points)}</span></div>`;
    return `<p class="league-copy">${escape(t.total)}</p>
      <details><summary class="league-btn">${escape(t.rules)}</summary>
        ${scale}
      </details>`;
  }

  function movement(entry, lang = 'en') {
    if (!entry || !Number.isFinite(entry.points_gain) || !Number.isInteger(entry.rank) || entry.rank < 1
      || !(entry.previous_rank === null || (Number.isInteger(entry.previous_rank) && entry.previous_rank > 0))
      || !(entry.previous_rank === null ? entry.rank_gain === null : Number.isInteger(entry.rank_gain))) return '';
    const t = text[lang] || text.en;
    const format = value => value.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 6 });
    const points = entry.points_gain === 0 ? 0 : entry.points_gain;
    const pointsText = (points > 0 ? '+' : '') + format(points) + ' ' + t.points;
    const pointsClass = points > 0 ? ' league-movement-up' : points < 0 ? ' league-movement-down' : '';
    const gain = entry.rank_gain;
    let rankText = t.newRank, rankClass = ' league-movement-new', arrow = '';
    if (entry.previous_rank !== null) {
      const count = Math.abs(gain);
      rankText = gain === 0 ? t.rankUnchanged : format(count) + ' '
        + (gain > 0 ? (count === 1 ? t.rankUpOne : t.rankUp) : (count === 1 ? t.rankDownOne : t.rankDown));
      rankClass = gain > 0 ? ' league-movement-up' : gain < 0 ? ' league-movement-down' : '';
      arrow = gain === 0 ? '' : `<span aria-hidden="true">${gain > 0 ? '\u2191' : '\u2193'}</span> `;
    }
    return `<span class="league-movement">
      <span class="league-movement-context">${escape(t.movementCompared)}</span>
      <span class="league-movement-value${pointsClass}">${escape(pointsText)}</span>
      <span class="league-movement-value${rankClass}">${arrow}${escape(rankText)}</span>
    </span>`;
  }

  function standings(players, lang) {
    const t = text[lang];
    return `<ol class="league-standings">${players.map(p => `<li class="league-standing">
      <span class="league-rank">#${escape(p.rank)}</span>
      <div><div class="league-player-name">${escape(p.display_name)}</div>
        <div class="league-player-meta">${escape(p.played)} ${escape(t.played)}${p.wins === undefined ? '' : ' &middot; ' + escape(p.wins) + ' ' + escape(t.wins)}</div>${movement(p, lang)}</div>
      <div class="league-points">${escape(p.points)}<small>${escape(t.points)}</small></div>
      ${p.legacy ? `<details class="league-standing-details"><summary>Details</summary><div class="league-player-meta">
        ${escape(p.legacy.tier)} &middot; Streak: ${escape(p.legacy.streak)} &middot; BP: ${escape(p.legacy.bp)}
        &middot; ${lang === 'de' ? 'Letzter Gewinn' : 'Last gain'}: ${escape(p.legacy.gain)}
        &middot; ${lang === 'de' ? 'Rangver\u00e4nderung' : 'Rank change'}: ${escape(p.legacy.change)}
      </div></details>` : ''}
    </li>`).join('')}</ol>`;
  }

  function event(eventData, lang) {
    const t = text[lang];
    const final = eventData.status === 'finalized';
    return `<div class="league-event-title">${escape(eventData.title)}</div>
      <p class="league-copy">${escape(date(eventData.session_date, lang))}${eventData.start_time ? ' &middot; ' + escape(eventData.start_time.slice(0, 5)) : ''}${eventData.location ? ' &middot; ' + escape(eventData.location) : ''}</p>
      <span class="league-chip league-chip-gold">${escape(final ? t.finalized : t.published)}</span>
      <p class="league-copy">${escape(t.rotated)} ${escape(eventData.team_size)}v${escape(eventData.team_size)}.</p>
      <div class="league-team-grid">${eventData.teams.map(team => {
        const extras = Math.max(0, team.players.length - eventData.team_size);
        return `<article class="league-team">
          <h4>${escape(team.name)}</h4>
          ${final ? `<span class="league-chip league-chip-gold">${escape(t.place)} ${escape(team.placement)} &middot; ${escape(team.points)} ${escape(t.points)}</span>` : ''}
          <div class="league-team-meta">${team.players.length} ${escape(t.members)}${extras ? ' &middot; ' + extras + ' ' + escape(t.substitutes) : ''}</div>
          <ul>${team.players.map(p => `<li>${escape(p.display_name)}</li>`).join('')}</ul>
        </article>`;
      }).join('')}</div>`;
  }

  function schedule(eventData, lang) {
    const t = text[lang];
    if (!eventData || !eventData.schedule) return `<p class="league-notice">${escape(t.noSchedule)}</p>`;
    const schedule = eventData.schedule;
    const names = new Map(eventData.teams.map(team => [team.number, team.name]));
    function clock(offset) {
      if (!eventData.start_time) return '+' + offset + ' min';
      const [hours, minutes] = eventData.start_time.split(':').map(Number);
      const total = hours * 60 + minutes + offset;
      const day = Math.floor(total / 1440);
      return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0') + (day ? ` (+${day}d)` : '');
    }
    const firstPending = schedule.rounds.findIndex(round => round.matches.some(match => match.score_a === null));
    const buffer = schedule.available_minutes - schedule.duration_minutes;
    const table = eventData.match_standings;
    const finalized = eventData.status === 'finalized';
    const finalPlaces = new Map(eventData.teams.map(team => [team.number, team.placement]));
    const tableRows = table ? [...table.standings] : [];
    if (finalized) tableRows.sort((a, b) => finalPlaces.get(a.team_number) - finalPlaces.get(b.team_number));
    const winner = finalized ? eventData.teams.find(team => team.placement === 1) : null;
    return `<div class="league-event-title">${escape(eventData.title)}</div>
      <p class="league-copy">${schedule.duration_minutes} min &middot; ${schedule.match_minutes} min ${lang === 'de' ? 'Spielzeit' : 'games'} &middot; ${schedule.break_minutes} min ${lang === 'de' ? 'Wechselpause' : 'changeovers'}</p>
      <p class="league-copy">${buffer === 0 ? escape(t.noBuffer) : buffer + ' min ' + (lang === 'de' ? 'Zeitreserve' : 'buffer')}</p>
      <div class="league-rounds">${schedule.rounds.map((round, index) => `<details class="league-round"${index === Math.max(0, firstPending) ? ' open' : ''}>
        <summary>${escape(t.round)} ${round.number}<span>${escape(clock(round.start_minute))} &ndash; ${escape(clock(round.end_minute))}</span></summary>
        ${round.matches.map(match => `<div class="league-match">
          <div class="league-player-meta">${escape(t.court)} ${match.court}</div>
          <div class="league-match-pair"><span>${escape(names.get(match.team_a))}</span>
            <strong>${Number.isInteger(match.score_a) && Number.isInteger(match.score_b) ? match.score_a + ' : ' + match.score_b : escape(t.pendingMatch)}</strong>
            <span>${escape(names.get(match.team_b))}</span></div>
        </div>`).join('')}
        ${round.bye_teams.length ? `<p class="league-copy">${escape(t.bye)}: ${round.bye_teams.map(team => escape(names.get(team))).join(', ')}</p>` : ''}
      </details>`).join('')}</div>
      ${table ? `<div class="league-block"><h3>${escape(t.matchTable)}</h3>
        <p class="league-copy">${escape(t.matchRules)}</p>
        ${!finalized ? `<p class="league-copy">${escape(t.provisional)}</p>` : ''}
        ${winner ? `<p class="league-copy"><strong>${escape(t.winner)}: ${escape(winner.name)}</strong></p>` : ''}
        ${table.has_ties ? `<p class="league-notice">${escape(finalized ? t.resolved : t.unresolved)}</p>` : ''}
        <ol class="league-standings">${tableRows.map(team => `<li class="league-standing">
          <span class="league-rank">#${finalized ? finalPlaces.get(team.team_number) : team.rank}</span>
          <div><div class="league-player-name">${escape(names.get(team.team_number))}</div>
            <div class="league-player-meta">${team.played} ${lang === 'de' ? 'Spiele' : 'played'} &middot; W ${team.won} / D ${team.drawn} / L ${team.lost}<br>
            ${lang === 'de' ? 'Differenz' : 'Difference'} ${team.score_difference > 0 ? '+' : ''}${team.score_difference} &middot; ${team.score_for} : ${team.score_against}</div></div>
          <div class="league-points">${team.table_points}<small>${escape(t.matchPoints)}</small></div>
        </li>`).join('')}</ol>
      </div>` : ''}`;
  }

  return { escape, text, date, seasonOptions, rules, standings, movement, event, schedule };
})();
