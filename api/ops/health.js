const { json } = require('../../lib/meta');
const { readDb } = require('../../lib/runtime-store');
const { configured: sheetsConfigured } = require('../../lib/google-sheets');
const { apifyTokenInfo, actorId } = require('../../lib/apify');

function status(ok, detail = {}) {
  return { status: ok ? 'ready' : 'needs_attention', ...detail };
}

module.exports = async function handler(req, res) {
  const db = readDb();
  const token = apifyTokenInfo();
  const checks = {
    project: status(true, { name: 'sns-agent', publicUrl: 'https://sns-agent.vercel.app' }),
    apify: status(Boolean(token.exists), { tokenConfigured: Boolean(token.exists), actors: {
      instagramProfile: Boolean(actorId('APIFY_INSTAGRAM_PROFILE_ACTOR_ID')),
      instagramHashtag: Boolean(actorId('APIFY_INSTAGRAM_HASHTAG_ACTOR_ID')),
      instagramSearch: Boolean(actorId('APIFY_INSTAGRAM_SEARCH_ACTOR_ID')),
      instagramReels: Boolean(actorId('APIFY_INSTAGRAM_REELS_ACTOR_ID')),
    } }),
    googleSheets: status(sheetsConfigured(), { configured: sheetsConfigured(), spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '18OUqBNfsA0ZxG0NkEoIxHPmxliJLsHcV1Iyx-AORra0' }),
    instagramInsights: status(Boolean(process.env.INSTAGRAM_INSIGHTS_UPSTREAM || process.env.META_ACCESS_TOKEN), {
      upstreamConfigured: Boolean(process.env.INSTAGRAM_INSIGHTS_UPSTREAM),
      metaTokenConfigured: Boolean(process.env.META_ACCESS_TOKEN),
      blocker: (process.env.INSTAGRAM_INSIGHTS_UPSTREAM || process.env.META_ACCESS_TOKEN) ? null : 'Meta/Instagram読み取り元未設定',
    }),
    runtimeStore: status(true, { scheduler: db.scheduler || null, recentAlerts: (db.alerts || []).slice(0, 5) }),
  };
  const ok = Object.values(checks).every((c) => c.status === 'ready');
  return json(res, ok ? 200 : 207, { ok, environment: 'production', project: 'sns-agent', publicUrl: 'https://sns-agent.vercel.app', checkedAt: new Date().toISOString(), checks });
};
