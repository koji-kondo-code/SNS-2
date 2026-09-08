const fs = require('fs');
const path = require('path');

const writableBaseDir = process.env.SNS_RUNTIME_DATA_DIR
  || (process.env.VERCEL ? '/tmp/sns-agent-runtime' : path.join(process.cwd(), 'data'));
const dbFile = path.join(writableBaseDir, 'sns-runtime-db.json');

function nowIso() { return new Date().toISOString(); }
function ensureDir() { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); }
function normalizeAccount(v = '') {
  return String(v || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .toLowerCase();
}
function defaultDb() {
  return {
    version: 1,
    updatedAt: nowIso(),
    sales_prospects: [],
    sales_exported_accounts: [],
    sales_runs: [],
    alerts: [],
    audit_logs: [],
    scheduler: {
      enabled: true,
      timezone: 'Asia/Tokyo',
      cronLabel: '毎朝 08:00',
      targetHourJst: 8,
      targetMinuteJst: 0,
      mode: 'scheduled',
      industry: 'all',
      limit: 20,
      destination: 'DB + Sheets（未接続時はDBに保存してSheets待機）',
      alertPolicy: '抽出失敗・Sheets保存失敗・0件継続時に管理者アラートへ記録',
      lastRunAt: null,
      nextRunAt: nextMorningJstIso(),
      lastStatus: 'not_run',
      lastNewCount: 0,
      lastError: null,
    },
  };
}
function readDb() {
  try {
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    return { ...defaultDb(), ...db, scheduler: { ...defaultDb().scheduler, ...(db.scheduler || {}) } };
  } catch (e) {
    return defaultDb();
  }
}
function writeDb(db) {
  ensureDir();
  const out = { ...db, updatedAt: nowIso() };
  fs.writeFileSync(dbFile, JSON.stringify(out, null, 2));
  return out;
}
function addAudit(db, log) {
  db.audit_logs = [{ at: nowIso(), external_ai_used: false, external_sent: false, ...log }, ...(db.audit_logs || [])].slice(0, 500);
}
function addAlert(db, alert) {
  db.alerts = [{ id: `alert_${Date.now()}`, at: nowIso(), status: 'open', ...alert }, ...(db.alerts || [])].slice(0, 100);
}
function mergeProspects(db, rows = [], meta = {}) {
  const existingKeys = new Set((db.sales_prospects || []).map((p) => normalizeAccount(p.account || p.accountUrl || p.company)));
  const exportedKeys = new Set((db.sales_exported_accounts || []).map(normalizeAccount));
  const newRows = [];
  for (const row of rows) {
    const key = normalizeAccount(row.account || row.accountUrl || row.company);
    if (!key || existingKeys.has(key) || exportedKeys.has(key)) continue;
    const saved = {
      ...row,
      account: row.account || `@${key}`,
      dedupeKey: key,
      firstSeenAt: meta.runAt || nowIso(),
      lastSeenAt: meta.runAt || nowIso(),
      storage: 'server-db',
      displayStatus: 'new_only',
    };
    db.sales_prospects.unshift(saved);
    existingKeys.add(key);
    newRows.push(saved);
  }
  db.sales_prospects = (db.sales_prospects || []).slice(0, 1000);
  return newRows;
}
function markExported(db, rows = []) {
  const keys = rows.map((p) => normalizeAccount(p.account || p.accountUrl || p.company)).filter(Boolean);
  db.sales_exported_accounts = [...new Set([...(db.sales_exported_accounts || []).map(normalizeAccount), ...keys])].filter(Boolean).slice(-2000);
  return keys;
}
function listNewProspects(db, limit = 80) {
  const exported = new Set((db.sales_exported_accounts || []).map(normalizeAccount));
  return (db.sales_prospects || []).filter((p) => !exported.has(normalizeAccount(p.account || p.accountUrl || p.company))).slice(0, limit);
}
function nextMorningJstIso(from = new Date()) {
  const jstNow = new Date(from.getTime() + 9 * 60 * 60 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  let nextJst = new Date(Date.UTC(y, m, d, 8, 0, 0));
  if (jstNow >= nextJst) nextJst = new Date(Date.UTC(y, m, d + 1, 8, 0, 0));
  return new Date(nextJst.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  dbFile,
  nowIso,
  normalizeAccount,
  readDb,
  writeDb,
  addAudit,
  addAlert,
  mergeProspects,
  markExported,
  listNewProspects,
  nextMorningJstIso,
};
