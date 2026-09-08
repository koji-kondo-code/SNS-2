const { json, graph, requiredEnv, safeTokenInfo, parseJsonBody } = require('../lib/meta');
const { readDb, writeDb, addAudit, nowIso, normalizeAccount } = require('../lib/runtime-store');
const { appendCompetitorCandidates } = require('../lib/google-sheets');

const DEFAULT_SEEDS = [
  { industry: 'IT・エンジニア採用', hashtag: 'エンジニア採用' },
  { industry: '新卒採用', hashtag: '新卒採用' },
  { industry: '中途採用', hashtag: '転職活動' },
  { industry: '店舗・サービス採用', hashtag: '美容師求人' },
];

const SAMPLE_BUZZ = [
  {
    id: 'sample_hashtag_1', industry: 'IT・エンジニア採用', hashtag: 'エンジニア採用', media_type: 'VIDEO', media_product_type: 'REELS',
    timestamp_days_ago: 1, permalink: 'https://www.instagram.com/reel/sample-engineer/',
    like_count: 1280, comments_count: 46, view_count: 180000, followers_count: 12000, view_follower_ratio: 15,
    caption: '採用募集｜未経験からエンジニアになるまでのリアルな1日。研修・先輩フォロー・面談導線を短尺で見せる。',
    buzz_score: 180000, source: 'fallback_sample', ai_topic: '未経験者の不安解消',
    ai_reason: '冒頭で未経験者の不安を提示し、研修・先輩・応募導線まで一連で見せているため採用リールへ転用しやすい。',
    reusable_idea: 'ABCの新人研修・メンター制度・現場配属までを30秒リールで見せる。', candidate_status: 'リールURL確認後にトレンド候補へ登録',
  },
  {
    id: 'sample_hashtag_2', industry: '新卒採用', hashtag: '新卒採用', media_type: 'VIDEO', media_product_type: 'REELS',
    timestamp_days_ago: 2, permalink: 'https://www.instagram.com/reel/sample-newgrad-faq/',
    like_count: 840, comments_count: 21, view_count: 145000, followers_count: 9000, view_follower_ratio: 16.1,
    caption: '新卒採用｜面接前に見るべき質問回答を15秒で紹介。人事担当が保存したくなるチェックリスト型リール。',
    buzz_score: 145000, source: 'fallback_sample', ai_topic: '保存型ノウハウリール',
    ai_reason: '就活生が保存しやすい実用情報を短尺化しており、プロフィール閲覧や説明会導線に接続しやすい。',
    reusable_idea: 'OPEN COMPANY前に見るべき企業研究チェックを短尺リールで展開する。', candidate_status: 'リールURL確認後にトレンド候補へ登録',
  },
];

function recentIso(daysAgo = 1) { return new Date(Date.now() - daysAgo * 86400000).toISOString(); }
function withFreshSampleDates(rows = []) {
  const byId = new Map(SAMPLE_BUZZ.map((row) => [row.id, row]));
  return rows.map((row) => {
    const sample = byId.get(row.id) || {};
    const isSample = row.source === 'fallback_sample' || byId.has(row.id);
    return {
      ...row,
      ...sample,
      timestamp: isSample ? recentIso(sample.timestamp_days_ago || row.timestamp_days_ago || 1) : (row.timestamp || recentIso(row.timestamp_days_ago || 1)),
      fetched_at: nowIso(),
      research_rules: row.research_rules || sample.research_rules || ['投稿後7日以内', '100,000回以上再生', 'フォロワー1,000人以上', 'フォロワー比10倍以上', 'ダンス企画以外', '事業・職種・企業・採用系シグナルあり'],
    };
  });
}

function isReelPost(p = {}) {
  const permalink = String(p.permalink || p.url || p.shortCodeUrl || '');
  const product = String(p.media_product_type || p.product_type || p.productType || '').toUpperCase();
  const media = String(p.media_type || p.type || p.mediaType || '').toUpperCase();
  return permalink.includes('/reel/') || product === 'REELS' || media === 'REEL';
}
function normalizeReelPermalink(p = {}) {
  const raw = String(p.permalink || p.url || p.shortCodeUrl || '');
  if (raw.includes('/reel/')) return raw;
  const product = String(p.media_product_type || p.product_type || p.productType || '').toUpperCase();
  const media = String(p.media_type || p.type || p.mediaType || '').toUpperCase();
  const shortcode = p.shortcode || p.shortCode || p.code || (raw.match(/instagram\.com\/(?:p|tv)\/([^/?#]+)/i) || [])[1];
  return (shortcode && (product === 'REELS' || media === 'REEL')) ? `https://www.instagram.com/reel/${shortcode}/` : raw;
}

function cleanHashtag(v) { return String(v || '').replace(/^#/, '').trim(); }
function scorePost(p) { return Number(p.like_count || 0) + Number(p.comments_count || 0) * 2; }
function aiClassifyPost(p, industry, hashtag) {
  const text = String(p.caption || '');
  const lower = text.toLowerCase();
  let topic = 'バズ投稿';
  if (/面接|就活|選考|内定|説明会|新卒/.test(text)) topic = '就活・選考ノウハウ';
  else if (/社員|先輩|1日|vlog|職場|社風/.test(text)) topic = '社員・社風訴求';
  else if (/未経験|転職|エンジニア|研修|キャリア/.test(text)) topic = '未経験/中途向け仕事理解';
  else if (lower.includes('tips') || /コツ|方法|チェック/.test(text)) topic = '保存型Tips';
  return {
    ai_topic: topic,
    ai_reason: `#${hashtag} 起点で反応が高い投稿です。${topic}として、冒頭フック・構成・CTAを自社企画に分解して使えます。`,
    reusable_idea: industry.includes('採用') ? '不安提示→実例→社員/制度→プロフィール誘導の短尺企画に転用する。' : '冒頭フックと保存導線を抽出し、自社商材の説明前コンテンツに転用する。',
    candidate_status: 'リールURL確認後にトレンド候補へ登録',
  };
}
function normalizeBuzzPost(p, meta = {}) {
  const out = {
    id: p.id || `buzz_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    industry: meta.industry || p.industry || '未分類',
    hashtag: meta.hashtag || p.hashtag || '',
    media_type: p.media_type || p.media_product_type || 'VIDEO',
    media_product_type: p.media_product_type || p.product_type || 'REELS',
    media_url: p.media_url || p.thumbnail_url || '',
    permalink: normalizeReelPermalink(p),
    timestamp: p.timestamp || nowIso(),
    like_count: Number(p.like_count || 0),
    comments_count: Number(p.comments_count || 0),
    view_count: Number(p.view_count || p.views || p.videoViewCount || p.videoPlayCount || 0),
    followers_count: Number(p.followers_count || p.followers || p.ownerFollowersCount || p.followersCount || 0),
    view_follower_ratio: Number(p.view_follower_ratio || 0) || null,
    caption: String(p.caption || '').slice(0, 500),
    source: p.source || meta.source || 'instagram_hashtag_api',
    fetched_at: meta.fetched_at || nowIso(),
  };
  out.buzz_score = scorePost(out);
  if (!out.view_follower_ratio && out.followers_count) out.view_follower_ratio = Number((out.view_count / out.followers_count).toFixed(1));
  return { ...out, ...aiClassifyPost(out, out.industry, out.hashtag) };
}
async function fetchHashtagMedia({ hashtag, industry, limit, token, igId }) {
  const clean = cleanHashtag(hashtag);
  const search = await graph('/ig_hashtag_search', { user_id: igId, q: clean, access_token: token });
  const hashtagId = search.data?.[0]?.id;
  if (!hashtagId) return [];
  const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  const [top, recent] = await Promise.all([
    graph(`/${hashtagId}/top_media`, { user_id: igId, fields, limit, access_token: token }).catch((e) => ({ data: [], error: e.message })),
    graph(`/${hashtagId}/recent_media`, { user_id: igId, fields, limit, access_token: token }).catch((e) => ({ data: [], error: e.message })),
  ]);
  const seen = new Set();
  return [...(top.data || []), ...(recent.data || [])]
    .filter((p) => p.id && !seen.has(p.id) && seen.add(p.id) && isReelPost(p))
    .map((p) => normalizeBuzzPost(p, { industry, hashtag: clean, fetched_at: nowIso() }))
    .sort((a, b) => b.buzz_score - a.buzz_score)
    .slice(0, limit);
}
async function analyzeBusinessAccounts({ accounts, industry, token, igId, limit }) {
  const rows = [];
  const errors = [];
  for (const raw of accounts.slice(0, Math.min(10, accounts.length))) {
    const username = normalizeAccount(raw);
    if (!username) continue;
    try {
      const fields = `business_discovery.username(${username}){id,username,name,followers_count,media_count,media.limit(${Math.min(25, limit || 10)}){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`;
      const data = await graph(`/${igId}`, { fields, access_token: token });
      const bd = data.business_discovery;
      if (!bd) {
        errors.push({ username, message: 'business_discovery_empty' });
        continue;
      }
      const media = (bd.media?.data || []).filter(isReelPost).map((m) => ({ ...m, permalink: normalizeReelPermalink(m), buzz_score: scorePost(m) })).sort((a, b) => b.buzz_score - a.buzz_score);
      const avgEng = media.length ? media.reduce((a, m) => a + scorePost(m), 0) / media.length : 0;
      rows.push({
        username: `@${bd.username || username}`,
        name: bd.name || bd.username || username,
        industry: industry || '登録済み競合',
        followers_count: bd.followers_count || 0,
        media_count: bd.media_count || 0,
        avg_engagement: Math.round(avgEng),
        engagement_rate: bd.followers_count ? Number((avgEng / bd.followers_count * 100).toFixed(2)) : null,
        top_media: media.slice(0, 5),
        source: 'business_discovery_api',
        fetched_at: nowIso(),
      });
    } catch (e) {
      errors.push({ username, message: e.message || String(e), detail: e.data || null });
    }
  }
  return { rows, errors };
}

module.exports = async function handler(req, res) {
  const db = readDb();
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      official_api_ready: Boolean(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID && process.env.META_ACCESS_TOKEN),
      buzz_posts: withFreshSampleDates((db.weekly_reel_research?.rows && db.weekly_reel_research.rows.length) ? db.weekly_reel_research.rows : ((db.competitor_buzz_posts && db.competitor_buzz_posts.length) ? db.competitor_buzz_posts : SAMPLE_BUZZ)).filter(isReelPost).slice(0, 100),
      weekly_reel_research: db.weekly_reel_research || null,
      competitor_accounts: (db.competitor_accounts || []).slice(0, 50),
      seeds: db.competitor_hashtag_seeds || DEFAULT_SEEDS,
      constraints: [
        'ハッシュタグAPIは投稿単位の抽出に使います。公式APIだけでは投稿者usernameを自動取得できません。',
        'Business Discoveryは、人が確認・登録した既知のビジネス/クリエイターusernameに対して実行します。',
        '投稿・DM・フォロー等の外部アクションは実行しません。読み取り専用です。',
      ],
    });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

  const body = await parseJsonBody(req);
  const action = body.action || 'save_candidate';
  if (action === 'discover_hashtags') {
    const seeds = Array.isArray(body.seeds) && body.seeds.length ? body.seeds : DEFAULT_SEEDS;
    const limit = Math.max(1, Math.min(25, Number(body.limit || 10)));
    const missing = requiredEnv(['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_ACCESS_TOKEN']);
    let rows = [];
    let apiStatus = 'live';
    let error = null;
    if (!missing.length) {
      try {
        for (const seed of seeds.slice(0, 6)) {
          rows.push(...await fetchHashtagMedia({ ...seed, limit, token: process.env.META_ACCESS_TOKEN, igId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID }));
        }
      } catch (e) { apiStatus = 'error_fallback'; error = e.message || String(e); rows = withFreshSampleDates(SAMPLE_BUZZ); }
    } else { apiStatus = 'missing_env_fallback'; rows = withFreshSampleDates(SAMPLE_BUZZ); }
    if (!rows.length) { apiStatus = 'no_live_rows_fallback'; rows = withFreshSampleDates(SAMPLE_BUZZ); }
    const byId = new Map([...(db.competitor_buzz_posts || []), ...rows].map((p) => [p.id || p.permalink, p]));
    db.competitor_buzz_posts = [...byId.values()].sort((a, b) => (b.buzz_score || 0) - (a.buzz_score || 0)).slice(0, 300);
    db.competitor_hashtag_seeds = seeds.map((s) => ({ industry: s.industry || '未分類', hashtag: cleanHashtag(s.hashtag) })).filter((s) => s.hashtag).slice(0, 50);
    addAudit(db, { action: 'competitor_hashtag_buzz_discovery', status: apiStatus, external_ai_used: false, external_sent: false, detail: `${rows.length} posts / ${seeds.length} seeds` });
    writeDb(db);
    return json(res, 200, { ok: true, action, apiStatus, official_api_ready: !missing.length, missing, token: safeTokenInfo(process.env.META_ACCESS_TOKEN), rows, error, constraints: 'Hashtag APIは投稿者usernameを返さないため、ビジネスアカウント登録は人の確認後に行います。リールURLのみ候補化します。' });
  }
  if (action === 'analyze_accounts') {
    const accounts = Array.isArray(body.accounts) ? body.accounts : String(body.accounts || '').split(/[\s,、]+/);
    const limit = Math.max(1, Math.min(25, Number(body.limit || 10)));
    const missing = requiredEnv(['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_ACCESS_TOKEN']);
    if (missing.length) return json(res, 200, { ok: true, action, apiStatus: 'missing_env', official_api_ready: false, missing, rows: [], message: 'Business Discovery実行にはVercel/ローカル環境に有効なMetaトークンが必要です。' });
    try {
      const result = await analyzeBusinessAccounts({ accounts, industry: body.industry, limit, token: process.env.META_ACCESS_TOKEN, igId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID });
      const rows = result.rows || [];
      const errors = result.errors || [];
      const byUser = new Map([...(db.competitor_accounts || []), ...rows].map((r) => [normalizeAccount(r.username), r]));
      db.competitor_accounts = [...byUser.values()].slice(0, 200);
      addAudit(db, { action: 'competitor_business_discovery', status: rows.length ? 'success' : 'no_rows', external_ai_used: false, external_sent: false, detail: `${rows.length} accounts`, errors: errors.slice(0, 5) });
      writeDb(db);
      return json(res, 200, { ok: true, action, apiStatus: rows.length ? 'live' : 'no_rows', official_api_ready: true, rows, errors, message: rows.length ? undefined : 'Business Discoveryは実行されましたが、保存できるアカウントがありませんでした。username、権限、対象がBusiness/Creatorで公開されているか確認してください。' });
    } catch (e) {
      return json(res, e.status || 500, { ok: false, action, error: 'business_discovery_save_failed', message: e.message, detail: e.data || null });
    }
  }

  const candidate = body.candidate || body;
  let sheet_write = { tab: '企画候補履歴', updatedRows: 0, verified: false, note: '現時点ではDB保存。Sheets接続後に書込へ拡張します。' };
  try {
    const sheetResult = await appendCompetitorCandidates([candidate]);
    sheet_write = {
      tab: '企画候補履歴',
      updatedRows: sheetResult.appendedRows || 0,
      verified: Boolean(sheetResult.configured),
      spreadsheetId: sheetResult.spreadsheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
      updatedRange: sheetResult.updatedRange || null,
      note: sheetResult.configured ? 'Google Sheetsへ追記しました。' : 'Sheets未設定のためDB保存のみ。',
    };
  } catch (e) {
    sheet_write = { tab: '企画候補履歴', updatedRows: 0, verified: false, error: e.message || String(e), note: 'Sheets書き込みに失敗したためDB保存のみ行いました。' };
  }
  db.competitor_saved_candidates = [{ ...candidate, saved_at: nowIso(), storage: sheet_write.verified ? 'server-db+google-sheets' : 'server-db' }, ...(db.competitor_saved_candidates || [])].slice(0, 200);
  addAudit(db, { action: 'competitor_candidate_saved', status: sheet_write.verified ? 'sheets_appended' : 'db_only', external_ai_used: false, external_sent: false, sheet_write, detail: candidate.theme || candidate.permalink || candidate.account || '' });
  writeDb(db);
  return json(res, 200, {
    ok: true,
    sheet_write,
    state: { audit_logs: db.audit_logs || [] },
  });
};
