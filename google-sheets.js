const { normalizeAccount, nowIso } = require('./runtime-store');

function apifyTokenInfo() {
  const token = process.env.APIFY_TOKEN || '';
  return token ? { exists: true, last4: token.slice(-4), length: token.length } : { exists: false };
}

function actorId(name, fallbacks = []) {
  for (const key of [name, ...fallbacks]) {
    if (process.env[key]) return process.env[key];
  }
  return '';
}

function actorPath(id = '') {
  // Apify actor IDs are passed in URLs as either user~actor or URL-encoded.
  return String(id).trim().replace('/', '~');
}

async function apifyJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!response.ok) {
    const err = new Error(data?.error?.message || data?.message || `Apify HTTP ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function runActorSync({ actor, input, timeout = 90 }) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    const err = new Error('missing_APIFY_TOKEN');
    err.status = 200;
    err.code = 'missing_env';
    throw err;
  }
  if (!actor) {
    const err = new Error('missing_Apify_actor_id');
    err.status = 200;
    err.code = 'missing_actor';
    throw err;
  }
  const url = new URL(`https://api.apify.com/v2/acts/${actorPath(actor)}/run-sync-get-dataset-items`);
  url.searchParams.set('token', token);
  url.searchParams.set('clean', 'true');
  url.searchParams.set('timeout', String(timeout));
  return apifyJson(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input || {}),
  });
}

function extractHandle(item = {}) {
  const candidates = [
    item.username, item.userName, item.ownerUsername, item.owner?.username, item.handle,
    item.account, item.profileName, item.url, item.inputUrl, item.profileUrl, item.shortCodeUrl,
  ];
  for (const raw of candidates) {
    const v = normalizeAccount(raw);
    if (v && !['p', 'reel', 'reels', 'explore', 'accounts'].includes(v)) return v;
  }
  return '';
}

function numberOrNull(v) {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeProspect(item = {}, meta = {}) {
  const handle = extractHandle(item);
  if (!handle) return null;
  const followers = numberOrNull(item.followersCount ?? item.followers ?? item.followerCount);
  const posts = numberOrNull(item.postsCount ?? item.posts ?? item.mediaCount);
  const reels = numberOrNull(item.reelsCount ?? item.reels);
  const fullName = item.fullName || item.name || item.companyName || `@${handle}`;
  const bio = item.biography || item.bio || item.description || item.caption || '';
  return {
    company: String(fullName || `@${handle}`).slice(0, 60),
    account: `@${handle}`,
    accountUrl: `https://www.instagram.com/${handle}/`,
    industry: meta.industry || '要分類',
    kind: /recruit|career|saiyo|jinji|採用|求人/i.test(`${handle} ${bio}`) ? '採用専用/採用要素あり' : '確認後アプローチ候補',
    feed: posts,
    reels,
    avgReel: numberOrNull(item.avgReelViews ?? item.averageReelViews ?? item.videoViewCount),
    followers,
    over10k: followers ? (followers >= 10000 ? '要精査' : '中小候補') : 'Apify取得値で要確認',
    type: 'Apify抽出候補',
    link: item.url || item.profileUrl || `https://www.instagram.com/${handle}/`,
    gap: '投稿量・リール活用・プロフィール導線をApify取得値で確認',
    priority: followers && followers < 30000 ? '高' : '中',
    angle: `${meta.industry || '採用'}向けに、社員紹介・職場紹介・応募導線を短尺動画化`,
    status: 'Apify抽出候補',
    source: 'apify',
    sourceNote: `Apify Actor: ${meta.actor || '未指定'} / ${meta.keyword || ''}`.trim(),
    snippet: String(bio || item.caption || '').slice(0, 180),
    sizeFit: followers && followers < 30000 ? '中小・地域企業寄り' : '要規模確認',
    contactability: '中',
    autoExtracted: true,
    fetched_at: nowIso(),
  };
}

function normalizeBuzz(item = {}, meta = {}) {
  const handle = extractHandle(item);
  const likeCount = numberOrNull(item.likesCount ?? item.likeCount ?? item.likes) || 0;
  const commentsCount = numberOrNull(item.commentsCount ?? item.commentCount ?? item.comments) || 0;
  const views = numberOrNull(item.videoViewCount ?? item.videoPlayCount ?? item.viewCount ?? item.views) || 0;
  const followers = numberOrNull(item.ownerFollowersCount ?? item.followersCount ?? item.followers);
  const permalink = item.url || item.shortCodeUrl || item.permalink || (item.shortCode ? `https://www.instagram.com/reel/${item.shortCode}/` : '');
  return {
    id: item.id || item.shortCode || permalink || `apify_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    industry: meta.industry || '要分類',
    hashtag: meta.keyword || meta.hashtag || '',
    account: handle ? `@${handle}` : '',
    media_type: item.type || item.mediaType || item.productType || 'MEDIA',
    media_url: item.displayUrl || item.imageUrl || item.thumbnailUrl || '',
    permalink,
    timestamp: item.timestamp || item.takenAt || item.createdAt || nowIso(),
    like_count: likeCount,
    comments_count: commentsCount,
    view_count: views,
    followers_count: followers,
    caption: String(item.caption || item.text || '').slice(0, 500),
    source: 'apify',
    sourceNote: `Apify Actor: ${meta.actor || '未指定'}`,
    fetched_at: nowIso(),
    buzz_score: views || likeCount + commentsCount * 2,
    ai_topic: 'Apify取得バズ投稿',
    ai_reason: 'Apifyで取得した公開投稿の再生/反応値をもとに、冒頭フック・構成・CTAを自社企画に分解します。',
    reusable_idea: '再生数・保存/反応が高い投稿構成を、自社の採用導線付き短尺企画へ置き換える。',
    candidate_status: '投稿URL確認後にトレンド候補へ登録',
  };
}

module.exports = {
  apifyTokenInfo,
  actorId,
  runActorSync,
  normalizeProspect,
  normalizeBuzz,
};
