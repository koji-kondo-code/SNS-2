const { json } = require('../_meta');
const { readDb, writeDb, markExported, addAudit } = require('../runtime-store');
const { configured: sheetsConfigured, appendSalesProspects } = require('../google-sheets');


module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}
  const rows = Array.isArray(body.prospects) ? body.prospects : [];
  const db = readDb();
  let sheetResult = { configured: false, appendedRows: 0 };
  if (sheetsConfigured() && rows.length) {
    try {
      sheetResult = await appendSalesProspects(rows);
    } catch (e) {
      const sheet_write = {
        tab: '05_営業候補アカウント',
        updatedRows: 0,
        verified: false,
        spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
        error: e.message || String(e),
        note: 'Google Sheets書き込みに失敗したため、DB側の既読/出力済み化は行っていません。サービスアカウント共有・Sheets API・環境変数を確認してください。',
      };
      addAudit(db, { action: 'sales_prospects_sheet_export', rows: rows.length, status: 'failed', sheet_write, external_ai_used: false, external_sent: false });
      writeDb(db);
      return json(res, 500, { ok: false, error: 'sheets_append_failed', sheet_write });
    }
  }
  const keys = markExported(db, rows);
  const sheet_write = {
    tab: '05_営業候補アカウント',
    updatedRows: sheetResult.appendedRows || rows.length,
    verified: Boolean(sheetResult.configured),
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
    updatedRange: sheetResult.updatedRange || null,
    note: sheetResult.configured
      ? 'Google Sheetsへ追記しました。DM送信は行いません。'
      : 'Sheets連携未設定のため、DBで受信・重複履歴を保存しました。連携後に同じ行をSheetsへ反映できます。DM送信は行いません。',
  };
  addAudit(db, {
    action: 'sales_prospects_sheet_export',
    status: sheetResult.configured ? 'sheets_appended' : 'db_only',
    rows: rows.length,
    sheet_write,
    external_ai_used: false,
    external_sent: false,
  });
  writeDb(db);
  return json(res, 200, {
    ok: true,
    sheet_write,
    sales_exported_accounts: keys,
    state: {
      sales_exported_accounts: db.sales_exported_accounts,
      audit_logs: db.audit_logs,
      sales_scheduler: db.scheduler,
      alerts: db.alerts,
    },
  });
};
