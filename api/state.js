const { json } = require('../lib/meta');
const { readDb, listNewProspects } = require('../lib/runtime-store');

module.exports = async function handler(req, res) {
  const db = readDb();
  return json(res, 200, {
    ok: true,
    audit_logs: [
      ...((db.audit_logs || []).slice(0, 300)),
      {
        at: new Date().toISOString(),
        action: 'meta_api_runtime_ready',
        status: 'ready',
        external_ai_used: false,
        external_sent: false,
        sheet_write: null,
      },
    ],
    sales_exported_accounts: db.sales_exported_accounts || [],
    sales_scheduler: db.scheduler,
    sales_new_prospects: listNewProspects(db, 80),
    sales_runs: (db.sales_runs || []).slice(0, 20),
    alerts: (db.alerts || []).slice(0, 50),
    research_candidates: (db.research_candidates || []).slice(0, 100),
    research_runs: (db.research_runs || []).slice(0, 20),
  });
};
