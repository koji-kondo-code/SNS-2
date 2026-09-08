const { redirectUri, requiredEnv, json } = require('../../lib/meta');

module.exports = async function handler(req, res) {
  const missing = requiredEnv(['META_APP_ID']);
  if (missing.length) return json(res, 500, { ok: false, error: 'missing_env', missing });

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const scope = [
    'instagram_basic',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement',
  ].join(',');
  const url = new URL('https://www.facebook.com/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('scope', scope);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
};
