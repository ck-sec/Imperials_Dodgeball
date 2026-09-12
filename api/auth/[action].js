const { setCors } = require('../../lib/cors');

const handlers = Object.freeze({
  login: require('../../lib/auth-handlers/login'),
  logout: require('../../lib/auth-handlers/logout'),
  refresh: require('../../lib/auth-handlers/refresh'),
  register: require('../../lib/auth-handlers/register'),
  'password-reset': require('../../lib/auth-handlers/password-reset'),
});

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query?.action;
  if (typeof action !== 'string' || !Object.hasOwn(handlers, action)) {
    setCors(req, res, 'POST, OPTIONS');
    return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  }
  return handlers[action](req, res);
};
