// JobHunter Apply Helper — background worker.
// Long-polls the local JobHunter app (http://localhost:8765) for actions and runs them in a tab of YOUR browser,
// so applications use your current window, existing logins, and optionally the job page you already opened.
const BASE = 'http://127.0.0.1:8765';
const H = { 'X-JH': '1', 'Content-Type': 'application/json' };
const VER = chrome.runtime.getManifest().version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = navigator.userAgent; const BROWSER = /Edg\//.test(UA) ? 'Edge' : 'Chrome';

// ---------- session (which tab we're working in) ----------
const EMPTY = () => ({ tab: null, ours: [], opened: [], manualSubmit: null, reuseCurrent: false });
let S = EMPTY();
const save = () => chrome.storage.session.set({ S }).catch(() => {});
const restored = chrome.storage.session.get('S').then((r) => {
  if (r && r.S) S = { ...EMPTY(), ...r.S, opened: r.S.opened || r.S.ours || [] };
}).catch(() => {});

function pageJob() {
  const first = (...xs) => xs.map((x) => String(x || '').trim()).find(Boolean) || '';
  const meta = (key, attr = 'property') => document.querySelector(`meta[${attr}="${key}"]`)?.content || '';
  const text = (value) => {
    if (!value) return '';
    const box = document.createElement('div'); box.innerHTML = String(value);
    return (box.innerText || box.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const nodes = [];
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const root = JSON.parse(el.textContent || 'null');
      const walk = (x) => {
        if (!x) return;
        if (Array.isArray(x)) return x.forEach(walk);
        if (typeof x !== 'object') return;
        const types = Array.isArray(x['@type']) ? x['@type'] : [x['@type']];
        if (types.some((t) => String(t).toLowerCase() === 'jobposting')) nodes.push(x);
        walk(x['@graph']);
      };
      walk(root);
    } catch {}
  }
  const job = nodes[0] || {};
  const org = job.hiringOrganization || {};
  const loc = Array.isArray(job.jobLocation) ? job.jobLocation[0] : (job.jobLocation || {});
  const addr = loc.address || {};
  const locationText = first(
    job.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '',
    [addr.addressLocality, addr.addressRegion, addr.addressCountry?.name || addr.addressCountry].filter(Boolean).join(', '),
    text(job.jobLocation)
  );
  const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  return {
    url: globalThis.location.href,
    title: first(job.title, meta('og:title'), document.querySelector('h1')?.innerText, document.title).slice(0, 300),
    company: first(org.name, meta('og:site_name'), meta('application-name', 'name')).slice(0, 200),
    location: locationText.slice(0, 300),
    description: first(text(job.description), meta('og:description'), meta('description', 'name'), body).slice(0, 50000),
  };
}

async function startCurrentTab() {
  await restored;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || '')) return { ok: false, error: 'Open a job page first, then press Apply.' };
  let job;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageJob });
    job = result?.result;
  } catch {
    return { ok: false, error: 'This browser page cannot be read. Open the actual HTTP/HTTPS job page and try again.' };
  }
  const previous = S;
  S = { tab: tab.id, ours: [tab.id], opened: [], manualSubmit: null, reuseCurrent: true };
  await save();
  try {
    const response = await fetch(`${BASE}/api/ext/manual-start`, { method: 'POST', headers: H, body: JSON.stringify(job) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Could not start the apply assistant');
    chrome.action.setBadgeBackgroundColor({ color: '#6d5dfc' });
    chrome.action.setBadgeText({ text: 'run' });
    return { ok: true, title: data.title || job.title, company: data.company || job.company, jobId: data.job_id };
  } catch (e) {
    S = previous; await save();
    return { ok: false, error: /fetch/i.test(String(e?.message)) ? 'Start JobHunter first, then try again.' : String(e?.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'jh_manual_submit' && sender.tab && S.ours.includes(sender.tab.id)) {
    S.manualSubmit = msg.detail || { text: 'Submit', url: sender.tab.url, at: Date.now() };
    save(); return;
  }
  if (msg?.type === 'jh_apply_current') {
    startCurrentTab().then(respond); return true;
  }
});

// follow tabs the application opens itself (e.g. "Apply on company site" in a new tab)
chrome.tabs.onCreated.addListener((t) => {
  if (S.tab != null && t.openerTabId === S.tab) {
    S.tab = t.id; S.ours.push(t.id); S.opened.push(t.id); save();
  }
});
chrome.tabs.onRemoved.addListener((id) => {
  if (!S.ours.includes(id)) return;
  S.ours = S.ours.filter((x) => x !== id);
  S.opened = S.opened.filter((x) => x !== id);
  if (S.tab === id) S.tab = S.ours.length ? S.ours[S.ours.length - 1] : null;
  save();
});

async function waitLoad(tabId, ms = 20000) {
  const t0 = Date.now(); await sleep(400);
  while (Date.now() - t0 < ms) {
    try { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return true; } catch { return false; }
    await sleep(300);
  }
  return false;
}
// every chrome.scripting call gets a time limit: one stuck frame (ad, captcha, about:blank) must never hang the scan
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function frameIds(tabId) {
  try { const fs = await chrome.webNavigation.getAllFrames({ tabId }); return (fs || []).filter((f) => !f.errorOccurred && /^https?:|^about:blank/.test(f.url)).map((f) => f.frameId); }
  catch { return [0]; }
}
async function inFrame(tabId, frameId, func, args = [], ms = 8000) {
  try { await withTimeout(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['page.js'] }), ms); } catch { return null; }
  try { const [r] = await withTimeout(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args }), ms); return r ? { frameId, result: r.result } : null; }
  catch { return null; }
}
const b64 = (buf) => { const u8 = new Uint8Array(buf); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

async function run(op) {
  const tab = S.tab;
  switch (op.op) {
    case 'hello': return { ok: true, browser: BROWSER, version: VER };
    case 'open': {   // reuse a manually selected page, otherwise open a new tab in the current window
      if (S.reuseCurrent && tab != null) {
        S.reuseCurrent = false; await save();
        const t = await chrome.tabs.update(tab, { active: true }).catch(() => null);
        if (!t) return { ok: false, error: 'the selected job tab was closed' };
        try { await chrome.windows.update(t.windowId, { focused: true }); } catch {}
        await waitLoad(tab, 30000);
        return { ok: true, tab, reused: true };
      }
      let win = null;
      try { win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch {}
      const t = await chrome.tabs.create({ url: op.url, active: true, ...(win ? { windowId: win.id } : {}) });
      S = { tab: t.id, ours: [t.id], opened: [t.id], manualSubmit: null, reuseCurrent: false }; save();
      await waitLoad(t.id, 30000);
      return { ok: true, tab: t.id };
    }
    case 'goto': await chrome.tabs.update(tab, { url: op.url }); await waitLoad(tab, 30000); return { ok: true };
    case 'waitLoad': return { ok: await waitLoad(tab, op.ms || 15000) };
    case 'focus': {
      if (tab == null) return { ok: false };
      const t = await chrome.tabs.update(tab, { active: true });
      try { await chrome.windows.update(t.windowId, { focused: true, drawAttention: true }); } catch {}
      return { ok: true };
    }
    case 'close': {   // never close a manually selected tab; only tabs the helper itself opened
      for (const id of S.opened) { try { await chrome.tabs.remove(id); } catch {} }
      S = EMPTY(); save(); return { ok: true };
    }
    case 'scan': {
      if (tab == null) return { ok: false, error: 'no tab' };
      const ids = await frameIds(tab);
      const rs = await Promise.all(ids.map((id) => inFrame(tab, id, () => (window.__JH ? window.__JH.scan() : null), [], 6000)));
      const frames = rs.filter((r) => r && r.result).map((r) => ({ frameId: r.frameId, ...r.result }));
      const t = await chrome.tabs.get(tab).catch(() => null);
      return { ok: true, frames, manualSubmit: S.manualSubmit, url: t && t.url, title: t && t.title };
    }
    case 'act': {
      if (tab == null) return { ok: false, error: 'no tab' };
      const a = { ...op.a };
      if (a.action === 'files') {
        const r = await fetch(`${BASE}/api/ext/file/${a.which}`, { headers: H });
        if (!r.ok) return { ok: false, error: 'file not available' };
        a.b64 = b64(await r.arrayBuffer());
      }
      const r = await inFrame(tab, op.frame || 0, (x) => window.__JH.act(x), [a], 20000);
      return (r && r.result) || { ok: false, error: 'frame not reachable' };
    }
  }
  return { ok: false, error: 'unknown op ' + op.op };
}

// ---------- poll loop ----------
let polling = false;
async function loop() {
  if (polling) return; polling = true;
  try {
    while (true) {
      let op = null;
      try {
        const r = await fetch(`${BASE}/api/ext/poll?v=${VER}&b=${BROWSER}`, { headers: H });
        op = (await r.json()).op;
        chrome.action.setBadgeText({ text: '' });
      } catch { chrome.action.setBadgeText({ text: 'off' }); await sleep(5000); }
      if (op) {
        let res;
        try { res = await run(op); } catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
        try { await fetch(`${BASE}/api/ext/result`, { method: 'POST', headers: H, body: JSON.stringify({ id: op.id, ...res }) }); } catch {}
      }
      await chrome.runtime.getPlatformInfo();   // any extension API call keeps the worker awake
    }
  } finally { polling = false; }
}
chrome.alarms.create('jh-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => loop());
chrome.runtime.onStartup.addListener(() => loop());
chrome.runtime.onInstalled.addListener(() => loop());
loop();
