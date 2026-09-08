const { json } = require('../lib/meta');
const { runMonthlyReport, listMonthlyReport } = require('../lib/monthly-report');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') return json(res, 200, await runMonthlyReport(req.body || {}));
    return json(res, 200, listMonthlyReport());
  } catch (e) {
    return json(res, 500, { ok: false, error: 'monthly_report_failed', message: e.message || String(e) });
  }
};
