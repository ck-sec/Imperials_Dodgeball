const { isValidUuid } = require('./validation');

async function findAuthorizedAdmin(sql, userId) {
  if (!isValidUuid(userId)) return null;
  const rows = await sql`
    SELECT u.id, u.display_name
    FROM admin_users a
    JOIN users u ON u.id = a.user_id
    WHERE a.user_id = ${userId}
      AND u.status = 'approved'
      AND u.is_active = TRUE
    LIMIT 1
  `;
  return rows[0] || null;
}

function isMissingAdminSchema(error) {
  return error && error.code === '42P01';
}

module.exports = { findAuthorizedAdmin, isMissingAdminSchema };
