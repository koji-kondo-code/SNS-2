const { json, parseJsonBody } = require('../meta');
const { readDb, writeDb, addAudit, mergeProspects } = require('../runtime-store');
const { actorId, runActorSync, normalizeProspect, apifyTokenInfo } = require('../apify');

function inputFor(keyword, limit) {
  const q = String(keyword || '採用').trim();
  return {
    search: q,
    searchType: 'user',
    resultsLimit: limit,
    maxItems: limit,
    directUrls: [],
    addParentData: false,
  };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = req.method === 'POST' ? await parseJsonBody(req) : {};
  const query = req.query || {};
  const keyword = body.keyword || query.keyword || '採用';
  const industry = body.industry || query.industry || 'all';
  const limit = Math.max(1, Math.min(50, Number(body.limit || query.limit || 10)));
  const actor = actorId('APIFY_INSTAGRAM_SEARCH_ACTOR', ['APIFY_INSTAGRAM_PROFILE_ACTOR', 'APIFY_INSTAGRAM_ACTOR']);
  const db = readDb();
  try {
    const items = await runActorSync({ actor, input: body.apifyInput || inputFor(keyword, limit), timeout: Number(body.timeout || 90) });
    const rows = (Array.isArray(items) ? items : [])
      .map((item) => normalizeProspect(item, { actor, keyword, industry: industry === 'all' ? '要分類' : industry }))
      .filter(Boolean)
      .slice(0, limit);
    const newRows = mergeProspects(db, rows, { runAt: new Date().toISOString() });
    addAudit(db, { action: 'sales_apify_discover', status: 'success', external_ai_used: false, external_sent: false, detail: `${rows.length} rows / ${newRows.length} new`, source: 'apify' });
    writeDb(db);
    return json(res, 200, { ok: true, source: 'apify', token: apifyTokenInfo(), actorConfigured: Boolean(actor), keyword, industry, count: rows.length, newCount: newRows.length, prospects: rows, newProspects: newRows });
  } catch (e) {
    addAudit(db, { action: 'sales_apify_discover', status: 'error', external_ai_used: false, external_sent: false, error: e.message || String(e), source: 'apify' });
    try { writeDb(db); } catch (_) {}
    return json(res, e.status && e.status !== 200 ? e.status : 200, { ok: false, source: 'apify', token: apifyTokenInfo(), actorConfigured: Boolean(actor), error: e.code || 'apify_failed', message: e.message || String(e), detail: e.data || null });
  }
};
