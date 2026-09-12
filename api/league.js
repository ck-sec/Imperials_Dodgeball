const { getDb } = require('../lib/db');
const { setCors } = require('../lib/cors');
const { requireAdmin, requireMember } = require('../lib/auth');
const { requireJSON } = require('../lib/validation');
const { assert, uuid, validateAction, publicView, adminView } = require('../lib/league');
const { readWorld, syncPlayers, applyAction, dbError } = require('../lib/league-db');

module.exports = async (req, res) => {
  setCors(req, res, 'GET, POST, OPTIONS');
  // Authenticated responses and unpublished data must never enter a shared cache.
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    if (req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      assert(requireJSON(req), 'Content-Type must be application/json');
      const input = validateAction(req.body);
      const sql = getDb();
      if (['save_player', 'link_player', 'generate'].includes(input.action)) await syncPlayers(sql);
      const world = input.action === 'save_season' ? null : await readWorld(sql);
      const result = await applyAction(sql, input, world);
      console.log('[AUDIT]', { action: `league_${input.action}`, event_id: result.event_id,
        season_id: result.season_id, player_id: result.player_id });
      return res.status(200).json({ success: true, ...result });
    }

    const view = req.query.view || 'public';
    assert(['admin', 'public', 'me'].includes(view), 'Invalid view');
    let userId;
    if (view === 'admin' && !requireAdmin(req, res)) return;
    if (view === 'me') {
      const member = requireMember(req, res);
      if (!member) return;
      userId = uuid(member.sub, 'Member id');
    }
    const seasonId = req.query.season_id === undefined ? undefined : uuid(req.query.season_id, 'season_id');
    const sql = getDb();
    if (view === 'admin') await syncPlayers(sql);
    const world = await readWorld(sql);
    if (userId) {
      assert(world.users.some(u => u.id === userId && u.is_active && u.status === 'approved'),
        'Approved active membership required', 403);
    }
    return res.status(200).json(view === 'admin' ? adminView(world) : publicView(world, seasonId, userId));
  } catch (err) {
    const known = dbError(err);
    if (known) return res.status(known.status).json({ error: known.message, code: known.code });
    console.error('League request failed:', { code: err.code || 'INTERNAL_ERROR', name: err.name });
    return res.status(500).json({ error: 'League request failed', code: 'SERVER_ERROR' });
  }
};
