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
      points: 'Punkte', totalPoints: 'Punkte gesamt', played: 'Trainings', wins: 'Siege', more: 'Mehr anzeigen',
      bonus: 'Bonuspunkte', bonusIncluded: 'BP sind in der Gesamtpunktzahl enthalten.',
      bonusOff: 'Bonuspunkte sind f\u00fcr diese Saison deaktiviert.',
      matchday: 'Spielplan & Live-Ergebnisse',
      movementCompared: 'Durch das letzte gewertete Training',
      newRank: 'Neu', rankUnchanged: 'Rang unver\u00e4ndert',
      rankUp: 'Pl\u00e4tze gestiegen', rankUpOne: 'Platz gestiegen',
      rankDown: 'Pl\u00e4tze gefallen', rankDownOne: 'Platz gefallen',
      teams: 'Teams', training: 'Training ausw\u00e4hlen', members: 'Spieler',
      schedule: 'Spielplan', round: 'Runde', court: 'Feld', bye: 'Pause', refTeam: 'Ref-Team',
      externalRef: 'Externer Head Ref / Admin',
      program: '18:00 Treffpunkt & Aufwärmen · 18:15 Ligaspiele · 20:00 Last Man / Last Woman Standing (max. 10 Min.)',
      noSchedule: 'Noch kein Spielplan freigegeben.', pendingMatch: 'Ausstehend',
      matchTable: 'Spieltagstabelle', matchPoints: 'Matchpunkte',
      matchRules: 'Sieg 2 / Unentschieden 1 / Niederlage 0. Danach z\u00e4hlen Punktedifferenz und erzielte Punkte. Diese Matchpunkte sind keine Saisonpunkte.',
      unresolved: 'Noch exakt punktgleiche Teams: Die Admins m\u00fcssen die Platzierung best\u00e4tigen.',
      resolved: 'Die Platzierungen bei Punktgleichstand wurden von den Admins best\u00e4tigt.',
      winner: 'Sieger',
      provisional: 'Vorl\u00e4ufig, bis alle Ergebnisse best\u00e4tigt sind.',
      noBuffer: 'Keine Zeitreserve f\u00fcr Aufw\u00e4rmen oder Verz\u00f6gerungen eingeplant.',
      substitutes: 'rotierende Ersatzspieler', published: 'Teams freigegeben', finalized: 'Ergebnis best\u00e4tigt',
      place: 'Platz', rules: 'Punkte & Rangstufen', rest: 'Weitere Pl\u00e4tze',
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
      points: 'Points', totalPoints: 'Total points', played: 'Trainings', wins: 'Wins', more: 'Show more',
      bonus: 'Bonus points', bonusIncluded: 'BP are included in the total points.',
      bonusOff: 'Bonus points are disabled for this season.',
      matchday: 'Schedule & live scores',
      movementCompared: 'From the last scored training',
      newRank: 'New', rankUnchanged: 'Rank unchanged',
      rankUp: 'places up', rankUpOne: 'place up',
      rankDown: 'places down', rankDownOne: 'place down',
      teams: 'Teams', training: 'Choose training', members: 'players',
      schedule: 'Schedule', round: 'Round', court: 'Court', bye: 'Rest', refTeam: 'Ref team',
      externalRef: 'External Head Ref / admin',
      program: '18:00 meet & warm-up · 18:15 league games · 20:00 Last Man / Last Woman Standing (10 min max)',
      noSchedule: 'No published match schedule yet.', pendingMatch: 'Pending',
      matchTable: 'Match standings', matchPoints: 'Match points',
      matchRules: 'Win 2 / Draw 1 / Loss 0, then score difference and points scored. These match-table points are not season points.',
      unresolved: 'Teams are still exactly tied: admins must confirm their final placements.',
      resolved: 'Admins have confirmed the placements for teams with identical match statistics.',
      winner: 'Winner',
      provisional: 'Provisional until all results are confirmed.',
      noBuffer: 'No time buffer for warm-up or delays is included.',
      substitutes: 'rotating substitutes', published: 'Teams published', finalized: 'Result confirmed',
      place: 'Place', rules: 'Points & tiers', rest: 'Further places',
      total: 'Every training counts towards the season. Equal points share the same rank.',
      rotated: 'Everyone plays. Larger squads rotate substitutes; on court it stays',
      noTeams: 'No published teams in this season.',
      noHistory: 'No scored trainings in this season yet.'
    }
  };
  const guideText = {
    de: {
      title: 'Neu dabei? Die Liga in 60 Sekunden',
      lead: 'Du meldest dich nicht für eine fixe Mannschaft oder gleich für die ganze Saison an. Wähle einfach die Donnerstage, an denen du spielen willst. Anfänger*innen sind ausdrücklich willkommen.',
      steps: [
        ['Termin wählen', 'Öffne im Mitgliederbereich „Training“ und tippe beim gewünschten Donnerstag auf „Dabei“. Jeder Termin braucht eine eigene Zusage. Du kannst sie ändern, bis die Teams veröffentlicht werden; danach hilft dir der Club bei Änderungen.'],
        ['Faire Teams', 'Die Admins übernehmen die Zusagen. Das System erstellt möglichst gleich große und ausgeglichene Teams anhand einer privaten ELO-Spielstärke sowie der Rookie- und Geschlechterverteilung. Es ist keine zufällige Auslosung.'],
        ['Alle spielen', 'Jedes Team spielt einmal gegen jedes andere. Ref-Einsätze und Pausen werden verteilt. Bei größeren Kadern wechseln Ersatzspieler*innen durch und gehören trotzdem voll zum Team.'],
        ['Ergebnis bestätigen', 'Head Refs oder Admins speichern die Scores und bestätigen am Ende die Platzierungen. Dann erhält jede Person im Team – auch rotierende Ersatzspieler*innen – dieselben Basis-Platzierungspunkte.']
      ],
      pointsHeading: 'Zwei Punktesysteme – bitte nicht verwechseln',
      matchTitle: 'Matchpunkte',
      matchScore: '2 / 1 / 0',
      matchBody: 'Nur für die Team-Platzierung an diesem Donnerstag: Sieg = 2, Unentschieden = 1, Niederlage = 0. Danach zählen Punktedifferenz und erzielte Punkte. Einen exakten Gleichstand lösen die Admins.',
      seasonTitle: 'Saisonpunkte',
      seasonScore: 'Platz = Punkte',
      seasonBody: 'Die endgültige Team-Platzierung wird in Punkte für deine persönliche Saison-Rangliste umgerechnet. Alle gewerteten Donnerstage werden zusammengezählt; gleiche Gesamtpunkte bedeuten den gleichen Rang.',
      eloHeading: 'Was macht die geheime ELO?',
      eloBody: 'ELO ist nur ein interner Schätzwert für faire zukünftige Teams. Sie ist kein öffentlicher Rang, keine Belohnung und kein Teil deiner Saisonpunkte. Nach einem finalisierten Abend vergleicht das System eure Platzierung mit der Erwartung aus den durchschnittlichen Teamstärken: besser als erwartet bedeutet ELO rauf, schlechter als erwartet ELO runter. Alle im selben Team bekommen dieselbe Änderung; persönliche Statistiken zählen nicht.',
      eloNote: 'Wichtig: ELO mischt die Teams. Sie wählt keine einzelnen Gegner aus – im Spielplan trifft weiterhin jedes Team auf jedes andere.',
      awardsHeading: 'Saisonpunkte, BP und Rangstufen',
      privacy: 'Nach der Teamfreigabe sind dein Name, dein Team, der Spielplan und die Ergebnisse öffentlich. Deine ELO bleibt privat.',
      signup: 'Donnerstag auswählen & anmelden'
    },
    en: {
      title: 'New here? The league in 60 seconds',
      lead: 'You are not joining a fixed squad or committing to the whole season. Simply choose the Thursdays you want to play. Complete beginners are very welcome.',
      steps: [
        ['Pick a date', 'Open Training in the member area and press Going on the Thursday you want. Each date needs its own RSVP. You can change it until teams are published; after that, contact the club for changes.'],
        ['Fair teams', 'Admins take the Going list. The system builds near-equal, balanced squads using a private ELO skill estimate plus the spread of rookies and genders. This is not a random draw.'],
        ['Everyone plays', 'Every team plays every other team once. Ref duties and rest rounds are shared. Larger squads rotate substitutes, who still count as full team members.'],
        ['Results are confirmed', 'Head Refs or admins save the scores and confirm the final places. Every person on a team – including rotating substitutes – then receives the same base placement points.']
      ],
      pointsHeading: 'Two point systems – do not mix them up',
      matchTitle: 'Match points',
      matchScore: '2 / 1 / 0',
      matchBody: 'These only decide the team places for that Thursday: win = 2, draw = 1, loss = 0. Next come score difference and points scored. Admins resolve an exact tie.',
      seasonTitle: 'Season points',
      seasonScore: 'Place = points',
      seasonBody: 'Your team’s final place becomes points in your personal season standings. Every scored Thursday is added together; equal totals share the same rank.',
      eloHeading: 'What does the hidden ELO do?',
      eloBody: 'ELO is only an internal estimate used to make future teams fair. It is not a public rank, a reward, or part of your season points. After results are final, the system compares your finish with the expectation from the squads’ average strengths: better than expected means ELO goes up; worse means it goes down. Everyone on the same team gets the same change; individual stats do not count.',
      eloNote: 'Important: ELO balances the squads. It does not pick individual opponents – the schedule is still round robin, so every team plays every other team.',
      awardsHeading: 'Season points, BP and tiers',
      privacy: 'After teams are published, your name, team, schedule and results are public. Your ELO stays private.',
      signup: 'Choose a Thursday & register'
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

  function ruleDetails(season, lang) {
    const activeLang = text[lang] ? lang : 'en';
    const t = text[activeLang];
    const awards = season.placement_points;
    const mode = season.scoring_mode || 'fixed';
    const step = season.points_step === undefined ? 0.5 : season.points_step;
    const bonusMax = season.bonus_points_max === undefined ? 1 : season.bonus_points_max;
    const bonusStep = season.bonus_points_step === undefined ? 0.5 : season.bonus_points_step;
    const format = value => value.toLocaleString(activeLang === 'de' ? 'de-AT' : 'en-GB');
    const table = () => `<dl class="league-score-examples">${[2, 3, 4, 5, 6].map(count => `<div>
      <dt>${count} Teams</dt><dd>${window.LeagueScoring.placementPoints(season, count).map(points => '+' + format(points)).join(' / ')}</dd>
    </div>`).join('')}</dl>`;
    const scale = mode === 'beaten'
      ? `<p class="league-copy">${activeLang === 'de'
        ? `${format(awards[0])} Punkt für die Teilnahme plus ${format(awards[1])} Punkte für jedes Team, vor dem dein Team landet. Mehr Teams bedeuten deshalb mehr mögliche Punkte.`
        : `${format(awards[0])} participation point plus ${format(awards[1])} points for every team your squad finishes above. More teams therefore mean more points are available.`}</p>
        ${table()}`
      : mode === 'relative'
        ? `<p class="league-copy">${activeLang === 'de'
        ? 'Relative Platzierung, gerundet auf ' + format(step) + ' Punkte. Reihenfolge: 1. bis letzter Platz.'
        : 'Relative finish, rounded to ' + format(step) + ' points. Listed from first to last place.'}</p>
        ${table()}`
        : `<div class="league-rules">${awards.map((points, i) =>
        `<span class="league-chip">${i + 1}. ${escape(t.place)}: ${escape(format(points))} ${escape(t.points)}</span>`
      ).join('')}<span class="league-chip">${escape(t.rest)}: ${escape(format(awards[awards.length - 1]))} ${escape(t.points)}</span></div>`;
    return `${scale}
      <p class="league-copy">${bonusMax === 0 ? escape(t.bonusOff) : escape(activeLang === 'de'
        ? `Zus\u00e4tzlich bis zu ${format(bonusMax)} BP pro Spieler und Training, in ${format(bonusStep)}er-Schritten. ${t.bonusIncluded}`
        : `Up to ${format(bonusMax)} BP per player and training, in steps of ${format(bonusStep)}. ${t.bonusIncluded}`)}</p>
      <p class="league-copy">${activeLang === 'de'
        ? 'Rangstufen nach Gesamtpunkten inklusive BP. Jede Saison beginnt neu.'
        : 'Tiers use total season points including BP. Each season starts fresh.'}</p>
      <ul class="league-tier-list" aria-label="${activeLang === 'de' ? 'Rangstufen' : 'Season tiers'}">${window.LeagueScoring.seasonTiers.map(tier =>
        `<li>${tierBadge({ points: tier.minimum }, activeLang)}<span>${activeLang === 'de' ? 'ab' : 'from'} ${format(tier.minimum)} ${escape(t.points)}</span></li>`
      ).join('')}</ul>`;
  }

  function rules(season, lang) {
    const activeLang = text[lang] ? lang : 'en';
    const t = text[activeLang];
    return `<p class="league-copy">${escape(t.total)}</p>
      <details><summary class="league-btn">${escape(t.rules)}</summary>${ruleDetails(season, activeLang)}</details>`;
  }

  function guide(season, lang = 'en') {
    const activeLang = text[lang] ? lang : 'en';
    const copy = guideText[activeLang];
    const scoring = window.LeagueScoring;
    const format = value => value.toLocaleString(activeLang === 'de' ? 'de-AT' : 'en-GB');
    const awards = scoring.placementPoints(season, 5);
    const bonusMax = season.bonus_points_max === undefined ? 1 : season.bonus_points_max;
    const bonusStep = season.bonus_points_step === undefined ? 0.5 : season.bonus_points_step;
    const diamond = scoring.seasonTiers.find(tier => tier.id === 'diamond');
    const standardExample = awards[0] === 3 && awards[2] === 2 && diamond.minimum === 70;
    const awardsIntro = activeLang === 'de'
      ? `Die Team-Platzierung wird zu deinen Basis-Saisonpunkten. Bei 5 Teams gibt es aktuell vom 1. bis zum letzten Platz ${awards.map(points => '+' + format(points)).join(' / ')}. Alle gewerteten Trainings zählen; es gibt keine Streichresultate.`
      : `Your team place becomes your base season points. With 5 teams, the current awards from first to last are ${awards.map(points => '+' + format(points)).join(' / ')}. Every scored training counts; no results are dropped.`;
    const bonusCopy = bonusMax === 0
      ? (activeLang === 'de' ? 'Bonuspunkte sind in dieser Saison deaktiviert.' : 'Bonus points are disabled for this season.')
      : bonusMax === 1 && bonusStep === 0.5
        ? (activeLang === 'de'
          ? 'Beim Last Man / Last Woman Standing gibt es pro ausgetragener Kategorie +1 BP für Platz 1 und +0,5 BP für Platz 2. BP zählen zur Gesamtpunktzahl und Rangstufe, verändern aber niemals ELO.'
          : 'In each Last Man / Last Woman Standing category played, first place gets +1 BP and second gets +0.5 BP. BP count toward your total and tier, but never change ELO.')
        : (activeLang === 'de'
          ? `Zusätzliche BP können bis ${format(bonusMax)} pro Spieler*in und Training in ${format(bonusStep)}er-Schritten vergeben werden. Sie zählen zur Gesamtpunktzahl und Rangstufe, aber niemals zur ELO.`
          : `Up to ${format(bonusMax)} extra BP per player and training can be awarded in steps of ${format(bonusStep)}. They count toward the total and tier, but never toward ELO.`);
    const diamondCopy = standardExample
      ? (activeLang === 'de'
        ? 'Diamond beginnt bei 70 Gesamtpunkten – nicht bei 70 Siegen. Beispiel bei 5 Teams: 14 erste Plätze (42 Punkte) plus 14 dritte Plätze (28 Punkte) ergeben 70. BP zählen ebenfalls mit.'
        : 'Diamond starts at 70 total points – not 70 wins. Example with 5 teams: 14 first-place finishes (42 points) plus 14 third-place finishes (28 points) make 70. BP count too.')
      : (activeLang === 'de'
        ? `Diamond beginnt bei ${format(diamond.minimum)} Gesamtpunkten – nicht bei ${format(diamond.minimum)} Siegen. Platzierungspunkte und BP zählen beide mit.`
        : `Diamond starts at ${format(diamond.minimum)} total points – not ${format(diamond.minimum)} wins. Placement points and BP both count.`);
    return `<details class="league-guide">
      <summary>${escape(copy.title)}</summary>
      <div class="league-guide-body">
        <p class="league-guide-lead">${escape(copy.lead)}</p>
        <ol class="league-guide-steps">${copy.steps.map(step => `<li><strong>${escape(step[0])}</strong><span>${escape(step[1])}</span></li>`).join('')}</ol>
        <section class="league-guide-section">
          <h3>${escape(copy.pointsHeading)}</h3>
          <div class="league-guide-grid">
            <div class="league-guide-card">
              <h4>${escape(copy.matchTitle)}</h4>
              <strong class="league-guide-score">${escape(copy.matchScore)}</strong>
              <p>${escape(copy.matchBody)}</p>
            </div>
            <div class="league-guide-card">
              <h4>${escape(copy.seasonTitle)}</h4>
              <strong class="league-guide-score">${escape(copy.seasonScore)}</strong>
              <p>${escape(copy.seasonBody)}</p>
            </div>
          </div>
        </section>
        <section class="league-guide-section">
          <h3>${escape(copy.eloHeading)}</h3>
          <p class="league-copy">${escape(copy.eloBody)}</p>
          <p class="league-guide-callout">${escape(copy.eloNote)}</p>
        </section>
        <section class="league-guide-section">
          <h3>${escape(copy.awardsHeading)}</h3>
          <p class="league-copy">${escape(awardsIntro)}</p>
          ${ruleDetails(season, activeLang)}
          <p class="league-copy">${escape(bonusCopy)}</p>
          <p class="league-guide-callout"><strong>Diamond:</strong> ${escape(diamondCopy)}</p>
        </section>
        <p class="league-guide-privacy">${escape(copy.privacy)}</p>
        <a class="league-btn league-btn-primary" href="/member#training">${escape(copy.signup)}</a>
      </div>
    </details>`;
  }

  function tierBadge(entry, lang = 'en') {
    const scoring = window.LeagueScoring;
    const tier = entry.legacy
      ? scoring.seasonTiers.find(item => item.id === entry.legacy.tier)
      : scoring.seasonTier(entry.points);
    if (!tier) {
      if (!entry.legacy.tier) return '';
      console.error('Unknown archived rank tier; displaying its label without a tier colour.');
      return `<span class="league-table-tier">${escape(entry.legacy.tier)}</span>`;
    }
    const description = entry.legacy
      ? (lang === 'de' ? 'Season 1: archivierte Rangstufe' : 'Season 1: archived tier')
      : (lang === 'de' ? `Ab ${tier.minimum} Gesamtpunkten inklusive BP` : `From ${tier.minimum} total points including BP`);
    return `<span class="league-table-tier league-tier-${tier.id}" title="${escape(description)}">${escape(tier.label)}</span>`;
  }

  function bonus(entry, lang = 'en', compact = false) {
    const t = text[lang] || text.en;
    const value = entry && entry.bonus_points !== undefined ? entry.bonus_points : 0;
    const formatted = typeof value === 'number'
      ? value.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 6 })
      : value;
    return `<span class="league-bonus" aria-label="${escape(t.bonus + ': ' + formatted + '. ' + t.bonusIncluded)}">${compact ? '' : 'BP '}${escape(formatted)}</span>`;
  }

  function movementData(entry, lang = 'en') {
    if (!entry || !Number.isFinite(entry.points_gain) || !Number.isInteger(entry.rank) || entry.rank < 1
      || !(entry.previous_rank === null || (Number.isInteger(entry.previous_rank) && entry.previous_rank > 0))
      || !(entry.previous_rank === null ? entry.rank_gain === null : Number.isInteger(entry.rank_gain))) return null;
    return changeData(entry.points_gain, entry.rank_gain, entry.previous_rank === null, lang);
  }

  function changeData(pointsGain, rankGain, isNew, lang, context) {
    const t = text[lang] || text.en;
    const format = value => value.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 6 });
    const points = pointsGain === 0 ? 0 : pointsGain;
    const pointsShort = (points > 0 ? '+' : '') + format(points);
    const gain = rankGain;
    let rankText = t.newRank, direction = 'new', arrow = '', rankShort = t.newRank;
    if (!isNew) {
      const count = Math.abs(gain);
      rankText = gain === 0 ? t.rankUnchanged : format(count) + ' '
        + (gain > 0 ? (count === 1 ? t.rankUpOne : t.rankUp) : (count === 1 ? t.rankDownOne : t.rankDown));
      direction = gain > 0 ? 'up' : gain < 0 ? 'down' : '';
      arrow = gain === 0 ? '' : (gain > 0 ? '\u2191' : '\u2193');
      rankShort = gain === 0 ? '\u2013' : arrow + format(count);
    }
    return {
      context: context || t.movementCompared,
      points: { short: pointsShort, text: pointsShort + ' ' + t.points, direction: points > 0 ? 'up' : points < 0 ? 'down' : '' },
      rank: { short: rankShort, text: rankText, direction, arrow }
    };
  }

  function movement(entry, lang = 'en') {
    const value = movementData(entry, lang);
    if (!value) return '';
    const color = field => field.direction ? ' league-movement-' + field.direction : '';
    return `<span class="league-movement">
      <span class="league-movement-context">${escape(value.context)}</span>
      <span class="league-movement-value${color(value.points)}">${escape(value.points.text)}</span>
      <span class="league-movement-value${color(value.rank)}">${value.rank.arrow ? `<span aria-hidden="true">${value.rank.arrow}</span> ` : ''}${escape(value.rank.text)}</span>
    </span>`;
  }

  function tableChange(data, field) {
    if (!data) return '<span aria-hidden="true">&ndash;</span>';
    const value = data[field];
    return `<span class="league-table-change${value.direction ? ' league-change-' + value.direction : ''}" title="${escape(data.context + ': ' + value.text)}"><span aria-hidden="true">${escape(value.short)}</span><span class="league-sr-only">${escape(value.text)}</span></span>`;
  }

  function standings(players, lang = 'en') {
    const t = text[lang] || text.en;
    const archived = players.length > 0 && players.every(p => p.legacy);
    const format = value => typeof value === 'number'
      ? value.toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 6 }) : value;
    const record = archived ? 'Streak' : t.wins;
    return `<div class="league-table-wrap"><table class="league-ranking-table">
      <caption class="league-sr-only">${escape(t.standings)}${archived ? ' - Season 1' : '. ' + escape(t.bonusIncluded)}</caption>
      <thead><tr>
        <th scope="col" class="league-table-rank" aria-label="${escape(t.place)}">#</th>
        <th scope="col">${lang === 'de' ? 'Spieler' : 'Player'}</th>
        <th scope="col" class="league-table-number league-table-total">${escape(archived ? t.points : t.totalPoints)}</th>
        <th scope="col" class="league-table-number league-table-secondary">${lang === 'de' ? 'Zuwachs' : 'Gain'}</th>
        <th scope="col" class="league-table-number league-table-secondary">${escape(t.played)}</th>
        <th scope="col" class="league-table-number league-table-secondary">${escape(record)}</th>
        <th scope="col" class="league-table-number league-table-bp" title="${escape(t.bonus)}">BP</th>
        <th scope="col" class="league-table-number league-table-secondary">${lang === 'de' ? 'Rang +/-' : 'Rank +/-'}</th>
      </tr></thead>
      <tbody>${players.map(p => {
        const changes = p.legacy
          ? (Number.isFinite(p.legacy.gain) && Number.isInteger(p.legacy.change)
            ? changeData(p.legacy.gain, p.legacy.change, false, lang, lang === 'de' ? 'Archivierte Ver\u00e4nderung' : 'Archived movement') : null)
          : movementData(p, lang);
        const recordValue = p.legacy ? p.legacy.streak : p.wins;
        const rankColor = [1, 2, 3].includes(p.rank) ? ' league-place-' + p.rank : '';
        const meta = p.played + ' ' + t.played
          + (recordValue === undefined ? '' : ' - ' + recordValue + ' ' + record);
        const shortMeta = escape(p.played) + (lang === 'de' ? ' Tr.' : ' played')
          + (recordValue === undefined ? '' : ' &middot; ' + escape(recordValue) + ' ' + escape(record));
        return `<tr>
          <td class="league-table-rank${rankColor}"><span class="league-rank">#${escape(p.rank)}</span><span class="league-table-mobile">${tableChange(changes, 'rank')}</span></td>
          <th scope="row" class="league-table-player"><span class="league-player-name">${escape(p.display_name)}</span>${tierBadge(p, lang)}<small class="league-table-mobile league-player-meta" title="${escape(meta)}">${shortMeta}</small></th>
          <td class="league-table-number"><span class="league-table-points">${escape(format(p.points))}</span><span class="league-table-mobile">${tableChange(changes, 'points')}</span></td>
          <td class="league-table-number league-table-secondary">${tableChange(changes, 'points')}</td>
          <td class="league-table-number league-table-secondary">${escape(format(p.played))}</td>
          <td class="league-table-number league-table-secondary">${recordValue === undefined ? '&ndash;' : escape(format(recordValue))}</td>
          <td class="league-table-number league-table-bp">${p.legacy ? `<span title="${lang === 'de' ? 'Archivierte BP' : 'Archived BP'}">${escape(format(p.legacy.bp))}</span>` : bonus(p, lang, true)}</td>
          <td class="league-table-number league-table-secondary">${tableChange(changes, 'rank')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function matchdayLink(eventData, lang = 'en') {
    if (!eventData || !eventData.id || !['published', 'finalized'].includes(eventData.status)
      || new Date(String(eventData.session_date).slice(0, 10) + 'T12:00:00Z').getUTCDay() !== 4) return '';
    const href = '/spieltag?event=' + encodeURIComponent(eventData.id);
    return `<a class="league-btn league-matchday-link" href="${escape(href)}">${escape((text[lang] || text.en).matchday)}</a>`;
  }

  function event(eventData, lang, options = {}) {
    const t = text[lang];
    const final = eventData.status === 'finalized';
    return `<div class="league-event-title">${escape(eventData.title)}</div>
      <p class="league-copy">${escape(date(eventData.session_date, lang))}${eventData.start_time ? ' &middot; ' + escape(eventData.start_time.slice(0, 5)) : ''}${eventData.location ? ' &middot; ' + escape(eventData.location) : ''}</p>
      <span class="league-chip league-chip-gold">${escape(final ? t.finalized : t.published)}</span>
      ${options.hideMatchdayLink ? '' : matchdayLink(eventData, lang)}
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

  function matchTable(eventData, lang = 'en') {
    const t = text[lang] || text.en;
    if (!eventData || !eventData.match_standings) return '';
    const table = eventData.match_standings;
    const names = new Map(eventData.teams.map(team => [team.number, team.name]));
    const finalized = eventData.status === 'finalized';
    const finalPlaces = new Map(eventData.teams.map(team => [team.number, team.placement]));
    const tableRows = [...table.standings];
    if (finalized) tableRows.sort((a, b) => finalPlaces.get(a.team_number) - finalPlaces.get(b.team_number));
    const winner = finalized ? eventData.teams.find(team => team.placement === 1) : null;
    return `<div class="league-block"><h3>${escape(t.matchTable)}</h3>
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
    </div>`;
  }

  function schedule(eventData, lang) {
    const t = text[lang];
    if (!eventData || !eventData.schedule) return `<p class="league-notice">${escape(t.noSchedule)}</p>`;
    const schedule = eventData.schedule;
    const names = new Map(eventData.teams.map(team => [team.number, team.name]));
    function clock(offset) {
      const start = schedule.meetup_time || eventData.start_time;
      if (!start) return '+' + offset + ' min';
      const [hours, minutes] = start.split(':').map(Number);
      const total = hours * 60 + minutes + offset;
      const day = Math.floor(total / 1440);
      return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0') + (day ? ` (+${day}d)` : '');
    }
    const firstPending = schedule.rounds.findIndex(round => round.matches.some(match => match.score_a === null));
    const buffer = schedule.available_minutes - schedule.duration_minutes;
    return `<div class="league-event-title">${escape(eventData.title)}</div>
      ${schedule.referee_policy ? `<p class="league-copy"><strong>${escape(t.program)}</strong></p>` : ''}
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
        ${round.referee_team ? `<p class="league-copy"><strong>${escape(t.refTeam)}: ${escape(names.get(round.referee_team))}</strong></p>`
          : schedule.referee_policy === 'external_ref_v1' ? `<p class="league-copy"><strong>${escape(t.externalRef)}</strong></p>` : ''}
        ${round.rest_teams?.length ? `<p class="league-copy">${escape(t.bye)}: ${round.rest_teams.map(team => escape(names.get(team))).join(', ')}</p>` : ''}
      </details>`).join('')}</div>
      ${matchTable(eventData, lang)}`;
  }

  return { escape, text, date, seasonOptions, rules, guide, tierBadge, bonus, standings, movement, matchdayLink, event, matchTable, schedule };
})();
