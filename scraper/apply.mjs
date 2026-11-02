// JobHunter apply assistant — drives a VISIBLE Chrome window under your supervision.
// usage: node apply.mjs <session.json>
// stdout: one JSON event per line   stdin: one JSON command per line
//   commands: {"cmd":"continue"} {"cmd":"answers","answers":{"<fid>":"value"}} {"cmd":"submit"} {"cmd":"skip"} {"cmd":"stop"}
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }

const S = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const P = S.profile;              // flat profile
const JOB = S.job;                // {url,title,company,country}
let OUTCOME = null;
const emit = (type, data = {}) => { if (['done', 'skipped', 'stopped', 'gave_up'].includes(type)) OUTCOME = type; process.stdout.write(JSON.stringify({ type, t: Date.now(), ...data }) + '\n'); };
const log = (msg) => emit('log', { msg });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => sleep(a + Math.random() * (b - a));

// ---------------- command channel ----------------
const queue = []; let waiter = null;
let STOP = false; let SKIP = false;
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  try {
    const c = JSON.parse(l);
    if (c.cmd === 'stop') STOP = true;
    if (c.cmd === 'skip') SKIP = true;
    if (waiter) { const w = waiter; waiter = null; w(c); }
    else if (!['stop', 'skip'].includes(c.cmd)) queue.push(c);
  } catch {}
});
const nextCmd = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => (waiter = r)));
let manualSubmitSignal = null;

// wait for the user; resolves early if autoCheck() becomes true (e.g. captcha solved, logged in)
async function needUser(reason, message, extra = {}, autoCheck = null) {
  emit('needs_input', { reason, message, ...extra });
  try { await page().bringToFront(); } catch {}
  while (true) {
    const c = await Promise.race([nextCmd(), (async () => {
      if (!autoCheck) return new Promise(() => {});
      while (true) { await sleep(2500); try { if (await autoCheck()) return { cmd: 'continue', auto: true }; } catch {} }
    })()]);
    if (c.cmd === 'stop' || c.cmd === 'skip') return c;
    emit('resumed', { by: c.auto ? 'auto' : 'you', cmd: c.cmd });
    return c;
  }
}

// ---------------- browser ----------------
const profileDir = path.join(HERE, '..', 'data', 'browser-apply');   // keeps your job-site logins between runs
let ctx, cdpBrowser = null, cur;
// ---- mode 1: YOUR browser via the "JobHunter Apply Helper" extension (relayed through the JobHunter app) ----
const EXT = !!S.ext;
async function X(op, extra = {}, timeout = 90) {
  const r = await fetch(S.ext, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JH': '1' }, body: JSON.stringify({ op, timeout, ...extra }) });
  const j = await r.json();
  if (!j.ok && j.error && /not connected|did not answer/i.test(j.error)) throw new Error(j.error);
  return j;
}
let extOpened = false;
const EXTPAGE = {
  goto: async (url) => { const r = await X(extOpened ? 'goto' : 'open', { url }); extOpened = true; if (!r.ok) throw new Error(r.error || 'open failed'); },
  waitForLoadState: async () => X('waitLoad', { ms: 15000 }),
  bringToFront: async () => X('focus'),
  isClosed: () => false,
};
if (EXT) {
  try { const h = await X('hello', {}, 15); log(`Working in your ${h.browser || 'browser'} via JobHunter Apply Helper ${h.version || ''}`); cur = EXTPAGE; }
  catch (e) { emit('error', { message: 'JobHunter Apply Helper extension not reachable: ' + e.message }); process.exit(1); }
}
if (!EXT && S.cdp) {   // attach to the always-open "JobHunter Chrome" and work in a NEW TAB of that window
  try {
    cdpBrowser = await chromium.connectOverCDP(S.cdp, { timeout: 15000 });
    ctx = cdpBrowser.contexts()[0] || (await cdpBrowser.newContext());
    // /json/new opens a TAB in the existing window (Playwright's newPage() would open a new window)
    const waitP = ctx.waitForEvent('page', { timeout: 10000 });
    await fetch(S.cdp + '/json/new?about:blank', { method: 'PUT' });
    cur = await waitP.catch(async () => ctx.newPage());
    log('Attached to JobHunter Chrome — new tab opened');
  } catch (e) { log(`Could not attach to JobHunter Chrome (${e.message.split('\n')[0]}) — opening a separate window`); cdpBrowser = null; ctx = null; }
}
if (!EXT && !ctx) {
  for (const channel of (S.browser_channel === 'none' ? [undefined] : [S.browser_channel || 'chrome', 'msedge', undefined])) {
    try {
      ctx = await chromium.launchPersistentContext(profileDir, {
        headless: false, viewport: null, ...(channel ? { channel } : {}),
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
        ignoreDefaultArgs: ['--enable-automation'],
      });
      break;
    } catch (e) { log(`${channel || 'chromium'} unavailable: ${e.message.split('\n')[0]}`); }
  }
  if (!ctx) { emit('error', { message: 'No browser available (install Chrome).' }); process.exit(1); }
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  cur = ctx.pages()[0] || (await ctx.newPage());
}
if (!EXT && ctx) {
  try { await ctx.exposeBinding('__jhReportSubmit', (_source, detail) => { manualSubmitSignal = detail || { text: 'Submit', at: Date.now() }; }); }
  catch (e) { log('Manual-submit watcher: ' + e.message.split('\n')[0]); }
}
const OURS = new Set([cur]);
const follow = (p) => { if (EXT) return; p.on('popup', (q) => { OURS.add(q); follow(q); cur = q; log('Switched to new tab'); }); };
follow(cur);
if (!EXT && !cdpBrowser) ctx.on('page', (p) => { if (!OURS.has(p)) { OURS.add(p); follow(p); cur = p; log('Switched to new tab'); } });
const page = () => EXT ? EXTPAGE : (cur.isClosed() ? ([...OURS].filter((p) => !p.isClosed()).slice(-1)[0] || cur) : cur);

// ---------------- in-page helpers (injected) ----------------
const SCAN = () => {
  const cleanAction = (s) => String(s || '').replace(/^[\s↗↖↘↙→←»›•·✓✔＋+]+|[\s↗↖↘↙→←»›•·✓✔＋+]+$/g, '').replace(/\s+/g, ' ').trim();
  const finalSubmit = /^(submit(?: application| your application| my application| now)?|send(?: application| my application)?|finish(?: application| and submit)?|complete application|finali[sz]e application|apply|confirm (?:and submit|application)|send it)$/i;
  const genericSubmit = /^(submit|apply|send|finish)$/i;
  if (!window.__JHSubmitWatcher) {
    window.__JHSubmitWatcher = true;
    document.addEventListener('click', (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const el = e.target.closest('button, input[type="submit"], input[type="button"], a[role="button"]');
      if (!el) return;
      const label = cleanAction(el.innerText || el.value || el.getAttribute('aria-label') || '');
      if (!finalSubmit.test(label)) return;
      const form = el.form || el.closest('form');
      const fields = form ? [...form.querySelectorAll('input:not([type="hidden"]), textarea, select')] : [];
      const fieldText = fields.map((f) => `${f.name || ''} ${f.id || ''} ${f.placeholder || ''} ${f.getAttribute('aria-label') || ''}`).join(' ');
      if (genericSubmit.test(label) && !(fields.length >= 3 && /e-?mail|phone|resume|cv|cover|experience|work|candidate|first.?name|last.?name/i.test(fieldText))) return;
      const detail = { text: label, url: location.href, at: Date.now() };
      window.__JHManualSubmit = detail;
      try { if (typeof window.__jhReportSubmit === 'function') window.__jhReportSubmit(detail); } catch {}
    }, true);
  }
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 || e.type === 'file'; };
  const txt = (e) => (e ? (e.innerText || e.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t = txt(l); }
    if (!t) { const l = el.closest('label'); if (l) t = txt(l); }
    if (!t && el.getAttribute('aria-labelledby')) t = el.getAttribute('aria-labelledby').split(/\s+/).map((i) => txt(document.getElementById(i))).join(' ');
    if (!t) t = el.getAttribute('aria-label') || '';
    if (!t) { let p = el.parentElement; for (let i = 0; i < 5 && p && !t; i++, p = p.parentElement) { const l = [...p.querySelectorAll('label,legend,[class*="label" i],[class*="question" i],h3,h4')].find((x) => !x.contains(el) && txt(x)); if (l) t = txt(l); } }
    return (t || el.placeholder || el.name || el.id || '').slice(0, 300);
  };
  const questionOf = (els) => {   // radio/checkbox group question text
    const optTxt = new Set(els.map((e) => labelOf(e).toLowerCase()));
    let p = els[0].parentElement;
    for (let i = 0; i < 7 && p; i++, p = p.parentElement) {
      if (els.every((e) => p.contains(e))) {
        const lg = p.querySelector('legend'); if (lg && txt(lg)) return txt(lg);
        const q = [...p.querySelectorAll('label,span,div,p,h3,h4,[class*="question" i]')].find((x) => txt(x) && !optTxt.has(txt(x).toLowerCase()) && !els.some((e) => x.contains(e)) && ![...p.querySelectorAll('input')].some((e) => x.contains(e)) && txt(x).length < 300);
        if (q) return txt(q);
        if (p.getAttribute('aria-label')) return p.getAttribute('aria-label');
      }
    }
    return els[0].name || '';
  };
  const req = (el, label) => el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$|[*✱]|\(required\)|required/i.test(label);
  let n = window.__jhN || 0; const out = [];
  const tag = (el) => { if (!el.dataset.jh) el.dataset.jh = 'f' + (++n); return el.dataset.jh; };
  const groups = {};
  for (const el of document.querySelectorAll('input, textarea, select, [role="combobox"]')) {
    let type = (el.type || el.getAttribute('role') || el.tagName).toLowerCase();
    if (el.tagName === 'INPUT' && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' || el.closest('[class*="select__control" i], [class*="react-select" i]'))) type = 'combobox';
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue;
    if (!vis(el) && type !== 'file') continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if ((type === 'radio' || type === 'checkbox') && el.name) { (groups[type + ':' + el.name] = groups[type + ':' + el.name] || []).push(el); continue; }
    let label = labelOf(el);
    if (type === 'file') {   // "Attach" buttons: use the surrounding block to tell resume from cover letter
      let p = el.parentElement, ctxt = '';
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) { const t = txt(p); if (/resume|cv\b|curriculum|cover letter/i.test(t) && t.length < 400) { ctxt = t; break; } }
      label = (ctxt || label).slice(0, 200);
    }
    const f = { id: tag(el), tag: el.tagName.toLowerCase(), type, name: el.name || '', label, required: req(el, label),
      value: el.tagName === 'SELECT' ? (el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '') : (type === 'checkbox' ? (el.checked ? 'on' : '') : (el.value || '')),
      accept: el.accept || '', placeholder: el.placeholder || '' };
    if (el.tagName === 'SELECT') f.options = [...el.options].map((o) => o.text.trim()).filter((x) => x);
    if (type === 'checkbox') f.single = true;
    out.push(f);
  }
  for (const [k, els] of Object.entries(groups)) {
    const [type] = k.split(':');
    if (type === 'checkbox' && els.length === 1) { const el = els[0]; const label = labelOf(el); out.push({ id: tag(el), tag: 'input', type: 'checkbox', single: true, label, required: req(el, label), value: el.checked ? 'on' : '' }); continue; }
    const q = questionOf(els);
    out.push({ id: tag(els[0]), group: els.map((e) => tag(e)), tag: 'input', type, label: q, required: els.some((e) => e.required) || /\*\s*$|required/i.test(q),
      options: els.map((e) => labelOf(e)), value: els.filter((e) => e.checked).map((e) => labelOf(e)).join('|') });
  }
  window.__jhN = n;
  const btns = [...document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], a')].filter(vis)
    .map((b) => ({ id: tag(b), text: (txt(b) || b.value || b.getAttribute('aria-label') || '').slice(0, 80), kind: b.tagName.toLowerCase(), href: b.href || '' }));
  const body = txt(document.body).slice(0, 4000);
  // CAPTCHA = a challenge you can actually SEE and haven't solved yet. Invisible reCAPTCHA/hCaptcha (badge in the corner,
  // hidden challenge frame parked off-screen) and already-ticked checkboxes don't count.
  const onScreen = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 30 || r.height < 30 || r.bottom < 0 || r.right < 0 || r.left > innerWidth + 50) return false;
    for (let q = e; q && q !== document.documentElement; q = q.parentElement) { const st = getComputedStyle(q); if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) return false; }
    return true;
  };
  const solved = [...document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]')].some((x) => (x.value || '').length > 20);
  const widgets = [...document.querySelectorAll('iframe')].filter((f) => {
    const src = f.src || '', ti = f.title || '';
    if (f.closest('.grecaptcha-badge') || /size=invisible/i.test(src)) return false;
    return /recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs|funcaptcha|geo\.captcha-delivery/i.test(src) || /challenge|captcha/i.test(ti);
  }).filter(onScreen);
  const challengeOpen = widgets.some((f) => /bframe|hcaptcha\.com.*challenge|arkoselabs|funcaptcha|captcha-delivery/i.test(f.src || '') || /challenge expires|content of the hcaptcha challenge/i.test(f.title || ''));
  const px = document.querySelector('#px-captcha'); 
  const captcha = challengeOpen || (widgets.length > 0 && !solved) || !!(px && onScreen(px))
    || /verify you are human|are you a robot|press (and|&) hold|complete the security check|^just a moment/i.test(document.title + ' ' + body.slice(0, 300));
  const pw = [...document.querySelectorAll('input[type=password]')].filter(vis).length;
  return { fields: out, buttons: btns, body, captcha, pw, manualSubmit: window.__JHManualSubmit || null, url: location.href, title: document.title };
};

async function scanAll(p) {
  if (EXT) {
    const r = await X('scan', {}, 60);
    const res = { fields: [], buttons: [], body: '', captcha: false, pw: 0, manualSubmit: r.manualSubmit || null, url: r.url, title: r.title };
    for (const fr of (r.frames || []).sort((a, b) => a.frameId - b.frameId)) {
      fr.fields.forEach((f) => (f.frame = fr.frameId)); fr.buttons.forEach((b) => (b.frame = fr.frameId));
      res.fields.push(...fr.fields); res.buttons.push(...fr.buttons);
      res.body += ' ' + fr.body; res.captcha ||= fr.captcha; res.pw += fr.pw;
    }
    return res;
  }
  const res = { fields: [], buttons: [], body: '', captcha: false, pw: 0, manualSubmit: manualSubmitSignal };
  // all frames in parallel, each with a time limit: some frames (hidden captcha/ad iframes) never answer
  const frames = p.frames();
  const outs = await Promise.all(frames.map((fr) => Promise.race([fr.evaluate(SCAN).catch(() => null), sleep(5000).then(() => null)])));
  outs.forEach((r, fi) => {
    if (!r) return;
    r.fields.forEach((f) => (f.frame = fi)); r.buttons.forEach((b) => (b.frame = fi));
    res.fields.push(...r.fields); res.buttons.push(...r.buttons);
    res.body += ' ' + r.body; res.captcha ||= r.captcha; res.pw += r.pw; res.manualSubmit ||= r.manualSubmit;
    if (fi === 0) { res.url = r.url; res.title = r.title; }
  });
  if (!res.url) { try { res.url = p.url(); res.title = await Promise.race([p.title(), sleep(2000).then(() => '')]); } catch {} }
  return res;
}
const loc = (p, frame, id) => p.frames()[frame].locator(`[data-jh="${id}"]`).first();

// ---------------- answers ----------------
const fill = (s) => String(s || '').replace(/\{company\}/g, JOB.company || 'your company').replace(/\{role\}/g, JOB.title || 'this role').replace(/\{date\}/g, new Date().toDateString());
const abroad = (JOB.country || '') !== 'Pakistan';

// ---------------- salary (depends on where the job is) ----------------
const CUR = { Pakistan: 'PKR', 'United States': 'USD', 'United Kingdom': 'GBP', Australia: 'AUD', Canada: 'CAD', 'United Arab Emirates': 'AED', 'Saudi Arabia': 'SAR', Qatar: 'QAR',
  Germany: 'EUR', Netherlands: 'EUR', France: 'EUR', Spain: 'EUR', Portugal: 'EUR', Italy: 'EUR', Ireland: 'EUR', Belgium: 'EUR', Austria: 'EUR', Finland: 'EUR', Greece: 'EUR', Luxembourg: 'EUR', Estonia: 'EUR', Lithuania: 'EUR', Cyprus: 'EUR',
  Switzerland: 'CHF', Sweden: 'SEK', Norway: 'NOK', Denmark: 'DKK', Poland: 'PLN', 'New Zealand': 'NZD', Singapore: 'SGD' };
const MODE = JOB.work_mode || '';
const SAL = (() => {
  if ((JOB.country || '') === 'Pakistan') return { kind: 'pk', currency: 'PKR' };
  if (MODE === 'Remote') return { kind: 'remote', currency: 'USD' };
  return { kind: 'abroad', currency: CUR[JOB.country] || 'USD' };
})();
const yearly = (f) => /annual|per year|yearly|per annum|p\.a\.|\/yr|\byear\b/i.test(f.label + ' ' + (f.placeholder || ''));
const commas = (n) => Number(n).toLocaleString('en-US');
function postedRange() {   // e.g. "€60,000 - €75,000" / "USD 140000-190000" / "$52.00 - $55.00 Per Hour"
  const m = String(JOB.salary || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:-|–|to)\s*\D{0,4}(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  const lo = +m[1] * (m[2] ? 1000 : 1), hi = +m[3] * (m[4] ? 1000 : 1);
  return { lo, hi, hourly: /hour/i.test(JOB.salary) };
}
function salaryExpected(f) {
  const num = f.type === 'number' || /number only|numeric|digits/i.test(f.placeholder || '');
  if (SAL.kind === 'pk') {
    const n = +P.expected_pkr; if (!n) return null;
    const v = yearly(f) ? n * 12 : n;
    return num ? String(v) : `PKR ${commas(v)} per ${yearly(f) ? 'year' : 'month'} (gross)`;
  }
  if (SAL.kind === 'remote') {
    const n = +P.expected_remote_usd; if (!n) return null;
    const v = yearly(f) ? n * 12 : n;
    return num ? String(v) : `USD ${commas(v)} per ${yearly(f) ? 'year' : 'month'}`;
  }
  const r = postedRange();     // relocation job abroad: stay inside the employer's own range
  if (r && !r.hourly) { const mid = Math.round((r.lo + (r.hi - r.lo) * 0.6) / 1000) * 1000; return num ? String(mid) : `${SAL.currency} ${commas(mid)} per year (within the posted range), negotiable`; }
  return num ? null : (P.expected_abroad_text || null);   // a bare number field abroad with no posted range → ask you
}
function salaryCurrent(f) {
  const n = +P.current_salary_pkr; const pol = P.disclose_current || '';
  if (!n || /^never/i.test(pol)) return null;
  if (/^only/i.test(pol) && !f.required) return null;
  const v = yearly(f) ? n * 12 : n;
  if (f.type === 'number') return String(SAL.kind === 'pk' ? v : v);
  return `PKR ${commas(v)} per ${yearly(f) ? 'year' : 'month'} (gross)`;
}

const RULES = [
  [/first\s*name|given\s*name|forename/i, () => P.first_name],
  [/middle\s*name/i, () => P.middle_name],
  [/last\s*name|surname|family\s*name/i, () => P.last_name],
  [/preferred\s*(first\s*)?name|nick\s*name/i, () => P.preferred_name],
  [/^(full\s*)?name\b|your name|legal name|candidate name/i, () => `${P.first_name} ${P.last_name}`.trim()],
  [/e-?mail/i, () => P.email],
  [/country\s*(phone\s*)?code|dial(ing)?\s*code/i, () => P.phone_country_code],
  [/phone|mobile|cell|contact number|telephone/i, (f) => (f.type === 'tel' && /code/i.test(f.placeholder) ? P.phone : P.phone_full)],
  [/linked\s*in/i, () => P.linkedin],
  [/git\s*hub/i, () => P.github],
  [/google scholar/i, () => P.google_scholar],
  [/research\s*gate/i, () => P.researchgate],
  [/kaggle/i, () => P.kaggle],
  [/portfolio|personal (web)?site|website|blog|other (url|link)/i, () => P.portfolio || P.github],
  [/current (company|employer)|most recent (company|employer)|employer name/i, () => P.current_company],
  [/current (job )?title|current (role|position)|most recent (title|role)/i, () => P.current_title],
  [/years?.{0,30}(experience|exp\b)|experience.{0,20}years|how many years/i, (f) => (/\b(ai|ml|machine learning|llm|python|data)\b/i.test(f.label) ? P.years_ml : P.years_experience)],
  [/notice period/i, () => P.notice_period],
  [/start date|available to start|availability|earliest|when can you (start|join)/i, () => P.earliest_start],
  [/current (salary|compensation|ctc|pay|package)|present salary|last drawn/i, (f) => salaryCurrent(f)],
  [/salary|compensation|pay expectation|desired (pay|rate)|expected (ctc|pay|package)|rate expectation|expected (monthly|annual)/i, (f) => salaryExpected(f)],
  [/currency/i, () => SAL.currency],
  [/sponsor/i, () => (abroad ? P.needs_sponsorship : 'No')],
  [/(authori[sz]ed|eligible|legally|right|permit(ted)?) to work|work (authori[sz]ation|permit|eligibility)|legally (able|entitled)/i,
    (f) => (/pakistan/i.test(f.label) ? P.auth_home : (abroad ? P.auth_other : P.auth_home))],
  [/address from which|where (will|would|do) you (plan to |be )?work(ing)? from|plan(ning)? (on|to) work(ing)? from/i, () => P.location_display],
  [/(ever|previously|before).{0,25}(interviewed|applied)|interviewed (with|at) .{0,30} before/i, () => P.previously_employed],
  [/pronunc/i, () => null],
  [/are you an? .{0,25}(citizen|permanent resident|national)\b|do you hold .{0,20}(citizenship|permanent residency)/i, (f) => (/pakistan/i.test(f.label) ? 'Yes' : 'No')],
  [/relocat/i, () => P.willing_to_relocate],
  [/travel/i, () => P.willing_to_travel],
  [/(remote|hybrid|on-?site).{0,30}(prefer|work|arrangement)|work (mode|arrangement|setting)/i, () => P.work_preference],
  [/18 years|over 18|age of 18|legal (working )?age/i, () => P.over_18],
  [/security clearance/i, () => P.security_clearance],
  [/(previously|ever|formerly).{0,30}(work|employ)|former employee/i, () => P.previously_employed],
  [/non-?compete|restrictive covenant/i, () => P.non_compete],
  [/highest (level of )?(education|degree)|education level|degree level/i, () => P.highest_degree],
  [/(field|area) of study|\bmajor\b|discipline|specialization/i, () => P.field_of_study],
  [/degree/i, () => P.degree_name],
  [/school|university|college|institution/i, () => P.university],
  [/(education|school|university|college).{0,20}(start|from) year|start year.{0,20}(education|school|university|college)/i, () => P.grad_start_year],
  [/graduat|completion year|end year/i, () => P.grad_year],
  [/gpa|cgpa|grade point/i, () => P.gpa],
  [/date of birth|birth date|\bdob\b/i, () => P.date_of_birth],
  [/pronoun/i, () => P.pronouns],
  [/hispanic|latin[oa]/i, () => P.hispanic_latino],
  [/race|ethnic/i, () => P.race_ethnicity],
  [/veteran/i, () => P.veteran_status],
  [/disabilit/i, () => P.disability_status],
  [/transgender/i, () => P.transgender],
  [/sexual orientation/i, () => P.sexual_orientation],
  [/gender|\bsex\b/i, () => P.gender],
  [/how (did )?you (hear|heard|find|found|learn|learned)|where did you (hear|see|find)|source of (application|referral)|referral source|how .{0,20} hear about/i, () => P.how_heard],
  [/referr(ed|al) by|who referred|referrer|employee referral/i, () => P.referral_name || (P.referral_name === '' ? 'No' : '')],
  [/english.{0,20}(proficien|level|fluen)/i, () => P.english_level],
  [/^(spoken |which |what )?languages?\b|languages? (do you )?(speak|known)|language skill/i, () => P.languages],
  [/cover letter/i, (f) => (f.type === 'file' ? null : fill(P.cover_letter))],
  [/why (do you want|are you interested|us|this (role|company|position))|what (excites|interests|attracts) you|motivation|^why [a-z0-9.&' -]{2,30}\??\s*[*✱]?$/i, () => fill(P.why_company)],
  [/tell us about yourself|about you|summary|introduce yourself|additional information|anything else/i, () => fill(P.about_me)],
  // address/location rules last so questions like 'authorised to work in the United States' don't match 'state'
  [/address (line )?2|apartment|suite/i, () => P.address_line2],
  [/street|address( line)?( 1)?$|^address|home address|mailing address/i, () => P.address_line1],
  [/\bcity\b|town/i, () => P.city],
  [/state|province|region|county/i, () => P.state],
  [/zip|postal|post code|postcode/i, () => P.postal_code],
  [/nationality|citizenship/i, () => P.nationality],
  [/country( of residence)?$|^country|which country|country you (live|reside)/i, () => P.country],
  [/(current |your )?location|where are you (based|located)|based in|reside/i, () => P.location_display],
  [/time\s*zone/i, () => P.timezone],
];
const normQ = (q) => (q || '').toLowerCase().replace(/[*:?]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (q) => new Set(normQ(q).split(' ').filter((w) => w.length > 2));
function fromQA(label) {
  const t = toks(label); let best = null, bs = 0;
  for (const it of S.qa || []) {
    if (it.q_norm === normQ(label)) return it.a;
    const u = toks(it.q); const inter = [...t].filter((x) => u.has(x)).length; const s = inter / Math.max(1, Math.min(t.size, u.size));
    if (s > bs) { bs = s; best = it; }
  }
  return bs >= 0.75 && t.size >= 3 ? best.a : null;
}
function answerFor(f) {
  const label = f.label || f.name || '';
  const qa = fromQA(label); if (qa != null && qa !== '') return qa;
  for (const [rx, fn] of RULES) if (rx.test(label)) { const v = fn(f); if (v != null && v !== '') return String(v); return null; }
  return null;
}
const SYN = { yes: /^(yes|y|true|i am|i do|i have|i will|i would|i can|agree)\b/i, no: /^(no|n|false|i am not|i do not|i don't|i have not|i will not|not)\b/i,
  decline: /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose|self)|choose not|rather not|don.?t want|do not want|not (want|wish) to/i };
function pickOption(options, value) {
  if (!options || !options.length || value == null) return null;
  const v = String(value).trim(); const vl = v.toLowerCase();
  let o = options.find((x) => x.trim().toLowerCase() === vl); if (o) return o;
  const kind = SYN.decline.test(v) ? 'decline' : SYN.yes.test(v) ? 'yes' : SYN.no.test(v) ? 'no' : null;
  if (kind) { o = options.find((x) => SYN[kind].test(x.trim())); if (o) return o; }
  o = options.find((x) => x.toLowerCase().includes(vl) || (vl.length > 3 && vl.includes(x.trim().toLowerCase()) && x.trim().length > 2)); if (o) return o;
  const w0 = vl.split(/[ (,]/)[0]; if (w0.length > 3) { o = options.find((x) => x.toLowerCase().startsWith(w0)); if (o) return o; }
  const num = parseFloat(v);   // ranges like "1-2 years", "3+ years"
  if (!isNaN(num)) {
    for (const x of options) { const m = x.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/); if (m && num >= +m[1] && num <= +m[2]) return x; }
    for (const x of options) { const m = x.match(/(\d+)\s*\+/); if (m && num >= +m[1]) return x; }
    for (const x of options) { const m = x.match(/(?:less than|under|<)\s*(\d+)/i); if (m && num < +m[1]) return x; }
  }
  const tk = (x) => new Set(x.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'university'].includes(w)));
  const abbr = (v.match(/\(([A-Z]{2,})\)/) || [])[1];
  if (abbr) { o = options.find((x) => new RegExp(`\\b${abbr}\\b`).test(x)); if (o) return o; }
  const vt = tk(v); let best = null, bs = 0;
  for (const x of options) { const xt = tk(x); const inter = [...vt].filter((w) => xt.has(w)).length; const sc = inter / Math.max(1, Math.max(vt.size, xt.size)); if (sc > bs) { bs = sc; best = x; } }
  if (bs >= 0.6) return best;
  if (/pakistan/i.test(vl)) { o = options.find((x) => /pakistan/i.test(x)); if (o) return o; }
  if (/asian/i.test(vl)) { o = options.find((x) => /asian/i.test(x)); if (o) return o; }
  return null;
}

// ---------------- filling ----------------
const filledIds = new Set();
async function extSetField(f, value) {
  const A = (action, extra = {}) => X('act', { frame: f.frame, a: { id: f.id, action, ...extra } });
  try {
    if (f.type === 'file') {
      const isCover = /cover/i.test(f.label + ' ' + f.name);
      if (isCover && !S.cover_pdf) return false;
      const r = await A('files', { which: isCover ? 'cover' : 'resume', name: isCover ? 'Candidate_Cover_Letter.pdf' : 'Candidate_Resume.pdf' });
      if (r.ok) log(`Uploaded ${isCover ? 'cover letter' : 'resume'} → “${f.label.slice(0, 50)}”`);
      return !!r.ok;
    }
    if (f.tag === 'select') { const o = pickOption(f.options, value); if (!o) return false; return !!(await A('select', { value: o })).ok; }
    if (f.type === 'radio') {
      const o = pickOption(f.options, value); if (!o) return false;
      return !!(await X('act', { frame: f.frame, a: { id: f.group[f.options.indexOf(o)], action: 'check' } })).ok;
    }
    if (f.type === 'checkbox' && f.group) {
      let ok = false;
      for (const v of String(value).split(/[|,]/).map((x) => x.trim()).filter(Boolean)) {
        const o = pickOption(f.options, v);
        if (o && (await X('act', { frame: f.frame, a: { id: f.group[f.options.indexOf(o)], action: 'check' } })).ok) ok = true;
      }
      return ok;
    }
    if (f.type === 'checkbox') { if (SYN.yes.test(value) || value === 'on' || value === true) return !!(await A('check')).ok; return false; }
    if (f.type === 'combobox' || f.role === 'combobox') {
      let r = await A('comboOpen'); let opts = r.opts || [];
      let choice = pickOption(opts, value);
      if (!choice) {
        const q = /^(yes|no)$/i.test(value) ? value : String(value).split(/[ ,(]/)[0];
        r = await A('comboType', { value: q.slice(0, 30) }); opts = r.opts || [];
        choice = pickOption(opts, value) || (opts.length === 1 ? opts[0] : null);
      }
      if (choice) { await A('comboPick', { value: choice }); return true; }
      if (opts.length === 0 && !/^(yes|no)$/i.test(value)) { await A('key', { value: 'Enter' }); await sleep(300); await A('key', { value: 'Escape' }); return true; }
      await A('key', { value: 'Escape' }); return false;
    }
    const r = await A('fill', { value: String(value) });
    await jitter(80, 260);
    return !!r.ok;
  } catch (e) { log(`Could not fill “${f.label.slice(0, 40)}”: ${e.message.split('\n')[0].slice(0, 80)}`); return false; }
}
async function setField(p, f, value) {
  if (EXT) return extSetField(f, value);
  const l = loc(p, f.frame, f.id);
  try {
    if (f.type === 'file') {
      const isCover = /cover/i.test(f.label + ' ' + f.name);
      const file = isCover ? S.cover_pdf : S.resume;
      if (!file || (isCover && !S.cover_pdf)) return false;
      await l.setInputFiles(file); log(`Uploaded ${isCover ? 'cover letter' : 'resume'} → “${f.label.slice(0, 50)}”`); return true;
    }
    if (f.tag === 'select') {
      const o = pickOption(f.options, value); if (!o) return false;
      await l.selectOption({ label: o }); return true;
    }
    if (f.type === 'radio') {
      const o = pickOption(f.options, value); if (!o) return false;
      const idx = f.options.indexOf(o);
      await loc(p, f.frame, f.group[idx]).check({ force: true }); return true;
    }
    if (f.type === 'checkbox' && f.group) {
      const vals = String(value).split(/[|,]/).map((x) => x.trim()).filter(Boolean); let ok = false;
      for (const v of vals) { const o = pickOption(f.options, v); if (o) { await loc(p, f.frame, f.group[f.options.indexOf(o)]).check({ force: true }); ok = true; } }
      return ok;
    }
    if (f.type === 'checkbox') { if (SYN.yes.test(value) || value === 'on' || value === true) { await l.check({ force: true }); return true; } return false; }
    if (f.type === 'combobox' || f.role === 'combobox') {
      const fr = p.frames()[f.frame];
      await l.click().catch(() => {}); await sleep(500);
      const readOpts = async () => fr.evaluate(() => [...document.querySelectorAll('[role="option"], [class*="select__option" i], [id*="-option-"]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 200));
      let opts = await readOpts();
      let choice = pickOption(opts, value);
      if (!choice) {   // type to filter (first word usually enough), then read again
        const q = /^(yes|no)$/i.test(value) ? value : String(value).split(/[ ,(]/)[0];
        await l.fill('').catch(() => {}); await l.pressSequentially(q.slice(0, 30), { delay: 40 }); await sleep(900);
        opts = await readOpts(); choice = pickOption(opts, value) || (opts.length === 1 ? opts[0] : null);
      }
      if (choice) {
        const opt = fr.locator('[role="option"], [class*="select__option" i], [id*="-option-"]').filter({ hasText: choice }).first();
        await opt.click({ timeout: 3000 }).catch(async () => { await l.press('Enter'); });
        await sleep(300); return true;
      }
      if (opts.length === 0 && !/^(yes|no)$/i.test(value)) { await l.press('Enter').catch(() => {}); await sleep(300); await l.press('Escape').catch(() => {}); return true; }  // free-text combobox
      await l.press('Escape').catch(() => {}); return false;
    }
    await l.click({ timeout: 3000 }).catch(() => {});
    await l.fill(String(value));
    await l.dispatchEvent('change').catch(() => {}); await l.blur().catch(() => {});
    // some React selects are plain inputs with a listbox — confirm with Enter if a listbox popped open
    if (await p.locator('[role="listbox"] [role="option"]').first().isVisible().catch(() => false)) { await sleep(400); await l.press('Enter').catch(() => {}); }
    await jitter(80, 260);
    return true;
  } catch (e) { log(`Could not fill “${f.label.slice(0, 40)}”: ${e.message.split('\n')[0].slice(0, 80)}`); return false; }
}

const CONSENT = /agree|consent|acknowledge|privacy|terms|policy|accept|certify|confirm that|i understand|gdpr|data processing/i;
async function fillPage(p, scan, answered) {
  let filled = 0; const unknown = [];
  for (const f of scan.fields) {
    const key = `${f.frame}:${f.id}`;
    const empty = !f.value || (f.type === 'checkbox' && !f.value);
    if (f.type === 'file') {
      if (filledIds.has(key)) continue;
      const isResume = /resume|cv|curriculum/i.test(`${f.label} ${f.name} ${f.accept}`) || !/cover/i.test(`${f.label} ${f.name}`);
      if (isResume || (/cover/i.test(f.label) && S.cover_pdf)) { if (await setField(p, f, null)) { filledIds.add(key); filled++; } }
      else if (f.required) unknown.push(f);
      continue;
    }
    if (!empty) continue;
    let v = answered[f.id] ?? answerFor(f);
    if (v == null && f.type === 'checkbox' && f.single && CONSENT.test(f.label) && /yes/i.test(P.tick_consents || '')) v = 'yes';
    if (v == null || v === '') { if (f.required) unknown.push(f); continue; }
    if (await setField(p, f, v)) { filled++; filledIds.add(key); }
    else if (f.required) unknown.push(f);
  }
  return { filled, unknown };
}

// ---------------- page understanding ----------------
const DONE_RX = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(submitted|received|sent|complete)|we(’|')?ve received your application|successfully (applied|submitted)|you(’|')?ve applied|your application is on its way/i;
const APPLY_RX = /^(easy apply|quick apply|apply(?: now| today| here)?|apply (?:for|to) (?:this |the )?(?:job|position|role)|apply (?:on|via|with) .+|start|begin|launch|continue (?:your |the )?application|start (?:your |the )?application|i('|’)m interested|express interest|submit (?:your )?(?:resume|cv)|join (?:us|the team))\b/i;
const NEXT_RX = /^(next(?: step)?|continue(?: to (?:the )?(?:next step|application|review))?|save (?:and|&) (?:continue|next|proceed)|proceed|review(?: application| your application| details)?|go (?:to )?(?:next|forward)|advance|confirm (?:details|information)|complete (?:this )?step)\b/i;
// Final-submit labels must match the whole button. Prefix matching made a JD-page
// CTA such as “Apply Now” look like the final “Apply” submission action, so the
// listing-page branch deliberately refused to click it.
const SUBMIT_RX = /^(submit(?: application| your application| my application| now)?|send(?: application| my application)?|finish(?: application| and submit)?|complete application|finali[sz]e application|apply|confirm (?:and submit|application)|send it)\s*[›»→↗]*\s*$/i;
const SIGNIN_RX = /^(sign in|log ?in|continue with email|next)$/i;
const SIGNUP_RX = /create (an |your )?account|sign up|register|join now/i;
// Some sites expose a decorative external-link/arrow icon as part of the button's
// accessible text (for example “↗ Apply Now”). Ignore those ornaments when deciding
// what an action does, while preserving the original text for clicking and logs.
const actionText = (s) => String(s || '').replace(/^[\s↗↖↘↙→←»›•·✓✔＋+]+|[\s↗↖↘↙→←»›•·✓✔＋+]+$/g, '').trim();

async function clickBtn(p, b) {
  await jitter(400, 900);
  if (EXT) { const r = await X('act', { frame: b.frame, a: { id: b.id, action: 'click' } }); if (!r.ok) throw new Error(r.error || 'click failed'); await jitter(1500, 2800); await X('waitLoad', { ms: 12000 }); return; }
  await loc(p, b.frame, b.id).click({ timeout: 8000 }); await jitter(1500, 2800);
}

async function main() {
  emit('started', { url: JOB.url });
  const p0 = page();
  await p0.goto(JOB.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('open: ' + e.message.split('\n')[0]));
  await jitter(2500, 4000);
  const answered = {}; let lastSig = ''; let same = 0; let clickedApply = false; let blank = 0; let noBtn = 0;
  for (let step = 0; step < 80 && !STOP && !SKIP; step++) {
    const p = page();
    await p.waitForLoadState('domcontentloaded').catch(() => {}); await jitter(1000, 1800);
    const sc = await scanAll(p);
    if (STOP || SKIP) break;
    // page still loading / being swapped (SPA redirect, new tab) → give it a moment instead of judging an empty page
    if (!sc.url || (sc.fields.length === 0 && sc.buttons.length === 0)) { if (++blank <= 5) { await sleep(2000); step--; continue; } }
    else blank = 0;
    emit('page', { url: sc.url, title: sc.title, fields: sc.fields.length });
    if (sc.manualSubmit) { log(`Manual submission detected (“${sc.manualSubmit.text || 'Submit'}”)`); emit('done', { url: sc.manualSubmit.url || sc.url, via: 'manual submit button', button: sc.manualSubmit.text }); return; }
    if (DONE_RX.test(sc.body)) { emit('done', { url: sc.url, via: 'confirmation page' }); return; }
    if (sc.captcha) {
      const c = await needUser('captcha', 'A CAPTCHA / “are you human” check is showing. Please solve it in the browser window — I’ll carry on automatically.', {},
        async () => !(await scanAll(page())).captcha);
      if (c.cmd === 'skip') { emit('skipped'); return; } continue;
    }
    // authentication
    if (sc.pw > 0) {
      const isSignup = sc.pw >= 2 || SIGNUP_RX.test(sc.buttons.map((b) => b.text).join(' | ') + ' ' + sc.title);
      const emailF = sc.fields.find((f) => /e-?mail|user ?name|login/i.test(f.label + f.name) && f.type !== 'password');
      if (emailF && !emailF.value) await setField(p, emailF, P.account_email || P.email);
      if (P.account_password) {
        for (const f of sc.fields.filter((x) => x.type === 'password' && !x.value)) await setField(p, f, P.account_password);
        if (isSignup) { const r = await fillPage(p, await scanAll(p), answered); log(`Filled ${r.filled} sign-up fields`); }
        const btn = sc.buttons.find((b) => (isSignup ? SIGNUP_RX : SIGNIN_RX).test(actionText(b.text))) || sc.buttons.find((b) => SIGNIN_RX.test(actionText(b.text)) || /continue|submit/i.test(actionText(b.text)));
        if (btn && step < 60) { log(`${isSignup ? 'Creating account' : 'Signing in'} as ${P.account_email || P.email}`); await clickBtn(p, btn); await jitter(2500, 4000); }
        const after = await scanAll(page());
        if (after.pw === 0 && !after.captcha) continue;
      }
      const c = await needUser('login', isSignup
        ? 'This site needs an account. I filled what I could — please finish creating the account (password / email verification), then I’ll continue automatically.'
        : 'Please sign in in the browser window (I filled your email). I’ll continue as soon as you’re in.', {},
        async () => { const s = await scanAll(page()); return s.pw === 0 && !s.captcha; });
      if (c.cmd === 'skip') { emit('skipped'); return; } continue;
    }
    // job listing page → find the Apply button
    const applyBtn = sc.buttons.find((b) => APPLY_RX.test(actionText(b.text)) && !/sign in|alert|similar|save/i.test(actionText(b.text)));
    const realFields = sc.fields.filter((f) => !/search|keyword|filter|subscribe|newsletter/i.test(f.label + f.name));
    if (applyBtn && (realFields.length < 3 || !clickedApply) && !SUBMIT_RX.test(actionText(applyBtn.text).replace(/^apply$/i, 'x'))) {
      log(`Clicking “${applyBtn.text}”`); clickedApply = true;
      try { await clickBtn(p, applyBtn); } catch (e) { log('apply click failed: ' + e.message.split('\n')[0]); }
      continue;
    }
    // fill
    const r = await fillPage(p, sc, answered);
    if (STOP || SKIP) break;
    emit('filled', { count: r.filled, total: sc.fields.length, unknown: r.unknown.length });
    const sig = sc.url + '|' + sc.fields.map((f) => f.label).join(',');
    same = sig === lastSig ? same + 1 : 0; lastSig = sig;
    if (r.unknown.length) {
      const qs = r.unknown.map((f) => ({ fid: f.id, label: f.label, type: f.type, options: f.options || null, required: f.required }));
      const c = await needUser('questions', `${qs.length} question(s) I don’t know the answer to. Answer them in JobHunter (they’ll be remembered next time) or type them in the browser, then Continue.`, { questions: qs });
      if (c.cmd === 'skip') { emit('skipped'); return; }
      if (c.cmd === 'answers') for (const [fid, v] of Object.entries(c.answers || {})) answered[fid] = v;
      if (c.cmd === 'answers') {
        const sc2 = await scanAll(page());
        for (const f of sc2.fields.filter((x) => answered[x.id] != null)) await setField(page(), f, answered[f.id]);
      }
      continue;
    }
    // navigate
    const nextB = sc.buttons.find((b) => NEXT_RX.test(actionText(b.text)) && !/sign in|log ?in|continue with (google|linkedin|facebook|apple)|subscribe|search/i.test(actionText(b.text)));
    const subB = sc.buttons.find((b) => SUBMIT_RX.test(actionText(b.text)) && !/search|subscribe/i.test(actionText(b.text)));
    if (same >= 3) {
      const c = await needUser('stuck', 'I seem to be stuck on this page (maybe a validation error or a custom widget). Please fix it in the browser, then Continue.');
      if (c.cmd === 'skip') { emit('skipped'); return; } same = 0; continue;
    }
    if (STOP || SKIP) break;
    if (nextB) { log(`Clicking “${nextB.text}”`); await clickBtn(p, nextB).catch((e) => log(e.message.split('\n')[0])); continue; }
    if (subB) {
      if (/^yes/i.test(P.auto_submit || '')) { log(`Submitting (“${subB.text}”)`); await clickBtn(p, subB); emit('done', { url: sc.url, via: 'automatic submit', button: subB.text }); return; }
      const c = await needUser('review', 'Everything I know is filled in. Please review the form in the browser. Press “Submit for me” here, or submit it yourself in the browser.', { canSubmit: true },
        async () => { const s = await scanAll(page()); return !!s.manualSubmit || DONE_RX.test(s.body); });
      if (c.cmd === 'submit') {
        log(`Submitting (“${subB.text}”)`);
        try { await clickBtn(page(), subB); emit('done', { url: sc.url, via: 'JobHunter Submit for me', button: subB.text }); return; }
        catch (e) { log('submit failed: ' + e.message.split('\n')[0]); }
      }
      if (c.cmd === 'skip') { emit('skipped'); return; }
      continue;
    }
    if (++noBtn <= 3) { await sleep(2500); continue; }   // buttons often render late — look again before asking you
    noBtn = 0;
    const c = await needUser('stuck', 'I can’t find a Next / Submit button here. Please take the next step in the browser, then Continue.');
    if (c.cmd === 'skip') { emit('skipped'); return; }
  }
  if (SKIP) emit('skipped', { via: 'skip button' });
  else if (STOP) emit('stopped');
  else emit('gave_up', { message: 'Too many steps' });
}

try { await main(); } catch (e) { emit('error', { message: e.message.split('\n')[0] }); }
emit('finished');
// A submitted/skipped application is fully recorded before this point. End the
// worker and close only its application tab(s), allowing a queued job to start.
if (['done', 'skipped'].includes(OUTCOME)) {
  if (EXT) { try { await X('close', {}, 15); } catch {} process.exit(0); }
  if (cdpBrowser) { for (const p of OURS) { try { if (!p.isClosed()) await p.close(); } catch {} } process.exit(0); }
  try { await ctx.close(); } catch {}
  process.exit(0);
}
if (!STOP) { const c = await nextCmd(); if (c && c.cmd === 'stop') STOP = true; }   // keep the window open (so you can look) until JobHunter says close
if (EXT) {   // your browser: only close this job's tab(s), and only when it was submitted/skipped and JobHunter moves on
  if (STOP && ['done', 'skipped'].includes(OUTCOME)) { try { await X('close', {}, 15); } catch {} }
  process.exit(0);
}
if (cdpBrowser) {
  // shared window: leave your tabs alone; only tidy up this job's tab(s) when it was submitted/skipped and JobHunter moves on
  if (STOP && ['done', 'skipped'].includes(OUTCOME)) for (const p of OURS) { try { if (!p.isClosed()) await p.close(); } catch {} }
  process.exit(0);   // disconnect only — the JobHunter Chrome window stays open with your logins
}
try { await ctx.close(); } catch {}
process.exit(0);
