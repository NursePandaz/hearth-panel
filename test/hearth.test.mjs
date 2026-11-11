import test from 'node:test';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { configuration, hestiaRead, websites } from '../hestia.mjs';
import { createServer } from '../server.mjs';
const env = { HESTIA_URL:'https://panel.example.com:8083', HESTIA_USER:'alice', HESTIA_ACCESS_KEY:'access', HESTIA_SECRET_KEY:'SECRET_DO_NOT_EXPOSE' };

test('configuration requires complete settings and trusted HTTPS addresses', () => {
  assert.equal(configuration({}), null);
  for (const value of ['http://panel.example.com', 'https://user:pass@panel.example.com', 'https://panel.example.com/?key=x', 'https://panel.example.com/path']) {
    assert.throws(() => configuration({...env, HESTIA_URL:value}));
  }
  assert.throws(() => configuration({ HESTIA_USER:'alice' }));
  assert.equal(configuration(env).url, 'https://panel.example.com:8083/api/');
});

test('adapter sends the documented Hestia access-key form and only permits reads', async () => {
  let calls=0;
  const fake = async (url, options) => {
    calls++;
    assert.equal(url, 'https://panel.example.com:8083/api/');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('hash'), 'access:SECRET_DO_NOT_EXPOSE');
    assert.equal(options.body.get('arg1'), 'alice');
    assert.equal(options.body.get('arg2'), 'json');
    assert.equal(options.body.get('returncode'), 'no');
    assert.equal(options.body.get('cmd'), 'v-list-web-domains');
    return Response.json({'example.com':{SSL:'yes'}});
  };
  assert.deepEqual(await hestiaRead(configuration(env),'v-list-web-domains',fake), {'example.com':{SSL:'yes'}});
  await assert.rejects(hestiaRead(configuration(env),'v-delete-user',fake));
  assert.equal(calls,1);
});

test('connection and upstream errors never expose credentials or response bodies', async () => {
  for (const fake of [async()=>{throw new Error(env.HESTIA_SECRET_KEY);}, async()=>new Response(env.HESTIA_SECRET_KEY,{status:403}), async()=>new Response(env.HESTIA_SECRET_KEY), async()=>Response.json(10)]) {
    await assert.rejects(hestiaRead(configuration(env),'v-list-web-domains',fake), e=>!e.message.includes(env.HESTIA_SECRET_KEY));
  }
});

test('site mapping does not claim WordPress or working HTTPS verification', () => {
  const result=websites({'example.com':{SSL:'yes',SUSPENDED:'no'},'<script>':{},'paused.example.com':{SUSPENDED:'yes'}});
  assert.equal(result.length,2);
  assert.equal(result[0].kind,'Hosted website');
  assert.equal(result[0].ssl,true);
  assert.equal(result[1].suspended,true);
});

function localFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req=request(url, { ...options, agent:false }, res=>{
      const chunks=[];
      res.on('data', chunk=>chunks.push(chunk));
      res.on('end',()=>resolve(new Response(Buffer.concat(chunks), {status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject); req.end();
  });
}
async function withServer(env, fn, fetcher) {
  const server=createServer({...env, PORT:'4318'},fetcher);
  await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(4318,'127.0.0.1',resolve); });
  try { await fn('http://127.0.0.1:4318'); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}

test('local server serves UI, blocks writes and cross-site access, and handles absent Hestia', async () => {
  await withServer({}, async base=>{
    const home=await localFetch(base);
    assert.equal(home.status,200);
    assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await home.text(), /Hearth/);
    assert.equal((await (await localFetch(base+'/api/status')).json()).mode,'demo');
    assert.equal((await localFetch(base+'/api/sites')).status,409);
    assert.equal((await localFetch(base+'/api/sites',{method:'POST'})).status,405);
    assert.equal((await localFetch(base+'/api/status',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await localFetch(base+'/api/status',{headers:{Host:'evil.example:4318'}})).status,403);
    assert.equal((await localFetch(base+'/api/status',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await localFetch(base+'/.env')).status,404);
  });
});

test('live routes map Hestia responses and keep secrets server-side', async () => {
  const calls=[];
  await withServer(env,async base=>{
    const status=await (await localFetch(base+'/api/status')).json();
    assert.equal(status.mode,'live');
    assert.equal(JSON.stringify(status).includes(env.HESTIA_SECRET_KEY),false);
    const check=await (await localFetch(base+'/api/check')).json();
    assert.equal(check.connected,true);
    const sites=await (await localFetch(base+'/api/sites')).json();
    assert.equal(sites.sites[0].domain,'example.com');
    const backups=await (await localFetch(base+'/api/backups')).json();
    assert.deepEqual(backups.backups,['alice.backup.tar']);
  },async (url,options)=>{
    const command=options.body.get('cmd'); calls.push(command);
    return Response.json(command==='v-list-user-backups'?{'alice.backup.tar':{}}:{'example.com':{SSL:'yes'}});
  });
  assert.deepEqual(calls,['v-list-web-domains','v-list-web-domains','v-list-user-backups']);
});
