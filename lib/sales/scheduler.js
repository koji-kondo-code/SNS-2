const { json } = require('../meta');
const discoverHandler = require('./discover');
const apifyDiscoverHandler = require('./apify-discover');
const {
  readDb,
  writeDb,
  addAudit,
  addAlert,
  mergeProspects,
  markExported,
  listNewProspects,
  nextMorningJstIso,
  nowIso,
} = require('../runtime-store');

function captureJsonHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(body) {
        try { resolve({ statusCode: this.statusCode, body: JSON.parse(body || '{}') }); }
        catch (e) { reject(e); }
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const { configured: sheetsConfigured, appendSalesProspects } = require('../google-sheets');

async function runMorningDiscovery(options = {}) {
  const db = readDb();
  const runAt = nowIso();
  const industry = options.industry || db.scheduler.industry || 'all';
  const limit = Math.max(1, Math.min(50, Number(options.limit || db.scheduler.dailySalesLimit || db.scheduler.limit || 32)));
  const run = { id: `sales_run_${Date.now()}`, runAt, mode: 'scheduled', industry, limit, status: 'running', newCount: 0 };
  db.sales_runs = [run, ...(db.sales_runs || [])].slice(0, 100);
  db.scheduler.lastRunAt = runAt;
  db.scheduler.lastStatus = 'running';
  db.scheduler.lastError = null;
  writeDb(db);

  try {
    let captured = await captureJsonHandler(apifyDiscoverHandler, {
      method: 'POST',
      body: { keyword: options.keyword || '採用', industry, limit, criteria: options.criteria || null },
      query: {},
      headers: {},
    });
    let primarySource = 'apify';
    let apifyError = null;
    if (captured.statusCode >= 400 || !captured.body.ok || !(captured.body.prospects || []).length) {
      apifyError = captured.body?.message || captured.body?.error || null;
      captured = await captureJsonHandler(discoverHandler, {
        method: 'POST',
        body: { mode: 'scheduled', industry, limit, criteria: options.criteria || null },
        query: {},
        headers: {},
      });
      primarySource = 'live_web_search_fallback';
    }
    if (captured.statusCode >= 400 || !captured.body.ok) throw new Error(captured.body.detail || captured.body.error || 'discover_failed');
    const fresh = mergeProspects(db, captured.body.prospects || [], { runAt });
    run.primarySource = primarySource;
    run.apifyError = apifyError;
    let sheetAppend = { configured: false, appendedRows: 0 };
    if (sheetsConfigured() && fresh.length) {
      sheetAppend = await appendSalesProspects(fresh, runAt);
    }
    const exportedKeys = sheetAppend.configured ? markExported(db, fresh) : [];
    const sheetWrite = {
      tab: '05_営業候補アカウント',
      updatedRows: sheetAppend.appendedRows || fresh.length,
      verified: Boolean(sheetAppend.configured),
      storage: sheetAppend.configured ? 'google-sheets' : 'server-db',
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
      updatedRange: sheetAppend.updatedRange || null,
      note: sheetAppend.configured
        ? 'Google Sheetsへ追記しました。'
        : 'Sheets連携未設定のため、DBへ保存しSheets出力待ちとして保持。連携後は同じdedupeKeyで追記可能。',
    };
    run.status = 'success';
    run.newCount = fresh.length;
    run.totalFetched = (captured.body.prospects || []).length;
    run.sheet_write = sheetWrite;
    db.scheduler.lastStatus = 'success';
    db.scheduler.lastNewCount = fresh.length;
    db.scheduler.nextRunAt = nextMorningJstIso();
    addAudit(db, {
      action: 'sales_morning_auto_discovery',
      status: 'success',
      rows: fresh.length,
      fetchedRows: run.totalFetched,
      sheet_write: sheetWrite,
      external_sent: false,
    });
    if (fresh.length === 0) {
      addAlert(db, {
        level: 'warning',
        title: '営業候補の新規抽出が0件でした',
        message: '検索元ブロックまたは重複のみの可能性があります。キャッシュ/業界キーワード/Sheets履歴を確認してください。',
        runId: run.id,
      });
    }
    writeDb(db);
    return { ok: true, run, newProspects: fresh, exportedKeys, sheet_write: sheetWrite, scheduler: db.scheduler };
  } catch (e) {
    run.status = 'failed';
    run.error = e.message || String(e);
    db.scheduler.lastStatus = 'failed';
    db.scheduler.lastError = run.error;
    db.scheduler.nextRunAt = nextMorningJstIso();
    addAudit(db, { action: 'sales_morning_auto_discovery', status: 'failed', error: run.error, external_sent: false });
    addAlert(db, { level: 'critical', title: '毎朝の営業候補自動抽出に失敗', message: run.error, runId: run.id });
    writeDb(db);
    return { ok: false, error: 'scheduled_discovery_failed', detail: run.error, run, scheduler: db.scheduler };
  }
}

module.exports = async function handler(req, res) {
  const method = req.method || 'GET';
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}
  const db = readDb();
  if (method === 'GET') {
    return json(res, 200, {
      ok: true,
      scheduler: db.scheduler,
      newProspects: listNewProspects(db, 80),
      recentRuns: (db.sales_runs || []).slice(0, 10),
      alerts: (db.alerts || []).slice(0, 20),
      sheetReady: sheetsConfigured(),
      note: '毎朝8:00 JSTの自動実行を想定。ローカル/デモでは「今すぐ定期抽出を実行」で同じ処理を検証できます。',
    });
  }
  if (method === 'POST') {
    const action = String(body.action || 'run');
    if (action === 'run') {
      const result = await runMorningDiscovery(body);
      return json(res, result.ok ? 200 : 500, result);
    }
    if (action === 'ack_alerts') {
      db.alerts = (db.alerts || []).map((a) => ({ ...a, status: 'acknowledged', acknowledgedAt: nowIso() }));
      writeDb(db);
      return json(res, 200, { ok: true, alerts: db.alerts });
    }
  }
  return json(res, 405, { ok: false, error: 'method_not_allowed' });
};

module.exports.runMorningDiscovery = runMorningDiscovery;
