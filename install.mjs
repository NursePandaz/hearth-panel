import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { hestiaRead, hestiaCommand } from './hestia.mjs';

export function installConfiguration(env) {
  if (env.HEARTH_INSTALL_ENABLED !== 'true') return null;
  if (isIP(env.HESTIA_SITE_IP || '') !== 4) throw new Error('Set HESTIA_SITE_IP to the Hestia website server’s IPv4 address.');
  if (!/^8\.[0-9]+$/.test(env.HESTIA_PHP_VERSION || '')) throw new Error('Set HESTIA_PHP_VERSION to an installed WordPress-compatible PHP version, such as 8.3.');
  return { ip:env.HESTIA_SITE_IP, php:env.HESTIA_PHP_VERSION };
}
export function validateInstall(value) {
  const out={};
  for (const k of ['domain','title','email','username','password','requestId']) {
    if (typeof value?.[k] !== 'string') throw new Error('Complete the website and login details.');
    out[k]=k==='password'?value[k]:value[k].trim();
  }
  out.domain=out.domain.toLowerCase();
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(out.domain) || /\.(localhost|local|internal|test|invalid|example)$/.test(out.domain)) throw new Error('Enter a public domain name without a URL path.');
  if (!out.title || out.title.length>100 || /[\x00-\x1f\x7f]/.test(out.title)) throw new Error('Use a website name between 1 and 100 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email) || out.email.length>253) throw new Error('Enter a valid administrator email.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]{2,59}$/.test(out.username)) throw new Error('Use a username of 3–60 letters, numbers, dots, dashes, underscores, or @.');
  if (out.password.length<12 || out.password.length>128 || /[\x00-\x1f\x7f]/.test(out.password) || out.password.trim()!==out.password) throw new Error('Use a password of 12–128 characters without leading or trailing spaces or control characters.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(out.requestId)) throw new Error('Refresh the wizard and try again.');
  out.backup=value.backup===true;
  return out;
}
async function answers(query, domain) {
  try { return await query(domain); } catch(e) { if (['ENODATA','ENOTFOUND'].includes(e.code)) return []; throw new Error('DNS could not be checked. Try again once your DNS provider is responding.'); }
}
export async function checkDns(domain, ip, resolver={resolve4,resolve6}) {
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS check timed out. Please try again.')),10000);});
  try {
    const [a,aaaa]=await Promise.race([Promise.all([answers(resolver.resolve4,domain),answers(resolver.resolve6,domain)]),deadline]);
    return { ready:a.length>0 && a.every(x=>x===ip) && aaaa.length===0, ipv4:a, ipv6:aaaa, expected:ip };
  } finally { clearTimeout(timer); }
}
// Pin HTTPS to the configured Hestia site IP. DNS changes cannot redirect this
// verification to another machine. TLS still validates the domain certificate.
export function siteRequest(domain, ip, pathname) {
  return new Promise((resolve,reject)=>{
    const req=https.get({hostname:domain,servername:domain,path:pathname,port:443,family:4,agent:false,lookup:(_host,_options,cb)=>cb(null,ip,4),timeout:15000,headers:{'User-Agent':'Hearth/0.2','Accept':pathname.startsWith('/?rest_route=')?'application/json':'text/html'}},res=>{
      let size=0; const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)res.destroy(new Error('Response too large'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('timeout',()=>req.destroy(new Error('Timed out'))); req.on('error',reject);
  });
}
export async function verifyWordPress(domain,ip,title,request=siteRequest) {
  const [home,rest,login]=await Promise.all([request(domain,ip,'/'),request(domain,ip,'/?rest_route=/'),request(domain,ip,'/wp-login.php')]);
  let data; try {data=JSON.parse(rest.body);}catch{throw new Error('WordPress is not returning its API yet.');}
  if (home.status!==200 || rest.status!==200 || login.status!==200 || !data.namespaces?.includes('wp/v2') || !/id=["']loginform["']/.test(login.body)) throw new Error('WordPress or its login page could not be verified.');
  let canonical;try{canonical=new URL(data.url);}catch{throw new Error('WordPress has no valid site address.');}
  if (canonical.origin!==`https://${domain}` || data.name!==title) throw new Error('WordPress returned different website settings. Inspect the site in Hestia.');
  return {url:`https://${domain}`,adminUrl:`https://${domain}/wp-admin/`};
}

const activeStates=new Set(['queued','running']);
export class InstallManager {
  constructor({config,install,dir,fetcher=fetch,dns=checkDns,verify=verifyWordPress,tls=siteRequest}) {
    Object.assign(this,{config,install,dir,fetcher,dns,verify,tls});
    this.jobs=new Map();this.locks=new Set();this.ready=this.load();this.ready.catch(()=>{});
  }
  async load() {
    await mkdir(this.dir,{recursive:true,mode:0o700});
    for (const filename of await readdir(this.dir)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(filename)) continue;
      const job=JSON.parse(await readFile(path.join(this.dir,filename),'utf8'));
      if (!job || filename!==`${job.id}.json` || typeof job.domain!=='string') throw new Error('An installation record is invalid. Inspect Hearth’s local data folder.');
      // Records are bound to the original Hestia server/account. Never adopt a
      // partially completed domain on a different configured destination.
      if(activeStates.has(job.state)) {job.state='needs_review';job.message='Hearth restarted during setup. Inspect the site in Hestia before taking further action.';await this.save(job);}
      this.jobs.set(job.id,job);
    }
  }
  async save(job) {
    job.updatedAt=new Date().toISOString();
    const tmp=path.join(this.dir,`${job.id}.${randomUUID()}.tmp`);
    await writeFile(tmp,JSON.stringify(job),{mode:0o600,flag:'wx'});
    await rename(tmp,path.join(this.dir,`${job.id}.json`));
  }
  async change(job,values) {Object.assign(job,values);await this.save(job);}
  destination() {return `${this.config.panel}|${this.config.user}|${this.install.ip}`;}
  view(job) {
    const {id,domain,title,username,email,backup,state,stage,message,createdAt,updatedAt,url,adminUrl,dns}=job;
    return {id,domain,title,username,email,backup,state,stage,message,createdAt,updatedAt,url,adminUrl,dns};
  }
  async list() {await this.ready;return [...this.jobs.values()].filter(j=>j.destination===this.destination()).map(j=>this.view(j));}
  async start(input) {
    await this.ready;
    const details=validateInstall(input);
    const existing=this.jobs.get(details.requestId);
    if(existing) {
      if(existing.destination!==this.destination() || existing.domain!==details.domain || existing.title!==details.title || existing.username!==details.username || existing.email!==details.email) throw new Error('This setup identifier belongs to different website details.');
      if(existing.state!=='waiting_dns') return this.view(existing);
    }
    if(this.locks.has(details.domain)) throw new Error('This domain already has a setup in progress.');
    const other=[...this.jobs.values()].find(j=>j.destination===this.destination() && j.domain===details.domain && j.id!==details.requestId);
    if(other) throw new Error('This domain already has an installation record. Open its progress instead of starting again.');
    this.locks.add(details.domain);
    try {
      const job=existing || {id:details.requestId,domain:details.domain,title:details.title,username:details.username,email:details.email,backup:details.backup,destination:this.destination(),state:'queued',stage:'dns',message:'Checking domain connection.',createdAt:new Date().toISOString()};
      job.state='queued';job.stage='dns';job.message='Checking domain connection.';this.jobs.set(job.id,job);await this.save(job);
      // Return immediately; the long-running Hestia requests continue server-side.
      // Only non-secret progress is written to disk.
      this.run(job,details).catch(()=>{}).finally(()=>this.locks.delete(details.domain));
      return this.view(job);
    } catch(e) {this.locks.delete(details.domain);if(!existing)this.jobs.delete(details.requestId);throw e;}
  }
  async run(job,details) {
    let mutationStarted=false;
    try {
      await this.change(job,{state:'running',stage:'dns',message:'Checking that your domain points to this server.'});
      const dns=await this.dns(details.domain,this.install.ip);
      if(!dns.ready) {await this.change(job,{state:'waiting_dns',dns,message:`Point your domain’s A record to ${this.install.ip}, remove conflicting A/AAAA records, and turn off any DNS proxy. Then try again. No server changes were made.`});return;}
      await this.change(job,{dns,stage:'preflight',message:'Checking for an existing website.'});
      const sites=await hestiaRead(this.config,'v-list-web-domains',this.fetcher);
      if(Object.hasOwn(sites,details.domain)) throw new Error('This domain already exists in Hestia. Hearth will not overwrite it.');
      // A durable checkpoint is saved before every write. A network timeout is
      // ambiguous: we never automatically replay a write or delete resources.
      await this.change(job,{stage:'domain',message:'Creating your website in Hestia.'});mutationStarted=true;
      await hestiaCommand(this.config,'v-add-web-domain',[this.config.user,details.domain,this.install.ip,'yes','none'],this.fetcher);
      const created=await hestiaRead(this.config,'v-list-web-domains',this.fetcher);
      if(created[details.domain]?.IP!==this.install.ip || created[details.domain]?.SUSPENDED==='yes') throw new Error('The new domain could not be verified in Hestia.');
      await this.change(job,{stage:'https',message:'Requesting and installing your HTTPS certificate.'});
      await hestiaCommand(this.config,'v-add-letsencrypt-domain',[this.config.user,details.domain],this.fetcher);
      const secure=await hestiaRead(this.config,'v-list-web-domains',this.fetcher);
      if(secure[details.domain]?.SSL!=='yes') throw new Error('Hestia has not confirmed the HTTPS certificate.');
      // Confirm TLS before allowing the installer to transmit the new password.
      const tlsCheck=await this.verifyTls(details.domain);
      if(!tlsCheck) throw new Error('HTTPS could not be reached.');
      await this.change(job,{stage:'wordpress',message:'Installing WordPress and creating its database.'});
      await hestiaCommand(this.config,'v-quick-install-app',['install',this.config.user,details.domain,'WordPress',`email=${details.email}`,`password=${details.password}`,`username=${details.username}`,`site_name=${details.title}`,'install_directory=/','language=en_US',`php_version=${this.install.php}`,'database_create=true'],this.fetcher);
      details.password='';
      await this.change(job,{stage:'redirect',message:'Making HTTPS the default.'});
      await hestiaCommand(this.config,'v-add-web-domain-ssl-force',[this.config.user,details.domain],this.fetcher);
      await this.change(job,{stage:'verify',message:'Checking WordPress, HTTPS, and your login page.'});
      const verified=await this.verify(details.domain,this.install.ip,details.title);
      const finalDns=await this.dns(details.domain,this.install.ip);
      if(!finalDns.ready) throw new Error('DNS changed during installation. Check your domain records before opening the site.');
      await this.change(job,{state:'complete',stage:'complete',message:'Your WordPress website and HTTPS connection are ready.',...verified});
    } catch(e) {
      // Do not persist or return upstream bodies, arguments, passwords, or keys.
      const safe=['dns','preflight'].includes(job.stage)?e.message:`Setup stopped during ${job.stage}. The server may have completed this step. Inspect the domain in Hestia before continuing; Hearth will not repeat installation or remove any resources.`;
      await this.change(job,{state:mutationStarted?'needs_review':'failed',message:safe}).catch(()=>{job.state='needs_review';job.message='Progress could not be saved. Inspect the domain in Hestia.';});
    } finally {details.password='';}
  }
  async verifyTls(domain) {const result=await this.tls(domain,this.install.ip,'/');return result.status>=200 && result.status<400;}
}
