const { runMorningDiscovery } = require('../lib/sales/scheduler');

runMorningDiscovery({ mode: 'scheduled', industry: 'all', limit: 32, executor: 'system:daily-worker' })
  .then((result) => { console.log(JSON.stringify(result, null, 2)); })
  .catch((err) => { console.error(err); process.exit(1); });
