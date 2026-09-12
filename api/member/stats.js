const { getDb } = require('../../lib/db');
const { setCors } = require('../../lib/cors');
const { requireMember } = require('../../lib/auth');
const { players: seasonOnePlayers } = require('../../data/season-1.json');
const { rankPlayers } = require('../../js/league-archive');

module.exports = async (req, res) => {
  setCors(req, res, 'GET, PATCH, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });

  try {
    const payload = requireMember(req, res);
    if (!payload) return;

    const sql = getDb();

    // PATCH: Update email notification preferences
    if (req.method === 'PATCH') {
      const { email_notifications } = req.body || {};
      if (typeof email_notifications !== 'boolean') {
        return res.status(400).json({ error: 'email_notifications must be a boolean', code: 'VALIDATION_ERROR' });
      }
      await sql`UPDATE users SET email_notifications = ${email_notifications} WHERE id = ${payload.sub}`;
      return res.status(200).json({ success: true, email_notifications });
    }

    const users = await sql`
      SELECT id, email, display_name, ranking_player_name, email_notifications, created_at
      FROM users WHERE id = ${payload.sub} AND is_active = true
    `;

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found', code: 'UNAUTHORIZED' });
    }

    const user = users[0];
    const account = {
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      ranking_player_name: user.ranking_player_name,
      email_notifications: user.email_notifications !== false,
      member_since: user.created_at
    };
    if (req.query && req.query.view === 'account') {
      return res.status(200).json({ user: account });
    }

    const rankings = rankPlayers(seasonOnePlayers);

    // Match user to their ranking entry
    let stats = null;
    if (user.ranking_player_name) {
      const player = rankings.find(
        p => p.name && p.name.toLowerCase() === user.ranking_player_name.toLowerCase()
      );
      if (player) stats = { ...player };
    }

    return res.status(200).json({
      user: account,
      stats,
      rankings_season: 'Season 1',
      rankings
    });
  } catch (err) {
    console.error('Could not load stats:', err);
    return res.status(500).json({ error: 'Could not load stats', code: 'SERVER_ERROR' });
  }
};
