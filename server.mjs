import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configuration, hestiaRead, websites } from './hestia.mjs';
import { InstallManager, installConfiguration } from './install.mjs';

export function createServer(env = process.env, fetcher = fetch, managerOptions = {}) {
  const port = Number(env.PORT || 4317);
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const csrf=randomBytes(32).toString('hex');
  let installer;
  function setup() {
    const config=configuration(env);const install=installConfiguration(env);
    if(install && !config) throw new Error('Configure the Hestia connection before enabling installation.');
    if(config && install && !installer) installer=new InstallManager({config,install,dir:env.HEARTH_DATA_DIR || path.join(fileURLToPath(new URL('.',import.meta.url)),'.hearth','installations'),fetcher,...managerOptions});
    return {config,install,installer};
  }
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
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method==='POST' && pathname==='/api/installations') {
        if(req.headers['x-hearth-token']!==csrf) return send(403,{error:'Refresh Hearth before starting installation.'});
        if(req.headers['content-type']?.split(';')[0].trim()!=='application/json') return send(415,{error:'Use JSON for installation requests.'});
        const {installer}=setup();
        if(!installer) return send(409,{error:'Enable installation in the local server settings first.'});
        let body='';
        for await(const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>16384)return send(413,{error:'Installation request is too large.'});}
        let input;try{input=JSON.parse(body);}catch{return send(400,{error:'Invalid installation request.'});}
        try {return send(202,await installer.start(input));} catch(e){return send(409,{error:e.message});}
      }
      if (req.method !== 'GET') return send(405, { error: 'This action is not supported.' });
      if (pathname === '/api/status') {
        let settings;
        try { settings=setup(); } catch(e) {return send(200,{mode:'error',message:e.message});}
        const {config,install}=settings;
        return send(200,{mode:config?'live':'demo',panel:config?.panel||null,user:config?.user||null,installEnabled:!!install,siteIp:install?.ip||null,csrf:install?csrf:null});
      }
      if(pathname==='/api/installations') {
        const {installer}=setup();
        return installer?send(200,{jobs:await installer.list()}):send(200,{jobs:[]});
      }
      if (['/api/check', '/api/sites', '/api/backups'].includes(pathname)) {
        const {config,installer}=setup();
        if (!config) return send(409, { error: 'No Hestia server is configured. You can explore the demo wizard.' });
        const command = pathname === '/api/backups' ? 'v-list-user-backups' : 'v-list-web-domains';
        const data = await hestiaRead(config, command, fetcher);
        if (pathname === '/api/check') return send(200, { connected: true, message: 'Connected. Website list permission verified. Installation permissions are checked as each operation runs.' });
        if(pathname==='/api/sites') {
          const jobs=installer?await installer.list():[];
          const sites=websites(data).map(site=>{
            const job=jobs.find(j=>j.domain===site.domain && j.state==='complete');
            return job?{...site,title:job.title,wordpress:true,adminUrl:job.adminUrl}:site;
          });
          return send(200,{sites});
        }
        return send(200,{backups:Object.keys(data)});
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
  const server=createServer();
  server.on('error',()=>{console.error('Hearth could not open its local port. Check that another copy is not already running.');process.exitCode=1;});
  server.listen(port, '127.0.0.1', () => console.log(`Hearth is ready at http://localhost:${port}`));
}
