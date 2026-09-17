const fs = require('fs');
const { google } = require('googleapis');

const SALES_HEADERS = [
  '記録日時', '会社名', 'Instagramアカウント', 'アカウントURL', '業種', '種別',
  '優先度', '規模適合', '連絡可能性', '営業角度', '確認ポイント', 'ステータス',
  '抽出元', '根拠メモ'
];
const CANDIDATE_HEADERS = [
  '記録日時', 'テーマ', 'アカウント', '投稿URL', '業種', '媒体', '投稿日',
  '再生数', 'いいね数', 'コメント数', 'バズスコア', 'AI分類', '転用案', 'ステータス'
];
const RESEARCH_CANDIDATE_HEADERS = [
  '取得日時', 'DiscordメッセージID', '実行者', '対象テーマ', '対象期間開始', '対象期間終了',
  '探索区分', '対象アカウント', '投稿URL', '投稿ID', '投稿日', '投稿種別', 'いいね数', 'コメント数',
  '再生数/表示回数', '保存数', 'シェア数', 'フォロワー数', '投稿本文/概要', 'AI抽出理由',
  '参考ポイント', 'リスク/注意点', '採用ステータス', '不採用理由分類', '不採用理由メモ', '次回抽出への反映要否'
];
const RESEARCH_LOG_HEADERS = [
  '実行者', '実行日時', 'DiscordメッセージID', 'Apify実行ID', '入力条件', '対象アカウント数',
  '取得投稿数', '出力件数', '条件一致件数', '未取得項目', 'エラー', '指定外探索理由', '不採用理由の反映内容'
];
const MONTHLY_OPERATION_LOG_HEADERS = [
  '実行日時', '依頼者', '実行種別', '対象月', '対象媒体', '対象アカウント', '対象データ種別',
  '対象タブ', '対象行', '作成件数', '更新件数', '未取得件数', 'エラー内容', '確認待ち事項',
  '最終取得日時', '取得ステータス', '最終ステータス'
];
const MONTHLY_CONTENT_HEADERS = [
  '対象アカウント', '投稿URL', '投稿ID', '投稿日', 'データ取得日', '投稿種別',
  '再生数', '閲覧者数', 'いいね数', '保存数', 'プロフアクセス数', 'リンクタップ数',
  '取得ステータス', '最終取得日時', '反映済みフラグ', '要確認事項', '分析コメント'
];
const MONTHLY_SUMMARY_HEADERS = [
  '対象月', '対象アカウント', '再生数', '再生数 前月比', '閲覧者数', '閲覧者数 前月比',
  'プロフ流入数', 'プロフ流入数 前月比', 'リンクタップ数', 'リンクタップ数 前月比',
  'フォロワー数', 'フォロワー数 前月比', 'フォロワー純増数', 'フォロワー純増数 前月比',
  '取得ステータス', '最終取得日時', '反映済みフラグ', '要確認事項', '分析コメント'
];

function parseJsonEnv(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}

function configured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
    (
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.GOOGLE_OAUTH_CLIENT_JSON && process.env.GOOGLE_OAUTH_TOKEN_JSON)
    )
  );
}

function serviceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return parseJsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  return null;
}

function oauthCredentials() {
  const clientJson = parseJsonEnv(process.env.GOOGLE_OAUTH_CLIENT_JSON);
  const tokenJson = parseJsonEnv(process.env.GOOGLE_OAUTH_TOKEN_JSON);
  if (!clientJson || !tokenJson) return null;
  const client = clientJson.installed || clientJson.web || clientJson;
  const oauth = new google.auth.OAuth2(client.client_id, client.client_secret, (client.redirect_uris || [])[0]);
  oauth.setCredentials(tokenJson);
  return oauth;
}

function columnName(index) {
  let n = Number(index);
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name || 'A';
}
function sheetRange(tab, a1) {
  const safe = String(tab).replace(/'/g, "''");
  return `'${safe}'!${a1}`;
}

async function sheetsClient() {
  const serviceAccount = serviceAccountCredentials();
  if (serviceAccount) {
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  }
  const oauth = oauthCredentials();
  if (oauth) return google.sheets({ version: 'v4', auth: oauth });
  throw new Error('google_sheets_credentials_not_configured');
}

async function ensureSheetExists(sheets, spreadsheetId, tab) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === tab);
  if (exists) return false;
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab } } }],
      },
    });
    return true;
  } catch (e) {
    if (String(e.message || '').includes('already exists')) return false;
    throw e;
  }
}

async function ensureHeader(sheets, spreadsheetId, tab, headers) {
  await ensureSheetExists(sheets, spreadsheetId, tab);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(tab, `A1:${columnName(headers.length)}1`),
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
}

async function appendValues(tab, headers, rows) {
  if (!configured()) return { configured: false, appendedRows: 0 };
  const values = rows.filter(Boolean);
  if (!values.length) return { configured: true, appendedRows: 0 };
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheets = await sheetsClient();
  await ensureHeader(sheets, spreadsheetId, tab, headers);
  const result = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetRange(tab, `A2:${columnName(headers.length)}`),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return {
    configured: true,
    spreadsheetId,
    tab,
    appendedRows: values.length,
    updatedRange: result.data?.updates?.updatedRange || null,
  };
}

function toText(v) { return v == null ? '' : String(v); }
function salesRows(prospects = [], at = new Date().toISOString()) {
  return prospects.map((p) => [
    at,
    toText(p.company),
    toText(p.account),
    toText(p.accountUrl),
    toText(p.industry),
    toText(p.kind || p.type),
    toText(p.priority),
    toText(p.sizeFit),
    toText(p.contactability),
    toText(p.angle),
    toText(p.gap),
    toText(p.status),
    toText(p.source),
    toText(p.sourceNote || p.snippet),
  ]);
}
function candidateRows(candidates = [], at = new Date().toISOString()) {
  return candidates.map((c) => [
    at,
    toText(c.theme || c.ai_topic),
    toText(c.account || c.username),
    toText(c.url || c.permalink),
    toText(c.industry),
    toText(c.media || c.media_type),
    toText(c.date || c.timestamp),
    toText(c.views),
    toText(c.like_count),
    toText(c.comments_count),
    toText(c.buzz_score),
    toText(c.ai_topic),
    toText(c.copy || c.reusable_idea),
    toText(c.status || c.candidate_status),
  ]);
}

async function appendSalesProspects(prospects, at) {
  return appendValues('05_営業候補アカウント', SALES_HEADERS, salesRows(prospects, at));
}
async function appendCompetitorCandidates(candidates, at) {
  return appendValues('企画候補履歴', CANDIDATE_HEADERS, candidateRows(candidates, at));
}
function researchCandidateRows(candidates = []) {
  return candidates.map((c) => {
    const [periodStart = '', periodEnd = ''] = String(c.period || '').split('〜');
    return [
      toText(c.fetchedAt), toText(c.discordMessageId), toText(c.executor || c.executedBy || 'Salieri'),
      toText(c.theme), toText(c.periodStart || periodStart), toText(c.periodEnd || periodEnd),
      toText(c.searchScope), toText(c.account), toText(c.postUrl), toText(c.postId), toText(c.postedAt), toText(c.postType),
      toText(c.likes), toText(c.comments), toText(c.views), toText(c.saves), toText(c.shares || '取得不可'),
      toText(c.followers || '取得不可'), toText(c.caption || c.summary || ''), toText(c.aiReason),
      toText(c.referencePoint || '冒頭フック、企画構成、CTA、コメント反応を人間確認して自社投稿への転用可否を判断'),
      toText(c.riskNote), toText(c.adoptionStatus), toText(c.rejectCategory), toText(c.rejectMemo), toText(c.reflectNext),
    ];
  });
}
function researchLogRows(logs = []) {
  return logs.map((l) => [
    toText(l.executor), toText(l.executedAt), toText(l.discordMessageId), toText(l.apifyRunId), toText(l.inputConditions),
    toText(l.accountCount), toText(l.fetchedCount), toText(l.outputCount), toText(l.matchedCount), toText(l.missingFields),
    toText(l.error), toText(l.externalSearchReason), toText(l.rejectedLearning),
  ]);
}
function monthlyOperationLogRows(logs = []) {
  return logs.map((l) => [
    toText(l.executedAt || l.at), toText(l.actor), toText(l.action || 'monthly_report_refresh'),
    toText(String(l.target || '').split(' ')[0]), 'Instagram', toText(String(l.target || '').split(' ')[1] || ''),
    toText(l.item), toText(l.target_tab), toText(l.rows), toText(l.rows), toText(l.rows),
    toText(l.status === '要確認' ? l.rows : 0), toText(l.error || l.sheet_write?.error || ''),
    toText(l.pending || l.confirmation || ''), toText(l.executedAt || l.at), toText(l.status), toText(l.status),
  ]);
}
function monthlyContentRows(rows = []) {
  return rows.map((r) => [
    toText(r.account), toText(r.postUrl), toText(r.postId), toText(r.postedAt), toText(r.fetchDate), toText(r.postType),
    toText(r.views), toText(r.reach), toText(r.likes), toText(r.saves), toText(r.profileAccess), toText(r.linkClicks),
    toText(r.status), toText(r.lastFetchedAt), toText(r.reflected ? 'TRUE' : 'FALSE'), toText(r.confirmation), toText(r.analysis),
  ]);
}
function monthlySummaryRows(rows = []) {
  return rows.map((r) => [
    toText(r.targetMonth), toText(r.account), toText(r.views), toText(r.viewsMoM), toText(r.reach), toText(r.reachMoM),
    toText(r.profileAccess), toText(r.profileAccessMoM), toText(r.linkClicks), toText(r.linkClicksMoM),
    toText(r.followers), toText(r.followersMoM), toText(r.followerNet), toText(r.followerNetMoM),
    toText(r.status), toText(r.lastFetchedAt), toText(r.reflected ? 'TRUE' : 'FALSE'), toText(r.confirmation), toText(r.analysis),
  ]);
}
async function appendResearchCandidates(candidates) {
  return appendValues('リサーチ候補一覧', RESEARCH_CANDIDATE_HEADERS, researchCandidateRows(candidates));
}
async function appendResearchLogs(logs) {
  return appendValues('運用ログ', RESEARCH_LOG_HEADERS, researchLogRows(logs));
}
async function appendMonthlyContentRows(rows) {
  return appendValues('月次レポート_コンテンツ別', MONTHLY_CONTENT_HEADERS, monthlyContentRows(rows));
}
async function appendMonthlySummaryRows(rows) {
  return appendValues('月次レポート_月次全体', MONTHLY_SUMMARY_HEADERS, monthlySummaryRows(rows));
}
async function appendMonthlyOperationLog(logs) {
  return appendValues('運用ログ', MONTHLY_OPERATION_LOG_HEADERS, monthlyOperationLogRows(logs));
}

module.exports = {
  configured,
  columnName,
  appendSalesProspects,
  appendCompetitorCandidates,
  appendResearchCandidates,
  appendResearchLogs,
  appendMonthlyContentRows,
  appendMonthlySummaryRows,
  appendMonthlyOperationLog,
};
