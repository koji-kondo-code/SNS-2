const handler = require('../api/ops/health');

const res = {
  statusCode: 200,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(code) { this.statusCode = code; return this; },
  end(body) {
    if (body) console.log(body);
    if (this.statusCode >= 400) process.exitCode = 1;
  },
};

Promise.resolve(handler({ method: 'GET', query: {} }, res)).catch((err) => {
  console.error(err);
  process.exit(1);
});
