const commands = new Set(['v-list-web-domains', 'v-list-user-backups']);

export function configuration(env = process.env) {
  const fields = ['HESTIA_URL', 'HESTIA_USER', 'HESTIA_ACCESS_KEY', 'HESTIA_SECRET_KEY'];
  if (!fields.some(k => env[k])) return null;
  if (!fields.every(k => env[k])) throw new Error('Complete all four HESTIA settings in .env, then restart Hearth.');
  let url;
  try { url = new URL(env.HESTIA_URL); } catch { throw new Error('HESTIA_URL must be a valid HTTPS panel address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/', ''].includes(url.pathname)) {
    throw new Error('Use an HTTPS panel address without a path, credentials, or query.');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(env.HESTIA_USER)) throw new Error('Check HESTIA_USER in .env.');
  return { url: new URL('/api/', url).href, panel: url.origin, user: env.HESTIA_USER, hash: `${env.HESTIA_ACCESS_KEY}:${env.HESTIA_SECRET_KEY}` };
}

export async function hestiaRead(config, command, fetcher = fetch) {
  if (!commands.has(command)) throw new Error('This version only supports approved read-only commands.');
  const body = new URLSearchParams({ hash: config.hash, returncode: 'no', cmd: command, arg1: config.user, arg2: 'json' });
  let response;
  try {
    response = await fetcher(config.url, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch { throw new Error('Cannot reach Hestia. Check its address, trusted HTTPS certificate, and API IP allowlist.'); }
  if (!response.ok) throw new Error('Hestia declined the connection. Check the access key and API permissions.');
  let data;
  try { data = await response.json(); } catch { throw new Error('Hestia returned an unexpected response. Check API access and permissions.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Hestia did not return the requested list. Check API permissions.');
  return data;
}

export function websites(data) {
  return Object.entries(data).filter(([domain]) => /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)).map(([domain, details]) => ({
    domain, title: domain, suspended: details?.SUSPENDED === 'yes', ssl: details?.SSL === 'yes', kind: 'Hosted website', demo: false
  }));
}

// Fixed write allowlist. Never accept a command name from the browser.
const writeCommands = new Set(['v-add-web-domain', 'v-add-letsencrypt-domain', 'v-quick-install-app', 'v-add-web-domain-ssl-force']);
export async function hestiaCommand(config, command, args, fetcher = fetch) {
  if (!writeCommands.has(command) || args.length > 13) throw new Error('Unsupported installation operation.');
  const body = new URLSearchParams({ hash:config.hash, returncode:'yes', cmd:command });
  args.forEach((arg,i)=>body.set(`arg${i+1}`,arg));
  let response;
  try { response = await fetcher(config.url, {method:'POST',body,redirect:'error',signal:AbortSignal.timeout(15*60*1000)}); }
  catch { throw new Error('Hestia installation response was not received.'); }
  const code = (await response.text()).trim();
  if (!response.ok || code !== '0') throw new Error('Hestia did not confirm the installation operation.');
}
