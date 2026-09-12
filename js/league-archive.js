(function(root, factory) {
  const archive = factory();
  if (typeof module === 'object' && module.exports) module.exports = archive;
  else root.LeagueArchive = archive;
})(typeof window === 'undefined' ? globalThis : window, function() {
  function rankPlayers(players) {
    const sorted = [...players].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de'));
    let rank = 1;
    return sorted.map((player, index) => {
      if (index > 0 && player.points !== sorted[index - 1].points) rank = index + 1;
      return { ...player, rank };
    });
  }

  function hallOfFame(players) {
    return ['male', 'female'].map(gender => ({
      gender,
      players: rankPlayers(players.filter(player => player.gender === gender)).filter(player => player.rank <= 3)
    }));
  }

  return { rankPlayers, hallOfFame };
});
