const { json } = require('../../lib/meta');
const { apifyTokenInfo, actorId, publicInstagramScraperActor } = require('../../lib/apify');

const LEGACY_STATUS_URL = process.env.APIFY_LEGACY_STATUS_URL || 'https://sns-agent.vercel.app/api/apify/status';

async function legacyStatus() {
  if (process.env.DISABLE_APIFY_LEGACY_STATUS === '1') return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(LEGACY_STATUS_URL, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch (e) {
    return null;
  }
}

function actorSummary() {
  const actors = {
    instagramProfile: actorId('APIFY_INSTAGRAM_PROFILE_ACTOR', ['APIFY_INSTAGRAM_ACTOR']),
    instagramHashtag: actorId('APIFY_INSTAGRAM_HASHTAG_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR']) || publicInstagramScraperActor(),
    instagramSearch: actorId('APIFY_INSTAGRAM_SEARCH_ACTOR', ['APIFY_SEARCH_ACTOR']),
    instagramReels: actorId('APIFY_INSTAGRAM_REEL_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR', 'APIFY_INSTAGRAM_ACTOR']) || publicInstagramScraperActor(),
    tiktok: actorId('APIFY_TIKTOK_ACTOR'),
  };
  return Object.fromEntries(Object.entries(actors).map(([k, v]) => [k, { configured: Boolean(v), value: v ? 'configured' : null }]));
}

function mergeActorStatus(localActors, legacyActors = {}) {
  const merged = { ...localActors };
  Object.entries(legacyActors || {}).forEach(([key, legacy]) => {
    if (!merged[key]?.configured && legacy?.configured) {
      merged[key] = { configured: true, value: 'configured' };
    }
  });
  return merged;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const token = apifyTokenInfo();
  const localActors = actorSummary();
  const localReady = Boolean(process.env.APIFY_TOKEN && Object.values(localActors).some(v => v.configured));
  const legacy = localReady ? null : await legacyStatus();
  const actors = mergeActorStatus(localActors, legacy?.actors);
  const ready = Boolean((process.env.APIFY_TOKEN || legacy?.token?.exists) && Object.values(actors).some(v => v.configured));
  return json(res, 200, {
    ok: true,
    source: 'apify_status',
    token: token.exists ? token : (legacy?.token || token),
    actors,
    ready,
    integratedFrom: legacy ? 'legacy_apify_status' : 'sns_agent_env',
    note: 'APIキーとActor IDの設定状態のみを返します。秘密値は返しません。',
  });
};
