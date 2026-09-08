const { json, parseJsonBody } = require('../meta');
const { readDb, writeDb, addAudit, addAlert, nowIso, normalizeAccount } = require('../runtime-store');
const { actorId, publicInstagramScraperActor, runActorSync, apifyTokenInfo } = require('../apify');
const { appendResearchCandidates, appendResearchLogs } = require('../google-sheets');

const STATUS = ['未確認', '採用', '不採用', '再探索対象', '学習反映済み', '取得失敗', '要確認'];
const REJECT_CATEGORIES = ['テーマ不一致', '対象期間外', '指定アカウント外', '投稿内容が薄い', '具体性不足', '重複投稿', '取得情報不足', '権利/炎上リスク', '撮影再現性不足'];
const LIMITS = { maxAccounts: 10, postsPerAccount: 50, maxCandidates: 20, maxExternalItems: 50, dailyRuns: 10, monthlyRuns: 200 };
const ALLOWED_URL_HOSTS = ['instagram.com', 'www.instagram.com', 'apify.com', 'api.apify.com', 'docs.google.com'];

function arr(v) { return Array.isArray(v) ? v : String(v || '').split(/[\n,、\s]+/).map((x) => x.trim()).filter(Boolean); }
function text(v) { return String(v == null || v === '' ? '要確認' : v); }
function isIsoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function parseDate(v) { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? null : d; }
function normalizeUrl(u) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!ALLOWED_URL_HOSTS.includes(url.hostname.toLowerCase())) return '要確認';
    return url.toString();
  } catch (e) { return '要確認'; }
}
function defaultTabs() { return { conditions: 'リサーチ条件', candidates: 'リサーチ候補一覧', standards: '自社コンテンツ基準', logs: '運用ログ' }; }
function instructionSummary(payload) {
  return [payload.theme, payload.periodStart && payload.periodEnd ? `${payload.periodStart}〜${payload.periodEnd}` : '', `希望${payload.limit || 10}件`, payload.allowExternalSearch ? '指定外探索許可あり' : '指定アカウント内のみ'].filter(Boolean).join(' / ');
}
function validationErrors(payload = {}) {
  const errors = [];
  if (!String(payload.theme || '').trim()) errors.push('対象テーマが未入力');
  if (!isIsoDate(payload.periodStart) || !isIsoDate(payload.periodEnd)) errors.push('対象期間は開始日・終了日をYYYY-MM-DDで指定');
  if (isIsoDate(payload.periodStart) && isIsoDate(payload.periodEnd) && payload.periodStart > payload.periodEnd) errors.push('対象期間の開始日が終了日より後');
  const limit = Number(payload.limit || 0);
  if (!Number.isFinite(limit) || limit < 1 || limit > LIMITS.maxCandidates) errors.push(`希望件数は1〜${LIMITS.maxCandidates}件`);
  const accounts = arr(payload.accounts);
  if (!accounts.length) errors.push('対象アカウントが未入力');
  if (accounts.length > LIMITS.maxAccounts) errors.push(`対象アカウントは最大${LIMITS.maxAccounts}件`);
  const tabs = { ...defaultTabs(), ...(payload.tabs || {}) };
  if (!tabs.candidates || !tabs.logs) errors.push('出力先タブが未指定');
  const accountBad = accounts.find((a) => normalizeUrl(a).includes('要確認') && /^https?:/i.test(a));
  if (accountBad) errors.push(`許可ドメイン外URL: ${accountBad}`);
  if (payload.allowExternalSearch && Number(payload.externalLimit || 0) > LIMITS.maxExternalItems) errors.push(`指定外探索は最大${LIMITS.maxExternalItems}件`);
  return errors;
}
function postIdFrom(item = {}) {
  return item.id || item.shortCode || item.shortcode || item.code || (String(item.url || item.permalink || '').match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i) || [])[1] || '取得不可';
}
function permalinkOf(item = {}) {
  const raw = item.permalink || item.url || item.shortCodeUrl || '';
  const code = postIdFrom(item);
  if (code !== '取得不可' && (String(raw).includes('/reel/') || String(item.media_product_type || item.productType || '').toUpperCase() === 'REELS')) return `https://www.instagram.com/reel/${code}/`;
  return raw || '取得不可';
}
function firstNumber(...values) {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function flatten(items = []) {
  const out = [];
  const visit = (v, depth = 0) => {
    if (!v || depth > 3) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth));
    if (typeof v !== 'object') return;
    if (v.url || v.permalink || v.shortCode || v.shortcode || v.code || v.latestPosts || v.posts || v.reels) out.push(v);
    ['topPosts', 'latestPosts', 'posts', 'reels', 'items', 'data', 'media'].forEach((k) => Array.isArray(v[k]) && visit(v[k], depth + 1));
  };
  visit(items);
  return out;
}
function accountFrom(item = {}) { return normalizeAccount(item.ownerUsername || item.username || item.account || item.profileUrl || item.url || item.inputUrl || ''); }
function candidateFrom(item = {}, payload = {}, meta = {}) {
  const account = accountFrom(item) || normalizeAccount(meta.account || '');
  const url = normalizeUrl(permalinkOf(item));
  const postedAt = item.timestamp || item.takenAt || item.createdAt || item.date || '';
  const like = firstNumber(item.likeCount, item.like_count, item.likes);
  const comments = firstNumber(item.commentsCount, item.comments_count, item.comments);
  const views = firstNumber(item.videoViewCount, item.video_view_count, item.videoPlayCount, item.viewCount, item.view_count, item.views, item.plays);
  const shares = firstNumber(item.shareCount, item.sharesCount, item.shares);
  const followers = firstNumber(item.ownerFollowersCount, item.followersCount, item.followerCount, item.followers, item.owner && item.owner.followersCount);
  const kind = String(item.media_product_type || item.productType || item.mediaType || item.type || '').toUpperCase().includes('CAROUSEL') ? 'Carousel' : (String(url).includes('/reel/') ? 'Reel' : text(item.media_type || item.type || '要確認'));
  const caption = String(item.caption || item.text || item.title || '').replace(/\s+/g, ' ').trim();
  const risks = [];
  if (!postedAt) risks.push('投稿日未取得');
  if (url === '要確認' || url === '取得不可') risks.push('URL取得不可');
  if (views == null) risks.push('再生数/表示回数は取得不可');
  return {
    fetchedAt: nowIso(),
    discordMessageId: text(payload.discordMessageId),
    theme: text(payload.theme),
    period: `${text(payload.periodStart)}〜${text(payload.periodEnd)}`,
    searchScope: meta.scope || '指定アカウント内',
    account: account ? `@${account}` : text(meta.account),
    postUrl: url,
    postId: postIdFrom(item),
    postedAt: postedAt ? String(postedAt).slice(0, 10) : '取得不可',
    postType: kind,
    likes: like == null ? '取得不可' : like,
    comments: comments == null ? '取得不可' : comments,
    views: views == null ? '取得不可' : views,
    saves: '取得不可',
    shares: shares == null ? '取得不可' : shares,
    followers: followers == null ? '取得不可' : followers,
    caption: caption.slice(0, 500),
    aiReason: caption ? `テーマ「${payload.theme}」との関連を確認。本文冒頭: ${caption.slice(0, 120)}` : '投稿本文は取得不可。URL・投稿日・数値の確認が必要。',
    referencePoint: '冒頭フック、企画構成、CTA、コメント反応を人間確認して自社投稿への転用可否を判断',
    riskNote: risks.length ? risks.join(' / ') : '人間がトンマナ・権利/炎上リスク・撮影再現性を確認',
    adoptionStatus: risks.length ? '要確認' : '未確認',
    rejectCategory: '',
    rejectMemo: '',
    reflectNext: '',
    sourceActor: meta.actor || '',
    runId: meta.runId || '',
    datasetId: meta.datasetId || '',
  };
}
function demoRows(payload) {
  const accounts = arr(payload.accounts).slice(0, 2);
  return accounts.map((a, i) => candidateFrom({
    url: `https://www.instagram.com/reel/demo${i + 1}/`, code: `demo${i + 1}`, username: normalizeAccount(a), timestamp: payload.periodEnd || nowIso(), media_product_type: 'REELS', view_count: 100000 + i * 25000, like_count: 1200 + i * 100, comments_count: 30 + i, caption: `${payload.theme}に関する採用・社員紹介系の検証用リール候補`,
  }, payload, { account: a, scope: '指定アカウント内', actor: 'demo_when_apify_not_configured' }));
}
async function collectFromApify(payload) {
  if (!process.env.APIFY_TOKEN) return { rows: demoRows(payload), attempts: [{ actor: 'apify', skipped: true, reason: 'missing_APIFY_TOKEN', fallback: 'demo_rows' }], actorConfigured: false };
  const actor = actorId('APIFY_INSTAGRAM_PROFILE_ACTOR', ['APIFY_INSTAGRAM_SCRAPER_ACTOR', 'APIFY_INSTAGRAM_ACTOR']) || publicInstagramScraperActor();
  const accounts = arr(payload.accounts).slice(0, LIMITS.maxAccounts);
  const postsPerAccount = Math.max(1, Math.min(Number(payload.postsPerAccount || LIMITS.postsPerAccount), LIMITS.postsPerAccount));
  const input = { usernames: accounts.map(normalizeAccount), directUrls: accounts.map((a) => `https://www.instagram.com/${normalizeAccount(a)}/`), resultsLimit: postsPerAccount, maxItems: accounts.length * postsPerAccount, addParentData: true, onlyPostsNewerThan: payload.periodStart };
  const items = await runActorSync({ actor, input, timeout: Number(payload.timeout || 120) });
  const flat = flatten(items);
  const start = parseDate(payload.periodStart), end = parseDate(payload.periodEnd);
  const seen = new Set();
  const rows = [];
  for (const item of flat) {
    const dt = parseDate(item.timestamp || item.takenAt || item.createdAt || item.date || '');
    if (start && dt && dt < start) continue;
    if (end && dt && dt > new Date(end.getTime() + 86400000 - 1)) continue;
    const key = String(permalinkOf(item) || postIdFrom(item)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(candidateFrom(item, payload, { scope: '指定アカウント内', actor }));
    if (rows.length >= Number(payload.limit || 10)) break;
  }
  return { rows, attempts: [{ actor, input, rawCount: Array.isArray(items) ? items.length : 0, flattenedCount: flat.length, outputCount: rows.length }], actorConfigured: true };
}
function countsThisPeriod(logs = []) {
  const jst = (d) => new Date(new Date(d).getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const today = jst(nowIso());
  const month = today.slice(0, 7);
  const runLogs = logs.filter((l) => l.action === 'research_semiauto_run');
  return { today: runLogs.filter((l) => jst(l.at) === today).length, month: runLogs.filter((l) => jst(l.at).startsWith(month)).length };
}
async function run(payload = {}) {
  const errors = validationErrors(payload);
  const db = readDb();
  if (errors.length) {
    addAudit(db, { action: 'research_semiauto_validate', status: 'requires_confirmation', errors, external_ai_used: false, external_sent: false, target: payload.theme || '' });
    writeDb(db);
    return { ok: false, status: 'requires_confirmation', message: '未確定項目があります。推測で実行せず確認してください。', errors, requiredFields: ['対象テーマ', '対象期間', '希望件数', '指定アカウント', '指定外探索許可有無', '出力先タブ'] };
  }
  const quota = countsThisPeriod(db.audit_logs || []);
  if (quota.today >= LIMITS.dailyRuns || quota.month >= LIMITS.monthlyRuns) {
    const msg = `実行上限超過（日${LIMITS.dailyRuns}回/月${LIMITS.monthlyRuns}回）`;
    addAudit(db, { action: 'research_semiauto_run', status: 'blocked_quota', error: msg, external_sent: false });
    addAlert(db, { type: 'research_quota', severity: 'warning', title: 'リサーチ実行上限', message: msg });
    writeDb(db);
    return { ok: false, status: '要確認', message: msg };
  }
  let result;
  try { result = await collectFromApify(payload); }
  catch (e) { result = { rows: [], attempts: [{ error: e.message || String(e) }], actorConfigured: Boolean(process.env.APIFY_TOKEN) }; }
  const rows = result.rows || [];
  let sheetCandidates = { configured: false, appendedRows: 0, note: 'Sheets未設定のためDB保存のみ' };
  let sheetLogs = { configured: false, appendedRows: 0, note: 'Sheets未設定のためDB保存のみ' };
  try { sheetCandidates = await appendResearchCandidates(rows); } catch (e) { sheetCandidates = { configured: false, appendedRows: 0, error: e.message || String(e) }; }
  const runLog = { executor: payload.executor || 'Discord指示者', executedAt: nowIso(), discordMessageId: text(payload.discordMessageId), apifyRunId: result.attempts?.[0]?.runId || '', inputConditions: instructionSummary(payload), accountCount: arr(payload.accounts).length, fetchedCount: rows.length, outputCount: rows.length, matchedCount: rows.filter((r) => r.adoptionStatus === '未確認').length, missingFields: [...new Set(rows.flatMap((r) => String(r.riskNote || '').split(' / ').filter(Boolean)))].join(' / ') || '', error: rows.length ? '' : '候補不足または取得失敗', externalSearchReason: payload.allowExternalSearch ? '人間が指定外探索を許可' : '', rejectedLearning: payload.rejectedLearning || '' };
  try { sheetLogs = await appendResearchLogs([runLog]); } catch (e) { sheetLogs = { configured: false, appendedRows: 0, error: e.message || String(e) }; }
  db.research_candidates = [...rows, ...(db.research_candidates || [])].slice(0, 500);
  db.research_runs = [{ at: nowIso(), status: rows.length ? 'success' : '要確認', input: { ...payload, accounts: arr(payload.accounts) }, attempts: result.attempts, count: rows.length }, ...(db.research_runs || [])].slice(0, 100);
  addAudit(db, { action: 'research_semiauto_run', status: rows.length ? 'success' : '要確認', target: payload.theme, rows: rows.length, external_ai_used: false, external_sent: false, source: 'apify', sheet_write: { candidates: sheetCandidates, logs: sheetLogs }, attempts: result.attempts });
  if (!rows.length) addAlert(db, { type: 'research_no_candidates', severity: 'warning', title: 'リサーチ候補不足', message: '指定アカウント内で候補が不足しています。指定外探索は人間許可後のみ実行してください。' });
  writeDb(db);
  return { ok: true, status: rows.length ? 'success' : '要確認', rows, count: rows.length, attempts: result.attempts, token: apifyTokenInfo(), sheet_write: { candidates: sheetCandidates, logs: sheetLogs }, allowedStatuses: STATUS, rejectCategories: REJECT_CATEGORIES, limits: LIMITS, message: rows.length ? 'リサーチ候補一覧へ出力しました。採用/不採用は人間判断です。' : '候補不足です。指定外探索案を提示し、人間許可を得てください。' };
}
async function handler(req, res) {
  if (req.method === 'GET') {
    const db = readDb();
    return json(res, 200, { ok: true, candidates: (db.research_candidates || []).slice(0, 100), runs: (db.research_runs || []).slice(0, 20), statuses: STATUS, rejectCategories: REJECT_CATEGORIES, limits: LIMITS, token: apifyTokenInfo() });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = await parseJsonBody(req);
  const result = await run(body);
  return json(res, result.ok ? 200 : 400, result);
}
module.exports = handler;
module.exports.run = run;
module.exports.validationErrors = validationErrors;
module.exports.LIMITS = LIMITS;
