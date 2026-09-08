const handlers = {
  'discover': require('../../lib/sales/discover'),
  'apify-discover': require('../../lib/sales/apify-discover'),
  'extract-hybrid': require('../../lib/sales/extract-hybrid'),
  'scheduler': require('../../lib/sales/scheduler'),
  'export-sheets': require('../../lib/sales/export-sheets'),
};
const { json } = require('../../lib/meta');

module.exports = async function handler(req, res) {
  const endpoint = Array.isArray(req.query?.endpoint) ? req.query.endpoint[0] : req.query?.endpoint;
  const fn = handlers[endpoint];
  if (!fn) return json(res, 404, { ok: false, error: 'sales_endpoint_not_found', endpoint });
  return fn(req, res);
};
