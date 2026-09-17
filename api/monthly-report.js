const { json } = require('../lib/meta');
const { runMonthlyReport, runScheduledMonthlyReports, listMonthlyReport } = require('../lib/monthly-report');

function isAuthorizedCron(req) {
  if (req.headers?.['x-vercel-cron']) return true;
  if (!process.env.CRON_SECRET) return false;
  const header = String(req.headers?.authorization || '');
  const querySecret = String(req.query?.secret || '');
  return header === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') return json(res, 200, await runMonthlyReport(req.body || {}));
    if (req.method === 'GET' && (req.query?.cron || req.headers?.['x-vercel-cron'])) {
      if (!isAuthorizedCron(req)) return json(res, 401, { ok: false, error: 'cron_unauthorized' });
      const kind = String(req.query?.cron || 'auto');
      if (!['daily', 'monthly', 'auto'].includes(kind)) return json(res, 400, { ok: false, error: 'invalid_cron_kind' });
      if (kind !== 'auto') return json(res, 200, await runScheduledMonthlyReports(kind));
      const daily = await runScheduledMonthlyReports('daily');
      const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const monthly = nowJst.getUTCDate() === 1 ? await runScheduledMonthlyReports('monthly') : null;
      return json(res, 200, { ok: daily.ok && (!monthly || monthly.ok), kind: 'auto', daily, monthly });
    }
    return json(res, 200, listMonthlyReport());
  } catch (e) {
    return json(res, 500, { ok: false, error: 'monthly_report_failed', message: e.message || String(e) });
  }
};
