const DEFAULT_VERSION = 'v21.0';
const GRAPH_BASE = 'https://graph.facebook.com';

function graphVersion() {
  return process.env.META_GRAPH_API_VERSION || DEFAULT_VERSION;
}

function redirectUri(req) {
  if (process.env.META_REDIRECT_URI) return process.env.META_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/meta/callback`;
}

function requiredEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}

async function graph(path, params = {}) {
  const url = new URL(`${GRAPH_BASE}/${graphVersion()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!response.ok) {
    const msg = data?.error?.message || `Graph API HTTP ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function exchangeCodeForToken(req, code) {
  return graph('/oauth/access_token', {
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: redirectUri(req),
    code,
  });
}

async function exchangeLongLivedToken(shortToken) {
  return graph('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
}

async function listPages(accessToken) {
  return graph('/me/accounts', {
    access_token: accessToken,
    fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
  });
}

function safeTokenInfo(token) {
  if (!token) return null;
  return { exists: true, last4: String(token).slice(-4), length: String(token).length };
}

module.exports = {
  graphVersion,
  redirectUri,
  requiredEnv,
  json,
  parseJsonBody,
  graph,
  exchangeCodeForToken,
  exchangeLongLivedToken,
  listPages,
  safeTokenInfo,
};
