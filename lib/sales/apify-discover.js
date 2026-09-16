const { json, parseJsonBody } = require('../meta');
const { readDb, writeDb, addAudit, mergeProspects } = require('../runtime-store');
const { actorId, runActorSync, normalizeProspect, filterQualifiedProspects, apifyTokenInfo } = require('../apify');

const LEGACY_APIFY_DISCOVER_URL = process.env.APIFY_LEGACY_DISCOVER_URL || 'https://sns-agent.vercel.app/api/sales/apify-discover';

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

function wordsFromCriteria(criteria, key, fallback = []) {
  const raw = criteria && criteria[key];
  const words = String(raw || '').split(/[、,\n]/).map((x) => x.trim()).filter(Boolean);
  return words.length ? words : fallback;
}
function searchTermsFor(keyword, industry, criteria = null) {
  const q = String(keyword || '採用').trim();
  const industryTerm = String(industry || '').trim();
  if (industryTerm && industryTerm !== 'all' && !q.includes(industryTerm)) return [`${industryTerm} ${q}`, q];
  if (/^採用$|^求人$|^recruit$/i.test(q)) {
    { const targets=wordsFromCriteria(criteria,'targetSignals',['介護','歯科','美容室','建設','保育','物流']).slice(0,6); return [...targets.map((x)=>`${x} ${q}`),'recruit saiyo career']; }
  }
  return [q];
}

function qualifiedLegacyRows(prospects, limit, criteria = null) {
  return filterQualifiedProspects(prospects || [], criteria)
    .slice(0, limit)
    .map((p) => ({
      ...p,
      source: p.source || 'apify',
      sourceNote: `${p.sourceNote || ''} / canonical URLから旧Apify設定をサーバー側統合 / 必須条件フィルタ適用`.trim(),
    }));
}

async function legacyDiscover(payload) {
  if (process.env.DISABLE_APIFY_LEGACY_DISCOVER === '1') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(payload.timeout || 90) * 1000);
  try {
    const response = await fetch(LEGACY_APIFY_DISCOVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

async function collectLegacyQualifiedRows({ keyword, industry, limit, apifyInput, timeout, criteria }) {
  const rows = [];
  const seen = new Set();
  const terms = apifyInput ? [keyword] : searchTermsFor(keyword, industry, criteria);
  for (const term of terms) {
    if (rows.length >= limit) break;
    const legacy = await legacyDiscover({ keyword: term, industry, limit: Math.max(limit, Math.min(50, limit * 5)), apifyInput, timeout });
    if (!legacy?.data?.ok) continue;
    for (const row of qualifiedLegacyRows(legacy.data.prospects, limit, criteria)) {
      const key = String(row.account || row.link || '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= limit) break;
    }
  }
  return rows;
}

function saveRowsFromSource(db, rows, source, detailPrefix = '') {
  const newRows = mergeProspects(db, rows, { runAt: new Date().toISOString() });
  addAudit(db, {
    action: 'sales_apify_discover',
    status: 'success',
    external_ai_used: false,
    external_sent: false,
    detail: `${detailPrefix}${rows.length} rows / ${newRows.length} new`,
    source,
  });
  writeDb(db);
  return newRows;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = req.method === 'POST' ? await parseJsonBody(req) : {};
  const query = req.query || {};
  const keyword = body.keyword || query.keyword || '採用';
  const industry = body.industry || query.industry || 'all';
  const limit = Math.max(1, Math.min(50, Number(body.limit || query.limit || 10)));
  const criteria = body.criteria || null;
  const actor = actorId('APIFY_INSTAGRAM_SEARCH_ACTOR', ['APIFY_INSTAGRAM_PROFILE_ACTOR', 'APIFY_INSTAGRAM_ACTOR']);
  const db = readDb();
  try {
    const upstreamLimit = Math.max(limit, Math.min(50, limit * 5));
    const timeout = Number(body.timeout || 90);
    const payload = { keyword, industry, limit: upstreamLimit, apifyInput: body.apifyInput, timeout, criteria };
    if (!process.env.APIFY_TOKEN || !actor) {
      const rows = await collectLegacyQualifiedRows({ keyword, industry, limit, apifyInput: body.apifyInput, timeout, criteria });
      if (rows.length) {
        const newRows = saveRowsFromSource(db, rows, 'apify_legacy_integrated', 'legacy integrated + qualified filter / ');
        return json(res, 200, { ok: true, source: 'apify', integratedFrom: 'legacy_apify_discover', token: apifyTokenInfo(), actorConfigured: true, keyword, industry, count: rows.length, newCount: newRows.length, qualifiedFilter: true, criteriaApplied: Boolean(criteria), prospects: rows, newProspects: newRows });
      }
      const err = new Error(!process.env.APIFY_TOKEN ? 'missing_APIFY_TOKEN' : 'missing_Apify_actor_id');
      err.status = 200;
      err.code = !process.env.APIFY_TOKEN ? 'missing_env' : 'missing_actor';
      throw err;
    }
    const collected = [];
    const seen = new Set();
    const terms = body.apifyInput ? [keyword] : searchTermsFor(keyword, industry, criteria);
    for (const term of terms) {
      if (collected.length >= upstreamLimit) break;
      const items = await runActorSync({ actor, input: body.apifyInput || inputFor(term, Math.min(50, upstreamLimit)), timeout: Number(body.timeout || 90) });
      for (const item of (Array.isArray(items) ? items : [])) {
        const row = normalizeProspect(item, { actor, keyword: term, industry: industry === 'all' ? '要分類' : industry });
        if (!row) continue;
        const key = String(row.account || row.link || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(row);
      }
    }
    const rows = filterQualifiedProspects(collected, criteria).slice(0, limit);
    let newRows = saveRowsFromSource(db, rows, 'apify');
    if (rows.length < limit) {
      const legacy = await legacyDiscover(payload);
      const legacyRows = qualifiedLegacyRows(legacy?.data?.prospects, limit - rows.length, criteria);
      if (legacy?.data?.ok && legacyRows.length) {
        const mergedRows = filterQualifiedProspects([...rows, ...legacyRows], criteria).slice(0, limit);
        const freshDb = readDb();
        newRows = saveRowsFromSource(freshDb, mergedRows, 'apify_legacy_integrated', `${rows.length ? 'local partial' : 'local 0 rows'}; legacy integrated + qualified filter / `);
        return json(res, 200, { ok: true, source: 'apify', integratedFrom: 'legacy_apify_discover', token: legacy.data.token || apifyTokenInfo(), actorConfigured: true, keyword, industry, count: mergedRows.length, newCount: newRows.length, qualifiedFilter: true, criteriaApplied: Boolean(criteria), prospects: mergedRows, newProspects: newRows });
      }
    }
    return json(res, 200, { ok: true, source: 'apify', token: apifyTokenInfo(), actorConfigured: Boolean(actor), keyword, industry, count: rows.length, newCount: newRows.length, qualifiedFilter: true, criteriaApplied: Boolean(criteria), prospects: rows, newProspects: newRows });
  } catch (e) {
    addAudit(db, { action: 'sales_apify_discover', status: 'error', external_ai_used: false, external_sent: false, error: e.message || String(e), source: 'apify' });
    try { writeDb(db); } catch (_) {}
    return json(res, e.status && e.status !== 200 ? e.status : 200, { ok: false, source: 'apify', token: apifyTokenInfo(), actorConfigured: Boolean(actor), error: e.code || 'apify_failed', message: e.message || String(e), detail: e.data || null });
  }
};
