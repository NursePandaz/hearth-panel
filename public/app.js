const paths = {
  websites: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M8 9v12"/>',
  backups: '<path d="M4 7h16v14H4zM2 3h20v4H2zM9 12h6"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  home: '<path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  bulb: '<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.websites}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const main = $('#main');
let status = { mode: 'demo' }, liveSites = [], liveError = '', step = 0, busy = false, progress = 0, completed = null;
let password = '';
let liveJobs=[], installJob=null, installError='', pollTimer;
const blank = () => ({ domain: '', title: '', email: '', username: '', backup: false, step: 0, requestId: crypto.randomUUID() });
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('Browser storage is unavailable. Keep this tab open to finish.'); return false; } }
let draft = blank();
const stored = read('hearth.draft', {});
for (const k of ['domain','title','email','username']) if (typeof stored[k] === 'string') draft[k] = stored[k].slice(0,253);
draft.backup = stored.backup === true;
if (typeof stored.requestId==='string' && /^[0-9a-f-]{36}$/.test(stored.requestId)) draft.requestId=stored.requestId;
draft.step = Number.isInteger(stored.step) ? Math.min(2, Math.max(0, stored.step)) : 0;
let demoSites = read('hearth.sites', []);
if (!Array.isArray(demoSites)) demoSites = [];
demoSites = demoSites.filter(s => s && typeof s.domain === 'string' && validDomain(s.domain) && typeof s.title === 'string').map(s => ({ domain:s.domain, title:s.title, demo:true, backup:s.backup === true }));
function saveDraft() { draft.step = Math.min(step, 2); write('hearth.draft', draft); }
function validDomain(value) { return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value); }
function toast(message) { $('#toast').textContent = message; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').textContent = '', 4500); }
async function api(path) { const r = await fetch(path); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Please try again.'); return data; }
function heading(title, subtitle, button='') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`; }
function demoNotice() { if (status.mode === 'error') return `<div class="notice error" role="alert">${esc(status.message)} <a href="#settings">Settings →</a></div>`; return `<div class="notice">${icon('bulb')}<span><strong>You’re in demo mode.</strong> Explore freely. Nothing is installed on a server.</span><a href="#settings">Connect Hestia ↗</a></div>`; }
function currentSites() { return status.mode === 'live' ? liveSites : demoSites; }
function render() {
  const page = location.hash.slice(1) || 'websites';
  const navPage = page === 'new' ? 'websites' : page;
  $('#nav').innerHTML = ['websites','backups','server','settings'].map(n => `<a href="#${n}" class="nav-item ${navPage === n ? 'active' : ''}" ${navPage === n ? 'aria-current="page"' : ''}>${icon(n)}${n[0].toUpperCase()+n.slice(1)}</a>`).join('');
  $('#breadcrumb').innerHTML = `Workspace <span>/</span> ${page === 'new' ? 'New website' : esc(navPage[0]?.toUpperCase()+navPage.slice(1))}`;
  $('#mode').textContent = status.mode === 'live' ? (status.installEnabled?'Hestia connected':'Hestia · read only') : status.mode === 'error' ? 'Setup needs attention' : 'Demo workspace';
  if (page === 'new') renderWizard();
  else if (page === 'backups') renderBackups();
  else if (page === 'server') renderServer();
  else if (page === 'settings') renderSettings();
  else renderWebsites();
}
function renderWebsites() {
  const sites = currentSites();
  main.innerHTML = heading('Your websites', 'A little space for everything you’re building.', `<button class="btn primary" data-action="new">${icon('plus')} New website</button>`)
    + (status.mode !== 'live' ? demoNotice() : `<div class="notice success">${status.installEnabled?'Connected to Hestia. Create a WordPress website when you’re ready.':'Connected to Hestia. Enable installation in Settings to create real WordPress websites.'}</div>`)
    + (status.mode==='live' ? liveJobs.filter(j=>j.state!=='complete').map(j=>`<div class="notice ${j.state==='needs_review'||j.state==='failed'?'error':''}"><span><strong>${esc(j.domain)}</strong> · ${esc(j.message)}</span><button data-action="job" data-id="${esc(j.id)}">View setup →</button></div>`).join('') : '')
    + (liveError ? `<div class="notice error" role="alert">${esc(liveError)} <button data-action="refresh">Try again</button></div>` : '')
    + `<section class="hero"><div class="hero-content"><div class="eyebrow">WELCOME TO HEARTH</div><h2>A home for your<br>next big idea.</h2><p>Your websites, without the busywork. Start with WordPress. We’ll walk you through the rest.</p><button class="btn primary" data-action="new">${icon('plus')} ${sites.length ? 'Add another website' : 'Create your first website'}</button></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="house">${icon('home')}</div><span class="spark">✦</span><span class="spark bottom">✦</span></div></section>`
    + `<div class="section-line"><h2>All websites <span class="count">${sites.length}</span></h2><button class="btn small subtle" data-action="refresh">Refresh ↻</button></div>`
    + (sites.length ? `<div class="grid">${sites.map(siteCard).join('')}</div>` : `<div class="empty">${icon('websites')}<h3>Your next chapter starts here.</h3><p>${status.mode==='live'?'No websites were returned for this Hestia user.':'Create a demo website to try the four-step wizard.'}</p><button class="btn small" data-action="new">${status.mode==='live'?'Explore the wizard':'Let’s get started'} →</button></div>`)
    + (draft.domain ? `<div class="notice"><span>You have an unfinished setup for <strong>${esc(draft.domain)}</strong>.</span><button data-action="resume">Continue setup →</button></div>` : '')
    + `<div class="tip">${icon('bulb')}<span><strong>Your server. Your rules.</strong> Hearth extends HestiaCP and keeps the everyday things simple.</span></div>`;
}
function siteCard(s) {
  const protocol = s.ssl ? 'https' : 'http';
  return `<article class="site-card"><div class="site-top"><div class="site-initial">${esc(s.title[0]?.toUpperCase() || 'W')}</div><div><h3>${esc(s.title)}</h3><p>${esc(s.domain)}</p></div></div><div class="site-meta"><span>${s.demo?'Demo website':s.suspended?'Suspended':s.wordpress?'WordPress':'Hosted website'}</span><span>${s.demo?'No live installation':s.ssl?'HTTPS configured':'HTTPS not configured'}</span></div><div class="actions">${s.demo?`<button class="btn small" data-action="details" data-domain="${esc(s.domain)}">View demo details →</button>`:`${s.suspended?'':`<a class="btn small" href="${protocol}://${esc(s.domain)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a>`}${s.wordpress&&!s.suspended?`<a class="btn small" href="${esc(s.adminUrl)}" target="_blank" rel="noopener noreferrer">WordPress admin ↗</a>`:''}<a class="btn small subtle" href="${esc(status.panel)}" target="_blank" rel="noopener noreferrer">Manage in Hestia ↗</a>`}</div></article>`;
}
function renderServer() {
  main.innerHTML = heading('Your server', 'The foundation for your websites.') + `<div class="settings-grid"><section class="panel"><div class="status-heading">${icon('server')}<h2>Hestia connection</h2></div><p class="muted">${status.mode==='live'?esc(status.panel):'No server connected yet.'}</p><p class="muted">${status.mode==='live'?'Your connection is configured. Check it to verify access.':'Connect an existing HestiaCP server, or explore the demo first.'}</p><div id="connection-result" aria-live="polite"></div><div class="actions"><button class="btn primary" data-action="check">Check connection</button><a class="btn" href="#settings">Connection settings →</a></div></section><section class="panel"><h2>One small step at a time.</h2><p class="muted">Hearth can check your connection, list websites and backups, and install WordPress when installation is enabled. Server updates and restarts are coming later.</p><div class="notice">No server measurements are available in this version.</div></section></div>`;
}
let backupRequest = 0;
function renderBackups() {
  const id = ++backupRequest;
  main.innerHTML = heading('Backups', 'A little peace of mind for your websites.') + `<section class="panel" id="backup-content"><p class="muted">${status.mode==='live'?'Looking for backups…':'No real backups in demo mode.'}</p>${status.mode!=='live'?'<p>Connect Hestia to view the backup files reported for your account. Creating and restoring backups is not enabled in this alpha.</p><a class="btn" href="#settings">Connect your server →</a>':''}</section>`;
  if (status.mode==='live') api('/api/backups').then(data => {
    if (id!==backupRequest || !$('#backup-content')) return;
    $('#backup-content').innerHTML = `<h2>Backups reported by Hestia</h2><p class="muted">These are account backups, not per-site restore points. Their recoverability has not been verified by Hearth.</p>${data.backups.length?data.backups.map(b=>`<div class="list-row">${icon('backups')} ${esc(b)}</div>`).join(''):'<div class="empty"><h3>No backup files reported.</h3><p>Set up backups in Hestia before relying on them.</p></div>'}<a class="btn" href="${esc(status.panel)}" target="_blank" rel="noopener noreferrer">Open Hestia ↗</a>`;
  }).catch(e => { if (id===backupRequest && $('#backup-content')) $('#backup-content').innerHTML=`<div class="notice error" role="alert">${esc(e.message)}</div><button class="btn" data-action="retry-backups">Try again</button>`; });
}
function renderSettings() {
  main.innerHTML = heading('Settings', 'A simple setup. A server that’s yours.') + `<div class="settings-grid"><section class="panel"><h2>Connect HestiaCP</h2><p>For this local alpha, connection details stay on the computer running Hearth. They are never saved in your browser.</p><p>Create a <strong>limited access key</strong> in Hestia that permits <code>v-list-web-domains</code> and <code>v-list-user-backups</code>. To install WordPress, also permit <code>v-add-web-domain</code>, <code>v-add-letsencrypt-domain</code>, <code>v-quick-install-app</code>, and <code>v-add-web-domain-ssl-force</code>. Use a dedicated key scoped to these commands; some Hestia versions require an admin-owned key for Quick Install. Add Hearth’s server IP to Hestia’s API allowlist.</p><p>Copy <code>.env.example</code> to <code>.env</code> in Hearth’s folder, fill in these values, then restart Hearth.</p><pre>HESTIA_URL=https://panel.example.com:8083\nHESTIA_USER=your-user\nHESTIA_ACCESS_KEY=your-access-key\nHESTIA_SECRET_KEY=your-secret-key</pre><details><summary>Enable real WordPress installs</summary><p>After connecting your test server, add these values to .env and restart Hearth. Use the IPv4 address assigned to websites in Hestia, and a PHP version already installed there.</p><pre>HEARTH_INSTALL_ENABLED=true\nHESTIA_SITE_IP=your-server-ipv4\nHESTIA_PHP_VERSION=8.3</pre><p>Your domain must point directly to that IPv4 address, without extra A or AAAA records or a DNS proxy. Start with a spare domain. Hearth never overwrites an existing domain.</p></details><p>Use a trusted HTTPS certificate. Hearth does not disable certificate checks.</p>${status.mode==='error'?`<div class="notice error">${esc(status.message)}</div>`:''}<a class="btn primary" href="#server">Check connection →</a></section><section><div class="panel"><h2>Your demo workspace</h2><p>Demo sites and unfinished setup details are saved only in this browser. Passwords are never saved.</p><p>Demo mode uses pretend progress. It does not install software, issue certificates, or create backups.</p><button class="btn" data-action="reset">Clear demo data</button><div id="reset-confirm"></div></div><div class="tip">${icon('bulb')}<span>This preview listens on your own computer only. Remote access and authentication need a separate release.</span></div><a class="btn subtle" href="https://github.com/NursePandaz/hearth-panel" target="_blank" rel="noopener noreferrer">View Hearth on GitHub ↗</a></section></div>`;
}
function renderWizard() {
  const labels = ['Check server','Name website','Create login','Launch'];
  main.innerHTML = `<div class="wizard"><button class="backlink" data-action="exit" ${busy?'disabled':''}>${icon('arrow')} Your websites</button><div class="wizard-heading"><div class="eyebrow">SOMETHING GOOD STARTS HERE</div><h1>Let’s give your idea a home.</h1><p>Four simple steps. We’ll take it from here.</p></div><ol class="steps" aria-label="Setup progress">${labels.map((l,i)=>`<li class="${i===step?'current':i<step?'done':''}" ${i===step?'aria-current="step"':''}><span class="step-number">${i<step?'✓':i+1}</span>${l}</li>`).join('')}</ol>${status.mode==='live'?`<div class="notice ${status.installEnabled?'success':''}">${status.installEnabled?'Real setup · This creates a website, certificate, and WordPress database on your server.':'Installation is disabled. Enable it in Settings to create a real website.'}</div>`:demoNotice()}<section class="panel form-panel" id="wizard-panel"></section></div>`;
  const panel = $('#wizard-panel');
  if(installJob) {renderInstallation(panel);return;}
  if (completed) { panel.innerHTML = `<div class="center"><div class="success-mark">✓</div><h2>Your demo is ready.</h2><p>${esc(completed.title)} has been added to your demo workspace.</p><div class="notice">No WordPress site was installed. Your domain and server have not changed.</div><div class="actions"><button class="btn primary" data-action="finish">Back to websites →</button><a class="btn" href="#settings">Connect a real server</a></div></div>`; return; }
  if (step===0) panel.innerHTML = `<h2>First, a quick check.</h2><p>${status.mode==='live'?'Confirm the Hestia connection before continuing.':'No server needed to take Hearth for a spin.'}</p><div class="checks"><div class="check-row"><span class="check-icon">✓</span><div><strong>${status.mode==='live'?'Hestia settings provided':'Demo workspace ready'}</strong><p>${status.mode==='live'?'Connection still needs verification.':'Your real server stays untouched.'}</p></div></div><div class="check-row"><span class="check-icon">✓</span><div><strong>Your progress stays with you</strong><p>Non-secret details are saved as you go.</p></div></div><div class="check-row"><span class="check-icon">✓</span><div><strong>Simple by default</strong><p>We’ll guide you through the essentials.</p></div></div></div><div id="connection-result" aria-live="polite"></div>${status.mode==='live'?'<button class="btn" data-action="check">Check Hestia connection</button>':''}<div class="form-actions"><span class="hint">${status.mode==='live'?(status.installEnabled?'Installation starts after your final review.':'Enable installation in Settings to launch.'):'A demo, with zero server changes.'}</span><button class="btn primary" data-action="next">Let’s go →</button></div>`;
  if (step===1) panel.innerHTML = `<h2>What’s your website called?</h2><p>A name and an address. That’s all we need here.</p><form id="domain-form"><div class="field"><label for="domain">Website address</label><input id="domain" name="domain" placeholder="your-idea.com" value="${esc(draft.domain)}" required maxlength="253" autocapitalize="none" spellcheck="false"><p class="hint">Just the domain, without https:// or a page address.</p></div><div class="field"><label for="title">Website name</label><input id="title" name="title" placeholder="My next big idea" value="${esc(draft.title)}" required maxlength="100"><p class="hint">You can change this in WordPress later.</p></div><details><summary>What about connecting my domain?</summary><p>For a live setup, you’ll point your domain’s DNS records to the server. ${status.mode==='live'?'Hearth checks DNS before installation and shows you what to update. It does not change your DNS records.':'This demo does not check or change DNS.'}</p></details><div class="form-actions"><button type="button" class="btn subtle" data-action="back">← Back</button><button class="btn primary" type="submit">Continue →</button></div></form>`;
  if (step===2) panel.innerHTML = `<h2>Make it yours.</h2><p>${status.mode==='live'?'Create the administrator login for your new WordPress website.':'Choose the login you’d use to manage WordPress. Use sample details for this demo.'}</p><form id="login-form"><div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" placeholder="you@example.com" value="${esc(draft.email)}" required maxlength="253" autocomplete="email"></div><div class="field"><label for="username">Username</label><input id="username" name="username" placeholder="your-name" value="${esc(draft.username)}" required minlength="3" maxlength="60" pattern="[A-Za-z0-9][A-Za-z0-9_.@-]{2,59}" autocomplete="username"><p class="hint">Use letters, numbers, dots, dashes, underscores, or @.</p></div><div class="field"><label for="password">Password</label><div class="password-row"><input id="password" name="password" type="password" placeholder="At least 12 characters" value="${esc(password)}" required minlength="12" maxlength="128" autocomplete="new-password"><button class="btn small" type="button" data-action="show-password" aria-pressed="false">Show</button><button class="btn small" type="button" data-action="generate">Generate</button></div><p class="hint">${status.mode==='live'?'Sent securely to Hestia only for installation. Never saved by Hearth.':'Kept in memory only. You’ll re-enter it if you leave this wizard.'}</p></div><div class="form-actions"><button type="button" class="btn subtle" data-action="back">← Back</button><button class="btn primary" type="submit">Review website →</button></div></form>`;
  if (step===3) {
    if (busy && status.mode==='demo') { renderProgress(panel); return; }
    panel.innerHTML = `<h2>Ready when you are.</h2><p>${status.mode==='live'?'Here’s the plan for your WordPress website.':'Here’s the plan for your demo website.'}</p><div class="review">${[['Website',draft.title],['Address',draft.domain],['WordPress login',draft.username],['Email',draft.email],['Installation',status.mode==='live'?'WordPress + database + HTTPS':'Demo only — no server changes']].map(([k,v])=>`<div class="review-row"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('')}</div><div class="check-text"><input id="backup-reminder" type="checkbox" ${draft.backup?'checked':''}><label for="backup-reminder">Remind me to set up backups</label></div><p class="hint">This saves a reminder, not a backup schedule.</p><div class="notice">${status.mode==='live'?(status.installEnabled?`Your domain must point to ${esc(status.siteIp)}. Existing websites will never be overwritten.`:'Enable installation in Settings before continuing.'):'We’ll simulate the setup so you can try the experience.'}</div>${installError?`<div class="notice error" role="alert">${esc(installError)}</div>`:''}<div class="form-actions"><button class="btn subtle" data-action="back">← Back</button><button class="btn primary" data-action="launch" ${status.mode!=='demo'&&!status.installEnabled?'disabled':''}>${status.mode==='live'?'Create my website':'Create demo website'} →</button></div>`;
  }
}
function renderProgress(panel = $('#wizard-panel')) {
  const tasks = ['Preparing your demo','Simulating WordPress setup','Simulating HTTPS setup','Adding to your demo workspace'];
  panel.innerHTML = `<h2>A little magic in progress.</h2><p>Simulating setup. Your real server stays untouched.</p><div class="progress-track"><progress aria-label="Demo setup progress" max="4" value="${progress}"></progress></div><div aria-live="polite">${tasks.map((t,i)=>`<div class="check-row"><span class="check-icon">${i<progress?'✓':i===progress?'·':'–'}</span><div><strong>${t}</strong><p>${i<progress?'Demo step complete':i===progress?'In progress…':'Up next'}</p></div></div>`).join('')}</div>`;
}
function capture() {
  if ($('#domain')) { draft.domain = $('#domain').value.trim().toLowerCase(); draft.title = $('#title').value.trim(); }
  if ($('#email')) { draft.email = $('#email').value.trim(); draft.username = $('#username').value.trim(); password = $('#password').value; }
  if ($('#backup-reminder')) draft.backup = $('#backup-reminder').checked;
}
async function launchDemo() {
  if (busy || status.mode!=='demo') return;
  capture();
  if (!validDomain(draft.domain) || !draft.title || !draft.username || password.length<12) { toast('Please review your website details first.'); step=1; render(); return; }
  if (demoSites.some(s=>s.domain===draft.domain)) { toast('That domain already exists in your demo workspace.'); step=1; render(); return; }
  busy=true; progress=0; render();
  for (let i=1;i<=4;i++) { await new Promise(resolve=>setTimeout(resolve,650)); progress=i; if ($('#wizard-panel')) renderProgress(); }
  completed = { domain:draft.domain, title:draft.title, demo:true, backup:draft.backup };
  demoSites.push(completed); write('hearth.sites',demoSites); password=''; draft=blank(); write('hearth.draft',draft); busy=false; render();
}
async function refreshSites() {
  if (status.mode!=='live') { toast('Demo workspace is up to date.'); return; }
  try { const data=await api('/api/sites'); liveSites=data.sites; liveError=''; await loadJobs(); } catch(e) { liveError=e.message; }
  render();
}
async function checkConnection(button) {
  const target=$('#connection-result'); if (!target) return;
  if (status.mode!=='live') { target.innerHTML='<div class="notice">No server connected. Add your connection details in Settings to check a real server.</div>'; return; }
  button.disabled=true; target.innerHTML='<p class="muted">Checking your Hestia connection…</p>';
  try { const result=await api('/api/check'); target.innerHTML=`<div class="notice success">${esc(result.message)}</div>`; }
  catch(e) { target.innerHTML=`<div class="notice error" role="alert">${esc(e.message)}</div>`; }
  finally { if (button.isConnected) button.disabled=false; }
}
document.addEventListener('submit',e=>{
  if (!['domain-form','login-form'].includes(e.target.id)) return;
  e.preventDefault(); capture();
  if (e.target.id==='domain-form') {
    const input=$('#domain'); input.setCustomValidity('');
    if (!validDomain(draft.domain)) { input.setCustomValidity('Enter a domain such as your-idea.com, without spaces or a URL path.'); input.reportValidity(); return; }
    if (currentSites().some(s=>s.domain===draft.domain)) { input.setCustomValidity('This domain is already in your workspace.'); input.reportValidity(); return; }
    if (!draft.title) { $('#title').setCustomValidity('Enter a website name.'); $('#title').reportValidity(); return; }
  }
  step++; saveDraft(); render(); $('#wizard-panel h2')?.setAttribute('tabindex','-1'); $('#wizard-panel h2')?.focus();
});
document.addEventListener('input',e=>{
  if (e.target.matches('input')) { e.target.setCustomValidity(''); capture(); saveDraft(); }
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]'); if (!b) return;
  const action=b.dataset.action;
  if (action==='new' || action==='resume') {
    if(busy){toast('An installation is already running. Open its progress to continue.');return;}
    completed=null; installJob=null; installError=''; password=''; step=action==='resume'?draft.step:0;
    if (action==='new') { draft=blank(); saveDraft(); }
    if (location.hash==='#new') render(); else location.hash='new';
  }
  if (action==='exit' || action==='finish') { if (busy) return; if(installJob?.state==='complete' && draft.requestId===installJob.id){draft=blank();saveDraft();} else if (!completed) { capture(); saveDraft(); } password=''; completed=null; installJob=null; busy=false; if (location.hash==='#websites') render(); else location.hash='websites'; }
  if (action==='next' || action==='back') { capture(); step+=action==='next'?1:-1; saveDraft(); render(); }
  if (action==='generate') {
    const bytes=crypto.getRandomValues(new Uint8Array(20)); const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    password=Array.from(bytes,x=>chars[x%chars.length]).join(''); $('#password').value=password; $('#password').setCustomValidity(''); toast('Strong password generated. Use Show to view it.');
  }
  if (action==='show-password') { const input=$('#password'); const show=input.type==='password'; input.type=show?'text':'password'; b.textContent=show?'Hide':'Show'; b.setAttribute('aria-pressed',String(show)); }
  if (action==='launch') { if(status.mode==='live') await launchLive(); else await launchDemo(); }
  if(action==='job') { installJob=liveJobs.find(j=>j.id===b.dataset.id); if(!installJob)return; step=3; busy=['running','queued'].includes(installJob.state); location.hash='new'; render(); if(busy) schedulePoll(); }
  if(action==='retry-dns') {draft={...draft,domain:installJob.domain,title:installJob.title,username:installJob.username,email:installJob.email,requestId:installJob.id};installJob=null;password='';step=2;saveDraft();render();}
  if (action==='refresh') await refreshSites();
  if (action==='check') await checkConnection(b);
  if (action==='retry-backups') renderBackups();
  if (action==='details') {
    const s=demoSites.find(s=>s.domain===b.dataset.domain); if (!s) return;
    main.innerHTML=heading(esc(s.title),'A preview of your website setup.')+`<div class="panel"><div class="notice">Demo website. Nothing is installed at ${esc(s.domain)}.</div><div class="review-row"><span>Domain</span><strong>${esc(s.domain)}</strong></div><div class="review-row"><span>Backups</span><strong>${s.backup?'Reminder requested — not configured':'Not configured'}</strong></div><p class="hint">WordPress admin links become available after a real installation is verified in a future release.</p><div class="actions"><button class="btn" data-action="finish">← Your websites</button><a class="btn primary" href="#settings">Connect Hestia →</a></div></div>`;
  }
  if (action==='reset') $('#reset-confirm').innerHTML='<div class="notice">Clear demo websites and your draft? Your Hestia server is unaffected.</div><div class="actions"><button class="btn primary" data-action="confirm-reset">Clear demo data</button><button class="btn" data-action="cancel-reset">Keep it</button></div>';
  if (action==='cancel-reset') $('#reset-confirm').innerHTML='';
  if (action==='confirm-reset') { demoSites=[]; draft=blank(); password=''; completed=null; write('hearth.sites',[]); write('hearth.draft',draft); render(); toast('Demo data cleared.'); }
});
window.addEventListener('hashchange',()=>{ if (location.hash!=='#new') { password=''; } render(); main.focus(); });
window.addEventListener('beforeunload',e=>{ if (busy && status.mode==='demo') { e.preventDefault(); e.returnValue=''; } });
async function init() {
  try { status=await api('/api/status'); } catch { status={mode:'error',message:'The local Hearth server is unavailable. Restart it and refresh.'}; }
  step=draft.step;
  if(status.mode==='live') {try{await loadJobs();const pending=liveJobs.find(j=>j.id===draft.requestId);if(location.hash==='#new'&&pending){installJob=pending;step=3;busy=['running','queued'].includes(pending.state);if(busy)schedulePoll();}}catch(e){liveError=e.message;}}
  render();
  if (status.mode==='error') toast(status.message);
  if (status.mode==='live') await refreshSites();
}

function renderInstallation(panel) {
  const job=installJob;
  busy=['queued','running'].includes(job.state);
  if(job.state==='complete') {
    panel.innerHTML=`<div class="center"><div class="success-mark">✓</div><h2>Your website is ready.</h2><p>${esc(job.title)} is installed. WordPress, HTTPS, and the login page have been checked.</p><div class="actions"><a class="btn primary" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a><a class="btn" href="${esc(job.adminUrl)}" target="_blank" rel="noopener noreferrer">Open WordPress ↗</a></div><p class="hint">Backups are not configured. Set them up in Hestia before relying on this site.</p><button class="btn subtle" data-action="finish">Back to websites →</button></div>`;
  } else {
    const stages=['dns','preflight','domain','https','wordpress','redirect','verify'];
    panel.innerHTML=`<h2>${busy?'Making room for your idea.':job.state==='waiting_dns'?'Connect your domain.':'Setup needs attention.'}</h2><p>${esc(job.domain)}</p><div class="notice ${job.state==='needs_review'||job.state==='failed'?'error':''}" role="status">${esc(job.message)}</div>${busy?`<div class="progress-track"><progress aria-label="Installation progress" max="7" value="${Math.max(0,stages.indexOf(job.stage))}"></progress></div><p class="hint">You can close this browser tab. Keep the Hearth server running; it will continue the setup.</p>`:''}${job.state==='waiting_dns'?`<div class="review-row"><span>DNS record</span><strong>A · ${esc(job.domain)} → ${esc(job.dns.expected)}</strong></div><p class="hint">Allow time for DNS to update. Remove conflicting A and AAAA records and turn off any DNS proxy. Then re-enter your password to try again.</p><button class="btn primary" data-action="retry-dns">I’ve updated DNS →</button>`:''}${!busy?`<div class="actions"><a class="btn" href="${esc(status.panel)}" target="_blank" rel="noopener noreferrer">Open Hestia ↗</a><button class="btn subtle" data-action="finish">Back to websites</button></div>`:''}`;
  }
}
async function loadJobs() {
  const data=await api('/api/installations');liveJobs=data.jobs;
  if(installJob) installJob=liveJobs.find(j=>j.id===installJob.id)||installJob;
}
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer=setTimeout(async()=>{
    try {
      await loadJobs();
      busy=!!installJob && ['queued','running'].includes(installJob.state);
      if(location.hash==='#new'&&installJob)render();
      if(busy)schedulePoll();
      else if(installJob?.state==='complete') {password='';await refreshSites();}
    } catch {toast('Progress is temporarily unavailable. Refresh Hearth to check the saved installation.');schedulePoll();}
  },2000);
}
async function launchLive() {
  if(busy||!status.installEnabled)return;
  capture();saveDraft();installError='';
  if(password.length<12){step=2;render();toast('Please re-enter your WordPress password.');return;}
  busy=true;
  const b=document.querySelector('[data-action="launch"]');if(b)b.disabled=true;
  try {
    const response=await fetch('/api/installations',{method:'POST',headers:{'Content-Type':'application/json','X-Hearth-Token':status.csrf},body:JSON.stringify({...draft,password})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Setup could not be started.');
    installJob=data;password='';busy=['running','queued'].includes(data.state);render();if(busy)schedulePoll();
  }catch(e){
    busy=false;installError=e.message;
    try{await loadJobs();const saved=liveJobs.find(j=>j.id===draft.requestId);if(saved){installJob=saved;password='';busy=['running','queued'].includes(saved.state);if(busy)schedulePoll();}}catch{}
    render();
  }
}

init();
