const { requiredEnv, json, graph, safeTokenInfo } = require('../lib/meta');

module.exports = async function handler(req, res) {
  const missing = requiredEnv(['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_ACCESS_TOKEN']);
  if (missing.length) {
    // Local handoff URL is intentionally not Vercel-deployed yet. When local env lacks
    // the Meta token, read the already-connected production API and reflect the real
    // Instagram account values in this latest local demo without exposing secrets.
    try {
      const upstreamUrl = process.env.INSTAGRAM_INSIGHTS_UPSTREAM || 'https://sns-agent.vercel.app/api/instagram-insights';
      const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json' } });
      const data = await upstream.json();
      if (!upstream.ok || !data.ok) throw new Error(data.message || data.error || `upstream_http_${upstream.status}`);
      return json(res, 200, {
        ...data,
        source: 'meta_graph_api_existing_connection',
        localFallback: true,
        note: 'Vercel本番側の既存Meta接続から読み取り専用で実アカウント数値を反映しています。投稿作成・DM送信は行っていません。',
      });
    } catch (fallbackError) {
      return json(res, 500, { ok: false, error: 'missing_env', missing, fallback_error: fallbackError.message || String(fallbackError) });
    }
  }

  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const token = process.env.META_ACCESS_TOKEN;
  const since = req.query?.since;
  const until = req.query?.until;

  try {
    const profile = await graph(`/${igId}`, {
      access_token: token,
      fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url',
    });

    // Graph API v21 no longer accepts the old `impressions` account metric.
    // Keep this endpoint read-only and request only metrics accepted by the app/account.
    const accountInsights = await graph(`/${igId}/insights`, {
      access_token: token,
      metric: 'reach,profile_views,website_clicks,views',
      metric_type: 'total_value',
      period: 'day',
      since,
      until,
    });

    const media = await graph(`/${igId}/media`, {
      access_token: token,
      fields: 'id,caption,media_type,media_product_type,thumbnail_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,views,total_interactions)',
      limit: 25,
    });

    return json(res, 200, {
      ok: true,
      source: 'meta_graph_api',
      token: safeTokenInfo(token),
      profile,
      accountInsights: accountInsights.data || [],
      media: media.data || [],
      paging: media.paging || null,
      note: '読み取り専用です。投稿作成・DM送信は行っていません。',
    });
  } catch (e) {
    return json(res, e.status || 500, { ok: false, error: 'graph_api_failed', message: e.message, detail: e.data || null });
  }
};
