const { json, parseJsonBody } = require('../meta');
const { readDb, writeDb, addAudit, addAlert, nowIso, normalizeAccount } = require('../runtime-store');
const { actorId, publicInstagramScraperActor, runActorSync, apifyTokenInfo } = require('../apify');

const KEYWORDS = [
  // 採用・会社紹介の広い母数を取りにいく基本軸
  '新卒採用','中途採用','採用広報','採用動画','採用担当','人事の日常','求人募集','採用募集','会社紹介','企業紹介',
  '社員紹介','社員インタビュー','若手社員','先輩社員','内定者','入社理由','入社の決め手','働く人','仕事紹介','職種紹介',
  '職場紹介','オフィス紹介','社風','福利厚生','研修制度','キャリア','就活','就活生','26卒','27卒',
  'インターン','会社説明会','面接対策','就活あるある','就活準備','1日密着','社員の1日','仕事のリアル','未経験から','ルーティン',
  'Q&A','質問回答','あるある','現場社員','働き方','仕事風景','職場の雰囲気','社員の日常','会社の裏側','オフィスツアー',
  // 職種・業界別に探索範囲を広げる追加軸
  '営業職採用','営業社員','エンジニア採用','エンジニアの日常','コンサル採用','コンサルタント','事務職採用','バックオフィス',
  '美容師採用','美容室求人','介護職採用','介護求人','保育士採用','保育園採用','店舗スタッフ採用','飲食店求人',
  '医療事務求人','看護師採用','建設業採用','施工管理採用','不動産営業採用','物流採用','製造業採用','士業採用',
  'ベンチャー採用','IT企業採用','スタートアップ採用','新卒研修','内定者研修','社員研修','仕事密着','採用アカウント',
  // 20件確保のため、日本語採用タグだけに閉じず海外の採用・会社文化系リールも探索する
  'recruitment','hiring','careers','career','jobs','jobsearch','nowhiring','wearehiring','companyculture','employerbranding',
  'employeeexperience','employeestories','dayinthelife','worklife','officeculture','teamculture','internship','graduatejobs','salesjobs','engineerjobs',
  'techjobs','startupjobs','retailjobs','restaurantjobs','healthcarejobs','nursingjobs','constructionjobs','realestatejobs','beautyjobs','hospitalityjobs'
];
const DANCE_RE = /ダンス|踊ってみた|dance|dancer|振付|choreography|choreo|dancechallenge|ダンスチャレンジ/i;
const BUSINESS_RE = /採用|求人|募集|社員|人事|会社|企業|事業|職種|仕事|サービス|店舗|recruit|career|hiring|job|company|corp|inc|official|営業|エンジニア|美容|介護|保育|医療|建設|不動産|士業/i;
const RECRUIT_RE = /新卒|中途|採用|求人|募集|人事|就活|インターン|内定|面接|recruit|career|hiring|job/i;
const RESEARCH_RULES = { maxAgeDays: 14, minViews: 100000, minFollowers: 1000, minRatio: 10 };
const FREE_TIER_LIMITS = { keywords: 110, rawItems: 2000, profiles: 700, keywordBatchSize: 10, maxActorRuns: 16, minRowsTarget: 20 };

function firstNumber(...values) {
  for (const v of values) {
    const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function ageDays(ts) {
  const d = new Date(ts || '');
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 86400000;
}
function cleanHashtag(value) {
  return String(value || '').replace(/^#/, '').replace(/[!?.,:;\-+=*&%$#@/\\~^|<>()[\]{}\"'`]+/g, '').trim();
}
function cleanKeywords(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(/[\n,、\s]+/);
  const extra = arr.map((x) => typeof x === 'object' ? (x.hashtag || x.keyword || x.tag || '') : x).map(cleanHashtag).filter(Boolean);
  return [...new Set([...extra, ...KEYWORDS.map(cleanHashtag).filter(Boolean)])].slice(0, FREE_TIER_LIMITS.keywords);
}
function tagUrl(tag) { return `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/reels/`; }
function profileUrl(handle) { return `https://www.instagram.com/${normalizeAccount(handle)}/`; }
function reelInput(tags, limit, actor = '') {
  const directUrls = tags.map(tagUrl);
  if (/instagram-scraper/i.test(String(actor)) && !/hashtag/i.test(String(actor))) {
    return { directUrls, search: tags.join(' '), searchType: 'hashtag', searchLimit: tags.length, resultsType: 'posts', resultsLimit: limit, maxItems: limit, addParentData: true, onlyPostsNewerThan: '14 days', onlyReels: true, mediaTypes: ['REELS'] };
  }
  return { hashtags: tags, directUrls, resultsLimit: limit, maxItems: limit, limit, onlyReels: true, resultsType: 'reels', contentType: 'reels', mediaTypes: ['REELS'], onlyPostsNewerThan: '14 days', addParentData: true };
}
function profileInput(handles, limit) {
  return { usernames: handles.map(normalizeAccount), directUrls: handles.map(profileUrl), resultsLimit: limit, maxItems: limit, addParentData: true };
}
function reelKey(item = {}) {
  return String(reelPermalink(item) || item.id || item.shortCode || item.shortcode || item.code || '').toLowerCase();
}
function passesPreProfileRules(item = {}) {
  const permalink = reelPermalink(item);
  if (!String(permalink || '').includes('/reel/')) return false;
  const views = firstNumber(item.videoViewCount, item.video_view_count, item.videoPlayCount, item.video_play_count, item.viewCount, item.view_count, item.views, item.playCount, item.play_count, item.plays) || 0;
  if (views < RESEARCH_RULES.minViews) return false;
  const timestamp = item.timestamp || item.takenAt || item.createdAt || item.date || item.uploadDate || '';
  const age = ageDays(timestamp);
  // Apify側の onlyPostsNewerThan='14 days' で取得範囲は縛っているため、
  // Actor出力に投稿日フィールドが無い候補はここでは落とさず、後段の正規化で扱う。
  if (age !== null && age > RESEARCH_RULES.maxAgeDays) return false;
  return !DANCE_RE.test(textOf(item, {}));
}
function rejectionSummary(items = []) {
  const summary = { total: items.length, reel: 0, missingViews: 0, lowViews: 0, highViews: 0, missingDate: 0, old: 0, dance: 0, businessSignal: 0 };
  for (const item of items) {
    const permalink = reelPermalink(item);
    const text = textOf(item, {});
    const views = firstNumber(item.videoViewCount, item.video_view_count, item.videoPlayCount, item.video_play_count, item.viewCount, item.view_count, item.views, item.playCount, item.play_count, item.plays);
    const timestamp = item.timestamp || item.takenAt || item.createdAt || item.date || item.uploadDate || '';
    const age = ageDays(timestamp);
    if (String(permalink || '').includes('/reel/')) summary.reel += 1;
    if (views == null) summary.missingViews += 1;
    else if (views < RESEARCH_RULES.minViews) summary.lowViews += 1;
    else summary.highViews += 1;
    if (age === null) summary.missingDate += 1;
    else if (age > RESEARCH_RULES.maxAgeDays) summary.old += 1;
    if (DANCE_RE.test(text)) summary.dance += 1;
    if (BUSINESS_RE.test(text)) summary.businessSignal += 1;
  }
  return summary;
}
function flatten(items = []) {
  const out = [];
  const visit = (v, depth = 0) => {
    if (!v || depth > 3) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth));
    if (typeof v !== 'object') return;
    if (v.url || v.shortCodeUrl || v.permalink || v.shortCode || v.shortcode || v.code || v.ownerUsername || v.username) out.push(v);
    ['topPosts','latestPosts','posts','reels','items','data','media','edges'].forEach((k) => Array.isArray(v[k]) && visit(v[k], depth + 1));
  };
  visit(items);
  return out;
}
function handleFrom(item = {}) {
  const vals = [item.ownerUsername, item.owner?.username, item.username, item.userName, item.handle, item.account, item.profileName, item.url, item.profileUrl, item.inputUrl];
  for (const raw of vals) {
    const h = normalizeAccount(raw);
    if (h && !['p','reel','reels','explore','tags','accounts'].includes(h)) return h;
  }
  return '';
}
function profileMap(items = []) {
  const map = new Map();
  for (const p of flatten(items)) {
    const h = handleFrom(p);
    if (!h) continue;
    map.set(h, {
      handle: h,
      fullName: p.fullName || p.name || p.ownerFullName || p.owner?.fullName || '',
      biography: p.biography || p.bio || p.description || p.owner?.biography || p.owner?.bio || '',
      followers: firstNumber(p.followersCount, p.followers, p.followerCount, p.ownerFollowersCount, p.owner?.followersCount),
      externalUrl: p.externalUrl || p.website || p.urlBio || '',
      category: p.categoryName || p.category || '',
      profileUrl: p.profileUrl || p.url || profileUrl(h),
    });
  }
  return map;
}
function reelPermalink(item = {}) {
  const raw = item.url || item.shortCodeUrl || item.permalink || '';
  const code = item.shortCode || item.shortcode || item.code || (String(raw).match(/instagram\.com\/(?:p|tv|reel)\/([^/?#]+)/i) || [])[1];
  const product = String(item.productType || item.mediaProductType || item.media_product_type || '').toUpperCase();
  const media = String(item.type || item.mediaType || item.media_type || '').toUpperCase();
  if (code && (String(raw).includes('/reel/') || product === 'REELS' || media === 'REEL' || media === 'VIDEO')) return `https://www.instagram.com/reel/${code}/`;
  return raw;
}
function textOf(item, prof = {}) {
  return [item.caption, item.text, item.title, item.description, item.alt, item.ownerFullName, item.fullName, item.username, item.ownerUsername, prof.fullName, prof.biography, prof.category, prof.externalUrl].filter(Boolean).join(' ');
}
function normalizeCandidate(item = {}, prof = {}, keyword = '') {
  const h = handleFrom(item) || prof.handle;
  const permalink = reelPermalink(item);
  if (!h || !String(permalink || '').includes('/reel/')) return null;
  const views = firstNumber(item.videoViewCount, item.video_view_count, item.videoPlayCount, item.video_play_count, item.viewCount, item.view_count, item.views, item.playCount, item.play_count, item.plays) || 0;
  const followers = firstNumber(prof.followers, item.ownerFollowersCount, item.owner_followers_count, item.followersCount, item.followers_count, item.followerCount, item.follower_count, item.followers, item.owner?.followersCount, item.owner?.followers_count);
  const timestamp = item.timestamp || item.takenAt || item.createdAt || item.date || item.uploadDate || nowIso();
  const age = ageDays(timestamp);
  const text = textOf(item, prof);
  const ratio = followers ? views / followers : null;
  const dance = DANCE_RE.test(text);
  const business = BUSINESS_RE.test(text);
  const recruit = RECRUIT_RE.test(text);
  if (dance || age === null || age > RESEARCH_RULES.maxAgeDays || views < RESEARCH_RULES.minViews || !followers || followers < RESEARCH_RULES.minFollowers || ratio === null || ratio < RESEARCH_RULES.minRatio || !business) return null;
  const score = views + (ratio || 0) * 1000 + (recruit ? 50000 : 0) + (business ? 30000 : 0);
  const caption = String(item.caption || item.text || '').replace(/\s+/g, ' ').trim();
  const theme = caption ? caption.slice(0, 42) : `${keyword || '採用'}関連リール`;
  return {
    id: permalink || `${h}_${Date.now()}`,
    week: weekKey(),
    company: prof.fullName || item.ownerFullName || item.fullName || `@${h}`,
    account: `@${h}`,
    profile_url: prof.profileUrl || profileUrl(h),
    url: permalink,
    permalink,
    industry: recruit ? '採用・採用広報' : '企業トレンド',
    media: 'Instagramリール',
    timestamp,
    date: timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '',
    views,
    followers_count: followers,
    view_follower_ratio: ratio == null ? null : Number(ratio.toFixed(1)),
    theme,
    opening: caption.slice(0, 80) || theme,
    structure: inferStructure(text),
    why: inferWhy({ views, ratio, text }),
    copy: inferIdea(text),
    source: 'weekly_research',
    source_keyword: keyword,
    buzz_score: score,
    caption: caption.slice(0, 500),
    fetched_at: nowIso(),
    dedupe_key: String(permalink || '').toLowerCase(),
    research_rules: [
      `投稿後${RESEARCH_RULES.maxAgeDays}日以内`,
      `${RESEARCH_RULES.minViews.toLocaleString('ja-JP')}回以上再生`,
      `フォロワー${RESEARCH_RULES.minFollowers.toLocaleString('ja-JP')}人以上`,
      `フォロワー比${RESEARCH_RULES.minRatio}倍以上`,
      'ダンス企画以外',
      '事業内容・職種・企業名・採用募集を含むアカウント'
    ],
  };
}
function inferStructure(text) {
  if (/1日|密着|ルーティン|vlog/i.test(text)) return '密着・Vlog型';
  if (/Q&A|質問|面接|対策|チェック/i.test(text)) return 'Q&A・ノウハウ型';
  if (/社員紹介|入社理由|若手|内定者/i.test(text)) return '社員紹介型';
  if (/あるある|共感/i.test(text)) return '共感型';
  return '短尺紹介型';
}
function inferWhy({ views, ratio, text }) {
  const parts = [];
  if (views) parts.push(`${views.toLocaleString('ja-JP')}回再生`);
  if (ratio) parts.push(`フォロワー比${ratio.toFixed(1)}倍`);
  if (/保存|チェック|対策|Q&A|質問/i.test(text)) parts.push('保存されやすいテーマ');
  if (/社員|若手|内定者|人事/i.test(text)) parts.push('人の顔が見える構成');
  return parts.length ? parts.join(' / ') : '指定条件を満たす候補';
}
function inferIdea(text) {
  if (/1日|密着|ルーティン|vlog/i.test(text)) return '若手社員の1日密着に置き換える';
  if (/面接|質問|Q&A|対策/i.test(text)) return '面接・説明会前のQ&A企画に置き換える';
  if (/社員紹介|入社理由|内定者/i.test(text)) return '社員紹介・入社理由シリーズに置き換える';
  return '自社の職種・社員・募集導線に置き換える';
}
function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}
function nextMondayJstIso(from = new Date()) {
  const jst = new Date(from.getTime() + 9 * 3600000);
  const day = jst.getUTCDay() || 7;
  const add = (8 - day) % 7 || 7;
  const next = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + add, 8, 0, 0));
  return new Date(next.getTime() - 9 * 3600000).toISOString();
}
function jstDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value || '');
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
async function collectWeekly({ seeds, limit = 50, timeout = 120, existingKeys = [] }) {
  const keywords = cleanKeywords(seeds);
  const configuredReel = actorId('APIFY_INSTAGRAM_REEL_ACTOR', ['APIFY_INSTAGRAM_HASHTAG_ACTOR','APIFY_INSTAGRAM_SCRAPER_ACTOR','APIFY_INSTAGRAM_ACTOR']);
  const configuredSearch = actorId('APIFY_INSTAGRAM_SEARCH_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR']);
  const reelActors = [...new Set([configuredReel, configuredSearch, 'apify/instagram-hashtag-scraper', publicInstagramScraperActor()].filter(Boolean))];
  const raw = [];
  const attempts = [];
  const rawSeen = new Set();
  if (process.env.APIFY_TOKEN) {
    let actorRuns = 0;
    for (const actor of reelActors.slice(0, 3)) {
      const batchSize = FREE_TIER_LIMITS.keywordBatchSize;
      for (let offset = 0; offset < keywords.length && actorRuns < FREE_TIER_LIMITS.maxActorRuns; offset += batchSize) {
        const tags = keywords.slice(offset, offset + batchSize);
        if (!tags.length) continue;
        try {
          const remaining = Math.max(0, FREE_TIER_LIMITS.rawItems - raw.length);
          const fetchLimit = Math.min(250, Math.max(120, Math.ceil(remaining / Math.max(1, FREE_TIER_LIMITS.maxActorRuns - actorRuns))));
          const items = await runActorSync({ actor, input: reelInput(tags, fetchLimit, actor), timeout });
          const flat = flatten(items);
          for (const x of flat) {
            const key = reelKey(x);
            if (!key || rawSeen.has(key)) continue;
            rawSeen.add(key);
            raw.push({ ...x, _keyword: tags.find((t) => JSON.stringify(x).includes(t)) || tags[0] || '' });
            if (raw.length >= FREE_TIER_LIMITS.rawItems) break;
          }
          attempts.push({ actor, rawCount: Array.isArray(items) ? items.length : 0, flatCount: flat.length, keptRawCount: raw.length, fetchLimit, keywordCount: tags.length, keywordOffset: offset });
        } catch (e) {
          attempts.push({ actor, error: e.message || String(e), keywordCount: tags.length, keywordOffset: offset });
        }
        actorRuns += 1;
        if (raw.length >= FREE_TIER_LIMITS.rawItems) break;
      }
      if (raw.length >= FREE_TIER_LIMITS.rawItems) break;
    }
  } else {
    attempts.push({ actor: 'apify', error: 'missing_APIFY_TOKEN' });
  }
  const rawDiagnostics = rejectionSummary(raw);
  const prefiltered = raw.filter(passesPreProfileRules);
  const handles = [...new Set(prefiltered.map(handleFrom).filter(Boolean))].slice(0, FREE_TIER_LIMITS.profiles);
  let profiles = new Map();
  const profileActor = actorId('APIFY_INSTAGRAM_PROFILE_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR']);
  if (process.env.APIFY_TOKEN && profileActor && handles.length) {
    try {
      const profItems = await runActorSync({ actor: profileActor, input: profileInput(handles, handles.length), timeout });
      profiles = profileMap(profItems);
      attempts.push({ actor: profileActor, profileCount: profiles.size, requestedProfiles: handles.length, purpose: 'profile_enrichment_after_prefilter' });
    } catch (e) {
      attempts.push({ actor: profileActor, error: e.message || String(e), purpose: 'profile_enrichment_after_prefilter' });
    }
  } else {
    attempts.push({ actor: 'profile_enrichment', skipped: true, reason: profileActor ? 'no_prefiltered_handles' : 'missing_APIFY_INSTAGRAM_PROFILE_ACTOR' });
  }
  const seen = new Set((existingKeys || []).map((x) => String(x || '').toLowerCase()).filter(Boolean));
  const rows = [];
  let duplicateCount = 0;
  for (const item of prefiltered) {
    const h = handleFrom(item);
    const row = normalizeCandidate(item, profiles.get(h) || {}, item._keyword || '');
    if (!row) continue;
    const key = String(row.dedupe_key || row.permalink || row.id).toLowerCase();
    if (seen.has(key)) { duplicateCount += 1; continue; }
    seen.add(key);
    rows.push(row);
  }
  rows.sort((a,b) => (b.buzz_score || 0) - (a.buzz_score || 0));
  return { rows: rows.slice(0, limit), duplicateCount, attempts, keywords: keywords.slice(0, FREE_TIER_LIMITS.keywords), profileActorConfigured: Boolean(profileActor), rawCount: raw.length, prefilteredCount: prefiltered.length, handlesCount: handles.length, rawDiagnostics, rules: RESEARCH_RULES, freeTierLimits: FREE_TIER_LIMITS };
}
async function runAndSave(options = {}) {
  const db = readDb();
  const limit = Math.max(1, Math.min(50, Number(options.limit || 50)));
  const startedAt = nowIso();
  try {
    const lastGenerated = db.weekly_reel_research?.generated_at || '';
    if (!options.force && lastGenerated && jstDateKey(lastGenerated) === jstDateKey(startedAt)) {
      const cachedRows = db.weekly_reel_research?.rows?.length ? db.weekly_reel_research.rows : (db.competitor_buzz_posts || []).slice(0, limit);
      addAudit(db, { action: 'weekly_reel_research', status: 'skipped_daily_limit', detail: '無料枠保護のため同日2回目のApify実行をスキップ', external_sent: false });
      writeDb(db);
      return { ok: true, ...(db.weekly_reel_research || {}), status: 'skipped_daily_limit', rows: cachedRows, started_at: startedAt, skipped: true };
    }
    const existingKeys = [...(db.competitor_reel_seen_keys || []), ...(db.competitor_buzz_posts || []).map((p) => p.dedupe_key || p.permalink || p.id)].filter(Boolean);
    const result = await collectWeekly({ seeds: options.seeds, limit, timeout: Number(options.timeout || 120), existingKeys });
    const weekly = { week: weekKey(), generated_at: nowIso(), next_run_at: nextMondayJstIso(), limit, status: result.rows.length ? 'success' : (result.duplicateCount ? 'duplicate_only' : 'no_rows'), rows: result.rows, attempts: result.attempts, keywords: result.keywords, rawCount: result.rawCount, prefilteredCount: result.prefilteredCount, handlesCount: result.handlesCount, rawDiagnostics: result.rawDiagnostics, duplicateCount: result.duplicateCount, rules: result.rules, freeTierLimits: result.freeTierLimits, profileActorConfigured: result.profileActorConfigured };
    db.weekly_reel_research = weekly;
    const byId = new Map([...(db.competitor_buzz_posts || []), ...result.rows].map((p) => [String(p.dedupe_key || p.id || p.permalink).toLowerCase(), p]));
    db.competitor_buzz_posts = [...byId.values()].sort((a,b) => (b.buzz_score || 0) - (a.buzz_score || 0)).slice(0, 300);
    db.competitor_reel_seen_keys = [...new Set([...existingKeys, ...result.rows.map((p) => p.dedupe_key || p.permalink || p.id)].map((x) => String(x || '').toLowerCase()).filter(Boolean))].slice(-2000);
    addAudit(db, { action: 'weekly_reel_research', status: weekly.status, detail: `${result.rows.length} new rows / ${result.duplicateCount} duplicates skipped / raw ${result.rawCount} / prefilter ${result.prefilteredCount} / handles ${result.handlesCount}`, external_ai_used: false, external_sent: false, attempts: result.attempts.slice(0, 8) });
    if (!result.rows.length) addAlert(db, { type: 'weekly_reel_research_no_rows', severity: 'warning', message: weekly.status === 'duplicate_only' ? '条件一致候補はありましたが、過去抽出済みのため新規表示は0件でした。' : '週次リール候補が0件でした。プロフィールActor/取得キーワード/Apify出力項目を確認してください。' });
    writeDb(db);
    return { ok: true, ...weekly, started_at: startedAt };
  } catch (e) {
    addAudit(db, { action: 'weekly_reel_research', status: 'failed', error: e.message || String(e), external_sent: false });
    addAlert(db, { type: 'weekly_reel_research_failed', severity: 'error', message: e.message || String(e) });
    writeDb(db);
    return { ok: false, error: 'weekly_research_failed', message: e.message || String(e), started_at: startedAt };
  }
}
async function handler(req, res) {
  if (req.method === 'GET') {
    const db = readDb();
    const weeklyRows = db.weekly_reel_research?.rows || [];
    const rows = weeklyRows.length ? weeklyRows : (db.competitor_buzz_posts || []);
    return json(res, 200, { ok: true, token: apifyTokenInfo(), weekly: db.weekly_reel_research || null, rows: rows.slice(0, 50) });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = await parseJsonBody(req);
  const result = await runAndSave(body);
  return json(res, result.ok ? 200 : 500, result);
}
module.exports = handler;
module.exports.runAndSave = runAndSave;
module.exports.collectWeekly = collectWeekly;
module.exports.KEYWORDS = KEYWORDS;
module.exports.RESEARCH_RULES = RESEARCH_RULES;
module.exports.FREE_TIER_LIMITS = FREE_TIER_LIMITS;

