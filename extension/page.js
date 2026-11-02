// JobHunter Apply Helper — in-page helpers (injected into every frame of the application tab).
// SCAN is a copy of the one in scraper/apply.mjs; ACT performs one action on a tagged element.
if (!window.__JH) {
const cleanAction = (s) => String(s || '').replace(/^[\s↗↖↘↙→←»›•·✓✔＋+]+|[\s↗↖↘↙→←»›•·✓✔＋+]+$/g, '').replace(/\s+/g, ' ').trim();
const FINAL_SUBMIT = /^(submit(?: application| your application| my application| now)?|send(?: application| my application)?|finish(?: application| and submit)?|complete application|finali[sz]e application|apply|confirm (?:and submit|application)|send it)$/i;
const GENERIC_SUBMIT = /^(submit|apply|send|finish)$/i;
const looksLikeApplicationForm = (el) => {
  const form = el.form || el.closest('form');
  if (!form) return false;
  const fields = [...form.querySelectorAll('input:not([type="hidden"]), textarea, select')];
  const text = fields.map((f) => `${f.name || ''} ${f.id || ''} ${f.placeholder || ''} ${f.getAttribute('aria-label') || ''}`).join(' ');
  return fields.length >= 3 && /e-?mail|phone|resume|cv|cover|experience|work|candidate|first.?name|last.?name/i.test(text);
};
// A trusted click means the person clicked it. ACT's synthetic clicks are not trusted,
// which keeps manual-submit reporting separate from JobHunter's own Submit-for-me path.
document.addEventListener('click', (e) => {
  if (!e.isTrusted || !(e.target instanceof Element)) return;
  const el = e.target.closest('button, input[type="submit"], input[type="button"], a[role="button"]');
  if (!el) return;
  const label = cleanAction(el.innerText || el.value || el.getAttribute('aria-label') || '');
  if (!FINAL_SUBMIT.test(label) || (GENERIC_SUBMIT.test(label) && !looksLikeApplicationForm(el))) return;
  const detail = { text: label, url: location.href, at: Date.now() };
  window.__JHManualSubmit = detail;
  try { if (typeof window.__jhReportSubmit === 'function') window.__jhReportSubmit(detail); } catch {}
  try { globalThis.chrome?.runtime?.sendMessage({ type: 'jh_manual_submit', detail }); } catch {}
}, true);

const SCAN = () => {
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
    .map((b) => ({ id: tag(b), text: (txt(b) || b.value || b.getAttribute('aria-label') || '').slice(0, 80), kind: b.tagName.toLowerCase(), href: b.href || '',
      disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true' }));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
const OPT_SEL = '[role="option"], [class*="select__option" i], [id*="-option-"]';
const readOpts = () => [...document.querySelectorAll(OPT_SEL)].filter(visible).map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 200);
const setter = (el) => Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set;
const fire = (el, type, init = {}) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
const key = (el, k) => { for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: k, code: k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0, which: k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0, bubbles: true, cancelable: true })); };
const mouse = (el) => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })); el.click(); };
const setVal = (el, v) => { el.focus(); setter(el).call(el, v); fire(el, 'input'); fire(el, 'change'); };

async function ACT(a) {
  const el = document.querySelector(`[data-jh="${a.id}"]`);
  if (!el) return { ok: false, error: 'element gone' };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
  switch (a.action) {
    case 'click': mouse(el); return { ok: true };
    case 'check': if (!el.checked) { const lab = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); (visible(el) ? el : (lab || el)).click(); if (!el.checked) el.click(); } return { ok: el.checked };
    case 'fill': {
      el.focus(); fire(el, 'focus'); setVal(el, a.value); await sleep(150);
      if ([...document.querySelectorAll('[role="listbox"] [role="option"]')].some(visible)) { await sleep(400); key(el, 'Enter'); }
      el.blur(); fire(el, 'blur'); return { ok: true };
    }
    case 'select': {
      const i = [...el.options].findIndex((o) => o.text.trim() === a.value);
      if (i < 0) return { ok: false, error: 'option not found' };
      el.focus(); setter(el).call(el, el.options[i].value); el.selectedIndex = i; fire(el, 'input'); fire(el, 'change'); el.blur(); return { ok: true };
    }
    case 'files': {
      const bin = atob(a.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u8], a.name, { type: 'application/pdf' }));
      el.files = dt.files; fire(el, 'input'); fire(el, 'change');
      return { ok: el.files && el.files.length > 0 };
    }
    case 'comboOpen': { el.focus(); mouse(el); const ctl = el.closest('[class*="control" i]'); if (ctl) ctl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); key(el, 'ArrowDown'); await sleep(500); return { ok: true, opts: readOpts() }; }
    case 'comboType': { setVal(el, ''); await sleep(100); setVal(el, a.value); await sleep(900); return { ok: true, opts: readOpts() }; }
    case 'comboPick': {
      const o = [...document.querySelectorAll(OPT_SEL)].filter(visible).find((e) => (e.innerText || '').trim() === a.value) || [...document.querySelectorAll(OPT_SEL)].filter(visible).find((e) => (e.innerText || '').includes(a.value));
      if (o) { mouse(o); await sleep(300); return { ok: true }; }
      key(el, 'Enter'); await sleep(300); return { ok: true, viaEnter: true };
    }
    case 'key': key(el, a.value); return { ok: true };
  }
  return { ok: false, error: 'unknown action ' + a.action };
}
window.__JH = { scan: SCAN, act: ACT };
}
