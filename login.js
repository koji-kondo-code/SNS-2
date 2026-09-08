const { json, parseJsonBody } = require('../../lib/meta');
const { readDb, writeDb, addAudit } = require('../../lib/runtime-store');
const { actorId, runActorSync, normalizeBuzz, apifyTokenInfo } = require('../../lib/apify');

function inputFor(seeds, limit) {
  const tags = (Array.isArray(seeds) ? seeds : String(seeds || '採用').split(/[\s,、]+/)).filter(Boolean).map((s) => String(s).replace(/^#/, ''));
  return {
    hashtags: tags,
    resultsLimit: limit,
    maxItems: limit,
    onlyPostsNewerThan: '30 days',
    addParentData: false,
  };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = req.method === 'POST' ? await parseJsonBody(req) : {};
  const query = req.query || {};
  const seeds = body.seeds || query.seeds || ['採用'];
  const industry = body.industry || query.industry || '公開トレンド投稿';
  const limit = Math.max(1, Math.min(50, Number(body.limit || query.limit || 10)));
  const actor = actorId('APIFY_INSTAGRAM_HASHTAG_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR', 'APIFY_INSTAGRAM_ACTOR']);
  const db = readDb();
  try {
    const input = body.apifyInput || inputFor(seeds, limit);
    const items = await runActorSync({ actor, input, timeout: Number(body.timeout || 90) });
    const rows = (Array.isArray(items) ? items : [])
      .map((item) => normalizeBuzz(item, { actor, keyword: Array.isArray(seeds) ? seeds.join(',') : String(seeds), industry }))
      .filter((r) => r.permalink || r.caption)
      .sort((a, b) => (b.buzz_score || 0) - (a.buzz_score || 0))
      .slice(0, limit);
    const byId = new Map([...(db.competitor_buzz_posts || []), ...rows].map((p) => [p.id || p.permalink, p]));
    db.competitor_buzz_posts = [...byId.values()].sort((a, b) => (b.buzz_score || 0) - (a.buzz_score || 0)).slice(0, 300);
    addAudit(db, { action: 'competitor_apify_buzz', status: 'success', external_ai_used: false, external_sent: false, source: 'apify', detail: `${rows.length} posts` });
    writeDb(db);
    return json(res, 200, { ok: true, source: 'apify', token: apifyTokenInfo(), actorConfigured: Boolean(actor), count: rows.length, rows, buzz_posts: rows });
  } catch (e) {
    addAudit(db, { action: 'competitor_apify_buzz', status: 'error', external_ai_used: false, external_sent: false, source: 'apify', error: e.message || String(e) });
    try { writeDb(db); } catch (_) {}
    return json(res, e.status && e.status !== 200 ? e.status : 200, { ok: false, source: 'apify', token: apifyTokenInfo(), actorConfigured: Boolean(actor), error: e.code || 'apify_failed', message: e.message || String(e), detail: e.data || null });
  }
};
