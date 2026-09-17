const { requiredEnv, json, graph, safeTokenInfo, listPages } = require('../lib/meta');

function sanitizeKey(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function normalizeAccount(raw, index = 0) {
  if (!raw) return null;
  const igBusinessAccountId = raw.igBusinessAccountId || raw.instagramBusinessAccountId || raw.instagram_business_account_id || raw.id || raw.igId;
  if (!igBusinessAccountId) return null;
  const key = sanitizeKey(raw.key || raw.accountKey || raw.username || raw.label || igBusinessAccountId || `account_${index + 1}`);
  return {
    key,
    label: raw.label || raw.name || raw.username || `Instagramアカウント ${index + 1}`,
    username: raw.username ? sanitizeKey(raw.username) : '',
    igBusinessAccountId: String(igBusinessAccountId),
    token: raw.accessToken || raw.metaAccessToken || raw.token || process.env.META_ACCESS_TOKEN,
  };
}

function parseDelimitedList(value) {
  return String(value || '').split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
}

function configuredAccounts() {
  const jsonConfig = process.env.INSTAGRAM_BUSINESS_ACCOUNTS_JSON
    || process.env.INSTAGRAM_ACCOUNTS_JSON
    || process.env.META_INSTAGRAM_ACCOUNTS_JSON;
  if (jsonConfig) {
    try {
      const parsed = JSON.parse(jsonConfig);
      const list = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([key, value]) => ({ key, ...(value || {}) }));
      const accounts = list.map(normalizeAccount).filter(Boolean);
      if (accounts.length) return accounts;
    } catch (e) {
      // Fall back to legacy single-account env below. The endpoint response includes no secrets.
    }
  }

  const ids = parseDelimitedList(process.env.INSTAGRAM_BUSINESS_ACCOUNT_IDS);
  if (ids.length) {
    const labels = parseDelimitedList(process.env.INSTAGRAM_ACCOUNT_LABELS);
    const usernames = parseDelimitedList(process.env.INSTAGRAM_ACCOUNT_USERNAMES);
    return ids.map((id, index) => normalizeAccount({
      key: usernames[index] || labels[index] || id,
      label: labels[index] || usernames[index] || `Instagramアカウント ${index + 1}`,
      username: usernames[index] || '',
      igBusinessAccountId: id,
    }, index)).filter(Boolean);
  }

  const missing = requiredEnv(['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_ACCESS_TOKEN']);
  if (missing.length) return [];
  return [normalizeAccount({
    key: process.env.INSTAGRAM_ACCOUNT_KEY || process.env.INSTAGRAM_ACCOUNT_USERNAME || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    label: process.env.INSTAGRAM_ACCOUNT_LABEL || process.env.INSTAGRAM_ACCOUNT_USERNAME || '接続済みInstagramアカウント',
    username: process.env.INSTAGRAM_ACCOUNT_USERNAME || '',
    igBusinessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  }, 0)];
}

function publicAccounts(accounts) {
  return accounts.map((a) => ({
    key: a.key,
    label: a.label,
    username: a.username,
    igBusinessAccountId: a.igBusinessAccountId,
  }));
}

function pickAccount(accounts, requested) {
  const key = sanitizeKey(requested || '');
  return accounts.find((a) => [a.key, a.username, a.igBusinessAccountId].map(sanitizeKey).includes(key)) || accounts[0];
}

async function discoveredAccountsFromPages(userToken) {
  if (!userToken || process.env.INSTAGRAM_AUTO_DISCOVER_ACCOUNTS === 'false') return [];
  try {
    const pages = await listPages(userToken);
    return (pages.data || [])
      .filter((page) => page.instagram_business_account?.id)
      .map((page, index) => normalizeAccount({
        key: page.instagram_business_account.username || page.instagram_business_account.id,
        label: page.instagram_business_account.name || page.name || page.instagram_business_account.username || `Instagramアカウント ${index + 1}`,
        username: page.instagram_business_account.username || '',
        igBusinessAccountId: page.instagram_business_account.id,
        accessToken: page.access_token || userToken,
      }, index))
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function effectiveAccounts() {
  const manual = configuredAccounts();
  if (manual.length && process.env.INSTAGRAM_AUTO_DISCOVER_ACCOUNTS !== 'true') {
    return manual;
  }
  const discovered = await discoveredAccountsFromPages(process.env.META_ACCESS_TOKEN);
  const byId = new Map([...discovered, ...manual].map((a) => [a.igBusinessAccountId, a]));
  return [...byId.values()];
}


async function tryGraph(path, params = {}, label = '') {
  try {
    const data = await graph(path, params);
    return { ok: true, label, data };
  } catch (e) {
    return { ok: false, label, message: e.message, detail: e.data?.error || e.data || null };
  }
}

function mergeInsightData(results) {
  return results.flatMap((r) => (r.ok && Array.isArray(r.data?.data)) ? r.data.data : []);
}

function publicInsightErrors(results) {
  return results.filter((r) => !r.ok).map((r) => ({
    label: r.label,
    message: r.message,
    code: r.detail?.code,
    type: r.detail?.type,
  }));
}

async function getAccountInsightBundles(igId, token, since, until) {
  const common = { access_token: token, since, until };
  const requests = [
    tryGraph(`/${igId}/insights`, { ...common, metric: 'reach,profile_views,website_clicks,views', metric_type: 'total_value', period: 'day' }, 'account_totals_day'),
    tryGraph(`/${igId}/insights`, { ...common, metric: 'follower_count', period: 'day' }, 'follower_count_day'),
    tryGraph(`/${igId}/insights`, { access_token: token, metric: 'follower_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'age,gender' }, 'follower_demographics_age_gender'),
    tryGraph(`/${igId}/insights`, { access_token: token, metric: 'follower_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'city' }, 'follower_demographics_city'),
    tryGraph(`/${igId}/insights`, { access_token: token, metric: 'follower_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'country' }, 'follower_demographics_country'),
    tryGraph(`/${igId}/insights`, { access_token: token, metric: 'reached_audience_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'age,gender', timeframe: 'this_month' }, 'reached_audience_demographics_age_gender'),
    tryGraph(`/${igId}/insights`, { access_token: token, metric: 'engaged_audience_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'age,gender', timeframe: 'this_month' }, 'engaged_audience_demographics_age_gender'),
    tryGraph(`/${igId}/insights`, { access_token: token, metric: 'online_followers', period: 'lifetime' }, 'online_followers_lifetime'),
  ];
  const results = await Promise.all(requests);
  return { data: mergeInsightData(results), errors: publicInsightErrors(results), rawResults: results.filter((r) => r.ok).map((r) => ({ label: r.label, data: r.data?.data || [] })) };
}

async function getMediaWithAllAvailableInsights(igId, token) {
  const mediaList = await graph(`/${igId}/media`, {
    access_token: token,
    fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
    limit: 50,
  });
  const mediaRows = mediaList.data || [];
  const metricGroups = [
    ['reach,saved,views,total_interactions,shares', 'media_common'],
    ['likes', 'media_likes'],
    ['comments', 'media_comments'],
    ['follows', 'media_follows'],
    ['profile_visits', 'media_profile_visits'],
    ['profile_activity', 'media_profile_activity'],
    ['ig_reels_video_view_total_time', 'reels_total_watch_time'],
    ['ig_reels_avg_watch_time', 'reels_avg_watch_time'],
    ['reels_skip_rate', 'reels_skip_rate'],
    ['reposts', 'media_reposts'],
    ['facebook_views', 'media_facebook_views'],
    ['crossposted_views', 'media_crossposted_views'],
    ['total_views', 'media_total_views'],
    ['total_likes', 'media_total_likes'],
    ['total_comments', 'media_total_comments'],
    ['link_clicks', 'media_link_clicks'],
    ['audience_retention_graph', 'media_audience_retention_graph'],
    ['retention_graph', 'media_retention_graph'],
  ];
  const enriched = await Promise.all(mediaRows.map(async (m) => {
    const results = await Promise.all(metricGroups.map(([metric, label]) => tryGraph(`/${m.id}/insights`, { access_token: token, metric }, `${label}:${m.id}`)));
    return {
      ...m,
      insights: { data: mergeInsightData(results) },
      insight_errors: publicInsightErrors(results),
    };
  }));
  return { data: enriched, paging: mediaList.paging || null };
}

module.exports = async function handler(req, res) {
  const accounts = await effectiveAccounts();
  if (!accounts.length) {
    // Local handoff URL is intentionally not Vercel-deployed yet. When local env lacks
    // the Meta token, read the already-connected production API and reflect the real
    // Instagram account values in this latest local demo without exposing secrets.
    try {
      const requested = req.query?.account;
      const upstreamUrl = new URL(process.env.INSTAGRAM_INSIGHTS_UPSTREAM || 'https://sns-agent.vercel.app/api/instagram-insights');
      if (requested) upstreamUrl.searchParams.set('account', requested);
      if (req.query?.since) upstreamUrl.searchParams.set('since', req.query.since);
      if (req.query?.until) upstreamUrl.searchParams.set('until', req.query.until);
      const upstream = await fetch(upstreamUrl.toString(), { headers: { Accept: 'application/json' } });
      const data = await upstream.json();
      if (!upstream.ok || !data.ok) throw new Error(data.message || data.error || `upstream_http_${upstream.status}`);
      return json(res, 200, {
        ...data,
        source: 'meta_graph_api_existing_connection',
        localFallback: true,
        note: 'Vercel本番側の既存Meta接続から読み取り専用で実アカウント数値を反映しています。投稿作成・DM送信は行っていません。',
      });
    } catch (fallbackError) {
      return json(res, 500, { ok: false, error: 'missing_env', missing: ['INSTAGRAM_BUSINESS_ACCOUNT_ID or INSTAGRAM_ACCOUNTS_JSON', 'META_ACCESS_TOKEN'], fallback_error: fallbackError.message || String(fallbackError) });
    }
  }

  const selected = pickAccount(accounts, req.query?.account);
  const igId = selected.igBusinessAccountId;
  const token = selected.token || process.env.META_ACCESS_TOKEN;
  const since = req.query?.since;
  const until = req.query?.until;

  try {
    const profile = await graph(`/${igId}`, {
      access_token: token,
      fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url',
    });

    const accountInsightBundle = await getAccountInsightBundles(igId, token, since, until);
    const media = await getMediaWithAllAvailableInsights(igId, token);

    return json(res, 200, {
      ok: true,
      source: 'meta_graph_api',
      multiAccountReady: true,
      selectedAccountKey: selected.key,
      selectedAccount: {
        key: selected.key,
        label: selected.label,
        username: profile.username || selected.username,
        igBusinessAccountId: igId,
      },
      accounts: publicAccounts(accounts),
      token: safeTokenInfo(token),
      profile,
      accountInsights: accountInsightBundle.data || [],
      accountInsightGroups: accountInsightBundle.rawResults || [],
      unavailableInsights: accountInsightBundle.errors || [],
      media: media.data || [],
      paging: media.paging || null,
      note: accounts.length > 1 ? '複数Instagramアカウント対応です。accountキーで取得対象を切り替えます。読み取り専用です。投稿作成・DM送信は行っていません。' : '読み取り専用です。投稿作成・DM送信は行っていません。',
    });
  } catch (e) {
    return json(res, e.status || 500, { ok: false, error: 'graph_api_failed', selectedAccountKey: selected.key, accounts: publicAccounts(accounts), message: e.message, detail: e.data || null });
  }
};
