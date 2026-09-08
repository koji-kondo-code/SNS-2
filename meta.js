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
    range: sheetRange(tab, `A1:${String.fromCharCode(64 + headers.length)}1`),
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
    range: sheetRange(tab, `A2:${String.fromCharCode(64 + headers.length)}`),
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

module.exports = {
  configured,
  appendSalesProspects,
  appendCompetitorCandidates,
};
