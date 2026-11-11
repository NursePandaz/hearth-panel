import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { configuration, hestiaRead, websites } from './hestia.mjs';

export function createServer(env = process.env, fetcher = fetch) {
  const port = Number(env.PORT || 4317);
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    function send(status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
    if (!allowedHosts.has(req.headers.host)) return send(403, { error: 'Open Hearth using its localhost address.' });
    if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return send(403, { error: 'Cross-origin requests are not allowed.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Cross-site requests are not allowed.' });
    if (req.method !== 'GET') return send(405, { error: 'This preview is read-only. Live installation is not enabled.' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (pathname === '/api/status') {
        let config;
        try { config = configuration(env); } catch (e) { return send(200, { mode: 'error', message: e.message }); }
        return send(200, { mode: config ? 'live' : 'demo', panel: config?.panel || null, user: config?.user || null });
      }
      if (['/api/check', '/api/sites', '/api/backups'].includes(pathname)) {
        const config = configuration(env);
        if (!config) return send(409, { error: 'No Hestia server is configured. You can explore the demo wizard.' });
        const command = pathname === '/api/backups' ? 'v-list-user-backups' : 'v-list-web-domains';
        const data = await hestiaRead(config, command, fetcher);
        if (pathname === '/api/check') return send(200, { connected: true, message: 'Connected. Website list permission verified. Installation permissions have not been checked.' });
        return send(200, pathname === '/api/sites' ? { sites: websites(data) } : { backups: Object.keys(data) });
      }
      const file = files.get(pathname);
      if (!file) return send(404, { error: 'Not found' });
      const content = await readFile(new URL(`public/${file[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(content);
    } catch (e) { send(502, { error: e.message || 'The request could not be completed.' }); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  createServer().listen(port, '127.0.0.1', () => console.log(`Hearth is ready at http://localhost:${port}`));
}
