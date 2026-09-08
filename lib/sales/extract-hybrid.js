const { json, parseJsonBody } = require('../meta');

async function callLocal(req, path, method, body) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(String(host || '')) ? 'http' : 'https');
  const url = `${proto}://${host}${path}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  });
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; } catch (e) { return { status: response.status, body: { raw: text } }; }
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = req.method === 'POST' ? await parseJsonBody(req) : {};
  const query = req.query || {};
  const payload = {
    keyword: body.keyword || query.keyword || '採用',
    industry: body.industry || query.industry || 'all',
    limit: Math.max(1, Math.min(50, Number(body.limit || query.limit || 10))),
    apifyInput: body.apifyInput,
    criteria: body.criteria || null,
  };

  const apify = await callLocal(req, '/api/sales/apify-discover', 'POST', payload);
  if (apify.body?.ok && (apify.body.prospects || []).length) {
    return json(res, 200, { ok: true, source: 'apify', mode: 'hybrid', primary: 'apify', fallbackUsed: false, ...apify.body });
  }

  const legacy = await callLocal(req, '/api/sales/discover', 'POST', payload);
  return json(res, 200, {
    ok: Boolean(legacy.body?.ok),
    source: legacy.body?.source || 'live_web_search',
    mode: 'hybrid',
    primary: 'apify',
    fallbackUsed: true,
    apify_error: apify.body?.message || apify.body?.error || null,
    keyword: payload.keyword,
    industry: payload.industry,
    criteriaApplied: Boolean(payload.criteria),
    prospects: legacy.body?.prospects || [],
    legacy,
  });
};
