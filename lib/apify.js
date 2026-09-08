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

function publicInstagramScraperActor() {
  return process.env.APIFY_DEFAULT_INSTAGRAM_SCRAPER_ACTOR || 'apify/instagram-scraper';
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

const RECRUITMENT_SIGNAL_RE = /recruit|recruitment|career|careers|saiyo|jinji|hr|job|jobs|hiring|採用|求人|社員募集|スタッフ募集|中途採用|新卒採用|人事|募集/i;
const SNS_AGENCY_RE = /sns\s*(運用|代行|マーケ|コンサル|集客|支援)|インスタ\s*(運用|代行|集客|コンサル)|instagram\s*(marketing|agency|consulting)|social\s*media\s*(agency|marketing)|マーケティング支援|運用代行|集客支援|広告代理店/i;
const RECRUITMENT_PROVIDER_RE = /採用\s*(支援|代行|コンサル|マーケ|ファネル|改善|サービス|パートナー)|求人\s*(広告|媒体|サイト|サービス)|人材\s*(紹介|派遣|サポート|サービス)|RPO|応募獲得支援|特定技能人材サポート/i;
const LARGE_ACCOUNT_FOLLOWER_LIMIT = Number(process.env.SALES_PROSPECT_MAX_FOLLOWERS || 30000);

const REEL_RESEARCH_MIN_VIEWS = Number(process.env.REEL_RESEARCH_MIN_VIEWS || 100000);
const REEL_RESEARCH_MIN_FOLLOWERS = Number(process.env.REEL_RESEARCH_MIN_FOLLOWERS || 1000);
const REEL_RESEARCH_MIN_VIEW_RATIO = Number(process.env.REEL_RESEARCH_MIN_VIEW_RATIO || 10);
const REEL_RESEARCH_MAX_AGE_DAYS = Number(process.env.REEL_RESEARCH_MAX_AGE_DAYS || 7);
const DANCE_CONTENT_RE = /ダンス|踊ってみた|dance|dancer|振付|choreography|choreo|ダンサー|dancechallenge|ダンスチャレンジ/i;
const BUSINESS_PROFILE_SIGNAL_RE = /事業|会社|企業|職種|仕事|店舗|サービス|採用|求人|募集|社員|人事|recruit|career|careers|hiring|job|jobs|staff|company|corp|inc|ltd|official|clinic|salon|restaurant|cafe|hotel|school|不動産|建設|士業|税理士|弁護士|美容|医療|介護|保育|IT|エンジニア|営業|製造|物流/i;

function firstNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}
function daysOld(timestamp) {
  const d = new Date(timestamp || nowIso());
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 86400000;
}
function buzzResearchText(item = {}) {
  return [
    item.caption, item.text, item.title, item.description,
    item.username, item.userName, item.ownerUsername, item.owner?.username, item.handle, item.account,
    item.fullName, item.ownerFullName, item.owner?.fullName, item.owner?.name, item.name,
    item.biography, item.bio, item.owner?.biography, item.owner?.bio, item.profileBio, item.profileName,
  ].filter(Boolean).join(' ');
}
function reelResearchQualification(item = {}) {
  const views = firstNumber(item.videoViewCount, item.videoPlayCount, item.viewCount, item.views, item.playCount, item.plays);
  const followers = firstNumber(item.ownerFollowersCount, item.followersCount, item.followerCount, item.followers, item.owner?.followersCount, item.owner?.followers);
  const timestamp = item.timestamp || item.takenAt || item.createdAt || item.date;
  const age = daysOld(timestamp);
  const text = buzzResearchText(item);
  const ratio = followers ? views / followers : null;
  const reasons = [];
  const rejectionReasons = [];
  if (age !== null && age <= REEL_RESEARCH_MAX_AGE_DAYS) reasons.push(`投稿後${REEL_RESEARCH_MAX_AGE_DAYS}日以内`);
  else rejectionReasons.push(`投稿後${REEL_RESEARCH_MAX_AGE_DAYS}日以内ではない/投稿日未取得`);
  if (views !== null && views >= REEL_RESEARCH_MIN_VIEWS) reasons.push(`${REEL_RESEARCH_MIN_VIEWS.toLocaleString('ja-JP')}回以上再生`);
  else rejectionReasons.push(`${REEL_RESEARCH_MIN_VIEWS.toLocaleString('ja-JP')}回以上再生ではない/再生数未取得`);
  if (followers !== null && followers >= REEL_RESEARCH_MIN_FOLLOWERS) reasons.push(`フォロワー${REEL_RESEARCH_MIN_FOLLOWERS.toLocaleString('ja-JP')}人以上`);
  else rejectionReasons.push(`フォロワー${REEL_RESEARCH_MIN_FOLLOWERS.toLocaleString('ja-JP')}人以上ではない/未取得`);
  if (ratio !== null && ratio >= REEL_RESEARCH_MIN_VIEW_RATIO) reasons.push(`フォロワー比${REEL_RESEARCH_MIN_VIEW_RATIO}倍以上`);
  else rejectionReasons.push(`フォロワー比${REEL_RESEARCH_MIN_VIEW_RATIO}倍以上ではない/算出不可`);
  if (DANCE_CONTENT_RE.test(text)) rejectionReasons.push('ダンス企画のため除外');
  else reasons.push('ダンス企画以外');
  if (BUSINESS_PROFILE_SIGNAL_RE.test(text)) reasons.push('プロフィール/アカウントに事業・職種・企業・採用系シグナルあり');
  else rejectionReasons.push('事業内容・職種・企業名・採用募集シグナルなし');
  return { qualified: rejectionReasons.length === 0, reasons, rejectionReasons, views, followers, ratio, age };
}

function wordsFromCriteria(criteria, key, fallback = []) {
  const raw = criteria && criteria[key];
  const words = String(raw || '').split(/[、,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return words.length ? words : fallback;
}
function hasAny(text, words) {
  const hay = String(text || '').toLowerCase();
  return (words || []).some((w) => w && hay.includes(String(w).toLowerCase()));
}

function prospectText(prospect = {}) {
  return [prospect.account, prospect.company, prospect.kind, prospect.snippet, prospect.link]
    .filter(Boolean)
    .join(' ');
}

function qualificationForProspect(prospect = {}, criteria = null) {
  const text = prospectText(prospect);
  const followers = numberOrNull(prospect.followers);
  const reels = numberOrNull(prospect.reels);
  const avgReel = numberOrNull(prospect.avgReel);
  const reasons = [];
  const rejectionReasons = [];

  if (RECRUITMENT_SIGNAL_RE.test(text) || hasAny(text, wordsFromCriteria(criteria, 'recruitKeywords', []))) reasons.push('ID/bio/名称に採用・求人シグナルあり');
  else rejectionReasons.push('採用・求人シグナルなし');

  if (SNS_AGENCY_RE.test(text) || hasAny(text, wordsFromCriteria(criteria, 'providerExcludes', []))) rejectionReasons.push('SNS運用代行・SNSコンサル/採用支援系のため除外');
  else reasons.push('SNS運用代行・SNSコンサル系ではない');

  if (RECRUITMENT_PROVIDER_RE.test(text)) rejectionReasons.push('採用支援・人材紹介など提供者/提供者/営業対象外のため除外');
  else reasons.push('採用支援サービス提供者ではない');

  if (hasAny(text, wordsFromCriteria(criteria, 'largeExcludes', []))) rejectionReasons.push('大手・有名企業キーワードに該当するため除外');
  if (followers !== null && followers > LARGE_ACCOUNT_FOLLOWER_LIMIT) rejectionReasons.push(`フォロワー${LARGE_ACCOUNT_FOLLOWER_LIMIT.toLocaleString('ja-JP')}超の大手/大型アカウントのため除外`);
  else reasons.push(followers === null ? 'フォロワー数は未取得のため画面確認対象' : '中小・地域企業寄りの規模');

  if (reels === null || reels <= 24 || avgReel === null || avgReel <= 3000) reasons.push('リール活用/再生に改善余地あり');

  return { qualified: rejectionReasons.length === 0, reasons, rejectionReasons };
}

function filterQualifiedProspects(rows = [], criteria = null) {
  return (rows || [])
    .map((row) => {
      const q = qualificationForProspect(row, criteria);
      if (!q.qualified) return null;
      const recruitmentDedicated = /recruit|career|saiyo|jinji|採用|求人|人事/i.test(prospectText(row));
      return {
        ...row,
        kind: recruitmentDedicated ? '採用専用/採用要素あり' : row.kind,
        priority: recruitmentDedicated ? '高' : (row.priority || '中'),
        qualification: q.reasons.join(' / '),
        gap: row.gap || '投稿量・リール活用・プロフィール導線をApify取得値で確認',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const score = (p) => (/採用専用|採用要素あり/.test(p.kind || '') ? 2 : 0) + (p.priority === '高' ? 1 : 0);
      return score(b) - score(a);
    });
}

function normalizeProspect(item = {}, meta = {}) {
  const handle = extractHandle(item);
  if (!handle) return null;
  const followers = numberOrNull(item.followersCount ?? item.followers ?? item.followerCount);
  const posts = numberOrNull(item.postsCount ?? item.posts ?? item.mediaCount);
  const reels = numberOrNull(item.reelsCount ?? item.reels);
  const fullName = item.fullName || item.name || item.companyName || `@${handle}`;
  const bio = item.biography || item.bio || item.description || item.caption || '';
  const avgReel = numberOrNull(item.avgReelViews ?? item.averageReelViews ?? item.videoViewCount);
  const recruitmentSignal = RECRUITMENT_SIGNAL_RE.test(`${handle} ${fullName} ${bio}`);
  return {
    company: String(fullName || `@${handle}`).slice(0, 60),
    account: `@${handle}`,
    accountUrl: `https://www.instagram.com/${handle}/`,
    industry: meta.industry || '要分類',
    kind: recruitmentSignal ? '採用専用/採用要素あり' : '確認後アプローチ候補',
    feed: posts,
    reels,
    avgReel,
    followers,
    over10k: followers ? (followers >= 10000 ? '要精査' : '中小候補') : 'Apify取得値で要確認',
    type: 'Apify抽出候補',
    link: item.url || item.profileUrl || `https://www.instagram.com/${handle}/`,
    gap: reels === null || reels <= 24 || avgReel === null || avgReel <= 3000 ? 'リール活用・再生/プロフィール導線に改善余地' : '投稿量・プロフィール導線を確認',
    priority: recruitmentSignal && (!followers || followers <= LARGE_ACCOUNT_FOLLOWER_LIMIT) ? '高' : '中',
    angle: `${meta.industry || '採用'}向けに、社員紹介・職場紹介・応募導線を短尺動画化`,
    status: 'Apify抽出候補',
    source: 'apify',
    sourceNote: `Apify Actor: ${meta.actor || '未指定'} / ${meta.keyword || ''}`.trim(),
    snippet: String(bio || item.caption || '').slice(0, 180),
    sizeFit: followers && followers <= LARGE_ACCOUNT_FOLLOWER_LIMIT ? '中小・地域企業寄り' : '要規模確認',
    contactability: '中',
    autoExtracted: true,
    fetched_at: nowIso(),
  };
}

function normalizeBuzz(item = {}, meta = {}) {
  const q = reelResearchQualification(item);
  if (!q.qualified) return null;
  const handle = extractHandle(item);
  const likeCount = numberOrNull(item.likesCount ?? item.likeCount ?? item.likes) || 0;
  const commentsCount = numberOrNull(item.commentsCount ?? item.commentCount ?? item.comments) || 0;
  const views = q.views || 0;
  const followers = q.followers;
  const rawPermalink = item.url || item.shortCodeUrl || item.permalink || '';
  const product = String(item.productType || item.mediaProductType || item.media_product_type || '').toUpperCase();
  const mediaType = String(item.type || item.mediaType || item.media_type || '').toUpperCase();
  const isExplicitReel = /instagram\.com\/reel\//i.test(String(rawPermalink)) || product === 'REELS' || mediaType === 'REEL' || mediaType === 'VIDEO';
  const shortcode = item.shortCode || item.shortcode || item.code || (String(rawPermalink).match(/instagram\.com\/(?:p|tv|reel)\/([^/?#]+)/i) || [])[1];
  const permalink = isExplicitReel && shortcode ? `https://www.instagram.com/reel/${shortcode}/` : rawPermalink;
  return {
    id: item.id || item.shortCode || permalink || `apify_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    industry: meta.industry || '要分類',
    hashtag: meta.keyword || meta.hashtag || '',
    account: handle ? `@${handle}` : '',
    media_type: item.type || item.mediaType || item.productType || '',
    media_product_type: item.productType || item.mediaProductType || '',
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
    ai_topic: 'Apify取得バズリール',
    ai_reason: `指定ルール通過: ${q.reasons.join(' / ')}。公開リールの再生/反応値をもとに、冒頭フック・構成・CTAを自社企画に分解します。`,
    reusable_idea: '再生数・保存/反応が高い投稿構成を、自社の採用導線付き短尺企画へ置き換える。',
    candidate_status: 'リサーチルール通過済み',
    research_rules: q.reasons,
    research_rejections: q.rejectionReasons,
    view_follower_ratio: q.ratio == null ? null : Number(q.ratio.toFixed(1)),
  };
}

module.exports = {
  apifyTokenInfo,
  actorId,
  publicInstagramScraperActor,
  runActorSync,
  normalizeProspect,
  normalizeBuzz,
  reelResearchQualification,
  filterQualifiedProspects,
  qualificationForProspect,
};
