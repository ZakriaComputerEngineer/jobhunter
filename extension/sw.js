// JobHunter Apply Helper — background worker.
// Long-polls the local JobHunter app (http://localhost:8765) for actions and runs them in a tab of YOUR browser,
// so applications open as a new tab in your current window with all your existing logins.
const BASE = 'http://127.0.0.1:8765';
const H = { 'X-JH': '1', 'Content-Type': 'application/json' };
const VER = chrome.runtime.getManifest().version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = navigator.userAgent; const BROWSER = /Edg\//.test(UA) ? 'Edge' : 'Chrome';

// ---------- session (which tab we're working in) ----------
let S = { tab: null, ours: [], manualSubmit: null };
const save = () => chrome.storage.session.set({ S }).catch(() => {});
chrome.storage.session.get('S').then((r) => { if (r && r.S) S = { tab: null, ours: [], manualSubmit: null, ...r.S }; }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'jh_manual_submit' || !sender.tab || !S.ours.includes(sender.tab.id)) return;
  S.manualSubmit = msg.detail || { text: 'Submit', url: sender.tab.url, at: Date.now() };
  save();
});

// follow tabs the application opens itself (e.g. "Apply on company site" in a new tab)
chrome.tabs.onCreated.addListener((t) => {
  if (S.tab != null && t.openerTabId === S.tab) { S.tab = t.id; S.ours.push(t.id); save(); }
});
chrome.tabs.onRemoved.addListener((id) => {
  if (!S.ours.includes(id)) return;
  S.ours = S.ours.filter((x) => x !== id);
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
    case 'open': {   // new tab in the window you're using right now
      let win = null;
      try { win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch {}
      const t = await chrome.tabs.create({ url: op.url, active: true, ...(win ? { windowId: win.id } : {}) });
      S = { tab: t.id, ours: [t.id], manualSubmit: null }; save();
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
    case 'close': {   // close only the tabs this application opened
      for (const id of S.ours) { try { await chrome.tabs.remove(id); } catch {} }
      S = { tab: null, ours: [], manualSubmit: null }; save(); return { ok: true };
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
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: BASE + '/#/apply' }));
loop();
