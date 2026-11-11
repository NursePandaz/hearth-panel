import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { InstallManager, checkDns, validateInstall, verifyWordPress, installConfiguration } from '../install.mjs';
import { hestiaCommand } from '../hestia.mjs';
const config={panel:'https://panel.example.net:8083',url:'https://panel.example.net:8083/api/',user:'alice',hash:'access:secret-key'};
const install={ip:'192.0.2.5',php:'8.3'};
const input=()=>({domain:'fresh.example.net',title:'My Site & Journal',email:'owner@example.net',username:'editor',password:'Test!SecretPassword-123',requestId:randomUUID()});
const ready=async()=>({ready:true,expected:install.ip,ipv4:[install.ip],ipv6:[]});
const waitFor=async(manager,id)=>{
  for(let i=0;i<500;i++) {const job=manager.jobs.get(id);if(job&&!['queued','running'].includes(job.state)&&!manager.locks.has(job.domain))return manager.view(job);await new Promise(r=>setTimeout(r,5));}
  throw new Error('Job did not settle');
};
async function fixture(fn,overrides={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'hearth-install-'));const calls=[];let sites={};
  const fetcher=async(url,options)=>{
    const b=options.body;const cmd=b.get('cmd');calls.push({cmd,args:[...b].filter(([k])=>k.startsWith('arg')).map(([,v])=>v)});
    if(cmd==='v-list-web-domains')return Response.json(sites);
    if(cmd==='v-add-web-domain')sites={[b.get('arg2')]:{IP:install.ip,SSL:'no'}};
    if(cmd==='v-add-letsencrypt-domain')sites[b.get('arg2')].SSL='yes';
    return new Response('0');
  };
  const options={config,install,dir,fetcher,dns:ready,tls:async()=>({status:200}),verify:async d=>({url:`https://${d}`,adminUrl:`https://${d}/wp-admin/`}),...overrides};
  const manager=new InstallManager(options);await manager.ready;
  try {await fn({manager,dir,calls,options,setSites:s=>sites=s});}finally{await rm(dir,{recursive:true,force:true});}
}
test('install configuration is opt-in and validates server IP and PHP',()=>{
  assert.equal(installConfiguration({}),null);
  assert.throws(()=>installConfiguration({HEARTH_INSTALL_ENABLED:'true'}));
  assert.deepEqual(installConfiguration({HEARTH_INSTALL_ENABLED:'true',HESTIA_SITE_IP:install.ip,HESTIA_PHP_VERSION:'8.3'}),install);
});
test('input validation rejects URLs, reserved domains, controls, short passwords and invalid request IDs',()=>{
  assert.equal(validateInstall(input()).domain,'fresh.example.net');
  for(const bad of [{domain:'https://example.net'},{domain:'foo.local'},{domain:'foo;evil.net'},{title:'bad\nname'},{username:'--admin'},{password:'short'},{password:'Test!SecretPassword-123 '},{email:'nope'},{requestId:'arbitrary-file'}]) assert.throws(()=>validateInstall({...input(),...bad}));
});
test('DNS blocks absent, conflicting, proxy and IPv6 records',async()=>{
  for(const [a,aaaa,expected] of [[[install.ip],[],true],[[],[],false],[['192.0.2.6'],[],false],[[install.ip,'192.0.2.6'],[],false],[[install.ip],['2001:db8::1'],false]]) {
    const result=await checkDns('fresh.example.net',install.ip,{resolve4:async()=>a,resolve6:async()=>aaaa});assert.equal(result.ready,expected);
  }
  const noData=async()=>{throw Object.assign(new Error(),{code:'ENODATA'});};
  assert.equal((await checkDns('fresh.example.net',install.ip,{resolve4:noData,resolve6:noData})).ready,false);
});
test('write adapter enforces command allowlist, argument limit, and confirmed zero exit',async()=>{
  await assert.rejects(hestiaCommand(config,'v-delete-user',['alice']));
  await assert.rejects(hestiaCommand(config,'v-quick-install-app',Array(14).fill('x')));
  for(const response of [new Response('1'),new Response('OK'),new Response('0',{status:403})]) await assert.rejects(hestiaCommand(config,'v-add-web-domain',[],async()=>response));
});
test('full installation uses Hestia WordPress installer, persists no secrets, and is idempotent',async()=>{
  await fixture(async({manager,dir,calls})=>{
    const details=input();const first=await manager.start(details);const duplicate=await manager.start(details);assert.equal(first.id,duplicate.id);
    const job=await waitFor(manager,first.id);assert.equal(job.state,'complete');assert.equal(job.adminUrl,`https://${details.domain}/wp-admin/`);
    assert.deepEqual(calls.filter(c=>c.cmd!=='v-list-web-domains').map(c=>c.cmd),['v-add-web-domain','v-add-letsencrypt-domain','v-quick-install-app','v-add-web-domain-ssl-force']);
    const wp=calls.find(c=>c.cmd==='v-quick-install-app');assert.equal(wp.args.length,12);assert.equal(wp.args[0],'install');assert.equal(wp.args[3],'WordPress');assert.ok(wp.args.includes(`site_name=${details.title}`));assert.ok(wp.args.includes('database_create=true'));
    const record=await readFile(path.join(dir,`${first.id}.json`),'utf8');for(const secret of [details.password,config.hash]) assert.equal(record.includes(secret),false);
    const count=calls.length;await manager.start(details);assert.equal(calls.length,count);
    assert.equal(JSON.stringify(await manager.list()).includes(details.password),false);
    assert.deepEqual((await readdir(dir)).filter(x=>x.endsWith('.tmp')),[]);
  });
});
test('DNS waiting makes no server writes and resumes with the same job identifier',async()=>{
  let good=false;
  await fixture(async({manager,calls})=>{
    const details=input();const job=await manager.start(details);assert.equal((await waitFor(manager,job.id)).state,'waiting_dns');assert.equal(calls.length,0);
    good=true;await manager.start(details);assert.equal((await waitFor(manager,job.id)).state,'complete');
  },{dns:async()=>({...await ready(),ready:good})});
});
test('existing domains are never modified or adopted',async()=>{
  await fixture(async({manager,calls,setSites})=>{
    const details=input();setSites({[details.domain]:{IP:install.ip,SSL:'yes'}});
    const job=await manager.start(details);const result=await waitFor(manager,job.id);assert.equal(result.state,'failed');assert.match(result.message,/not overwrite/);assert.equal(calls.length,1);
  });
});
test('uncertain writes stop for review and are not replayed after retry or restart',async()=>{
  await fixture(async({manager,dir,options})=>{
    let writes=0;manager.fetcher=async(_url,{body})=>{if(body.get('cmd')==='v-list-web-domains')return Response.json({});writes++;throw new Error('secret body');};
    const details=input();const job=await manager.start(details);const result=await waitFor(manager,job.id);assert.equal(result.state,'needs_review');assert.equal(result.stage,'domain');assert.equal(result.message.includes('secret body'),false);
    await manager.start(details);assert.equal(writes,1);
    const restarted=new InstallManager({...options,dir});await restarted.ready;assert.equal((await restarted.start(details)).state,'needs_review');assert.equal(writes,1);
    await assert.rejects(restarted.start({...details,requestId:randomUUID()}),/already has an installation record/);
  });
});
test('interrupted checkpoints recover as review-required and stay bound to their original destination',async()=>{
  await fixture(async({manager,dir,options})=>{
    const details=input();const record={id:details.requestId,domain:details.domain,title:details.title,username:details.username,email:details.email,destination:manager.destination(),state:'running',stage:'wordpress'};
    await writeFile(path.join(dir,`${record.id}.json`),JSON.stringify(record));
    const restarted=new InstallManager(options);await restarted.ready;assert.equal((await restarted.list())[0].state,'needs_review');
    const changed=new InstallManager({...options,config:{...config,user:'bob'}});await changed.ready;assert.equal((await changed.list()).length,0);await assert.rejects(changed.start(details),/different website/);
  });
});
test('TLS, installer, and final verification failures cannot report success or delete resources',async()=>{
  for(const stage of ['tls','installer','verify']) await fixture(async({manager,calls})=>{
    if(stage==='installer') {const original=manager.fetcher;manager.fetcher=async(url,options)=>options.body.get('cmd')==='v-quick-install-app'?new Response('1'):original(url,options);}
    const details=input();const job=await manager.start(details);assert.equal((await waitFor(manager,job.id)).state,'needs_review');assert.equal(calls.some(c=>c.cmd.startsWith('v-delete')),false);
  },stage==='tls'?{tls:async()=>{throw new Error('TLS failed');}}:stage==='verify'?{verify:async()=>{throw new Error('Wrong site');}}:{});
});
test('WordPress success requires HTTPS site identity, REST API and login form',async()=>{
  const details=input();
  const request=async(_d,_i,p)=>({status:200,body:p==='/'?'Home':p==='/wp-login.php'?'<form id="loginform">':JSON.stringify({url:`https://${details.domain}`,name:details.title,namespaces:['wp/v2']})});
  assert.equal((await verifyWordPress(details.domain,install.ip,details.title,request)).url,`https://${details.domain}`);
  for(const bad of [async()=>({status:200,body:'Not WordPress'}),async(d,i,p)=>p==='/?rest_route=/'?{status:200,body:JSON.stringify({url:'http://wrong.example.net',name:details.title,namespaces:['wp/v2']})}:request(d,i,p),async(d,i,p)=>p==='/wp-login.php'?{status:302,body:''}:request(d,i,p)]) await assert.rejects(verifyWordPress(details.domain,install.ip,details.title,bad));
});


test('simultaneous requests cannot reuse one installation ID for different domains',async()=>{
  await fixture(async({manager,calls})=>{
    const details=input();const results=await Promise.allSettled([manager.start(details),manager.start({...details,domain:'other.example.net'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
    await waitFor(manager,details.requestId);assert.equal(calls.filter(c=>c.cmd==='v-add-web-domain').length,1);
  });
});
