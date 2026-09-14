/* Single-page, dependency-free league poster from the safe public matchday payload. */
(function () {
  'use strict';

  const WIDTH = 1754;
  const HEIGHT = 1240;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const COLORS = {
    deep: '#061329',
    navy: '#0b2043',
    panel: '#102b57',
    panelDark: '#071a38',
    border: '#365b8e',
    gold: '#d4961a',
    goldLight: '#f4c95d',
    cyan: '#61c8ff',
    cloud: '#f6f8ff',
    muted: '#b3c1d9',
    green: '#4ade80',
    pink: '#fb7185',
    violet: '#a78bfa',
  };
  const copy = {
    de: {
      itinerary: 'SPIELPLAN & ABLAUF',
      final: 'ENDRESULTATE',
      teams: 'TEAMS & AUFSTELLUNG',
      tree: 'MATCH TREE',
      treeKicker: 'RUNDEN · FELDER · ERGEBNISSE',
      itineraryKicker: 'RUNDEN · FELDER · PAUSEN',
      table: 'TAGESTABELLE',
      schedule: 'SPIELPLAN BEREIT',
      team: 'TEAM',
      round: 'RUNDE',
      rounds: 'Runden',
      court: 'FELD',
      game: 'SPIEL',
      bye: 'PAUSE',
      refTeam: 'REF-TEAM',
      meetWarmup: 'TREFFPUNKT & AUFWÄRMEN',
      leagueGames: 'LIGASPIELE',
      finale: 'LAST MAN / LAST WOMAN',
      finaleAwards: 'Sieger +1 BP · Zweite +0,5 BP',
      lastMan: 'LM',
      lastWoman: 'LW',
      pending: 'OFFEN',
      played: 'SP',
      win: 'S',
      draw: 'U',
      loss: 'N',
      points: 'PKT',
      matches: 'Spiele',
      courts: 'Felder',
      minutes: 'Minuten',
      more: 'weitere',
      share: 'FÜR DIE WHATSAPP-GRUPPE',
      generated: 'Öffentliche Spieltagsdaten · keine privaten Ratings oder Kontodaten',
    },
    en: {
      itinerary: 'FIXTURES & ITINERARY',
      final: 'FINAL RESULTS',
      teams: 'TEAMS & LINEUPS',
      tree: 'MATCH TREE',
      treeKicker: 'ROUNDS · COURTS · RESULTS',
      itineraryKicker: 'ROUNDS · COURTS · RESTS',
      table: 'MATCHDAY TABLE',
      schedule: 'FIXTURES READY',
      team: 'TEAM',
      round: 'ROUND',
      rounds: 'rounds',
      court: 'COURT',
      game: 'GAME',
      bye: 'REST',
      refTeam: 'REF TEAM',
      meetWarmup: 'MEET & WARM-UP',
      leagueGames: 'LEAGUE GAMES',
      finale: 'LAST MAN / LAST WOMAN',
      finaleAwards: 'Winner +1 BP · runner-up +0.5 BP',
      lastMan: 'LM',
      lastWoman: 'LW',
      pending: 'OPEN',
      played: 'PL',
      win: 'W',
      draw: 'D',
      loss: 'L',
      points: 'PTS',
      matches: 'matches',
      courts: 'courts',
      minutes: 'minutes',
      more: 'more',
      share: 'MADE FOR YOUR WHATSAPP GROUP',
      generated: 'Public matchday data · no private ratings or account data',
    },
  };

  function fail(message) {
    throw new Error(message);
  }

  function cleanText(value, fallback = '') {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text || fallback;
  }

  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
  }

  function projectEvent(event, standings = []) {
    if (!event || typeof event !== 'object' || !UUID.test(event.id || '')) fail('A valid published league event is required');
    if (!['published', 'finalized'].includes(event.status)) fail('Publish the league before exporting its PDF');
    if (!Array.isArray(event.teams) || event.teams.length < 2) fail('The league needs at least two published teams');
    if (!event.schedule || !Array.isArray(event.schedule.rounds) || !event.schedule.rounds.length) {
      fail('Generate a fixture schedule before exporting its PDF');
    }
    return {
      id: event.id.toLowerCase(),
      title: cleanText(event.title, 'Imperials Social League'),
      session_date: cleanText(event.session_date),
      start_time: cleanText(event.start_time),
      end_time: cleanText(event.end_time),
      location: cleanText(event.location, 'Vienna'),
      status: event.status,
      teams: event.teams.map(team => ({
        number: integer(team.number),
        name: cleanText(team.name, 'Team ' + integer(team.number)),
        placement: Number.isInteger(team.placement) ? team.placement : null,
        points: Number.isFinite(Number(team.points)) ? Number(team.points) : 0,
        players: Array.isArray(team.players) ? team.players.map(player => ({
          display_name: cleanText(player && player.display_name, 'Player'),
        })) : [],
      })),
      schedule: {
        courts: integer(event.schedule.courts, 1),
        active_courts: integer(event.schedule.active_courts, integer(event.schedule.courts, 1)),
        match_minutes: integer(event.schedule.match_minutes),
        meetup_time: cleanText(event.schedule.meetup_time || event.start_time),
        warmup_minutes: integer(event.schedule.warmup_minutes),
        available_minutes: integer(event.schedule.available_minutes, integer(event.schedule.duration_minutes)),
        duration_minutes: integer(event.schedule.duration_minutes),
        finale_start_minute: integer(event.schedule.finale_start_minute, integer(event.schedule.duration_minutes)),
        finale_minutes: integer(event.schedule.finale_minutes),
        total_duration_minutes: integer(event.schedule.total_duration_minutes, integer(event.schedule.duration_minutes)),
        referee_policy: cleanText(event.schedule.referee_policy),
        rounds: event.schedule.rounds.map(round => ({
          number: integer(round.number),
          start_minute: integer(round.start_minute),
          end_minute: integer(round.end_minute),
          bye_teams: Array.isArray(round.bye_teams) ? round.bye_teams.map(number => integer(number)) : [],
          referee_team: integer(round.referee_team),
          rest_teams: Array.isArray(round.rest_teams) ? round.rest_teams.map(number => integer(number)) : [],
          matches: Array.isArray(round.matches) ? round.matches.map(match => ({
            number: integer(match.number),
            court: integer(match.court, 1),
            team_a: integer(match.team_a),
            team_b: integer(match.team_b),
            score_a: Number.isInteger(match.score_a) ? match.score_a : null,
            score_b: Number.isInteger(match.score_b) ? match.score_b : null,
          })) : [],
        })),
      },
      match_standings: event.match_standings && Array.isArray(event.match_standings.standings) ? {
        standings: event.match_standings.standings.map(row => ({
          team_number: integer(row.team_number),
          rank: integer(row.rank),
          played: integer(row.played),
          won: integer(row.won),
          drawn: integer(row.drawn),
          lost: integer(row.lost),
          score_difference: integer(row.score_difference),
          table_points: Number.isFinite(Number(row.table_points)) ? Number(row.table_points) : 0,
        })),
      } : null,
      finale_results: event.finale_results && typeof event.finale_results === 'object'
        ? Object.fromEntries(['men', 'women'].map(key => {
          const category = event.finale_results[key];
          return [key, category && category.winner && category.runner_up ? {
            winner: {
              display_name: cleanText(category.winner.display_name, 'Player'),
              bonus_points: Number.isFinite(Number(category.winner.bonus_points))
                ? Number(category.winner.bonus_points) : 0,
            },
            runner_up: {
              display_name: cleanText(category.runner_up.display_name, 'Player'),
              bonus_points: Number.isFinite(Number(category.runner_up.bonus_points))
                ? Number(category.runner_up.bonus_points) : 0,
            },
          } : null];
        })) : null,
      standings: Array.isArray(standings) ? standings.map(player => ({
        display_name: cleanText(player && player.display_name, 'Player'),
        rank: integer(player && player.rank),
        points: Number.isFinite(Number(player && player.points)) ? Number(player.points) : 0,
      })) : [],
    };
  }

  function allMatches(event) {
    return event.schedule.rounds.flatMap(round => round.matches);
  }

  function exportMode(event, requested) {
    if (requested === 'itinerary' || requested === 'results') return requested;
    return event.status === 'finalized' ? 'results' : 'itinerary';
  }

  function fileName(event, requestedMode) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(event.session_date) ? event.session_date : 'matchday';
    return `vienna-imperials-${exportMode(event, requestedMode)}-${date}.pdf`;
  }

  function clock(start, offset) {
    if (!/^([01]\d|2[0-3]):[0-5]\d/.test(start || '')) return '+' + offset + ' min';
    const [hours, minutes] = start.split(':').map(Number);
    const total = hours * 60 + minutes + offset;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function eventDate(value, lang) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return cleanText(value);
    return new Intl.DateTimeFormat(lang === 'de' ? 'de-AT' : 'en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }

  function pagePlan(event, requestedMode) {
    return [{
      type: 'poster',
      mode: exportMode(event, requestedMode),
      teamCount: event.teams.length,
      roundCount: event.schedule.rounds.length,
      matchCount: allMatches(event).length,
    }];
  }

  function roundedPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fillRounded(ctx, x, y, width, height, radius, fill, stroke) {
    roundedPath(ctx, x, y, width, height, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawCoverImage(ctx, image, x, y, width, height, focusY = .5) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceHeight,
      (image.naturalHeight - sourceHeight) * focusY));
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  }

  function font(ctx, size, weight = 700, family = 'Inter') {
    ctx.font = `${weight} ${size}px "${family}", sans-serif`;
  }

  function fitText(ctx, value, x, y, maxWidth, size, minimum = 12, align = 'left', color = COLORS.cloud, family = 'Barlow Condensed') {
    let current = size;
    const text = cleanText(value);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    font(ctx, current, 700, family);
    while (current > minimum && ctx.measureText(text).width > maxWidth) {
      current -= 1;
      font(ctx, current, 700, family);
    }
    ctx.fillText(text, x, y);
  }

  function drawLogo(ctx, image, x, y, width) {
    const height = width * image.naturalHeight / image.naturalWidth;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 18;
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
  }

  function teamColor(number) {
    return [COLORS.cyan, COLORS.goldLight, COLORS.pink, COLORS.green, COLORS.violet][Math.abs(number - 1) % 5];
  }

  function drawHeader(ctx, event, images, t, lang, mode) {
    drawCoverImage(ctx, images.match, 0, 0, WIDTH, 206, .46);
    const overlay = ctx.createLinearGradient(0, 0, WIDTH, 0);
    overlay.addColorStop(0, 'rgba(6,19,41,.98)');
    overlay.addColorStop(.58, 'rgba(6,19,41,.72)');
    overlay.addColorStop(1, 'rgba(6,19,41,.94)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, WIDTH, 214);
    drawLogo(ctx, images.logo, 48, 24, 160);
    ctx.fillStyle = COLORS.goldLight;
    font(ctx, 21, 800, 'Barlow Condensed');
    ctx.textAlign = 'left';
    ctx.fillText('VIENNA IMPERIALS · SOCIAL LEAGUE', 236, 50);
    fitText(ctx, event.title, 236, 114, 940, 64, 34, 'left', COLORS.cloud, 'Bebas Neue');
    fillRounded(ctx, 236, 135, 210, 42, 21, 'rgba(212,150,26,.92)', null);
    ctx.fillStyle = COLORS.deep;
    font(ctx, 18, 900, 'Barlow Condensed');
    ctx.textAlign = 'center';
    ctx.fillText(mode === 'results' ? t.final : t.itinerary, 341, 163);
    ctx.fillStyle = COLORS.cloud;
    font(ctx, 25, 700);
    ctx.textAlign = 'right';
    ctx.fillText(eventDate(event.session_date, lang), 1698, 67);
    ctx.fillStyle = COLORS.muted;
    font(ctx, 19, 600);
    const time = [event.start_time && event.start_time.slice(0, 5), event.end_time && event.end_time.slice(0, 5)]
      .filter(Boolean).join('–');
    ctx.fillText([time, event.location].filter(Boolean).join(' · '), 1698, 103);
    const stats = `${allMatches(event).length} ${t.matches} · ${event.schedule.courts} ${t.courts} · ${event.schedule.duration_minutes} ${t.minutes}`;
    ctx.fillStyle = COLORS.goldLight;
    font(ctx, 18, 800, 'Barlow Condensed');
    ctx.fillText(stats, 1698, 158);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(0, 206, WIDTH, 8);
  }

  function drawTeamPanel(ctx, event, images, t) {
    const x = 46;
    const y = 240;
    const width = 424;
    const height = 902;
    ctx.save();
    roundedPath(ctx, x, y, width, height, 24);
    ctx.clip();
    drawCoverImage(ctx, images.jubel, x, y, width, height, .42);
    ctx.fillStyle = 'rgba(6,19,41,.83)';
    ctx.fillRect(x, y, width, height);
    const fade = ctx.createLinearGradient(x, y, x, y + height);
    fade.addColorStop(0, 'rgba(16,43,87,.28)');
    fade.addColorStop(1, 'rgba(3,11,25,.86)');
    ctx.fillStyle = fade;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    roundedPath(ctx, x, y, width, height, 24);
    ctx.strokeStyle = 'rgba(98,200,255,.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLORS.goldLight;
    font(ctx, 25, 800, 'Barlow Condensed');
    ctx.textAlign = 'left';
    ctx.fillText(t.teams, x + 24, y + 44);

    const gap = 10;
    const available = height - 86;
    const cardHeight = Math.min(220, Math.floor((available - gap * (event.teams.length - 1)) / event.teams.length));
    let cardY = y + 66;
    event.teams.forEach(team => {
      const color = teamColor(team.number);
      fillRounded(ctx, x + 16, cardY, width - 32, cardHeight, 16, 'rgba(7,26,56,.88)', 'rgba(179,193,217,.3)');
      ctx.fillStyle = color;
      ctx.fillRect(x + 16, cardY, 7, cardHeight);
      fillRounded(ctx, x + 32, cardY + 14, 42, 34, 12, color, null);
      ctx.fillStyle = COLORS.deep;
      font(ctx, 22, 900, 'Bebas Neue');
      ctx.textAlign = 'center';
      ctx.fillText(String(team.number), x + 53, cardY + 39);
      fitText(ctx, team.name, x + 88, cardY + 41, width - 152, 29, 17, 'left', COLORS.cloud);
      if (team.placement !== null) {
        ctx.fillStyle = COLORS.goldLight;
        font(ctx, 16, 800, 'Barlow Condensed');
        ctx.textAlign = 'right';
        ctx.fillText('#' + team.placement, x + width - 34, cardY + 39);
      }
      const lineHeight = 22;
      const rows = Math.max(1, Math.floor((cardHeight - 67) / lineHeight));
      const capacity = rows * 2;
      const truncated = team.players.length > capacity;
      const visibleCapacity = truncated ? Math.max(1, capacity - 1) : capacity;
      const players = team.players.slice(0, visibleCapacity);
      const columnWidth = (width - 70) / 2;
      players.forEach((player, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const px = x + 38 + column * columnWidth;
        const py = cardY + 70 + row * lineHeight;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px + 3, py - 5, 3, 0, Math.PI * 2);
        ctx.fill();
        fitText(ctx, player.display_name, px + 13, py, columnWidth - 20, 16, 11, 'left', COLORS.cloud, 'Inter');
      });
      if (truncated) {
        ctx.fillStyle = COLORS.muted;
        font(ctx, 14, 700);
        ctx.textAlign = 'right';
        ctx.fillText(`+${team.players.length - visibleCapacity} ${t.more}`, x + width - 34, cardY + cardHeight - 14);
      }
      cardY += cardHeight + gap;
    });
  }

  function drawTree(ctx, event, t, mode) {
    const x = 500;
    const y = 240;
    const width = 1208;
    const height = 672;
    fillRounded(ctx, x, y, width, height, 24, 'rgba(7,26,56,.9)', 'rgba(54,91,142,.72)');
    ctx.fillStyle = COLORS.goldLight;
    font(ctx, 28, 800, 'Barlow Condensed');
    ctx.textAlign = 'left';
    ctx.fillText(t.tree, x + 28, y + 43);
    ctx.fillStyle = COLORS.muted;
    font(ctx, 16, 800, 'Barlow Condensed');
    ctx.textAlign = 'right';
    ctx.fillText(mode === 'results' ? t.treeKicker : t.itineraryKicker, x + width - 28, y + 41);

    const rounds = event.schedule.rounds;
    const columnGap = 14;
    const innerX = x + 24;
    const innerWidth = width - 48;
    const columnWidth = (innerWidth - columnGap * (rounds.length - 1)) / rounds.length;
    const centers = rounds.map((_, index) => innerX + index * (columnWidth + columnGap) + columnWidth / 2);
    ctx.strokeStyle = 'rgba(212,150,26,.58)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centers[0], y + 92);
    ctx.lineTo(centers[centers.length - 1], y + 92);
    ctx.stroke();

    const names = new Map(event.teams.map(team => [team.number, team.name]));
    rounds.forEach((round, roundIndex) => {
      const columnX = innerX + roundIndex * (columnWidth + columnGap);
      const center = centers[roundIndex];
      ctx.fillStyle = COLORS.gold;
      ctx.beginPath();
      ctx.arc(center, y + 92, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(212,150,26,.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(center, y + 101);
      ctx.lineTo(center, y + 145);
      ctx.stroke();
      fillRounded(ctx, columnX, y + 116, columnWidth, 66, 14, 'rgba(16,43,87,.95)', 'rgba(212,150,26,.42)');
      ctx.fillStyle = COLORS.goldLight;
      font(ctx, Math.max(14, Math.min(21, columnWidth / 9)), 800, 'Barlow Condensed');
      ctx.textAlign = 'center';
      ctx.fillText(`${t.round} ${round.number}`, center, y + 144);
      ctx.fillStyle = COLORS.muted;
      font(ctx, Math.max(11, Math.min(15, columnWidth / 13)), 700);
      ctx.fillText(`${clock(event.schedule.meetup_time || event.start_time, round.start_minute)}–${clock(event.schedule.meetup_time || event.start_time, round.end_minute)}`, center, y + 168);

      const matches = round.matches;
      const matchGap = 12;
      const available = height - 250 - (round.referee_team ? 50 : 0) - (round.rest_teams.length ? 24 : 0);
      const matchHeight = Math.min(164, Math.floor((available - matchGap * Math.max(0, matches.length - 1)) / Math.max(1, matches.length)));
      matches.forEach((match, index) => {
        const matchY = y + 204 + index * (matchHeight + matchGap);
        fillRounded(ctx, columnX, matchY, columnWidth, matchHeight, 14, 'rgba(3,13,30,.96)', 'rgba(54,91,142,.72)');
        ctx.fillStyle = COLORS.muted;
        font(ctx, Math.max(10, Math.min(14, columnWidth / 15)), 800, 'Barlow Condensed');
        ctx.textAlign = 'left';
        ctx.fillText(`${t.game} ${match.number}`, columnX + 14, matchY + 24);
        ctx.textAlign = 'right';
        ctx.fillText(`${t.court} ${match.court}`, columnX + columnWidth - 14, matchY + 24);
        const rows = [
          { number: match.team_a, score: mode === 'results' ? match.score_a : null },
          { number: match.team_b, score: mode === 'results' ? match.score_b : null },
        ];
        const rowStart = matchY + Math.max(56, matchHeight * .48);
        rows.forEach((row, rowIndex) => {
          const rowY = rowStart + rowIndex * Math.min(48, matchHeight * .27);
          const color = teamColor(row.number);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(columnX + 15, rowY - 5, 5, 0, Math.PI * 2);
          ctx.fill();
          fitText(ctx, names.get(row.number), columnX + 29, rowY, columnWidth - 82,
            Math.max(13, Math.min(21, columnWidth / 10)), 10, 'left', COLORS.cloud);
          if (mode === 'results') {
            ctx.fillStyle = row.score === null ? COLORS.muted : COLORS.goldLight;
            font(ctx, Math.max(16, Math.min(24, columnWidth / 9)), 800, 'Inter');
            ctx.textAlign = 'right';
            ctx.fillText(row.score === null ? '—' : String(row.score), columnX + columnWidth - 14, rowY);
          }
        });
      });
      if (round.referee_team) {
        ctx.fillStyle = COLORS.goldLight;
        font(ctx, Math.max(10, Math.min(13, columnWidth / 15)), 700);
        ctx.textAlign = 'center';
        const referee = `${t.refTeam}: ${names.get(round.referee_team)}`;
        fitText(ctx, referee, center, y + height - (round.rest_teams.length ? 42 : 20),
          columnWidth - 10, 13, 9, 'center', COLORS.goldLight, 'Inter');
      }
      if (round.rest_teams.length) {
        const rest = `${t.bye}: ${round.rest_teams.map(number => names.get(number)).join(', ')}`;
        fitText(ctx, rest, center, y + height - 18, columnWidth - 10, 12, 8, 'center', COLORS.muted, 'Inter');
      }
    });
  }

  function drawStandings(ctx, event, t, mode) {
    const x = 500;
    const y = 934;
    const width = 1208;
    const height = 208;
    fillRounded(ctx, x, y, width, height, 24, 'rgba(7,26,56,.9)', 'rgba(54,91,142,.72)');
    const recorded = allMatches(event).filter(match => match.score_a !== null && match.score_b !== null).length;
    const hasTable = mode === 'results' && recorded > 0 && event.match_standings;
    ctx.fillStyle = COLORS.goldLight;
    font(ctx, 23, 800, 'Barlow Condensed');
    ctx.textAlign = 'left';
    ctx.fillText(hasTable ? t.table : t.schedule, x + 24, y + 38);
    if (!hasTable) {
      const start = event.schedule.meetup_time || event.start_time;
      const finaleStart = event.schedule.finale_start_minute || event.schedule.duration_minutes;
      const program = [
        { time: `${clock(start, 0)}–${clock(start, event.schedule.warmup_minutes)}`, label: t.meetWarmup, detail: t.itineraryKicker },
        { time: `${clock(start, event.schedule.warmup_minutes)}–${clock(start, finaleStart)}`, label: t.leagueGames,
          detail: `${event.schedule.rounds.length} ${t.rounds} · ${allMatches(event).length} ${t.matches} · ${event.schedule.active_courts} ${t.courts}` },
        { time: `${clock(start, finaleStart)}–${clock(start, event.schedule.total_duration_minutes)}`, label: t.finale, detail: t.finaleAwards },
      ];
      const gap = 12;
      const cardWidth = (width - 48 - gap * 2) / 3;
      program.forEach((item, index) => {
        const cardX = x + 24 + index * (cardWidth + gap);
        fillRounded(ctx, cardX, y + 54, cardWidth, 128, 15, 'rgba(3,13,30,.86)', 'rgba(54,91,142,.62)');
        ctx.fillStyle = COLORS.goldLight;
        font(ctx, 25, 800, 'Bebas Neue');
        ctx.fillText(item.time, cardX + 14, y + 88);
        fitText(ctx, item.label, cardX + 14, y + 124, cardWidth - 28, 20, 11, 'left', COLORS.cloud);
        fitText(ctx, item.detail, cardX + 14, y + 158, cardWidth - 28, 14, 9, 'left', COLORS.muted, 'Inter');
      });
      return;
    }
    const finaleWinners = [
      event.finale_results?.men ? `${t.lastMan}: ${event.finale_results.men.winner.display_name}` : '',
      event.finale_results?.women ? `${t.lastWoman}: ${event.finale_results.women.winner.display_name}` : '',
    ].filter(Boolean).join(' · ');
    if (finaleWinners) fitText(ctx, finaleWinners, x + width - 24, y + 36, 650, 15, 10, 'right', COLORS.goldLight, 'Inter');
    const names = new Map(event.teams.map(team => [team.number, team.name]));
    const placements = new Map(event.teams.map(team => [team.number, team.placement]));
    const rows = [...event.match_standings.standings].sort((a, b) =>
      event.status === 'finalized'
        ? (placements.get(a.team_number) || a.rank) - (placements.get(b.team_number) || b.rank)
        : a.rank - b.rank);
    const gap = 10;
    const cardWidth = (width - 48 - gap * (rows.length - 1)) / rows.length;
    rows.forEach((row, index) => {
      const cardX = x + 24 + index * (cardWidth + gap);
      const color = teamColor(row.team_number);
      fillRounded(ctx, cardX, y + 55, cardWidth, 128, 15,
        index === 0 ? 'rgba(212,150,26,.15)' : 'rgba(3,13,30,.86)',
        index === 0 ? 'rgba(212,150,26,.65)' : 'rgba(54,91,142,.62)');
      ctx.fillStyle = color;
      font(ctx, 34, 800, 'Bebas Neue');
      ctx.textAlign = 'left';
      const rank = event.status === 'finalized' ? placements.get(row.team_number) || row.rank : row.rank;
      ctx.fillText('#' + rank, cardX + 14, y + 91);
      fitText(ctx, names.get(row.team_number), cardX + 14, y + 122, cardWidth - 28, 21, 11, 'left', COLORS.cloud);
      ctx.fillStyle = COLORS.muted;
      font(ctx, Math.max(10, Math.min(13, cardWidth / 15)), 700, 'Inter');
      ctx.fillText(`${t.played} ${row.played} · ${t.win} ${row.won} · ${t.draw} ${row.drawn} · ${t.loss} ${row.lost}`, cardX + 14, y + 149);
      ctx.fillStyle = COLORS.goldLight;
      font(ctx, 18, 800, 'Inter');
      ctx.fillText(`${row.table_points} ${t.points}`, cardX + 14, y + 174);
    });
  }

  function drawFooter(ctx, publicUrl, t) {
    ctx.strokeStyle = 'rgba(179,193,217,.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(46, 1170);
    ctx.lineTo(1708, 1170);
    ctx.stroke();
    ctx.fillStyle = COLORS.goldLight;
    font(ctx, 16, 800, 'Barlow Condensed');
    ctx.textAlign = 'left';
    ctx.fillText(t.share, 46, 1204);
    ctx.fillStyle = COLORS.muted;
    font(ctx, 14, 600);
    ctx.textAlign = 'center';
    ctx.fillText(t.generated, WIDTH / 2, 1204);
    const short = cleanText(publicUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');
    fitText(ctx, short, 1708, 1204, 520, 14, 10, 'right', COLORS.muted, 'Inter');
  }

  function drawPoster(event, images, publicUrl, t, lang, mode) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) fail('Canvas rendering is unavailable in this browser');
    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, COLORS.deep);
    background.addColorStop(.54, COLORS.navy);
    background.addColorStop(1, '#030b19');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.globalAlpha = .07;
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 3;
    for (let offset = -700; offset < 2200; offset += 130) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + 760, HEIGHT);
      ctx.stroke();
    }
    ctx.restore();
    drawHeader(ctx, event, images, t, lang, mode);
    drawTeamPanel(ctx, event, images, t);
    drawTree(ctx, event, t, mode);
    drawStandings(ctx, event, t, mode);
    drawFooter(ctx, publicUrl, t);
    return canvas;
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('A required Imperials image could not be loaded'));
      image.src = new URL(source, document.baseURI).href;
    });
  }

  async function loadAssets() {
    const [logo, match, jubel] = await Promise.all([
      loadImage('/logo.webp'),
      loadImage('/imperials-match-wide.webp'),
      loadImage('/imperials-jubel.webp'),
    ]);
    return { logo, match, jubel };
  }

  function jpegBytes(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {
          reject(new Error('The browser could not encode the PDF artwork'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/jpeg', .92);
    });
  }

  function asciiBytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index++) bytes[index] = value.charCodeAt(index) & 255;
    return bytes;
  }

  function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function pdfFromJpegs(images, metadata = {}) {
    if (!Array.isArray(images) || !images.length) fail('At least one PDF page is required');
    const pageIds = images.map((_, index) => 5 + index * 3);
    const infoId = 3 + images.length * 3;
    const objectCount = infoId;
    const chunks = [asciiBytes('%PDF-1.4\n%VI-PDF\n')];
    const offsets = new Array(objectCount + 1).fill(0);
    let length = chunks[0].length;
    const add = part => {
      const bytes = typeof part === 'string' ? asciiBytes(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };
    const object = (id, parts) => {
      offsets[id] = length;
      add(`${id} 0 obj\n`);
      for (const part of parts) add(part);
      add('\nendobj\n');
    };
    object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    object(2, [`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] >>`]);
    images.forEach((image, index) => {
      const imageId = 3 + index * 3;
      const contentId = imageId + 1;
      const pageId = imageId + 2;
      const name = 'PageImage' + (index + 1);
      const landscape = image.width > image.height;
      const pageWidth = landscape ? 841.89 : 595.28;
      const pageHeight = landscape ? 595.28 : 841.89;
      object(imageId, [
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
        image.bytes,
        '\nendstream',
      ]);
      const command = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${name} Do\nQ\n`;
      object(contentId, [`<< /Length ${command.length} >>\nstream\n${command}endstream`]);
      object(pageId, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `,
        `/Resources << /XObject << /${name} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ]);
    });
    const safeTitle = cleanText(metadata.title, 'Vienna Imperials League').replace(/[^\x20-\x7e]/g, '?')
      .replace(/([\\()])/g, '\\$1');
    object(infoId, [`<< /Title (${safeTitle}) /Author (Vienna Imperials) /Creator (Imperials Match Center) >>`]);
    const xref = length;
    add(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= objectCount; id++) add(String(offsets[id]).padStart(10, '0') + ' 00000 n \n');
    add(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return concatBytes(chunks);
  }

  async function create(event, options = {}) {
    const lang = options.lang === 'en' ? 'en' : 'de';
    const model = projectEvent(event, options.standings);
    const mode = exportMode(model, options.mode);
    if (mode === 'results' && model.status !== 'finalized') fail('Finalize the league before exporting final results');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const images = await loadAssets();
    const publicUrl = cleanText(options.publicUrl,
      new URL('/spieltag?event=' + encodeURIComponent(model.id), window.location.origin).href);
    const canvas = drawPoster(model, images, publicUrl, copy[lang], lang, mode);
    const page = { bytes: await jpegBytes(canvas), width: canvas.width, height: canvas.height };
    canvas.width = 1;
    canvas.height = 1;
    const bytes = pdfFromJpegs([page], { title: model.title });
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: fileName(model, mode),
      pageCount: 1,
      mode,
      byteLength: bytes.length,
    };
  }

  function save(result) {
    if (!result || !(result.blob instanceof Blob)) fail('Create the PDF before downloading it');
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function asFile(result) {
    if (typeof File !== 'function') return null;
    return new File([result.blob], result.filename, { type: 'application/pdf', lastModified: Date.now() });
  }

  function canShare(file) {
    if (!file || typeof navigator === 'undefined' || typeof navigator.share !== 'function'
      || typeof navigator.canShare !== 'function') return false;
    try { return navigator.canShare({ files: [file] }); } catch { return false; }
  }

  function share(file, title) {
    if (!canShare(file)) fail('PDF file sharing is unavailable in this browser');
    return navigator.share({ files: [file], title: cleanText(title, 'Vienna Imperials League') });
  }

  window.LeaguePDF = {
    projectEvent,
    allMatches,
    exportMode,
    fileName,
    clock,
    pagePlan,
    pdfFromJpegs,
    create,
    save,
    asFile,
    canShare,
    share,
  };
})();
