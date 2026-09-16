const { runAndSave } = require('../lib/competitor/weekly-research');

runAndSave({ theme: '業界別リールバズ分析', limit: 74, executor: 'system:weekly-worker' })
  .then((result) => { console.log(JSON.stringify(result, null, 2)); })
  .catch((err) => { console.error(err); process.exit(1); });
