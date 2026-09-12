(function(root, factory) {
  const scoring = factory();
  if (typeof module === 'object' && module.exports) module.exports = scoring;
  else root.LeagueScoring = scoring;
})(typeof window === 'undefined' ? globalThis : window, function() {
  const seasonTiers = Object.freeze([
    { id: 'bronze', label: 'Bronze', minimum: 0 },
    { id: 'silver', label: 'Silver', minimum: 10 },
    { id: 'gold', label: 'Gold', minimum: 25 },
    { id: 'platinum', label: 'Platinum', minimum: 45 },
    { id: 'diamond', label: 'Diamond', minimum: 70 }
  ].map(tier => Object.freeze(tier)));

  function seasonTier(totalPoints) {
    if (!Number.isFinite(totalPoints) || totalPoints < 0) {
      throw new RangeError('Season tiers require a finite, nonnegative total.');
    }
    let tier = seasonTiers[0];
    for (const candidate of seasonTiers) {
      if (totalPoints >= candidate.minimum) tier = candidate;
    }
    return tier;
  }

  function placementPoints(settings, teamCount) {
    if (!Number.isInteger(teamCount) || teamCount < 2) throw new RangeError('At least two teams are required.');
    const points = settings.placement_points;
    if (!Array.isArray(points) || !points.length || points.some(value => !Number.isFinite(value))) {
      throw new TypeError('A finite placement points scale is required.');
    }
    const mode = settings.scoring_mode || 'relative';
    if (!['relative', 'fixed'].includes(mode)) throw new TypeError('Invalid scoring mode.');
    const step = settings.points_step === undefined ? 0.5 : settings.points_step;
    if (!Number.isFinite(step) || step <= 0) throw new TypeError('A positive points step is required.');
    return Array.from({ length: teamCount }, (_, index) => {
      if (mode === 'fixed') return points[Math.min(index, points.length - 1)];
      // Interpolate the configured curve by relative finish, not by team count.
      const position = index * (points.length - 1) / (teamCount - 1);
      const lower = Math.floor(position);
      const upper = Math.min(points.length - 1, lower + 1);
      const value = points[lower] + (points[upper] - points[lower]) * (position - lower);
      const scaled = value / step;
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
      return Number((Math.round(scaled + tolerance) * step).toFixed(4));
    });
  }
  return { placementPoints, seasonTiers, seasonTier };
});
