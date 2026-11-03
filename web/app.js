/* JobHunter SPA — vanilla JS, no build step */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r.json();
};
const toast = (m, cls = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = m; $('#toast').appendChild(d); setTimeout(() => d.remove(), 4500); };
const rel = (iso) => { if (!iso) return '–'; const s = (Date.now() - new Date(iso)) / 1000; if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + 'd ago'; };
const scoreColor = (v) => (v >= 80 ? 'var(--ok)' : v >= 65 ? '#a3e635' : v >= 50 ? 'var(--warn)' : 'var(--bad)');
const ring = (v, size = 40) => `<div class="ring" style="--p:${Math.round(v || 0)};--c:${scoreColor(v)};width:${size}px;height:${size}px"><span>${Math.round(v || 0)}</span></div>`;
const PCOL = { LinkedIn: '#0a66c2', Indeed: '#2557a7', Glassdoor: '#0caa41', Bayt: '#e4572e', 'Rozee.pk': '#00a0e3', Seek: '#e60278', Remotive: '#4b6bfb', RemoteOK: '#ff4742', WeWorkRemotely: '#1f8ceb', Arbeitnow: '#5b5bd6', Jobicy: '#00b3a4', Himalayas: '#3b82f6', 'Working Nomads': '#14b8a6', "HN Who's Hiring": '#ff6600', 'Careerjet PK': '#1d9bf0', 'Jooble PK': '#2dbf75', Manual: '#888' };
const plat = (p) => `<span class="plat" style="color:${PCOL[p] || 'var(--muted)'};border-color:${(PCOL[p] || '#666')}55">${esc(p)}</span>`;
const FLAG = { Remote: '🏠', Pakistan: '🇵🇰', Australia: '🇦🇺', 'United Arab Emirates': '🇦🇪', 'United Kingdom': '🇬🇧', Germany: '🇩🇪', Netherlands: '🇳🇱', France: '🇫🇷', Spain: '🇪🇸', Portugal: '🇵🇹', 'United States': '🇺🇸', Canada: '🇨🇦', India: '🇮🇳', Singapore: '🇸🇬', 'Saudi Arabia': '🇸🇦', Qatar: '🇶🇦', Ireland: '🇮🇪', Sweden: '🇸🇪', Poland: '🇵🇱', Belgium: '🇧🇪', Austria: '🇦🇹', Switzerland: '🇨🇭', Greece: '🇬🇷', Italy: '🇮🇹', Bulgaria: '🇧🇬', Turkey: '🇹🇷', Worldwide: '🌍', 'Europe (any)': '🇪🇺' };
const MODEI = { Remote: '🏠', Hybrid: '⇄', Onsite: '🏢' };
let META = { domains: [], templates: [], statuses: [] };
const DOM = (id) => META.domains.find((d) => d.id === id) || { label: id, color: '#666' };
const ELC = { eligible: ['var(--ok)', '✓ open to you'], maybe: ['var(--warn)', '? check'], blocked: ['var(--bad)', '✕ restricted'] };
const eligChip = (j) => (j.elig ? `<span class="chip" title="${esc(j.elig_reason || '')}" style="margin-top:4px;color:${ELC[j.elig][0]};border-color:${ELC[j.elig][0]}55">${ELC[j.elig][1]}</span>` : '');
const domChips = (s) => (s || '').split(',').filter(Boolean).map((d) => `<span class="chip" style="border-color:${DOM(d).color}66;color:${DOM(d).color}">${esc(DOM(d).label)}</span>`).join(' ');

/* ---------------- router ---------------- */
const VIEWS = {};
function parseHash() { const h = location.hash.slice(2) || 'dashboard'; const [path, qs] = h.split('?'); return { parts: path.split('/'), q: new URLSearchParams(qs || '') }; }
async function route() {
  $$('.drawer,.drawer-bg,.modal').forEach((e) => e.remove());
  const { parts, q } = parseHash();
  const v = parts[0];
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v || (v === 'resume' && a.dataset.v === 'resumes')));
  const fn = VIEWS[v] || VIEWS.dashboard;
  $('#view').innerHTML = '<div class="empty"><div class="spin"></div></div>';
  try { await fn(parts.slice(1), q); } catch (e) { $('#view').innerHTML = `<div class="empty"><div class="big">⚠</div>${esc(e.message)}</div>`; console.error(e); }
}
window.addEventListener('hashchange', route);
const setTitle = (t) => { $('#title').textContent = t; document.title = t + ' · JobHunter'; };

/* ---------------- charts ---------------- */
const bars = (rows, { label = (r) => r.k, val = (r) => r.n, max, color, onclick } = {}) => {
  const m = max || Math.max(1, ...rows.map(val));
  return rows.map((r, i) => `<div class="bar" ${onclick ? `style="cursor:pointer" data-i="${i}"` : ''}><div class="lab" title="${esc(label(r))}">${esc(label(r) || 'Unknown')}</div><div class="trk"><div class="fill" style="width:${(100 * val(r)) / m}%;${color ? `background:${color(r)}` : ''}"></div></div><div class="n">${val(r)}</div></div>`).join('');
};
const spark = (rows) => {
  if (!rows.length) return '<div class="dim small">No data yet</div>';
  const w = 520, h = 120, m = Math.max(...rows.map((r) => r.n)), bw = w / rows.length;
  return `<svg viewBox="0 0 ${w} ${h + 18}" width="100%" height="${h + 18}">${rows.map((r, i) => { const bh = Math.max(2, (r.n / m) * h); return `<rect x="${i * bw + 2}" y="${h - bh}" width="${bw - 4}" height="${bh}" rx="3" fill="url(#gr)"><title>${r.d}: ${r.n}</title></rect>`; }).join('')}<defs><linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a48bff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>${rows.map((r, i) => (i % Math.ceil(rows.length / 7) === 0 ? `<text x="${i * bw + bw / 2}" y="${h + 14}" font-size="10" fill="var(--dim)" text-anchor="middle">${r.d.slice(5)}</text>` : '')).join('')}</svg>`;
};
const donut = (rows) => {
  const tot = rows.reduce((a, r) => a + r.n, 0) || 1; let acc = 0; const cols = ['#7c5cff', '#00b894', '#38bdf8', '#f5a524', '#ef4444', '#a3e635'];
  const segs = rows.map((r, i) => { const a0 = (acc / tot) * 2 * Math.PI; acc += r.n; const a1 = (acc / tot) * 2 * Math.PI; const L = a1 - a0 > Math.PI ? 1 : 0; const p = (a) => [60 + 48 * Math.sin(a), 60 - 48 * Math.cos(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1 - 0.0001); return `<path d="M${x0} ${y0} A48 48 0 ${L} 1 ${x1} ${y1}" stroke="${cols[i % 6]}" stroke-width="16" fill="none"><title>${r.k}: ${r.n}</title></path>`; }).join('');
  return `<div class="row" style="gap:18px"><svg width="120" height="120">${segs}<text x="60" y="66" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)">${tot}</text></svg><div class="col small">${rows.map((r, i) => `<div class="row"><span class="dot" style="background:${cols[i % 6]}"></span>${esc(r.k)} <b>${r.n}</b></div>`).join('')}</div></div>`;
};

/* ---------------- dashboard ---------------- */
VIEWS.dashboard = async () => {
  setTitle('Dashboard');
  const s = await api('/api/stats');
  const t = s.total || {};
  $('#view').innerHTML = `
  <div class="grid g4">
    <div class="card kpi"><div class="l">Jobs in window (${META.settings?.days || 7}d)</div><div class="v">${t.n || 0}</div><div class="d">+${s.new_24h} new in 24h</div><div class="dim small">${s.blocked || 0} region-restricted hidden</div></div>
    <div class="card kpi"><div class="l">80+ ATS matches (base CV)</div><div class="v" style="color:var(--ok)">${t.hot || 0}</div><div class="dim small">avg match ${Math.round(t.avg || 0)}</div></div>
    <div class="card kpi"><div class="l">Remote roles</div><div class="v">${t.remote || 0}</div><div class="dim small">${Math.round((100 * (t.remote || 0)) / Math.max(1, t.n))}% of all</div></div>
    <div class="card kpi"><div class="l">Applications</div><div class="v">${(s.pipeline.find((p) => p.k === 'applied') || {}).n || 0}</div><div class="dim small">${s.pipeline.map((p) => `${p.k}: ${p.n}`).join(' · ') || 'none yet'}</div></div>
  </div>
  <div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:14px">
    <div class="card"><h3>Top matches for you <span class="sp"></span><a class="small" href="#/jobs?sort=match&seniority=Mid|Junior">see all →</a></h3>
      <table class="tbl" style="border:0"><tbody>${s.top.map((j) => `<tr data-id="${j.id}"><td style="width:50px">${ring(j.match)}</td><td><div class="jt">${esc(j.title)}</div><div class="jc">${esc(j.company)} · ${FLAG[j.country] || ''} ${esc(j.country)} · ${MODEI[j.work_mode] || ''} ${j.work_mode}</div></td><td>${plat(j.platform)}</td><td class="dim small">${rel(j.posted)}</td></tr>`).join('') || '<tr><td class="empty">No jobs yet — hit “Scrape now”.</td></tr>'}</tbody></table>
    </div>
    <div class="col" style="gap:14px">
      <div class="card"><h3>Postings per day</h3>${spark(s.trend)}</div>
      <div class="card"><h3>Work mode</h3>${donut(s.by_mode)}</div>
    </div>
  </div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><h3>By domain</h3><div id="bDom">${bars(s.by_domain, { label: (r) => DOM(r.k).label, color: (r) => DOM(r.k).color, onclick: 1 })}</div></div>
    <div class="card"><h3>By platform</h3><div id="bPlat">${bars(s.by_platform.slice(0, 14), { color: (r) => PCOL[r.k] || 'var(--brand)', onclick: 1 })}</div></div>
    <div class="card"><h3>By country</h3><div id="bCty">${bars(s.by_country.slice(0, 14), { label: (r) => `${FLAG[r.k] || ''} ${r.k}`, onclick: 1 })}</div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Recent resumes</h3>${s.resumes.map((r) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><a href="#/resume/${r.id}" style="flex:1">${esc(r.name)}</a><span class="pill" style="color:${scoreColor(r.score)}">${Math.round(r.score)}</span><span class="dim small">from ${Math.round(r.base_score)}</span></div>`).join('') || '<div class="dim">None yet. Open a job and press “Generate resume”.</div>'}</div>
    <div class="card"><h3>Recent scrapes</h3>${s.runs.map((r) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="pill">${esc(r.source)}</span><span>${rel(r.finished)}</span><span class="dim" style="flex:1">${esc((r.platforms || '').slice(0, 60))}</span><b>${r.n_new}</b><span class="dim">new / ${r.n_found}</span></div>`).join('') || '<div class="dim">No runs yet.</div>'}</div>
  </div>`;
  $$('#view tr[data-id]').forEach((tr) => (tr.onclick = () => openJob(tr.dataset.id)));
  $$('#bDom .bar').forEach((b) => (b.onclick = () => (location.hash = `#/jobs?domain=${s.by_domain[b.dataset.i].k}`)));
  $$('#bPlat .bar').forEach((b) => (b.onclick = () => (location.hash = `#/jobs?platform=${encodeURIComponent(s.by_platform[b.dataset.i].k)}`)));
  $$('#bCty .bar').forEach((b) => (b.onclick = () => (location.hash = `#/jobs?country=${encodeURIComponent(s.by_country[b.dataset.i].k)}`)));
};

/* ---------------- jobs ---------------- */
const JF = { sort: 'newest', days: '7', page: 1, per: 50, dedupe: '1', seniority: 'Mid' };
const FILTER_KEYS = ['elig', 'english', 'q', 'platform', 'country', 'region', 'mode', 'seniority', 'domain', 'status', 'min_match', 'days', 'sort', 'starred', 'dedupe', 'with_jd', 'template'];
let JSEL = new Set();
VIEWS.jobs = async (_, q) => {
  setTitle('Jobs');
  const f = { ...JF };
  FILTER_KEYS.forEach((k) => { if (q.has(k)) f[k] = q.get(k); });
  if (q.has('page')) f.page = +q.get('page');
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null)).toString();
  const d = await api('/api/jobs?' + qs);
  const go = (patch) => { const n = { ...f, ...patch }; if (!('page' in patch)) n.page = 1; Object.keys(n).forEach((k) => (n[k] === '' || n[k] == null) && delete n[k]); location.hash = '#/jobs?' + new URLSearchParams(n).toString(); };
  const multi = (key, label, opts, fmt = (x) => x) => {
    const cur = (f[key] || '').split('|').filter(Boolean);
    return `<div class="sel" data-k="${key}"><button class="${cur.length ? 'act' : ''}">${label}${cur.length ? `: ${cur.length > 1 ? cur.length : esc(fmt(cur[0]))}` : ''} ▾</button><div class="menu" hidden>${opts.map(([v, n]) => `<label><input type="checkbox" value="${esc(v)}" ${cur.includes(v) ? 'checked' : ''}> ${esc(fmt(v))}<span class="n">${n}</span></label>`).join('')}<div class="row" style="padding:6px"><button class="btn sm ghost clr">Clear</button><span class="sp" style="flex:1"></span><button class="btn sm pri ap">Apply</button></div></div></div>`;
  };
  const F = d.facets;
  $('#view').innerHTML = `
  <div class="filters">
    <input class="inp" id="fq" placeholder="Filter…" value="${esc(f.q || '')}" style="width:220px">
    ${multi('domain', 'Domain', F.domain, (x) => DOM(x).label)}
    ${multi('platform', 'Platform', F.platform)}
    ${multi('country', 'Country', F.country, (x) => `${FLAG[x] || ''} ${x}`)}
    ${multi('region', 'Region', F.region)}
    ${multi('mode', 'Work mode', F.work_mode)}
    ${multi('seniority', 'Level', F.seniority)}
    ${multi('status', 'Status', META.statuses.filter((s) => s !== 'applied').map((s) => [s, '']))}
    <select class="inp" id="felig" title="Can someone based in Pakistan actually get this job?">${[['', 'Open to me (default)'], ['eligible', 'Definitely open to me'], ['all', 'Show all (incl. restricted)'], ['blocked', 'Only restricted']].map(([v, l]) => `<option value="${v}" ${String(f.elig || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select class="inp" id="fdays">${[['1', '24 hours'], ['3', '3 days'], ['7', 'This week'], ['14', '2 weeks'], ['30', '30 days'], ['', 'Any time']].map(([v, l]) => `<option value="${v}" ${String(f.days || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select class="inp" id="fmin">${[['', 'Any match'], ['50', 'Match 50+'], ['65', 'Match 65+'], ['80', 'Match 80+']].map(([v, l]) => `<option value="${v}" ${String(f.min_match || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="row small muted"><input type="checkbox" id="fstar" ${f.starred === '1' ? 'checked' : ''}> ★ only</label>
    <label class="row small muted" title="Hide postings written in German, French, Spanish…"><input type="checkbox" id="fen" ${f.english === '1' ? 'checked' : ''}> English JDs</label>
    <label class="row small muted" title="Merge the same job posted on several platforms"><input type="checkbox" id="fdup" ${f.dedupe !== '0' ? 'checked' : ''}> merge duplicates</label>
    <span style="flex:1"></span>
    <span class="muted small">Sort</span>
    <select class="inp" id="fsort">${[['newest', 'Newest first'], ['match', 'Best match'], ['seen', 'Recently found'], ['company', 'Company A–Z'], ['platform', 'Platform'], ['country', 'Country'], ['title', 'Title A–Z'], ['oldest', 'Oldest']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <a class="btn" href="/api/export.csv?${qs}" title="Download these results as CSV">⇩ CSV</a>
  </div>
  <div class="row" style="margin:-2px 0 10px"><span class="muted small"><b style="color:var(--text)">${d.total}</b> jobs</span>
    ${Object.keys(f).filter((k) => !['sort', 'page', 'per', 'dedupe'].includes(k) && f[k] && !(k === 'days' && f[k] === '7')).map((k) => `<span class="chip">${k}: ${esc(f[k])} <a href="javascript:void 0" data-x="${k}">✕</a></span>`).join('')}
    <span style="flex:1"></span>
    ${d.total ? `<button class="btn sm pri" id="applyAll" title="Queue every job matching the current filters">⚡ Apply all ${d.total}</button>` : ''}
    <span id="bulk" class="row" ${JSEL.size ? '' : 'hidden'}><span class="small muted"><b id="nsel">${JSEL.size}</b> selected</span><button class="btn sm" data-b="star">★ Star</button><button class="btn sm" data-b="saved">Save</button><button class="btn sm" data-b="applied">Mark applied</button><button class="btn sm pri" id="bApply">⚡ Apply to selected</button><button class="btn sm danger" data-b="hide">Hide</button></span>
  </div>
  ${d.items.length ? `<table class="tbl"><thead><tr><th style="width:28px"><input type="checkbox" id="selAll"></th><th style="width:56px" data-s="match">Match</th><th data-s="title">Role</th><th data-s="platform">Platform</th><th data-s="country">Location</th><th>Domains</th><th data-s="newest">Posted</th><th style="width:210px"></th></tr></thead><tbody>
  ${d.items.map((j) => `<tr data-id="${j.id}" class="${JSEL.has(j.id) ? 'sel' : ''}">
    <td><input type="checkbox" class="cb" ${JSEL.has(j.id) ? 'checked' : ''}></td>
    <td title="Auto CV ${Math.round(j.match_auto)} · ML CV ${Math.round(j.match_ml)} · JD: ${j.jd_quality}${j.jd_quality !== 'full' ? ' (estimate — fetch full JD for an exact score)' : ''}" style="${j.jd_quality === 'snippet' ? 'opacity:.6' : ''}">${ring(j.match)}</td>
    <td><div class="row"><span class="star ${j.starred ? 'on' : ''}" data-star>${j.starred ? '★' : '☆'}</span><div><div class="jt">${esc(j.title)}</div><div class="jc">${esc(j.company)} ${j.salary ? `· <span style="color:var(--ok)">${esc(j.salary)}</span>` : ''} ${j.status !== 'new' ? `<span class="pill">${esc(j.status)}</span>` : ''} <span class="pill" style="font-weight:500">${esc(j.seniority)}</span>${j.lang && j.lang !== 'English' ? ` <span class="pill" style="color:var(--warn)">JD in ${esc(j.lang)}</span>` : ''}${j.years_req ? ` <span class="dim small">${j.years_req}+ yrs</span>` : ''}</div></div></div></td>
    <td>${plat(j.platform)}${j.also_on?.length ? `<div class="dim small" title="${esc(j.also_on.map((a) => a.platform).join(', '))}">+${j.also_on.length} more</div>` : ''}</td>
    <td><div>${FLAG[j.country] || ''} ${esc(j.country)}</div><div class="jc">${MODEI[j.work_mode] || ''} ${j.work_mode} · ${esc((j.location || '').slice(0, 34))}</div>${eligChip(j)}</td>
    <td style="max-width:230px">${domChips(j.domains)}</td>
    <td class="small" title="${esc(j.posted)}">${rel(j.posted)}<div class="dim">${j.applicants ? esc(j.applicants.replace(/applicants?/i, 'appl.')) : ''}</div></td>
    <td><div class="acts"><a class="btn sm" href="${esc(j.url)}" target="_blank" rel="noopener" data-stop>Open ↗</a><button class="btn sm" data-jd>JD</button><button class="btn sm pri" data-gen>Generate</button><button class="btn sm" data-apply title="Open the application and fill it for me">⚡ Apply</button></div></td>
  </tr>`).join('')}</tbody></table>
  <div class="pager"><span class="muted small">Page ${f.page} of ${Math.max(1, Math.ceil(d.total / f.per))}</span><button class="btn sm" id="pp" ${f.page <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="btn sm" id="pn" ${f.page * f.per >= d.total ? 'disabled' : ''}>Next ›</button></div>`
    : `<div class="card empty"><div class="big">🔍</div>No jobs match these filters.<br><br><button class="btn" onclick="location.hash='#/jobs'">Reset filters</button></div>`}`;
  // wiring
  $('#fq').onkeydown = (e) => e.key === 'Enter' && go({ q: e.target.value });
  $('#fdays').onchange = (e) => go({ days: e.target.value });
  $('#felig').onchange = (e) => go({ elig: e.target.value });
  $('#fmin').onchange = (e) => go({ min_match: e.target.value });
  $('#fsort').onchange = (e) => go({ sort: e.target.value });
  $('#fstar').onchange = (e) => go({ starred: e.target.checked ? '1' : '' });
  $('#fdup').onchange = (e) => go({ dedupe: e.target.checked ? '1' : '0' });
  $('#fen').onchange = (e) => go({ english: e.target.checked ? '1' : '' });
  $$('[data-x]').forEach((a) => (a.onclick = () => go({ [a.dataset.x]: '' })));
  $$('.sel').forEach((s) => {
    const m = $('.menu', s);
    $('button', s).onclick = (e) => { e.stopPropagation(); $$('.menu').forEach((x) => x !== m && (x.hidden = true)); m.hidden = !m.hidden; };
    m.onclick = (e) => e.stopPropagation();
    $('.ap', m).onclick = () => go({ [s.dataset.k]: $$('input:checked', m).map((i) => i.value).join('|') });
    $('.clr', m).onclick = () => go({ [s.dataset.k]: '' });
  });
  document.onclick = () => $$('.menu').forEach((x) => (x.hidden = true));
  $$('th[data-s]').forEach((th) => (th.onclick = () => go({ sort: th.dataset.s })));
  $('#pp') && ($('#pp').onclick = () => go({ page: f.page - 1 }));
  $('#pn') && ($('#pn').onclick = () => go({ page: f.page + 1 }));
  const updBulk = () => { $('#bulk').hidden = !JSEL.size; $('#nsel').textContent = JSEL.size; };
  $('#selAll') && ($('#selAll').onchange = (e) => { $$('tbody tr').forEach((tr) => { const id = +tr.dataset.id; e.target.checked ? JSEL.add(id) : JSEL.delete(id); $('.cb', tr).checked = e.target.checked; tr.classList.toggle('sel', e.target.checked); }); updBulk(); });
  $$('tbody tr').forEach((tr) => {
    const id = +tr.dataset.id;
    tr.onclick = (e) => {
      if (e.target.closest('[data-stop]')) return;
      if (e.target.classList.contains('cb')) { e.target.checked ? JSEL.add(id) : JSEL.delete(id); tr.classList.toggle('sel', e.target.checked); updBulk(); return; }
      if (e.target.closest('[data-star]')) { const on = !e.target.classList.contains('on'); api(`/api/jobs/${id}`, { method: 'PATCH', body: { starred: on ? 1 : 0 } }); e.target.classList.toggle('on', on); e.target.textContent = on ? '★' : '☆'; return; }
      if (e.target.closest('[data-gen]')) return genModal(id);
      if (e.target.closest('[data-apply]')) return applyModal([id]);
      openJob(id, e.target.closest('[data-jd]') ? 'jd' : 'overview');
    };
  });
  $('#bApply') && ($('#bApply').onclick = () => applyModal([...JSEL]));
  $('#applyAll') && ($('#applyAll').onclick = async () => {
    const b = $('#applyAll'); const old = b.textContent; b.disabled = true; b.innerHTML = '<span class="spin"></span> Loading…';
    try {
      const ids = []; let page = 1; let total = d.total;
      do {
        const af = { ...f, page, per: 500 };
        const batch = await api('/api/jobs?' + new URLSearchParams(Object.entries(af).filter(([, v]) => v !== '' && v != null)).toString());
        batch.items.forEach((j) => ids.push(j.id)); total = batch.total;
        if (!batch.items.length) break;
        page++;
      } while (ids.length < total);
      const unique = [...new Set(ids)];
      if (!unique.length) return toast('No unapplied jobs match these filters', 'err');
      applyModal(unique);
    } catch (e) { toast('Could not load all jobs: ' + esc(e.message), 'err'); }
    finally { b.disabled = false; b.textContent = old; }
  });
  $$('[data-b]').forEach((b) => (b.onclick = async () => {
    const k = b.dataset.b; const body = { ids: [...JSEL] };
    if (k === 'star') body.starred = 1; else if (k === 'hide') body.hidden = 1; else body.status = k;
    await api('/api/jobs/bulk', { method: 'POST', body }); JSEL.clear(); toast(`Updated ${body.ids.length} jobs`, 'okk'); route();
  }));
  $('#ctJobs').textContent = d.total;
};

/* ---------------- job drawer ---------------- */
async function openJob(id, tab = 'overview') {
  const j = await api(`/api/jobs/${id}`);
  const bg = document.createElement('div'); bg.className = 'drawer-bg';
  const dr = document.createElement('div'); dr.className = 'drawer';
  const close = () => { bg.remove(); dr.remove(); document.removeEventListener('keydown', onk); };
  const onk = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onk);
  bg.onclick = close;
  const md = j.match_detail; const best = md[j.best_template] || md.auto;
  const truth = new Set(j.truth_skills);
  const LEXHL = (txt) => { let t = esc(txt); [...(best.skills_matched || [])].forEach((k) => { t = t.replace(new RegExp(`\\b(${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})\\b`, 'gi'), '<mark>$1</mark>'); }); (best.skills_missing || []).forEach((k) => { t = t.replace(new RegExp(`\\b(${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})\\b`, 'gi'), '<mark class="miss">$1</mark>'); }); return t; };
  const render = (tab) => {
    $$('.tabs button', dr).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('.tabbody', dr);
    if (tab === 'overview') {
      body.innerHTML = `
      <div class="grid g3">
        <div class="card"><div class="muted small">Best CV match</div><div class="row" style="margin-top:6px">${ring(j.match, 54)}<div><b>${esc((META.templates.find((t) => t.id === j.best_template) || {}).label || j.best_template)}</b><div class="dim small">Auto ${Math.round(j.match_auto)} · ML ${Math.round(j.match_ml)}</div></div></div></div>
        <div class="card"><div class="muted small">Level & experience</div><div style="font-size:18px;font-weight:700;margin-top:6px">${esc(j.seniority)}</div><div class="dim small">${j.years_req ? j.years_req + '+ years asked' : 'years not stated'} ${j.seniority_raw ? '· ' + esc(j.seniority_raw) : ''}</div></div>
        <div class="card"><div class="muted small">Where</div><div style="font-size:16px;font-weight:650;margin-top:6px">${FLAG[j.country] || ''} ${esc(j.country)}</div><div class="dim small">${MODEI[j.work_mode] || ''} ${j.work_mode} · ${esc(j.region)}</div>${j.elig ? `<div class="small" style="margin-top:6px;color:${ELC[j.elig][0]}">${ELC[j.elig][1]} — ${esc(j.elig_reason || '')}</div>` : ''}</div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Skills the JD asks for</h3>
        ${(best.skills_matched || []).map((k) => `<span class="skill have">✓ ${esc(k)}</span>`).join('')}
        ${(best.skills_missing || []).map((k) => `<span class="skill ${truth.has(k) ? 'gap' : 'miss'}" title="${truth.has(k) ? 'You have this (in your other CV) — tailoring will add it' : 'Not in your CVs — real gap'}">${truth.has(k) ? '↻' : '✕'} ${esc(k)}${truth.has(k) ? '' : `<span class="ihave" data-have="${esc(k)}">I have this</span>`}</span>`).join('') || ''}
        <div class="dim small" style="margin-top:8px">✓ already in this CV · ↻ you have it, tailoring will surface it · ✕ genuine gap (add it in Settings → Skills bank if you actually have it)</div>
        ${best.jd_quality !== 'full' ? `<div class="small" style="margin-top:10px;color:var(--warn)">Only a ${best.jd_quality} of the JD is stored (${best.jd_chars} chars) — match is approximate. <a href="javascript:void 0" id="fj">Fetch full JD</a></div>` : ''}
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Details</h3><div class="col small">
          <div><span class="muted">Platform:</span> ${plat(j.platform)} ${j.also_on.map((a) => `<a href="${esc(a.url)}" target="_blank">${plat(a.platform)}</a>`).join(' ')}</div>
          <div><span class="muted">Posted:</span> ${esc((j.posted || '').slice(0, 10))} (${rel(j.posted)}) · <span class="muted">found</span> ${rel(j.first_seen)}</div>
          ${j.salary ? `<div><span class="muted">Salary:</span> ${esc(j.salary)}</div>` : ''}${j.job_type ? `<div><span class="muted">Type:</span> ${esc(j.job_type)}</div>` : ''}
          ${j.applicants ? `<div><span class="muted">Applicants:</span> ${esc(j.applicants)}</div>` : ''}
          <div><span class="muted">Domains:</span> ${domChips(j.domains)}</div></div></div>
        <div class="card"><h3>Status & notes</h3>
          <div class="row wrap">${META.statuses.map((s) => `<button class="btn sm ${j.status === s ? 'pri' : ''}" data-st="${s}">${s}</button>`).join('')}</div>
          <textarea class="inp" id="notes" rows="4" style="margin-top:10px" placeholder="Recruiter, referral, salary notes…">${esc(j.notes || '')}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn sm" id="saveNotes">Save notes</button><button class="btn sm danger" id="hideJob">Hide job</button></div></div>
      </div>`;
      $('#fj') && ($('#fj').onclick = () => fetchJD());
      $$('[data-have]', body).forEach((x) => (x.onclick = async () => { await addSkill(x.dataset.have); x.parentElement.className = 'skill gap'; x.remove(); }));
      $$('[data-st]', body).forEach((b) => (b.onclick = async () => { await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status: b.dataset.st } }); j.status = b.dataset.st; toast('Status → ' + b.dataset.st, 'okk'); render('overview'); }));
      $('#saveNotes').onclick = async () => { await api(`/api/jobs/${id}`, { method: 'PATCH', body: { notes: $('#notes').value } }); toast('Notes saved', 'okk'); };
      $('#hideJob').onclick = async () => { await api(`/api/jobs/${id}`, { method: 'PATCH', body: { hidden: 1 } }); close(); route(); };
    }
    if (tab === 'jd') {
      body.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted small">${(j.description || '').length} chars · ${esc(best.jd_quality)}</span><span style="flex:1"></span><button class="btn sm" id="fj2">↻ Fetch full JD</button><button class="btn sm" id="pasteJD">✎ Paste JD</button></div>
        <div class="dim small" style="margin-bottom:10px"><mark style="background:color-mix(in srgb,var(--ok) 25%,transparent)">green</mark> = skills you show · <mark style="background:color-mix(in srgb,var(--warn) 30%,transparent)">amber</mark> = missing from this CV</div>
        <div class="jd card">${LEXHL(j.description || 'No description stored yet.')}</div>`;
      $('#fj2').onclick = () => fetchJD();
      $('#pasteJD').onclick = () => modal(`<h3>Paste the full job description</h3><textarea class="inp" id="pjd" rows="14"></textarea><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn pri" id="pjdok">Save & rescore</button></div>`, (m) => { $('#pjdok', m).onclick = async () => { await api(`/api/jobs/${id}/fetch_jd`, { method: 'POST', body: { text: $('#pjd', m).value } }); m.remove(); close(); openJob(id, 'jd'); }; });
    }
    if (tab === 'match') {
      body.innerHTML = `<div class="grid g2">${Object.entries(md).map(([t, r]) => `<div class="card"><h3>${esc((META.templates.find((x) => x.id === t) || {}).label || t)} ${t === j.best_template ? '<span class="chip" style="color:var(--ok)">best</span>' : ''}</h3>
        <div class="row">${ring(r.score, 60)}<div class="col small" style="flex:1">${Object.entries(r.breakdown).map(([k, v]) => `<div class="row"><span class="muted" style="width:120px">${k.replace('_', ' ')}</span><div class="gauge" style="flex:1"><div style="width:${(v / { hard_skills: 45, keywords: 15, title: 10, parse_structure: 20, qualifications: 10 }[k]) * 100}%;background:var(--brand)"></div></div><b style="width:34px;text-align:right">${v}</b></div>`).join('')}</div></div>
        <div class="small" style="margin-top:10px"><span class="muted">Missing keywords:</span> ${(r.keywords_missing || []).slice(0, 14).map(esc).join(', ') || '—'}</div>
        <button class="btn sm pri" style="margin-top:10px" data-g="${t}">Generate with this CV</button></div>`).join('')}</div>`;
      $$('[data-g]', body).forEach((b) => (b.onclick = () => genModal(id, b.dataset.g)));
    }
    if (tab === 'resumes') {
      body.innerHTML = j.resumes.length ? j.resumes.map((r) => `<div class="card row" style="margin-bottom:8px">${ring(r.score)}<div style="flex:1"><a href="#/resume/${r.id}">${esc(r.name)}</a><div class="dim small">${esc(r.template)} · base ${Math.round(r.base_score)} → ${Math.round(r.score)} · ${rel(r.created)}</div></div><a class="btn sm" href="#/resume/${r.id}">View / edit</a><a class="btn sm" href="/files/resume/${r.id}.pdf?dl=1">⇩ PDF</a></div>`).join('') : `<div class="empty"><div class="big">▣</div>No resume for this job yet.<br><br><button class="btn pri" id="g0">Generate resume</button></div>`;
      $('#g0') && ($('#g0').onclick = () => genModal(id));
    }
    if (tab === 'activity') {
      body.innerHTML = j.events.map((e) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line)"><span class="pill">${esc(e.kind)}</span><span>${esc(e.detail)}</span><span class="dim" style="margin-left:auto">${esc(e.ts)}</span></div>`).join('') || '<div class="dim">No activity yet.</div>';
    }
  };
  const fetchJD = async () => { toast('<span class="spin"></span> Fetching full description in the background browser…'); const r = await api(`/api/jobs/${id}/fetch_jd`, { method: 'POST', body: {} }); toast(r.ok ? `Got ${r.chars} chars — rescored` : r.msg, r.ok ? 'okk' : 'err'); close(); openJob(id, 'jd'); };
  dr.innerHTML = `<header><div class="row" style="align-items:flex-start"><div style="flex:1"><h2>${esc(j.title)}</h2><div class="muted">${esc(j.company)} · ${esc(j.location)} · ${plat(j.platform)}</div></div><button class="btn icon ghost" id="x">✕</button></div>
    <div class="row wrap" style="margin-top:12px"><a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener">Open posting ↗</a><button class="btn pri" id="gen">✦ Generate resume</button><button class="btn pri" id="apl">⚡ Apply for me</button><button class="btn" id="atsb">◎ ATS check</button><button class="btn" id="st">${j.starred ? '★ Starred' : '☆ Star'}</button><button class="btn" id="ap">✓ Mark applied</button></div></header>
    <div class="body"><div class="tabs">${[['overview', 'Overview'], ['jd', 'Job description'], ['match', 'ATS match'], ['resumes', `Resumes (${j.resumes.length})`], ['activity', 'Activity']].map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div><div class="tabbody"></div></div>`;
  document.body.append(bg, dr);
  render(tab);
  $$('.tabs button', dr).forEach((b) => (b.onclick = () => render(b.dataset.t)));
  $('#x', dr).onclick = close;
  $('#gen', dr).onclick = () => genModal(id);
  $('#apl', dr).onclick = () => { close(); applyModal([id]); };
  $('#atsb', dr).onclick = () => { close(); location.hash = `#/ats?job=${id}`; };
  $('#st', dr).onclick = async () => { j.starred = j.starred ? 0 : 1; await api(`/api/jobs/${id}`, { method: 'PATCH', body: { starred: j.starred } }); $('#st', dr).textContent = j.starred ? '★ Starred' : '☆ Star'; };
  $('#ap', dr).onclick = async () => { await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status: 'applied' } }); toast('Marked as applied — good luck!', 'okk'); j.status = 'applied'; render('overview'); };
}

/* ---------------- generate modal ---------------- */
function modal(html, init) {
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box">${html}</div>`;
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); };
  document.body.appendChild(m); init && init(m); return m;
}
async function genModal(id, tpl) {
  const j = await api(`/api/jobs/${id}`);
  const prov = META.llm?.provider || 'none';
  modal(`<h3>✦ Generate ATS-optimised resume</h3><div class="muted small" style="margin-bottom:14px">${esc(j.title)} · ${esc(j.company)}</div>
    <div class="setgrid"><label>Base CV</label><select class="inp" id="gt">${META.templates.map((t) => `<option value="${t.id}" ${(tpl || j.best_template) === t.id ? 'selected' : ''}>${esc(t.label)} — match ${Math.round(j.match_detail[t.id].score)}${t.id === j.best_template ? ' (recommended)' : ''}</option>`).join('')}</select>
    <label>Writer</label><select class="inp" id="gp">${[['', `Settings default (${prov})`], ['none', 'Rule-based (no AI, instant)'], ['anthropic', 'Claude (Anthropic API)'], ['openai', 'OpenAI'], ['gemini', 'Google Gemini'], ['ollama', 'Ollama (local)'], ['lmstudio', 'LM Studio (local)'], ['openrouter', 'OpenRouter']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <label>Full JD</label><label class="row" style="padding:0;color:var(--text)"><input type="checkbox" id="gf" ${j.jd_quality === 'full' ? '' : 'checked'}> Fetch full description first ${j.jd_quality === 'full' ? '<span class="dim small">(already have it)</span>' : ''}</label></div>
    <div class="log" id="glog" style="height:170px;margin-top:14px" hidden></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn pri" id="go">Generate PDF</button></div>`, (m) => {
    $('#go', m).onclick = async () => {
      $('#go', m).disabled = true; $('#go', m).innerHTML = '<span class="spin"></span> Working…'; const lg = $('#glog', m); lg.hidden = false;
      const { task } = await api(`/api/jobs/${id}/generate`, { method: 'POST', body: { template: $('#gt', m).value, provider: $('#gp', m).value, fetch_jd: $('#gf', m).checked } });
      const poll = async () => {
        const t = await api('/api/tasks/' + task); lg.textContent = t.log.join('\n'); lg.scrollTop = 1e9;
        if (t.status === 'running') return setTimeout(poll, 1200);
        if (t.status === 'done') { toast('Resume ready ✓', 'okk'); m.remove(); location.hash = `#/resume/${t.resume_id}`; }
        else { $('#go', m).disabled = false; $('#go', m).textContent = 'Retry'; toast(esc(t.error || 'failed'), 'err'); }
      };
      poll();
    };
  });
}

/* ---------------- domains ---------------- */
VIEWS.domains = async () => {
  setTitle('Domains');
  const [s, d] = await Promise.all([api('/api/stats'), api('/api/jobs?sort=match&per=500&days=' + (META.settings?.days || 7))]);
  const by = {}; d.items.forEach((j) => (j.domains || '').split(',').filter(Boolean).forEach((k) => (by[k] = by[k] || []).push(j)));
  $('#view').innerHTML = `<div class="muted" style="margin-bottom:14px">Your skill domains (from your CVs, publications and GitHub). Click a panel to see every job in it.</div>
  <div class="grid g3">${META.domains.map((dm) => { const L = by[dm.id] || []; const avg = L.length ? Math.round(L.reduce((a, j) => a + j.match, 0) / L.length) : 0; return `<div class="dom" style="--c:${dm.color}" data-d="${dm.id}">
    <div class="row"><div class="t" style="flex:1">${esc(dm.label)}</div><span class="pill" style="color:${scoreColor(avg)}">avg ${avg}</span></div>
    <div class="row" style="align-items:baseline;gap:6px"><div class="n" style="color:${dm.color}">${L.length}</div><span class="muted small">jobs · ${L.filter((j) => j.work_mode === 'Remote').length} remote · ${L.filter((j) => j.country === 'Pakistan').length} 🇵🇰</span></div>
    <ul>${L.slice(0, 5).map((j) => `<li data-id="${j.id}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.title)} <span class="dim">· ${esc(j.company)}</span></span><b style="color:${scoreColor(j.match)}">${Math.round(j.match)}</b></li>`).join('') || '<li class="dim">No jobs this week</li>'}</ul></div>`; }).join('')}</div>`;
  $$('.dom').forEach((el) => (el.onclick = (e) => { const li = e.target.closest('li[data-id]'); if (li) return openJob(li.dataset.id); location.hash = `#/jobs?domain=${el.dataset.d}&sort=match`; }));
};

/* ---------------- pipeline ---------------- */
VIEWS.pipeline = async () => {
  setTitle('Pipeline');
  const lanes = ['saved', 'resume ready', 'applied', 'interview', 'offer', 'rejected'];
  const [d, gm] = await Promise.all([api('/api/jobs?per=500&days=&status=' + lanes.join('|')), api('/api/gmail/status')]);
  const SC = { waiting: 'var(--warn)', 'action required': '#f97316', interview: '#38bdf8', rejected: 'var(--bad)', offer: '#a3e635', accepted: 'var(--ok)' };
  const stage = (j) => {
    const s = j.application_stage || (j.status === 'applied' ? 'waiting' : ''); if (!s) return '';
    const title = j.stage_source ? `${j.stage_source}${j.stage_updated_at ? ' · ' + rel(j.stage_updated_at) : ''}${j.stage_confidence ? ' · ' + Math.round(j.stage_confidence * 100) + '% match' : ''}` : 'No status email matched yet';
    return `<span class="pill" title="${esc(title)}" style="color:${SC[s] || 'var(--muted)'};border-color:${SC[s] || 'var(--line)'}">${esc(s)}</span>`;
  };
  const gmail = !gm.client_configured
    ? `<div class="card" style="margin-bottom:12px"><div class="row wrap"><b>Gmail application-status sync</b><span class="pill">no AI · read-only</span><span style="flex:1"></span><input type="file" id="gmailFile" accept="application/json,.json" class="inp" style="max-width:280px"><button class="btn pri" id="gmailSave">Add Google OAuth JSON</button></div><div class="small muted" style="margin-top:8px">One-time setup: enable the Gmail API in Google Cloud, create an OAuth client of type <b>Desktop app</b>, download its JSON file, then add it here. The token and email-derived statuses stay on this PC.</div></div>`
    : !gm.connected
      ? `<div class="card row wrap" style="margin-bottom:12px"><div><b>Gmail application-status sync</b><div class="small muted">OAuth client ready · Gmail read-only · deterministic keyword matching</div></div><span style="flex:1"></span><a class="btn pri" href="/api/gmail/connect">Connect Gmail</a></div>`
      : `<div class="card row wrap" style="margin-bottom:12px"><div><b>Gmail connected</b> <span class="pill" style="color:var(--ok)">read-only · no AI</span><div class="small muted">Checks every 10 minutes${gm.last_sync ? ` · last synced ${rel(gm.last_sync)}` : ''}${gm.last_result ? ` · ${gm.last_result.updated || 0} status update(s)` : ''}${gm.last_error ? ` · error: ${esc(gm.last_error)}` : ''}</div></div><span style="flex:1"></span><button class="btn pri" id="gmailSync" ${gm.running ? 'disabled' : ''}>${gm.running ? '<span class="spin"></span> Syncing…' : '↻ Sync now'}</button></div>`;
  $('#view').innerHTML = gmail + `<div class="muted small" style="margin-bottom:12px">Drag cards between columns. Applied cards show email-derived status beside the company; unmatched applications remain “waiting”.</div><div class="kan">${lanes.map((l) => { const L = d.items.filter((j) => j.status === l); return `<div class="lane" data-l="${l}"><h4>${l} <span>${L.length}</span></h4>${L.map((j) => `<div class="kc" draggable="true" data-id="${j.id}"><div class="jt">${esc(j.title)}</div><div class="jc row wrap">${esc(j.company)} · ${FLAG[j.country] || ''} ${esc(j.country)} ${stage(j)}</div><div class="row" style="margin-top:6px">${plat(j.platform)}${j.applied_at ? `<span class="dim small">${rel(j.applied_at)}</span>` : ''}<span style="flex:1"></span><b style="color:${scoreColor(j.match)}">${Math.round(j.match)}</b></div></div>`).join('')}</div>`; }).join('')}</div>`;
  $('#gmailSave') && ($('#gmailSave').onclick = async () => {
    const f = $('#gmailFile').files[0]; if (!f) return toast('Choose the downloaded Google OAuth JSON file', 'err');
    try { const credentials = JSON.parse(await f.text()); await api('/api/gmail/client', { method: 'POST', body: { credentials } }); toast('OAuth client saved — now connect Gmail', 'okk'); route(); }
    catch (e) { toast('Could not use that JSON file: ' + esc(e.message), 'err'); }
  });
  $('#gmailSync') && ($('#gmailSync').onclick = async () => {
    const b = $('#gmailSync'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Syncing…';
    try { await api('/api/gmail/sync', { method: 'POST', body: {} }); toast('Gmail sync started', 'okk');
      const wait = async () => { const s = await api('/api/gmail/status'); if (s.running) return setTimeout(wait, 1200); toast(s.last_error ? esc(s.last_error) : `Email status sync finished · ${(s.last_result || {}).updated || 0} updated`, s.last_error ? 'err' : 'okk'); route(); }; setTimeout(wait, 1000);
    } catch (e) { b.disabled = false; b.textContent = '↻ Sync now'; toast(esc(e.message), 'err'); }
  });
  $$('.kc').forEach((c) => { c.ondragstart = (e) => e.dataTransfer.setData('id', c.dataset.id); c.onclick = () => openJob(c.dataset.id); });
  $$('.lane').forEach((l) => { l.ondragover = (e) => { e.preventDefault(); l.classList.add('over'); }; l.ondragleave = () => l.classList.remove('over'); l.ondrop = async (e) => { const id = e.dataTransfer.getData('id'); await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status: l.dataset.l } }); route(); }; });
};

/* ---------------- resumes ---------------- */
VIEWS.resumes = async () => {
  setTitle('Resumes');
  const rs = await api('/api/resumes');
  $('#ctRes').textContent = rs.length;
  $('#view').innerHTML = `<div class="row" style="margin-bottom:12px"><span class="muted">${rs.length} tailored resumes · saved to your <b>new resumes</b> folder</span><span style="flex:1"></span><button class="btn" id="of">📂 Open folder</button><a class="btn" href="/files/base/auto.pdf" target="_blank">Base: Automation CV</a><a class="btn" href="/files/base/ml.pdf" target="_blank">Base: ML CV</a></div>
  ${rs.length ? `<table class="tbl"><thead><tr><th style="width:56px">ATS</th><th>Resume</th><th>Job</th><th>CV / writer</th><th>Created</th><th></th></tr></thead><tbody>${rs.map((r) => `<tr data-id="${r.id}"><td>${ring(r.score)}</td><td><div class="jt">${esc(r.name)}</div><div class="jc">base ${Math.round(r.base_score)} → <b style="color:${scoreColor(r.score)}">${Math.round(r.score)}</b> (+${Math.round(r.score - r.base_score)})</div></td><td>${r.title ? `<div>${esc(r.title)}</div><div class="jc">${esc(r.company)} ${r.status ? `<span class="pill">${esc(r.status)}</span>` : ''}</div>` : '<span class="dim">—</span>'}</td><td class="small">${esc(r.template)} · ${esc(r.provider)}</td><td class="small">${rel(r.created)}</td><td><div class="acts"><a class="btn sm" href="#/resume/${r.id}" data-stop>View / edit</a><a class="btn sm" href="/files/resume/${r.id}.pdf?dl=1" data-stop>⇩ PDF</a>${r.url ? `<a class="btn sm" target="_blank" href="${esc(r.url)}" data-stop>Apply ↗</a>` : ''}<button class="btn sm danger" data-del>🗑</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="card empty"><div class="big">▣</div>No tailored resumes yet. Open any job and press <b>Generate</b>.</div>'}`;
  $('#of').onclick = () => api('/api/open', { method: 'POST', body: {} });
  $$('tbody tr').forEach((tr) => (tr.onclick = async (e) => {
    if (e.target.closest('[data-stop]')) return;
    if (e.target.closest('[data-del]')) { if (confirm('Delete this resume (PDF too)?')) { await api('/api/resumes/' + tr.dataset.id, { method: 'DELETE' }); route(); } return; }
    location.hash = '#/resume/' + tr.dataset.id;
  }));
};

VIEWS.resume = async ([id]) => {
  const r = await api('/api/resumes/' + id);
  setTitle('Resume · ' + (r.job ? r.job.company : r.name));
  let C = r.content;
  const atsCard = (a) => `<div class="row">${ring(a.score, 64)}<div style="flex:1"><div class="muted small">ATS score (parsed from the PDF)</div><div class="gauge" style="margin-top:6px"><div style="width:${a.score}%;background:${scoreColor(a.score)}"></div></div><div class="small dim" style="margin-top:4px">base ${Math.round(r.base_score)} · target ${META.settings?.ats_target || 80} · ${a.pages} page(s) · JD: ${a.jd_quality}</div></div></div>
    <div class="small" style="margin-top:10px">${(a.skills_matched || []).map((k) => `<span class="skill have">✓ ${esc(k)}</span>`).join('')}${(a.skills_missing || []).map((k) => `<span class="skill miss">✕ ${esc(k)}</span>`).join('')}</div>
    ${(a.gaps || []).length ? `<div class="small" style="margin-top:8px"><span class="muted">Real gaps (not added):</span> ${a.gaps.map((g) => `${esc(g)}<span class="ihave" data-have="${esc(g)}">I have this</span>`).join(' · ')}<div class="dim">Click “I have this” for skills you genuinely have, then regenerate — they'll be included from now on.</div></div>` : ''}
    ${a.notes ? `<div class="small dim" style="margin-top:6px">${esc(a.notes)}</div>` : ''}`;
  $('#view').innerHTML = `
  <div class="row" style="margin-bottom:12px"><a href="#/resumes" class="btn ghost sm">‹ All resumes</a><b>${esc(r.name)}</b><span style="flex:1"></span>
    ${r.job ? `<a class="btn sm" href="${esc(r.job.url)}" target="_blank">Open job ↗</a>` : ''}
    <a class="btn sm" href="/files/resume/${r.id}.pdf?dl=1">⇩ PDF</a><a class="btn sm" href="/files/resume/${r.id}.docx?dl=1">⇩ DOCX</a><button class="btn sm" id="reveal">📂 Show in folder</button>
    <button class="btn sm" id="mode">✎ Edit</button><button class="btn sm pri" id="save" hidden>💾 Save & rebuild PDF</button></div>
  ${r.warnings.length ? `<div class="card small" style="border-color:var(--warn);margin-bottom:12px">⚠ ${r.warnings.map(esc).join('<br>⚠ ')}</div>` : ''}
  <div class="split">
    <iframe class="pdf" id="pdf" src="/files/resume/${r.id}.pdf?t=${Date.now()}#view=FitH"></iframe>
    <div class="editor" id="ed"><div class="card" id="atsc">${atsCard(r.ats)}</div><div id="blocks"></div></div>
  </div>`;
  const renderBlocks = (edit) => {
    $('#blocks').innerHTML = `<div class="sec"><div class="h"><b>Headline</b></div>${edit ? `<input class="inp" style="width:100%" data-head value="${esc(C.headline || '')}">` : `<div>${esc(C.headline || '')}</div>`}</div>` +
      C.sections.map((s, si) => `<div class="sec"><div class="h"><b>${esc(s.heading)}</b><span class="dim small">${s.blocks.filter((b) => b.t !== 'spacer').length} blocks</span></div>${s.blocks.map((b, bi) => b.t === 'spacer' ? '' : b.t === 'raw' ? `<div class="blk"><span class="tag">link</span><div class="lock">${esc(b.preview || 'Publication with hyperlink (kept as in your original)')}</div></div>` :
        `<div class="blk"><span class="tag">${b.t === 'header' ? 'role' : b.t}</span>${edit ? `<textarea class="inp" data-s="${si}" data-b="${bi}" rows="${Math.max(2, Math.ceil(b.text.length / 85))}">${esc(b.text)}</textarea>${b.t === 'bullet' ? `<button class="btn sm ghost" data-del="${si}.${bi}" title="Remove bullet">✕</button>` : ''}` : `<div style="flex:1" class="small">${esc(b.text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>`}</div>`).join('')}${edit && s.blocks.some((b) => b.t === 'bullet') ? `<button class="btn sm ghost" data-add="${si}">＋ bullet</button>` : ''}</div>`).join('');
    if (edit) {
      $$('#blocks [data-del]').forEach((b) => (b.onclick = () => { collect(); const [si, bi] = b.dataset.del.split('.').map(Number); C.sections[si].blocks.splice(bi, 1); renderBlocks(true); }));
      $$('#blocks [data-add]').forEach((b) => (b.onclick = () => { collect(); const s = C.sections[+b.dataset.add]; const proto = s.blocks.filter((x) => x.t === 'bullet').pop(); s.blocks.splice(s.blocks.lastIndexOf(proto) + 1, 0, { t: 'bullet', text: 'New bullet with **bold** impact', proto: proto.proto }); renderBlocks(true); }));
    }
  };
  const collect = () => { const h = $('[data-head]'); if (h) C.headline = h.value; $$('#blocks textarea').forEach((t) => (C.sections[+t.dataset.s].blocks[+t.dataset.b].text = t.value)); };
  let edit = false; renderBlocks(false);
  $('#atsc').onclick = async (e) => { const x = e.target.closest('[data-have]'); if (x) { await addSkill(x.dataset.have); x.remove(); } };
  $('#mode').onclick = () => { edit = !edit; if (!edit) collect(); renderBlocks(edit); $('#save').hidden = !edit; $('#mode').textContent = edit ? '👁 Preview text' : '✎ Edit'; };
  $('#reveal').onclick = () => api('/api/open', { method: 'POST', body: { resume_id: r.id, reveal: true } });
  $('#save').onclick = async () => {
    collect(); $('#save').disabled = true; $('#save').innerHTML = '<span class="spin"></span> Rebuilding…';
    try { const res = await api('/api/resumes/' + r.id, { method: 'PUT', body: { content: C } }); r.ats = res.ats; $('#atsc').innerHTML = atsCard(res.ats); $('#pdf').src = `/files/resume/${r.id}.pdf?t=${Date.now()}#view=FitH`; toast(`Rebuilt — ATS ${res.ats.score}`, 'okk'); }
    catch (e) { toast(esc(e.message), 'err'); }
    $('#save').disabled = false; $('#save').textContent = '💾 Save & rebuild PDF';
  };
};

/* ---------------- ATS lab ---------------- */
VIEWS.ats = async (_, q) => {
  setTitle('ATS Lab');
  const rs = await api('/api/resumes');
  let job = null; if (q.get('job')) job = await api('/api/jobs/' + q.get('job'));
  $('#view').innerHTML = `<div class="grid settings-grid">
   <div class="card"><h3>Job</h3><input class="inp" id="at" placeholder="Job title" style="width:100%;margin-bottom:8px" value="${esc(job?.title || '')}"><textarea class="inp" id="ajd" rows="18" placeholder="Paste the job description…">${esc(job?.description || '')}</textarea>
     <div class="row" style="margin-top:10px"><select class="inp" id="ar"><option value="t:auto">Base · Automation CV</option><option value="t:ml">Base · ML CV</option>${rs.map((r) => `<option value="r:${r.id}">${esc(r.name)} (${Math.round(r.score)})</option>`).join('')}</select><span style="flex:1"></span><button class="btn pri" id="ago">◎ Score</button></div></div>
   <div class="card" id="aout"><div class="empty"><div class="big">◎</div>Paste a JD and score any of your resumes.<div class="small dim" style="margin-top:8px">Scoring mirrors Workday/Greenhouse-style parsers: hard skills 45, keywords 15, title 10, parse & structure 20, qualifications 10.</div></div></div></div>`;
  $('#ago').onclick = async () => {
    const v = $('#ar').value; const body = { jd: $('#ajd').value, title: $('#at').value };
    if (v.startsWith('r:')) body.resume_id = +v.slice(2); else body.template = v.slice(2);
    const a = await api('/api/ats', { method: 'POST', body }); const truth = new Set(a.truth_skills);
    $('#aout').innerHTML = `<h3>Result</h3><div class="row"><div class="score-big" style="color:${scoreColor(a.score)}">${a.score}</div><div class="col small" style="flex:1">${Object.entries(a.breakdown).map(([k, v]) => `<div class="row"><span class="muted" style="width:120px">${k.replace('_', ' ')}</span><div class="gauge" style="flex:1"><div style="width:${(v / { hard_skills: 45, keywords: 15, title: 10, parse_structure: 20, qualifications: 10 }[k]) * 100}%;background:var(--brand)"></div></div><b style="width:34px;text-align:right">${v}</b></div>`).join('')}</div></div>
    <h3 style="margin-top:16px">Skills</h3>${a.skills_matched.map((k) => `<span class="skill have">✓ ${esc(k)}</span>`).join('')}${a.skills_missing.map((k) => `<span class="skill ${truth.has(k) ? 'gap' : 'miss'}">${truth.has(k) ? '↻' : '✕'} ${esc(k)}</span>`).join('')}
    <h3 style="margin-top:16px">Missing keywords</h3><div class="small">${a.keywords_missing.map(esc).join(' · ') || '—'}</div>
    <div class="small dim" style="margin-top:12px">JD: ${a.jd_chars} chars (${a.jd_quality}) · years asked: ${a.years_required_min || '—'}</div>`;
  };
  if (job) $('#ago').click();
};

/* ---------------- scraper ---------------- */
let logOff = 0, logTimer = null;
VIEWS.scraper = async () => {
  setTitle('Scraper');
  const [runs, s] = await Promise.all([api('/api/runs'), api('/api/settings')]);
  const P = Object.keys(s.platforms);
  $('#view').innerHTML = `<div class="grid" style="grid-template-columns:1fr 1.3fr">
  <div class="col" style="gap:14px">
    <div class="card"><h3>Run a scrape</h3><div class="muted small" style="margin-bottom:10px">Uses your installed Chrome off-screen with human-like pacing (random ${s.delays.page[0] / 1000}-${s.delays.page[1] / 1000}s page waits, scrolling, back-off on 429/challenges, persistent cookies).</div>
      <div class="row wrap">${P.map((p) => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${p}" ${s.platforms[p] ? 'checked' : ''}> ${p}</label>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn pri" id="go">↻ Scrape selected</button><button class="btn" id="imp">⇩ Import Claude's results</button><button class="btn" id="csv">⇩ Write CSVs</button></div></div>
    <div class="card"><h3>Schedule</h3><div class="small col">
      <div>🤖 <b>Claude scheduled task</b> — every day at <b>6:30 PM</b> (PKT) Claude runs the Playwright scraper on this PC and drops results that this app imports automatically.</div>
      <div>🖥 <b>In-app fallback</b> — ${s.schedule_enabled ? `if nothing has arrived by <b>${esc(s.schedule_time)}</b>, the app scrapes by itself while it is running.` : 'disabled'}</div>
      <div class="dim">CSV exports: <span class="mono">${esc(s.output_dir)}\\job_csvs\\</span> (all, by platform / domain / country / region, remote-only, mid-level, top matches).</div></div></div>
    <div class="card"><h3>History</h3>${runs.map((r) => `<div class="row small" style="padding:6px 0;border-top:1px solid var(--line);cursor:pointer" data-r="${r.id}"><span class="pill">${esc(r.source)}</span><span>${esc((r.finished || '').replace('T', ' ').slice(0, 16))}</span><span class="dim" style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(Object.entries(JSON.parse(r.stats || '{}')).map(([k, v]) => k + ' ' + v).join(' · '))}</span><b>${r.n_new}</b><span class="dim">/ ${r.n_found}</span></div>`).join('') || '<div class="dim">No runs yet.</div>'}</div>
  </div>
  <div class="card"><h3>Live log <span class="dot" id="ld"></span></h3><div class="log" id="log" style="height:calc(100vh - 220px)"></div></div></div>`;
  $('#go').onclick = async () => { const ps = $$('#view input[type=checkbox]:checked').map((i) => i.value); const r = await api('/api/scrape', { method: 'POST', body: { platforms: ps } }); toast(r.started ? 'Scrape started' : 'A scrape is already running'); logOff = 0; $('#log').textContent = ''; poll(); };
  $('#imp').onclick = async () => { const r = await api('/api/import', { method: 'POST' }); toast(`Imported ${r.files.length} file(s), ${r.new} new jobs`, 'okk'); };
  $('#csv').onclick = async () => { const r = await api('/api/export_all', { method: 'POST' }); toast('CSVs written to ' + esc(r.folder), 'okk'); };
  $$('[data-r]').forEach((e) => (e.onclick = async () => { const r = await api('/api/runs/' + e.dataset.r); $('#log').textContent = r.log || '(no log)'; }));
  logOff = 0; const poll = async () => { clearTimeout(logTimer); if (!$('#log')) return; const st = await api('/api/scrape/status?since=' + logOff); logOff = st.offset; if (st.log.length) { $('#log').textContent += st.log.join('\n') + '\n'; $('#log').scrollTop = 1e9; } $('#ld').className = 'dot' + (st.running ? ' live' : ''); if (st.running) logTimer = setTimeout(poll, 1500); };
  poll();
};

/* ---------------- settings ---------------- */
VIEWS.settings = async () => {
  setTitle('Settings');
  const s = await api('/api/settings');
  const J = (v) => esc(JSON.stringify(v, null, 1));
  const opt = s.discovery_options; const df = s.discovery_filters;
  const choices = (group, items, selected) => `<div class="choice-grid">${items.map((x) => `<label class="choice"><input type="checkbox" data-discovery="${group}" value="${x.id}" ${selected.includes(x.id) ? 'checked' : ''}><span>${esc(x.label)}</span></label>`).join('')}</div>`;
  $('#view').innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr">
  <div class="card"><h3>AI writer (resume tailoring)</h3><div class="setgrid">
    <label>Provider</label><select class="inp" id="lp">${[['none', 'Rule-based only (no AI)'], ['anthropic', 'Anthropic Claude'], ['openai', 'OpenAI'], ['gemini', 'Google Gemini'], ['openrouter', 'OpenRouter'], ['ollama', 'Ollama (local)'], ['lmstudio', 'LM Studio (local)'], ['custom', 'Custom OpenAI-compatible']].map(([v, l]) => `<option value="${v}" ${s.llm.provider === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Model</label><input class="inp" id="lm" value="${esc(s.llm.model || '')}" placeholder="e.g. claude-sonnet-4-5 · gpt-4.1 · qwen2.5:14b">
    <label>API key</label><input class="inp" id="lk" type="password" value="${esc(s.llm.api_key || '')}" placeholder="not needed for Ollama / LM Studio">
    <label>Base URL</label><input class="inp" id="lb" value="${esc(s.llm.base_url || '')}" placeholder="optional (local / custom)">
    <label></label><div class="row"><button class="btn" id="lt">Test connection</button><span id="ltr" class="small muted"></span></div>
    <label>ATS target</label><input class="inp" id="tg" type="number" min="50" max="100" value="${s.ats_target}">
  </div></div>
  <div class="card"><h3>Search</h3><div class="setgrid">
    <label>Search titles / keywords</label><textarea class="inp" id="kw" rows="3">${esc(s.keywords.join('\n'))}</textarea>
    <label>Remote-board keywords</label><textarea class="inp" id="rk" rows="2">${esc(s.remote_keywords.join('\n'))}</textarea>
    <label>Posted within (days)</label><input class="inp" id="dy" type="number" min="1" max="30" value="${s.days}">
    <label>LinkedIn levels</label><select class="inp" id="le">${[['2', 'Entry'], ['3', 'Associate'], ['3%2C4', 'Associate + Mid-Senior (mid-level)'], ['4', 'Mid-Senior'], ['2%2C3%2C4', 'Entry → Mid-Senior']].map(([v, l]) => `<option value="${v}" ${s.linkedin_experience === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Browser</label><div class="row"><select class="inp" id="bc">${['chrome', 'msedge'].map((c) => `<option ${s.browser_channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select><label class="row small muted"><input type="checkbox" id="hl" ${s.headless ? 'checked' : ''}> headless (more bot-checks)</label></div>
    <label>⚡ Apply opens in</label><select class="inp" id="ab">${[['auto', 'My own browser (Apply Helper; no silent fallback)'], ['mine', 'My own browser only (Apply Helper extension)'], ['shared', 'JobHunter Chrome window'], ['separate', 'Separate window per application']].map(([v, l]) => `<option value="${v}" ${(s.apply_browser || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>In-app fallback run</label><div class="row"><label class="tgl"><input type="checkbox" id="se" ${s.schedule_enabled ? 'checked' : ''}><span></span></label><input class="inp" id="stime" type="time" value="${esc(s.schedule_time)}"></div>
    <label>Relocation (with sponsorship)</label><input class="inp" id="rl" value="${esc((s.relocation || []).join(', '))}" title="Countries or regions: Europe, Australia, Middle East, Canada, United Kingdom…">
    <label>Default job view</label><select class="inp" id="ev">${[['ok', 'Open to me + needs checking'], ['eligible', 'Only definitely open to me'], ['all', 'Everything']].map(([v, l]) => `<option value="${v}" ${s.eligibility_view === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Output folder</label><input class="inp" id="od" value="${esc(s.output_dir)}">
  </div></div>
  <div class="card discovery-card"><h3>Job discovery <span class="dim small plain">AI-free rules applied to every platform</span></h3>
    <div class="discovery-summary" id="discSummary"></div>
    <div class="discovery-section"><h4>Platforms</h4>${choices('platforms', opt.platforms, opt.platforms.filter((x) => s.platforms[x.id] !== false).map((x) => x.id))}</div>
    <div class="discovery-section"><h4>Regions</h4>${choices('regions', opt.regions, df.regions)}</div>
    <div class="discovery-section"><h4>Domains and synonymous JD language</h4>${choices('domains', opt.domains, df.domains)}</div>
    <div class="discovery-split">
      <div class="discovery-section"><h4>Work arrangement</h4>${choices('work_modes', opt.work_modes, df.work_modes)}</div>
      <div class="discovery-section"><h4>Seniority</h4>${choices('seniority', opt.seniority, df.seniority)}</div>
    </div>
    <div class="range-grid">
      <div><label>Salary currency</label><select class="inp" id="dcur">${opt.salary_currencies.map((x) => `<option value="${x.id}" ${df.salary_currency === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <div><label>Minimum annual salary</label><input class="inp" id="dsmin" type="number" min="0" step="1000" value="${df.salary_min || 0}"></div>
      <div><label>Maximum annual salary</label><input class="inp" id="dsmax" type="number" min="0" step="1000" value="${df.salary_max || 0}"></div>
      <div><label>Minimum required experience</label><input class="inp" id="demin" type="number" min="0" max="30" step="1" value="${df.experience_min || 0}"></div>
      <div><label>Maximum required experience</label><input class="inp" id="demax" type="number" min="0" max="30" step="1" value="${df.experience_max || 0}"></div>
    </div>
    <div class="row wrap small muted"><label class="choice inline"><input type="checkbox" id="dreqs" ${df.require_salary ? 'checked' : ''}> Require a stated salary</label><label class="choice inline"><input type="checkbox" id="dreqe" ${df.require_experience ? 'checked' : ''}> Require stated years of experience</label></div>
    <div class="small dim" style="margin-top:8px">Salary values are compared only within the selected currency; hourly/monthly pay is left unfiltered. Jobs missing salary or experience stay eligible unless you require those fields.</div>
  </div>
  <div class="card"><h3>Skills bank <span class="dim small" style="text-transform:none;letter-spacing:0">skills you genuinely have but aren't in either CV — tailoring may use them</span></h3>
    <textarea class="inp" id="xs" rows="5" placeholder="one per line, e.g. GCP Vertex AI">${esc((s.extra_skills || []).join('\n'))}</textarea>
    <div class="small muted" style="margin-top:8px">Detected from your CVs: ${(META.truth_skills || []).map((k) => `<span class="chip">${esc(k)}</span>`).join(' ')}</div></div>
  <div class="card"><h3>Advanced (JSON)</h3><div class="col small">
    <label class="muted">LinkedIn locations</label><textarea class="inp mono" id="ll" rows="5">${J(s.linkedin_locations)}</textarea>
    <label class="muted">Indeed sites</label><textarea class="inp mono" id="is" rows="4">${J(s.indeed_sites)}</textarea>
    <label class="muted">Company ATS boards (greenhouse / lever / ashby slugs)</label><textarea class="inp mono" id="cb" rows="3">${J(s.company_boards)}</textarea>
    <label class="muted">Delays (ms)</label><textarea class="inp mono" id="dl" rows="3">${J(s.delays)}</textarea></div></div>
  </div><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="rs">↻ Re-score all jobs</button><button class="btn pri" id="sv">💾 Save settings</button></div>`;
  const llm = () => ({ provider: $('#lp').value, model: $('#lm').value, api_key: $('#lk').value, base_url: $('#lb').value });
  const selected = (group) => $$(`[data-discovery="${group}"]:checked`).map((x) => x.value);
  const discoveryFilters = () => ({ regions: selected('regions'), domains: selected('domains'), work_modes: selected('work_modes'), seniority: selected('seniority'), salary_currency: $('#dcur').value, salary_min: +$('#dsmin').value || 0, salary_max: +$('#dsmax').value || 0, require_salary: $('#dreqs').checked, experience_min: +$('#demin').value || 0, experience_max: +$('#demax').value || 0, require_experience: $('#dreqe').checked });
  const updateSummary = () => { $('#discSummary').textContent = `${selected('platforms').length} platforms · ${selected('regions').length} regions · ${selected('domains').length} domain bags · ${selected('work_modes').length} work modes · ${selected('seniority').length} seniority levels`; };
  $$('[data-discovery]').forEach((x) => (x.onchange = updateSummary)); updateSummary();
  $('#lt').onclick = async () => { $('#ltr').innerHTML = '<span class="spin"></span>'; const r = await api('/api/llm/test', { method: 'POST', body: { llm: llm() } }); $('#ltr').innerHTML = r.ok ? `<span style="color:var(--ok)">✓ ${esc(r.reply.slice(0, 80))}</span>` : `<span style="color:var(--bad)">${esc(r.error)}</span>`; };
  $('#rs').onclick = async () => { await api('/api/rescore', { method: 'POST' }); toast('Re-scoring in the background'); };
  $('#sv').onclick = async () => {
    try {
      const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
      await api('/api/settings', { method: 'PUT', body: { llm: llm(), ats_target: +$('#tg').value, keywords: lines('#kw'), remote_keywords: lines('#rk'), days: +$('#dy').value, linkedin_experience: $('#le').value, browser_channel: $('#bc').value, apply_browser: $('#ab').value, headless: $('#hl').checked, schedule_enabled: $('#se').checked, schedule_time: $('#stime').value, output_dir: $('#od').value, relocation: $('#rl').value.split(',').map((x) => x.trim()).filter(Boolean), eligibility_view: $('#ev').value, extra_skills: lines('#xs'), platforms: Object.fromEntries(opt.platforms.map((x) => [x.id, selected('platforms').includes(x.id)])), discovery_filters: discoveryFilters(), linkedin_locations: JSON.parse($('#ll').value), indeed_sites: JSON.parse($('#is').value), company_boards: JSON.parse($('#cb').value), delays: JSON.parse($('#dl').value) } });
      toast('Settings saved', 'okk'); await loadMeta();
    } catch (e) { toast('Could not save: ' + esc(e.message), 'err'); }
  };
};


/* ---------------- skills bank ---------------- */
async function addSkill(k) { await api('/api/skills_bank', { method: 'POST', body: { skill: k } }); toast(`Added “${esc(k)}” to your skills bank — future resumes will include it`, 'okk'); loadMeta(); }

/* ---------------- apply assistant ---------------- */
async function applyModal(ids) {
  const [pf, st, ext, settings, job] = await Promise.all([api('/api/profile'), api('/api/apply/status'), api('/api/ext/status'), api('/api/settings'), ids.length === 1 ? api('/api/jobs/' + ids[0]) : Promise.resolve(null)]);
  const c = pf.completeness;
  const helperRequired = ['auto', 'mine'].includes(settings.apply_browser || 'auto');
  const helperMissing = helperRequired && !ext.connected;
  modal(`<h3>⚡ Apply ${ids.length > 1 ? `to ${ids.length} jobs` : 'for me'}</h3>
    <div class="small col" style="gap:6px;margin-bottom:12px">
      <div>The application opens as a <b>new tab in this browser window</b>. I fill everything I know from your resume and application profile, upload the keyword-optimised resume (generated now if needed) and pause only when <b>you</b> are needed — a real CAPTCHA, login / account creation, unknown questions, and the final review.</div>
      ${helperMissing ? '<div style="color:var(--warn)"><b>Apply Helper is not connected.</b> I will not silently open a separate browser. Complete the one-time setup, then try again.</div>' : ''}
      <div class="muted">${ids.length > 1 ? 'Jobs run one after another; the next one opens when the current one is submitted or skipped.' : ''}</div>
      <div>Profile completeness: <b style="color:${c.filled === c.total ? 'var(--ok)' : 'var(--warn)'}">${c.filled}/${c.total}</b>${c.missing.length ? ` · missing: ${c.missing.slice(0, 6).map(esc).join(', ')} — <a href="#/apply?tab=profile" data-close>fill now</a>` : ''}</div>
      ${st.session && st.session.alive ? '<div style="color:var(--warn)">An application window is already open — these will be queued.</div>' : ''}
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button>${helperMissing && job ? `<a class="btn" href="${esc(job.url)}" target="_blank" rel="noopener">Open posting only ↗</a>` : ''}${helperMissing ? '<a class="btn pri" href="#/apply" data-close>Set up Apply Helper</a>' : '<button class="btn pri" id="ago">Start</button>'}</div>`, (m) => {
    const start = $('#ago', m);
    if (!start) return;
    start.onclick = async () => {
      const r = ids.length > 1 || (st.session && st.session.alive) ? await api('/api/apply/start', { method: 'POST', body: { ids } }) : await api('/api/apply/start', { method: 'POST', body: { job_id: ids[0] } });
      m.remove(); if (r.ok === false) return toast(esc(r.error), 'err');
      try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
      toast('Apply assistant started in a new tab of this browser', 'okk'); location.hash = '#/apply';
    };
  });
}

let lastNeed = null, beepCtx = null;
function beep() { try { beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25].forEach((d) => { const o = beepCtx.createOscillator(), g = beepCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(beepCtx.destination); g.gain.setValueAtTime(0.15, beepCtx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + d + 0.2); o.start(beepCtx.currentTime + d); o.stop(beepCtx.currentTime + d + 0.22); }); } catch (e) {} }
let titleBlink = null;
function notifyNeed(s) {
  const key = s.id + (s.need_since || '');
  if (key === lastNeed) return; lastNeed = key;
  beep();
  try { if (window.Notification && Notification.permission === 'granted') new Notification('JobHunter needs you', { body: `${s.job.company}: ${s.need.message}` }); } catch (e) {}
  clearInterval(titleBlink); let on = false; titleBlink = setInterval(() => { document.title = (on = !on) ? '⚠ Your input needed' : 'JobHunter'; }, 900);
}
const cmd = (c) => api('/api/apply/cmd', { method: 'POST', body: c });
function questionForm(qs) {
  return qs.map((q) => `<div class="qcard"><label>${esc(q.label || '(unlabelled field)')} ${q.required ? '<span style="color:var(--bad)">*</span>' : ''}</label>${q.options && q.options.length ? `<select class="inp" data-fid="${q.fid}" style="width:100%"><option value="">— choose —</option>${q.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : q.type === 'textarea' ? `<textarea class="inp" data-fid="${q.fid}" rows="3"></textarea>` : `<input class="inp" data-fid="${q.fid}" style="width:100%">`}</div>`).join('');
}
async function applyPoll() {
  let st; try { st = await api('/api/apply/status'); } catch (e) { return setTimeout(applyPoll, 4000); }
  const s = st.session; const bar = $('#applyBar');
  $('#ctApply').hidden = !(s && s.status === 'needs_input');
  if (s && s.alive && s.status === 'needs_input') {
    notifyNeed(s);
    bar.innerHTML = `<div class="ab"><span class="dot live"></span><b>Your input needed</b><span style="flex:1">${esc(s.job.company)} · ${esc(s.need.message)}</span>${s.need.canSubmit ? '<button class="btn sm pri" data-c="submit">Submit for me</button>' : ''}${s.need.reason === 'questions' ? '<a class="btn sm pri" href="#/apply">Answer questions</a>' : '<button class="btn sm pri" data-c="continue">Continue</button>'}<button class="btn sm" data-c="skip">Skip job</button></div>`;
  } else if (s && s.alive && s.status === 'stopping') {
    clearInterval(titleBlink); document.title = 'JobHunter';
    bar.innerHTML = `<div class="ab"><b>⏹ Stopping</b><span style="flex:1" class="small">${esc(s.job.title)} · ${esc(s.job.company)} — the apply flow is shutting down…</span><a class="btn sm" href="#/apply">Open</a></div>`;
  } else if (s && s.alive && s.status === 'skipping') {
    clearInterval(titleBlink); document.title = 'JobHunter';
    bar.innerHTML = `<div class="ab"><b>⏭ Skipping</b><span style="flex:1" class="small">${esc(s.job.title)} · ${esc(s.job.company)} — ending this job and moving to the next…</span><a class="btn sm" href="#/apply">Open</a></div>`;
  } else if (s && s.alive && s.status === 'paused') {
    clearInterval(titleBlink); document.title = 'JobHunter';
    bar.innerHTML = `<div class="ab"><b>⏸ Paused</b><span style="flex:1" class="small">Take over in the browser. Continue when you are ready for automation to resume.</span><button class="btn sm pri" data-c="continue">Continue</button><a class="btn sm" href="#/apply">Open</a></div>`;
  } else if (s && s.alive) {
    clearInterval(titleBlink); document.title = 'JobHunter';
    bar.innerHTML = `<div class="ab run"><span class="spin"></span><b>Applying</b><span style="flex:1" class="small">${esc(s.job.title)} · ${esc(s.job.company)} — ${esc(((s.events || []).filter((e) => e.type === 'log' || e.type === 'page').slice(-1)[0] || {}).msg || ((s.events || []).slice(-1)[0] || {}).title || 'working…')}</span><button class="btn sm" data-c="pause">Pause</button><a class="btn sm" href="#/apply">Open</a></div>`;
  } else { bar.innerHTML = ''; clearInterval(titleBlink); }
  $$('[data-c]', bar).forEach((b) => (b.onclick = async () => { await cmd({ cmd: b.dataset.c }); applyPoll(); }));
  if (location.hash.startsWith('#/apply') && !location.hash.includes('tab=') && window.__applyRender) window.__applyRender(st);
  setTimeout(applyPoll, s && s.alive ? 2000 : 5000);
}

VIEWS.apply = async (_, q) => {
  setTitle('Apply assistant');
  const tab = q.get('tab') || 'assistant';
  const tabs = `<div class="tabs" style="margin:0 0 16px;padding:0">${[['assistant', '⚡ Assistant'], ['profile', '👤 My application profile'], ['qa', '💬 Answer bank']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" onclick="location.hash='#/apply?tab=${k}'">${l}</button>`).join('')}</div>`;
  window.__applyRender = null;
  if (tab === 'profile') {
    const pf = await api('/api/profile'); const v = pf.values; const c = pf.completeness;
    $('#view').innerHTML = tabs + `<div class="row" style="margin-bottom:12px"><span class="muted">Filled once, reused on every application form. Pre-filled from your CVs; stored only on this PC.</span><span style="flex:1"></span><span class="pill" style="color:${c.filled === c.total ? 'var(--ok)' : 'var(--warn)'}">key fields ${c.filled}/${c.total}</span><button class="btn pri" id="pfs">💾 Save profile</button></div>` +
      pf.schema.map((s) => `<div class="pf-sec"><h3>${esc(s.section)}</h3><div class="pf-grid">${s.fields.map((f) => `<div class="${f.type === 'textarea' ? 'full' : ''}"><label>${esc(f.label)}</label>${f.type === 'select' ? `<select class="inp" data-k="${f.key}">${f.options.map((o) => `<option ${v[f.key] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea class="inp" data-k="${f.key}" rows="${f.key === 'cover_letter' ? 9 : 3}">${esc(v[f.key] || '')}</textarea>` : `<input class="inp" data-k="${f.key}" type="${f.type === 'password' ? 'password' : 'text'}" value="${esc(v[f.key] || '')}">`}</div>`).join('')}</div></div>`).join('') +
      `<div class="row" style="justify-content:flex-end"><button class="btn pri" id="pfs2">💾 Save profile</button></div>`;
    const save = async () => { const d = {}; $$('[data-k]').forEach((e) => (d[e.dataset.k] = e.value)); const r = await api('/api/profile', { method: 'PUT', body: d }); toast(`Profile saved (${r.completeness.filled}/${r.completeness.total} key fields)`, 'okk'); };
    $('#pfs').onclick = save; $('#pfs2').onclick = save; return;
  }
  if (tab === 'qa') {
    const qa = await api('/api/qa');
    $('#view').innerHTML = tabs + `<div class="muted small" style="margin-bottom:10px">Every question you answer during an application is remembered here and filled automatically next time (matched by wording). Add your own too.</div>
      <div class="card" style="margin-bottom:12px"><div class="row"><input class="inp" id="nq" placeholder="Question, e.g. Do you have experience with Kubernetes?" style="flex:2"><input class="inp" id="na" placeholder="Answer" style="flex:1"><button class="btn pri" id="nadd">Add</button></div></div>
      ${qa.length ? `<table class="tbl"><thead><tr><th>Question</th><th>Answer</th><th>Updated</th><th></th></tr></thead><tbody>${qa.map((x) => `<tr><td>${esc(x.q)}</td><td>${esc(x.a)}</td><td class="small dim">${rel(x.updated)}</td><td><button class="btn sm danger" data-del="${esc(x.q_norm)}">🗑</button></td></tr>`).join('')}</tbody></table>` : '<div class="card empty">No saved answers yet.</div>'}`;
    $('#nadd').onclick = async () => { if (!$('#nq').value.trim()) return; await api('/api/qa', { method: 'POST', body: { q: $('#nq').value, a: $('#na').value } }); route(); };
    $$('[data-del]').forEach((b) => (b.onclick = async () => { await api('/api/qa', { method: 'DELETE', body: { q_norm: b.dataset.del } }); route(); }));
    return;
  }
  $('#view').innerHTML = tabs + `<div class="card" id="extCard" style="margin:-6px 0 12px;padding:12px 14px"><span class="muted small">Checking your browser helper…</span></div><div class="grid" style="grid-template-columns:1.2fr 1fr"><div id="apMain"></div><div class="col" style="gap:14px"><div class="card"><h3>Queue</h3><div id="apQueue"></div></div><div class="card"><h3>Recent</h3><div id="apHist"></div></div></div></div>`;
  extCard();
  let shownNeed = null;
  window.__applyRender = (st) => {
    const s = st.session;
    $('#apQueue').innerHTML = st.queue.length ? st.queue.map((j) => `<div class="row small" style="padding:4px 0;border-top:1px solid var(--line)"><span style="flex:1">${esc(j.title)}</span><span class="dim">${esc(j.company)}</span></div>`).join('') + '<button class="btn sm ghost" id="qclr" style="margin-top:6px">Clear queue</button>' : '<div class="dim small">Empty. Select jobs on the Jobs page → “⚡ Apply to selected”.</div>';
    $('#qclr') && ($('#qclr').onclick = async () => { await api('/api/apply/queue/clear', { method: 'POST' }); });
    $('#apHist').innerHTML = st.history.map((h) => `<div class="row small" style="padding:4px 0;border-top:1px solid var(--line)"><span class="pill" style="color:${h.status === 'done' ? 'var(--ok)' : 'var(--muted)'}">${esc(h.status)}</span><span style="flex:1">${esc(h.job.title)} · ${esc(h.job.company)}</span><span class="dim">${rel(h.finished)}</span></div>`).join('') || '<div class="dim small">Nothing yet.</div>';
    if (!s) { $('#apMain').innerHTML = '<div class="card empty"><div class="big">⚡</div>No application running.<br>Open a job and press <b>⚡ Apply for me</b>, or select several on the Jobs page.<br><br><a class="btn" href="#/apply?tab=profile">Complete my application profile first</a></div>'; return; }
    const needKey = `${s.id}:${s.status}:${s.need_since || ''}`;
    const evs = (s.events || []).filter((e) => ['log', 'page', 'filled', 'needs_input', 'paused', 'resumed', 'stop_requested', 'skip_requested', 'stopped', 'done', 'error', 'skipped'].includes(e.type)).slice(-80)
      .map((e) => `${new Date(e.t).toLocaleTimeString()}  ${e.type === 'page' ? `→ ${e.title || e.url} (${e.fields} fields)` : e.type === 'filled' ? `✎ filled ${e.count}/${e.total} fields${e.unknown ? `, ${e.unknown} unknown` : ''}` : e.type === 'needs_input' ? `⚠ ${e.message}` : e.type === 'paused' ? '⏸ paused — you have control' : e.type === 'resumed' ? `▶ resumed (${e.by})` : e.type === 'done' ? '✅ Application submitted!' : e.msg || e.message || e.type}`).join('\n');
    if (needKey === shownNeed && $('#apLog')) { $('#apLog').textContent = evs; $('#apLog').scrollTop = 1e9; $('#apStatus').innerHTML = statusLine(s); return; }
    shownNeed = needKey;
    $('#apMain').innerHTML = `<div class="card"><div class="row" style="align-items:flex-start"><div style="flex:1"><div class="jt" style="font-size:16px">${esc(s.job.title)}</div><div class="jc">${esc(s.job.company)} · ${plat(s.job.platform)} ${s.resume_id ? `· <a href="#/resume/${s.resume_id}">resume used</a>` : ''}</div></div><div id="apStatus">${statusLine(s)}</div></div>
      ${s.need && s.alive ? `<div class="card" style="margin-top:12px;border-color:var(--warn)"><b>⚠ ${esc(s.need.message)}</b>
        ${s.need.reason === 'questions' ? `<div style="margin-top:8px">${questionForm(s.need.questions || [])}</div><label class="row small muted"><input type="checkbox" id="rem" checked> remember these answers for future applications</label><div class="row" style="margin-top:8px"><button class="btn pri" id="sendA">Fill these & continue</button><button class="btn" data-c2="continue">I typed them in the browser</button><button class="btn" data-c2="skip">Skip job</button></div>`
        : `<div class="row" style="margin-top:10px">${s.need.canSubmit ? '<button class="btn pri" data-c2="submit">✓ Submit for me</button>' : ''}<button class="btn ${s.need.canSubmit ? '' : 'pri'}" data-c2="continue">Continue</button><button class="btn" data-c2="skip">Skip job</button><button class="btn danger" data-c2="stop">Stop</button></div>`}</div>`
        : s.alive ? `<div class="row" style="margin-top:12px">${s.status === 'paused' ? '<button class="btn pri" data-c2="continue">▶ Continue automation</button>' : '<button class="btn" data-c2="pause">⏸ Pause & take over</button>'}<button class="btn" data-c2="skip">Skip job</button><button class="btn danger" data-c2="stop">Stop</button></div>` : `<div class="row" style="margin-top:12px"><button class="btn" data-c2="stop">Close browser window</button></div>`}
      <h3 style="margin-top:16px">Activity</h3><div class="evlog" id="apLog">${esc(evs)}</div></div>`;
    $('#apLog').scrollTop = 1e9;
    $$('[data-c2]').forEach((b) => (b.onclick = async () => {
      const action = b.dataset.c2;
      if (action === 'stop' || action === 'skip') {
        b.disabled = true;
        b.textContent = action === 'stop' ? 'Stopping…' : 'Skipping…';
        toast(action === 'stop' ? 'Stop requested — shutting down the apply flow…' : 'Skip requested — ending this job and moving to the next…', 'okk');
      }
      const result = await cmd({ cmd: action });
      if ((action === 'stop' || action === 'skip') && !result.ok) toast('The apply flow had already ended.', 'okk');
      applyPoll();
    }));
    $('#sendA') && ($('#sendA').onclick = async () => { const answers = {}; $$('[data-fid]').forEach((e) => { if (e.value) answers[e.dataset.fid] = e.value; }); await cmd({ cmd: 'answers', answers, remember: $('#rem').checked }); toast('Answers sent' + ($('#rem').checked ? ' and saved to your answer bank' : ''), 'okk'); shownNeed = null; });
  };
  const statusLine = (s) => `<span class="pill" style="color:${{ done: 'var(--ok)', needs_input: 'var(--warn)', paused: 'var(--info)', stopping: 'var(--warn)', skipping: 'var(--warn)', stopped: 'var(--muted)', skipped: 'var(--muted)', running: 'var(--brand2)' }[s.status] || 'var(--muted)'}">${esc(s.status.replace('_', ' '))}</span>`;
  window.__applyRender(await api('/api/apply/status'));
};

/* ---------------- global ---------------- */
async function loadMeta() { META = await api('/api/meta'); }
function cmdk() {
  const items = [['Dashboard', '#/dashboard'], ['Jobs — newest', '#/jobs'], ['Jobs — best match', '#/jobs?sort=match'], ['Jobs — remote only', '#/jobs?mode=Remote'], ['Jobs — Pakistan', '#/jobs?country=Pakistan'], ['Domains', '#/domains'], ['Pipeline', '#/pipeline'], ['Resumes', '#/resumes'], ['ATS Lab', '#/ats'], ['Scraper', '#/scraper'], ['Settings', '#/settings'], ['Apply assistant', '#/apply'], ['My application profile', '#/apply?tab=profile'], ['Answer bank', '#/apply?tab=qa'], ...META.domains.map((d) => [`Domain: ${d.label}`, `#/jobs?domain=${d.id}&sort=match`])];
  const m = document.createElement('div'); m.className = 'cmdk'; m.innerHTML = `<div class="box"><input placeholder="Type a command or search jobs…"><div class="list"></div></div>`;
  document.body.appendChild(m); const inp = $('input', m); let sel = 0;
  const draw = () => { const q = inp.value.toLowerCase(); const L = items.filter(([l]) => l.toLowerCase().includes(q)).slice(0, 9); if (q) L.push([`Search jobs for “${inp.value}”`, `#/jobs?q=${encodeURIComponent(inp.value)}&days=`]); sel = Math.min(sel, L.length - 1); $('.list', m).innerHTML = L.map(([l, h], i) => `<div class="it ${i === sel ? 'on' : ''}" data-h="${h}">${esc(l)}</div>`).join(''); $$('.it', m).forEach((e) => (e.onclick = () => { location.hash = e.dataset.h; m.remove(); })); return L; };
  let L = draw(); inp.focus();
  inp.oninput = () => { sel = 0; L = draw(); };
  inp.onkeydown = (e) => { if (e.key === 'ArrowDown') { sel = Math.min(L.length - 1, sel + 1); L = draw(); } if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); L = draw(); } if (e.key === 'Enter' && L[sel]) { location.hash = L[sel][1]; m.remove(); } if (e.key === 'Escape') m.remove(); };
  m.onclick = (e) => e.target === m && m.remove();
}
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdk(); } if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#gq').focus(); } });
$('#gq').onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#/jobs?q=${encodeURIComponent(e.target.value)}&days=`; };
$('#btnTheme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.jhTheme = t; } catch (e) {} };
try { if (localStorage.jhTheme) document.documentElement.dataset.theme = localStorage.jhTheme; } catch (e) {}
$('#btnScrape').onclick = async () => { const r = await api('/api/scrape', { method: 'POST', body: {} }); toast(r.started ? 'Scrape started — follow it in Scraper' : 'A scrape is already running'); location.hash = '#/scraper'; };
$('#btnAdd').onclick = () => modal(`<h3>＋ Add a job manually</h3><div class="col"><input class="inp" id="mt" placeholder="Job title *"><input class="inp" id="mc" placeholder="Company"><input class="inp" id="ml" placeholder="Location (e.g. Remote, Lahore)"><input class="inp" id="mu" placeholder="URL"><textarea class="inp" id="md" rows="9" placeholder="Paste the full job description *"></textarea></div><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn pri" id="mok">Add & score</button></div>`, (m) => {
  $('#mok', m).onclick = async () => { const r = await api('/api/jobs/manual', { method: 'POST', body: { title: $('#mt', m).value, company: $('#mc', m).value, location: $('#ml', m).value, url: $('#mu', m).value, description: $('#md', m).value } }); m.remove(); toast('Job added', 'okk'); if (r.id) openJob(r.id); };
});
async function heartbeat() {
  try {
    const st = await api('/api/scrape/status?since=999999');
    $('#scrapeDot').className = 'dot' + (st.running ? ' live' : '');
    $('#scrapeTxt').textContent = st.running ? 'Scraping…' : st.finished ? `Last scrape ${rel(st.finished)}` : 'Idle';
    $('#nextRun').textContent = 'Daily scrape · 6:30 PM (Claude)';
  } catch (e) {}
  setTimeout(heartbeat, 8000);
}
(async () => { await loadMeta(); api('/api/resumes').then((r) => ($('#ctRes').textContent = r.length)); heartbeat(); applyPoll(); route(); })();

// ---- explicit Apply Assistant browser control ----
async function openInJH(url) {
  try {
    const r = await api('/api/browser/open', { method: 'POST', body: { url: url || null } });
    if (r.ok) { toast(url ? 'Opened in JobHunter Chrome' : 'JobHunter Chrome is open', 'okk'); return true; }
    toast(r.error || 'Could not open JobHunter Chrome', 'err');
  } catch (e) { toast('Could not open JobHunter Chrome', 'err'); }
  return false;
}
window.openInJH = openInJH;

// ---- JobHunter Apply Helper (extension in your own browser) status card ----
async function extCard() {
  const el = $('#extCard'); if (!el) return;
  let st = {}; try { st = await api('/api/ext/status'); } catch {}
  if (st.connected) {
    el.innerHTML = `<div class="row"><span class="pill" style="color:var(--ok)">● Connected</span><span class="small">⚡ Apply opens a <b>new tab in your current ${esc(st.browser || 'browser')} window</b>, using your existing logins. Helper v${esc(st.version || '')}.</span></div>`;
  } else {
    el.innerHTML = `<div class="row" style="align-items:flex-start;gap:14px"><span class="pill" style="color:var(--warn)">○ Helper not installed</span><div class="small" style="flex:1">
      To make ⚡ Apply open as a tab in <b>this browser</b> (already logged in), add the one-time <b>JobHunter Apply Helper</b>:
      <ol style="margin:6px 0 0 18px;padding:0;line-height:1.7">
        <li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) in a new tab — type it in the address bar.</li>
        <li>Turn on <b>Developer mode</b> (top-right).</li>
        <li>Click <b>Load unpacked</b> and choose this folder: <code id="extPath">${esc(st.folder || '')}</code> <button class="btn sm" id="extCopy">Copy path</button></li>
      </ol>
      It only talks to JobHunter on this PC (localhost:8765). This card turns green within a few seconds.</div></div>`;
    $('#extCopy').onclick = () => { navigator.clipboard.writeText(st.folder || ''); toast('Folder path copied', 'okk'); };
    setTimeout(() => { if (location.hash.startsWith('#/apply') && !location.hash.includes('tab=')) extCard(); }, 4000);
  }
}
