const { readDb, writeDb, addAudit, nowIso } = require('./runtime-store');
const { configured, appendMonthlyOperationLog } = require('./google-sheets');

const STATUS = ['未取得', '取得済み', '要確認', '取得不可', '反映済み', 'エラー'];
const SHEET_ID = '18OUqBNfsA0ZxG0NkEoIxHPmxliJLsHcV1Iyx-AORra0';
const REQUIREMENTS_TAB = '月次レポート_運用反映案';
const CONTENT_TAB = '月次レポート_コンテンツ別';
const MONTHLY_TAB = '月次レポート_月次全体';
const LOG_TAB = '運用ログ';
const HUMAN_COLUMNS = ['対象アカウント', '投稿URL', '投稿ID', '投稿日', '投稿種別', '対象月'];
const CONTENT_AI_COLUMNS = ['再生数', '閲覧者数', 'いいね数', '保存数', 'プロフアクセス数', 'リンクタップ数', '取得ステータス', '最終取得日時', '反映済みフラグ', '要確認事項', '分析コメント'];
const MONTHLY_AI_COLUMNS = ['再生数', '再生数 前月比', '閲覧者数', '閲覧者数 前月比', 'プロフ流入数', 'プロフ流入数 前月比', 'リンクタップ数', 'リンクタップ数 前月比', 'フォロワー数', 'フォロワー数 前月比', 'フォロワー純増数', 'フォロワー純増数 前月比', '取得ステータス', '最終取得日時', '反映済みフラグ', '要確認事項', '分析コメント'];
const SECRET_RE = /(token|secret|password|client_secret|access_token|bearer|認証|パスワード)/i;

function toNum(v) { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }
function pct(num, den) { return den ? `${((num - den) / den * 100).toFixed(1)}%` : '比較不可'; }
function rate(num, den) { return den ? `${(num / den * 100).toFixed(2)}%` : '-'; }
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
function prevMonthKey(ym) {
  const [y, m] = String(ym || monthKey()).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 2, 1)).toISOString().slice(0, 7);
}
function sanitizeText(v) { return String(v == null ? '' : v).replace(SECRET_RE, '[機密語句除去]'); }
function validatePayload(body = {}) {
  const errors = [];
  const ym = String(body.targetMonth || '').trim();
  const account = String(body.account || '').trim().replace(/^@/, '');
  const dataType = String(body.dataType || 'both');
  const targetTab = String(body.targetTab || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) errors.push('対象月は YYYY-MM 形式で指定してください');
  if (!account) errors.push('対象アカウントが未指定です');
  if (!['content', 'monthly', 'both'].includes(dataType)) errors.push('対象データ種別は content/monthly/both のいずれかです');
  if (!targetTab) errors.push('対象タブが未指定です');
  if (targetTab && ![CONTENT_TAB, MONTHLY_TAB, REQUIREMENTS_TAB].includes(targetTab)) errors.push('更新対象タブが要件定義の許可範囲外です');
  return { ok: errors.length === 0, errors, normalized: { targetMonth: ym, account, dataType, targetTab } };
}
function extractMetric(list = [], name) {
  const row = list.find((x) => x.name === name);
  return toNum(row?.total_value?.value ?? row?.values?.[0]?.value);
}
function mediaMetric(media, name) { return extractMetric(media?.insights?.data || [], name); }
function buildRowsFromInsights(insights = {}, payload = {}) {
  const now = nowIso();
  const profile = insights.profile || {};
  const account = payload.account || profile.username || insights.selectedAccount?.username || 'instagram';
  const posts = (insights.media || []).filter((m) => String(m.timestamp || '').startsWith(payload.targetMonth)).slice(0, 50);
  const contentRows = posts.map((m) => {
    const views = mediaMetric(m, 'views') || mediaMetric(m, 'reach');
    const reach = mediaMetric(m, 'reach');
    const likes = mediaMetric(m, 'likes') || toNum(m.like_count);
    const saves = mediaMetric(m, 'saved');
    const profileAccess = mediaMetric(m, 'profile_visits') || mediaMetric(m, 'profile_activity');
    const linkClicks = mediaMetric(m, 'link_clicks');
    const missing = [];
    if (!views) missing.push('再生数/閲覧数');
    if (!reach) missing.push('閲覧者数');
    if (!profileAccess) missing.push('プロフアクセス数');
    if (!linkClicks) missing.push('リンクタップ数');
    const status = missing.length ? '要確認' : '取得済み';
    return {
      type: 'content', targetMonth: payload.targetMonth, account: `@${account}`, postUrl: m.permalink || '', postId: m.id || '', postedAt: String(m.timestamp || '').slice(0, 10), fetchDate: now.slice(0, 10), postType: m.media_product_type || m.media_type || '投稿',
      views, reach, likes, saves, profileAccess, linkClicks, status, lastFetchedAt: now, reflected: false,
      confirmation: missing.length ? `Meta API非返却/権限要確認: ${missing.join('、')}` : '人間がレポート採用可否を確認',
      analysis: `${sanitizeText(String(m.caption || '').split('\n')[0]).slice(0, 40)} / いいね率 ${rate(likes, reach)}・保存率 ${rate(saves, reach)}。採用導線への貢献は人間確認。`,
    };
  });
  const metrics = insights.accountInsights || [];
  const views = extractMetric(metrics, 'views');
  const reach = extractMetric(metrics, 'reach');
  const profileAccess = extractMetric(metrics, 'profile_views');
  const linkClicks = extractMetric(metrics, 'website_clicks');
  const followers = toNum(profile.followers_count);
  const previous = payload.previousMonthly || {};
  const monthlyRow = {
    type: 'monthly', targetMonth: payload.targetMonth, account: `@${account}`,
    views, viewsMoM: pct(views, previous.views), reach, reachMoM: pct(reach, previous.reach), profileAccess, profileAccessMoM: pct(profileAccess, previous.profileAccess), linkClicks, linkClicksMoM: pct(linkClicks, previous.linkClicks), followers, followersMoM: pct(followers, previous.followers), followerNet: previous.followers ? followers - previous.followers : 0, followerNetMoM: previous.followerNet != null ? pct(followers - previous.followers, previous.followerNet) : '比較不可',
    status: (views && reach) ? '取得済み' : '要確認', lastFetchedAt: now, reflected: false,
    confirmation: previous.views ? '前月比算出済み。最終採用は人間確認。' : '比較対象月なし/前月比は比較不可',
    analysis: `再生${views.toLocaleString('ja-JP')}、閲覧者${reach.toLocaleString('ja-JP')}、プロフ流入${profileAccess.toLocaleString('ja-JP')}、リンクタップ${linkClicks.toLocaleString('ja-JP')}。異常値・採用導線評価は人間承認待ち。`,
  };
  return { contentRows, monthlyRows: [monthlyRow] };
}
function demoInsights(payload) {
  return {
    profile: { username: payload.account || 'ascentbusiness_consulting', followers_count: 4698 },
    accountInsights: [
      { name: 'views', total_value: { value: 138400 } }, { name: 'reach', total_value: { value: 84200 } },
      { name: 'profile_views', total_value: { value: 3840 } }, { name: 'website_clicks', total_value: { value: 612 } },
    ],
    media: [
      { id: 'demo-reel-001', permalink: 'https://www.instagram.com/ascentbusiness_consulting/reel/demo1/', timestamp: `${payload.targetMonth}-12T09:00:00+0000`, media_product_type: 'REELS', caption: '仕事内容FAQ', like_count: 820, insights: { data: [{ name: 'views', values: [{ value: 24100 }] }, { name: 'reach', values: [{ value: 18600 }] }, { name: 'saved', values: [{ value: 336 }] }, { name: 'profile_visits', values: [{ value: 590 }] }, { name: 'link_clicks', values: [{ value: 86 }] }] } },
      { id: 'demo-reel-002', permalink: 'https://www.instagram.com/ascentbusiness_consulting/reel/demo2/', timestamp: `${payload.targetMonth}-18T09:00:00+0000`, media_product_type: 'REELS', caption: '若手社員の1日密着', like_count: 760, insights: { data: [{ name: 'views', values: [{ value: 21400 }] }, { name: 'reach', values: [{ value: 16800 }] }, { name: 'saved', values: [{ value: 220 }] }, { name: 'profile_visits', values: [{ value: 520 }] }] } },
    ],
  };
}
async function fetchInsights(payload) {
  const upstream = process.env.INSTAGRAM_INSIGHTS_UPSTREAM;
  if (!upstream) return { insights: demoInsights(payload), source: 'demo_db_only' };
  const url = new URL(upstream);
  url.searchParams.set('account', payload.account);
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.message || json.error || `instagram_http_${res.status}`);
  return { insights: json, source: json.source || 'meta_graph_api' };
}
function filterByType(rows, dataType) {
  if (dataType === 'content') return { contentRows: rows.contentRows, monthlyRows: [] };
  if (dataType === 'monthly') return { contentRows: [], monthlyRows: rows.monthlyRows };
  return rows;
}
async function runMonthlyReport(body = {}) {
  const check = validatePayload(body);
  const db = readDb();
  if (!check.ok) {
    const log = { action: 'monthly_report_validate', status: 'requires_confirmation', errors: check.errors, external_sent: false, sheet_write: null };
    addAudit(db, log); writeDb(db);
    return { ok: false, requires_confirmation: true, errors: check.errors, log, allowedColumns: { content: CONTENT_AI_COLUMNS, monthly: MONTHLY_AI_COLUMNS } };
  }
  const payload = { ...check.normalized, previousMonthly: body.previousMonthly || {} };
  const { insights, source } = await fetchInsights(payload);
  const rows = filterByType(buildRowsFromInsights(insights, payload), payload.dataType);
  db.monthly_report_rows = [...(rows.contentRows || []), ...(db.monthly_report_rows || [])].slice(0, 500);
  db.monthly_summary_rows = [...(rows.monthlyRows || []), ...(db.monthly_summary_rows || [])].slice(0, 120);
  const status = [...rows.contentRows, ...rows.monthlyRows].some((r) => r.status === '要確認') ? '要確認' : '取得済み';
  const log = {
    action: 'monthly_report_refresh', status, actor: sanitizeText(body.executor || 'Salieri'), target: `${payload.targetMonth} @${payload.account}`,
    item: payload.dataType, source, target_tab: payload.targetTab, rows: rows.contentRows.length + rows.monthlyRows.length,
    external_sent: false, sheet_write: { configured: configured(), spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || SHEET_ID, tabs: [payload.targetTab, LOG_TAB], mode: 'allowed_columns_only' },
  };
  try {
    const sheetLog = await appendMonthlyOperationLog([{ ...log, executedAt: nowIso(), pending: status === '要確認' ? '未取得/比較不可/人間承認待ちあり' : '人間承認待ち' }]);
    log.sheet_write = { ...log.sheet_write, log: sheetLog };
  } catch (e) { log.sheet_write = { ...log.sheet_write, error: e.message || String(e) }; }
  addAudit(db, log); writeDb(db);
  return { ok: true, status, requirementsSource: { spreadsheetId: SHEET_ID, tab: REQUIREMENTS_TAB }, allowedColumns: { human: HUMAN_COLUMNS, content: CONTENT_AI_COLUMNS, monthly: MONTHLY_AI_COLUMNS }, tabs: { content: CONTENT_TAB, monthly: MONTHLY_TAB, log: LOG_TAB }, ...rows, log };
}
function listMonthlyReport() {
  const db = readDb();
  return { ok: true, rows: db.monthly_report_rows || [], monthlyRows: db.monthly_summary_rows || [], logs: (db.audit_logs || []).filter((l) => String(l.action || '').startsWith('monthly_report')).slice(0, 20), statuses: STATUS, allowedColumns: { human: HUMAN_COLUMNS, content: CONTENT_AI_COLUMNS, monthly: MONTHLY_AI_COLUMNS }, tabs: { content: CONTENT_TAB, monthly: MONTHLY_TAB, log: LOG_TAB }, requirementsSource: { spreadsheetId: SHEET_ID, tab: REQUIREMENTS_TAB } };
}
module.exports = { STATUS, CONTENT_TAB, MONTHLY_TAB, LOG_TAB, REQUIREMENTS_TAB, validatePayload, buildRowsFromInsights, runMonthlyReport, listMonthlyReport };
