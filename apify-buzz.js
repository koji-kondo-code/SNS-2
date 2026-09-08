const { json } = require('../../lib/meta');
const { apifyTokenInfo, actorId } = require('../../lib/apify');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const actors = {
    instagramProfile: actorId('APIFY_INSTAGRAM_PROFILE_ACTOR', ['APIFY_INSTAGRAM_ACTOR']),
    instagramHashtag: actorId('APIFY_INSTAGRAM_HASHTAG_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR']),
    instagramSearch: actorId('APIFY_INSTAGRAM_SEARCH_ACTOR', ['APIFY_SEARCH_ACTOR']),
    tiktok: actorId('APIFY_TIKTOK_ACTOR'),
  };
  return json(res, 200, {
    ok: true,
    source: 'apify_status',
    token: apifyTokenInfo(),
    actors: Object.fromEntries(Object.entries(actors).map(([k, v]) => [k, { configured: Boolean(v), value: v ? 'configured' : null }])),
    ready: Boolean(process.env.APIFY_TOKEN && Object.values(actors).some(Boolean)),
    note: 'APIキーとActor IDの設定状態のみを返します。秘密値は返しません。',
  });
};
