const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const root = __dirname;
const routes = {
  '/api/state': require('./api/state'),
  '/api/apify/status': require('./api/apify/status'),
  '/api/sales/discover': require('./lib/sales/discover'),
  '/api/sales/apify-discover': require('./lib/sales/apify-discover'),
  '/api/sales/extract-hybrid': require('./lib/sales/extract-hybrid'),
  '/api/sales/scheduler': require('./lib/sales/scheduler'),
  '/api/sales/export-sheets': require('./lib/sales/export-sheets'),
  '/api/instagram-insights': require('./api/instagram-insights'),
  '/api/competitor/apify-buzz': require('./api/competitor/apify-buzz'),
  '/api/competitor/weekly-research': require('./api/competitor/weekly-research'),
  '/api/research/semiauto': require('./api/research/semiauto'),
  '/api/monthly-report': require('./api/monthly-report'),
  '/api/ops/health': require('./api/ops/health'),
  '/api/competitor-candidates': require('./api/competitor-candidates'),
  '/api/plans': require('./api/plans'),
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (routes[u.pathname]) {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', async () => {
      req.query = Object.fromEntries(u.searchParams.entries());
      if (raw) {
        try { req.body = JSON.parse(raw); } catch (e) { req.body = raw; }
      }
      res.status = (code) => { res.statusCode = code; return res; };
      try { await routes[u.pathname](req, res); }
      catch (e) { send(res, 500, JSON.stringify({ ok:false, error:e.message || String(e) }), 'application/json; charset=utf-8'); }
    });
    return;
  }
  let file = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, '');
  file = path.normalize(file).replace(/^\.\.(\/|$)/, '');
  let full = path.join(root, file);
  if (full.startsWith(root) && fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    full = path.join(full, 'index.html');
  }
  if (!full.startsWith(root) || !fs.existsSync(full)) return send(res, 404, 'Not found');
  send(res, 200, fs.readFileSync(full), mime(full));
});

const port = Number(process.env.PORT || 4188);
server.listen(port, '::', () => console.log(`SNS demo server listening on ${port}`));
