function normalizeName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('de-AT') : '';
}

function matchArchivedGender(user, archivePlayers, users = [user]) {
  const linked = normalizeName(user.ranking_player_name);
  const name = linked || normalizeName(user.display_name);
  if (!name) return 'unspecified';
  if (!linked && users.filter(u => normalizeName(u.display_name) === name).length !== 1) return 'unspecified';
  const matches = archivePlayers.filter(p => normalizeName(p.name) === name);
  return matches.length === 1 && ['male', 'female'].includes(matches[0].gender) ? matches[0].gender : 'unspecified';
}

function genderBackfillPlan(profiles, users, archivePlayers) {
  const members = new Map(users.map(u => [u.id, u]));
  return profiles.filter(p => p.gender === 'unspecified' && !p.merged_into && members.has(p.user_id))
    .map(p => ({ player_id: p.id, user_id: p.user_id, gender: matchArchivedGender(members.get(p.user_id), archivePlayers, users) }))
    .filter(p => p.gender !== 'unspecified');
}

module.exports = { normalizeName, matchArchivedGender, genderBackfillPlan };
