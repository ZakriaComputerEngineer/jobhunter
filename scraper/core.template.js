async (page) => {
  /* JobHunter multi-platform scraper core.
     Runs (a) inside the Node runner (run.mjs) and (b) via the Playwright MCP (browser_run_code).
     Config is injected by the app into the line below. */
  const CFG = /*__CONFIG__*/{};
  const ONLY = /*__ONLY__*/null;

  const T0 = Date.now();
  const BUDGET = CFG.budgetMs || 0;  // MCP calls must finish quickly; Node runner has no budget
  const over = () => BUDGET > 0 && Date.now() - T0 > BUDGET;
  const log = [];
  const say = (m) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${m}`; log.push(s); try { if (globalThis.__jhLog) globalThis.__jhLog(s); } catch (e) {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => sleep(Math.round(a + Math.random() * (b - a)));
  const days = CFG.days || 7;
  const since = Date.now() - days * 864e5;
  const UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ];
  const hdr = () => ({ 'user-agent': UAS[Math.floor(Math.random() * UAS.length)], 'accept-language': 'en-US,en;q=0.9', accept: 'text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8' });
  const D = CFG.delays || { api: [1200, 3500], page: [5000, 11000], detail: [1500, 4000], backoff: [30000, 75000] };
  const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const enabled = (p) => (ONLY ? ONLY.includes(p) : (CFG.platforms || {})[p] !== false);
  const strip = (h) => (h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const rel2iso = (s) => {
    if (!s) return null; s = String(s).toLowerCase();
    if (/just|today|hour|minute|moment|new/.test(s)) return new Date().toISOString();
    if (/yesterday/.test(s)) return new Date(Date.now() - 864e5).toISOString();
    const m = s.match(/(\d+)\+?\s*(h|hr|hour|d|day|w|week|mo|month)/); if (m && /^h/.test(m[2])) return new Date().toISOString(); if (!m) return null;
    const n = +m[1]; const mult = m[2].startsWith('w') ? 7 : m[2].startsWith('mo') ? 30 : 1;
    return new Date(Date.now() - n * mult * 864e5).toISOString();
  };
  const toIso = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString(); const d = new Date(v); return isNaN(d) ? rel2iso(v) : d.toISOString(); };
  const fresh = (iso) => !iso || new Date(iso).getTime() >= since;
  const RELEVANT = new RegExp(CFG.relevantRegex || '(\\bai\\b|a\\.i\\.|artificial intelligence|machine learning|\\bml\\b|mlops|llm|genai|generative|deep learning|data scien|computer vision|\\bnlp\\b|natural language|automation engineer|ai automation|agentic|\\bagents?\\b|prompt engineer|applied scien|research engineer|speech|voice ai|rag\\b)', 'i');
  const EXCLUDE = new RegExp(CFG.excludeRegex || '(plc|scada|controls engineer|electrical|mechanical|instrumentation|test automation|qa automation|sdet|quality engineer|quality assurance|\\bqa\\b|tester|sales|account (?:executive|manager)|marketing|recruit|go-to-market|\\bgtm\\b|governance|product manager|project manager|program manager|designer|copywriter|writer|annotat|tutor|trainer|customer success|business development|legal|counsel|accountant|payroll|teacher|lecturer|nurse|physician|\\beditor\\b|videograph|graphic design|content creator)', 'i');
  const relevant = (title) => RELEVANT.test(title || '') && !EXCLUDE.test(title || '');

  const jobs = []; const seen = new Set(); const stats = {};
  const add = (j) => {
    if (!j || !j.title || !j.url) return;
    j.posted = toIso(j.posted);
    if (!fresh(j.posted)) return;
    if (!relevant(j.title)) return;
    const key = (j.platform + '|' + (j.ext_id || j.url)).toLowerCase();
    if (seen.has(key)) return; seen.add(key);
    j.description = (j.description || '').slice(0, 20000);
    j.scraped_at = new Date().toISOString();
    jobs.push(j); stats[j.platform] = (stats[j.platform] || 0) + 1;
  };

  async function get(url, opts = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await page.request.get(url, { headers: { ...hdr(), ...(opts.headers || {}) }, timeout: 30000 });
        const st = r.status();
        if (st === 429 || st === 503) { say(`  ${st} rate-limited on ${new URL(url).host}, backing off`); await jitter(...D.backoff); continue; }
        if (st >= 400) { say(`  HTTP ${st} ${url.slice(0, 90)}`); return null; }
        return opts.json ? await r.json() : await r.text();
      } catch (e) { say(`  error ${e.message.slice(0, 80)}`); await jitter(4000, 9000); }
    }
    return null;
  }
  const race = (p, ms) => Promise.race([p, sleep(ms)]);
  async function human() {
    // light, fast "reading" behaviour: one pointer move + a few scrolls (stepped mouse moves crawl in background windows)
    try {
      await race(page.mouse.move(150 + Math.random() * 800, 120 + Math.random() * 500), 1500);
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
        await race(page.evaluate((y) => window.scrollBy(0, y), 250 + Math.random() * 650), 1500);
        await jitter(350, 1100);
      }
    } catch (e) {}
  }
  const CHALLENGE = /just a moment|attention required|access denied|captcha|verify you are human|are you a robot|security check|^security \|/i;
  async function visit(url) {
    const tv = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        // Cloudflare-style interstitials usually clear themselves in a few seconds in a real browser
        for (let i = 0; i < 10 && CHALLENGE.test(await page.title().catch(() => '')); i++) await sleep(1500);
        if (CHALLENGE.test(await page.title().catch(() => ''))) { say(`  challenge on ${new URL(url).host}; backing off`); await jitter(...D.backoff); continue; }
        await jitter(...D.page); await human();
        say(`  page ${new URL(url).host} ok in ${Math.round((Date.now() - tv) / 1000)}s`);
        return true;
      } catch (e) { say(`  nav error ${e.message.slice(0, 80)}`); await jitter(5000, 10000); }
    }
    return false;
  }
  const KW = CFG.keywords || ['AI Engineer', 'Machine Learning Engineer', 'AI Automation Engineer', 'LLM Engineer'];
  const KW_REMOTE = CFG.remoteKeywords || ['machine learning', 'AI engineer', 'LLM', 'automation'];

  // ---------------- LinkedIn (guest API) ----------------
  async function linkedin() {
    const locs = CFG.linkedinLocations || [{ name: 'Pakistan' }, { name: 'European Union' }, { name: 'Australia' }, { name: 'United Arab Emirates' }, { name: 'Remote (Worldwide)', geoId: '92000000', remote: true }];
    const tpr = 'r' + days * 86400;
    const exp = CFG.linkedinExperience || '3%2C4';
    const found = [];
    for (const kw of shuffle([...KW])) for (const L of shuffle([...locs])) for (const start of [0, 25, 50].slice(0, L.pages || CFG.linkedinPages || 1)) {
      if (over()) break;
      const loc = L.geoId ? `geoId=${L.geoId}` : `location=${encodeURIComponent(L.name)}`;
      const u = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&${loc}&f_TPR=${tpr}&f_E=${exp}${L.remote ? '&f_WT=2' : ''}&sortBy=DD&start=${start}`;
      const html = await get(u); await jitter(...D.api);
      if (!html) continue;
      const items = await page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; return [...d.querySelectorAll('li')].map((li) => { const a = li.querySelector('a[href*="/jobs/view/"]'); if (!a) return null; const t = (s) => { const e = li.querySelector(s); return e ? e.textContent.trim().replace(/\s+/g, ' ') : ''; }; const tm = li.querySelector('time'); return { title: t('.base-search-card__title'), company: t('.base-search-card__subtitle'), location: t('.job-search-card__location'), posted: tm ? tm.getAttribute('datetime') : '', url: a.href.split('?')[0] }; }).filter(Boolean); }, html);
      for (const it of items) { const id = (it.url.match(/(\d{6,})/) || [])[1]; if (found.find((f) => f.ext_id === id)) continue; found.push({ ...it, ext_id: id, url: `https://www.linkedin.com/jobs/view/${id}`, platform: 'LinkedIn', remote: L.remote || /remote/i.test(it.location), search_region: L.name }); }
    }
    say(`LinkedIn: ${found.length} cards; fetching details`);
    let n = 0; const cap = CFG.linkedinDetailCap || 80;
    for (const j of found) {
      if (!relevant(j.title) || !fresh(toIso(j.posted))) continue;
      if (n++ < cap && !over()) {
        const h = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${j.ext_id}`);
        if (h) {
          const det = await page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; const crit = {}; d.querySelectorAll('.description__job-criteria-item').forEach((li) => { const a = li.querySelector('h3'), b = li.querySelector('span'); if (a && b) crit[a.textContent.trim()] = b.textContent.trim(); }); const m = d.querySelector('.show-more-less-html__markup'); const ap = d.querySelector('.num-applicants__caption'); return { desc: m ? m.innerText || m.textContent : '', crit, applicants: ap ? ap.textContent.trim().replace(/\s+/g, ' ') : '' }; }, h);
          j.description = det.desc; j.seniority = det.crit['Seniority level'] || ''; j.job_type = det.crit['Employment type'] || ''; j.applicants = det.applicants;
        }
        await jitter(...D.detail);
      }
      add(j);
    }
  }

  // ---------------- Indeed (real browser; embedded mosaic JSON) ----------------
  async function indeed() {
    const sites = CFG.indeedSites || [{ host: 'pk.indeed.com', l: 'Pakistan' }, { host: 'au.indeed.com', l: 'Australia' }, { host: 'uk.indeed.com', l: 'United Kingdom' }, { host: 'ae.indeed.com', l: 'United Arab Emirates' }, { host: 'www.indeed.com', l: 'Remote', remote: true }];
    for (const s of shuffle([...sites])) for (const kw of shuffle([...KW]).slice(0, s.kw || CFG.indeedKeywordsPerSite || 3)) {
      if (over()) break;
      const u = `https://${s.host}/jobs?q=${encodeURIComponent(kw)}${s.remote ? '&l=Remote' : ''}&fromage=${Math.min(days, 14)}&sort=date`;
      if (!(await visit(u))) continue;
      const rows = await page.evaluate(() => {
        try { const r = window.mosaic.providerData['mosaic-provider-jobcards'].metaData.mosaicProviderJobCardsModel.results; return r.map((x) => ({ title: x.displayTitle || x.title, company: x.company, location: x.formattedLocation, posted: x.pubDate || x.createDate, rel: x.formattedRelativeTime, snippet: x.snippet, jk: x.jobkey, remote: !!x.remoteLocation, salary: (x.salarySnippet && x.salarySnippet.text) || '' })); } catch (e) {}
        return [...document.querySelectorAll('div.job_seen_beacon')].map((c) => { const a = c.querySelector('a[data-jk]'); const t = (s) => { const e = c.querySelector(s); return e ? e.textContent.trim() : ''; }; return a ? { title: t('h2 span[title], h3 span[title]') || a.textContent.trim(), company: t('[data-testid="company-name"]'), location: t('[data-testid="text-location"]'), rel: t('[data-testid="myJobsStateDate"]'), jk: a.dataset.jk, snippet: t('[data-testid="belowJobSnippet"], .job-snippet') } : null; }).filter(Boolean);
      });
      for (const r of rows) add({ platform: 'Indeed', ext_id: r.jk, title: r.title, company: r.company, location: r.location, posted: r.posted || rel2iso(r.rel), description: strip(r.snippet), url: `https://${s.host}/viewjob?jk=${r.jk}`, remote: r.remote || s.remote || /remote/i.test(r.location || ''), salary: r.salary, search_region: s.remote ? 'United States' : s.l });
      say(`Indeed ${s.host} "${kw}": ${rows.length}`);
    }
  }

  // ---------------- Glassdoor (real browser) ----------------
  async function glassdoor() {
    const locs = CFG.glassdoorLocations || [{ name: 'Pakistan', slug: 'pakistan', il: 'IN192' }, { name: 'Remote', q: 'remoteWorkType=1' }];
    for (const L of locs) for (const kw of shuffle([...KW]).slice(0, CFG.glassdoorKeywords || 3)) {
      if (over()) break;
      // canonical SRCH URL keeps fromAge (the jobs.htm form drops it on redirect)
      const ks = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-'); const ls = (L.slug || '').toLowerCase();
      const path = ls ? `${ls}-${ks}-jobs-SRCH_IL.0,${ls.length}_${L.il}_KO${ls.length + 1},${ls.length + 1 + ks.length}.htm` : `${ks}-jobs-SRCH_KO0,${ks.length}.htm`;
      const u = `https://www.glassdoor.com/Job/${path}?fromAge=${Math.min(days, 14)}&sortBy=date_desc${L.q ? '&' + L.q : ''}`;
      if (!(await visit(u))) continue;
      const rows = await page.evaluate(() => [...document.querySelectorAll('li[data-test="jobListing"]')].map((li) => { const t = (s) => { const e = li.querySelector(s); return e ? e.textContent.trim() : ''; }; const a = li.querySelector('a[data-test="job-title"], a[href*="job-listing"]'); return a ? { id: li.dataset.jobid, title: a.textContent.trim(), url: a.href, company: t('[class*="EmployerProfile_compactEmployerName"], [class*="employerName"]').replace(/\s*\d\.\d\s*★?$/, ''), location: t('[data-test="emp-location"]'), age: t('[data-test="job-age"], [class*="listingAge"], [class*="JobCard_age"], [class*="jobAge"]') || ([...li.querySelectorAll('div,span')].map((e) => e.textContent.trim()).find((x) => /^\d+\s*[dh]\+?$|^\d+\s*(day|hour)s?\s*ago$/i.test(x)) || ''), snippet: t('[data-test="descSnippet"], [class*="jobDescriptionSnippet"]'), salary: t('[data-test="detailSalary"]') } : null; }).filter(Boolean));
      for (const r of rows) add({ platform: 'Glassdoor', ext_id: r.id, title: r.title, company: r.company, location: r.location, posted: rel2iso(r.age), description: r.snippet, url: r.url.split('?')[0] + (r.id ? `?jl=${r.id}` : ''), remote: L.name === 'Remote' || /remote/i.test(r.location), salary: r.salary, search_region: L.name === 'Remote' ? 'United States' : L.name });
      say(`Glassdoor ${L.name} "${kw}": ${rows.length}`);
    }
  }

  // ---------------- Bayt (real browser) ----------------
  async function bayt() {
    const regions = CFG.baytRegions || ['pakistan', 'uae', 'saudi-arabia'];
    for (const rg of regions) for (const kw of shuffle(['machine learning engineer', 'ai engineer', 'automation engineer']).slice(0, 2)) {
      if (over()) break;
      const slug = kw.replace(/\s+/g, '-');
      if (!(await visit(`https://www.bayt.com/en/${rg}/jobs/${slug}-jobs/?filters%5Bjb_last_modification_date_interval%5D%5B%5D=${days <= 7 ? 7 : 30}`))) continue;
      const rows = await page.evaluate(() => [...document.querySelectorAll('li[data-js-job]')].map((li) => { const a = li.querySelector('h2 a'); const t = (s) => { const e = li.querySelector(s); return e ? e.textContent.trim().replace(/\s+/g, ' ') : ''; }; const wrap = li.querySelectorAll('.job-company-location-wrapper > div'); return a ? { id: li.dataset.jobId, title: a.textContent.trim(), url: a.href, company: wrap[0] ? wrap[0].textContent.trim() : '', location: wrap[1] ? wrap[1].textContent.trim().replace(/\s+/g, ' ') : '', age: t('[data-automation-id="job-active-date"], .jb-date'), snippet: t('.jb-descr') } : null; }).filter(Boolean));
      for (const r of rows) add({ platform: 'Bayt', ext_id: r.id, title: r.title, company: r.company, location: r.location || rg, posted: rel2iso(r.age), description: r.snippet, url: r.url, search_region: rg });
      say(`Bayt ${rg} "${kw}": ${rows.length}`);
    }
  }

  // ---------------- Rozee.pk (real browser) ----------------
  async function rozee() {
    for (const kw of (CFG.rozeeKeywords || ['machine learning', 'artificial intelligence', 'ai engineer', 'automation engineer', 'data scientist', 'llm', 'python ai', 'computer vision', 'nlp', 'mlops'])) {
      if (over()) break;
      if (!(await visit(`https://www.rozee.pk/job/jsearch/q/${encodeURIComponent(kw)}/fdte/${days <= 7 ? 7 : 15}`))) continue;
      try { await page.waitForSelector('#jobs .job h3 a', { timeout: 15000 }); } catch (e) {}
      const rows = await page.evaluate(() => [...document.querySelectorAll('#jobs .job')].map((j) => { const a = j.querySelector('h3 a'); if (!a) return null; const cn = j.querySelector('.cname'); const spans = [...j.querySelectorAll('.jfooter span')].map((s) => s.textContent.trim()); return { title: a.textContent.trim(), url: a.href.split('?')[0], cname: cn ? cn.textContent.trim().replace(/\s+/g, ' ') : '', desc: (j.querySelector('.jbody') || {}).textContent || '', date: spans.find((s) => /\d{4}/.test(s)) || '', exp: spans.find((s) => /year/i.test(s)) || '', skills: [...j.querySelectorAll('.jblk span')].map((s) => s.textContent.trim()).join(', ') }; }).filter(Boolean));
      for (const r of rows) { const parts = r.cname.split(','); add({ platform: 'Rozee.pk', ext_id: (r.url.match(/-(\d+)$/) || [])[1], title: r.title, company: parts[0] || '', location: parts.slice(1).join(',').trim() + (/pakistan/i.test(r.cname) ? '' : ', Pakistan'), posted: r.date, description: (r.desc || '').trim() + (r.skills ? '\nSkills: ' + r.skills : ''), experience: r.exp, url: r.url, search_region: 'Pakistan' }); }
      say(`Rozee "${kw}": ${rows.length}`);
    }
  }


  // ---------------- Careerjet Pakistan (aggregator; real browser) ----------------
  async function careerjet() {
    for (const kw of (CFG.pkKeywords || ['machine learning', 'artificial intelligence', 'AI engineer', 'automation engineer', 'data scientist', 'LLM'])) {
      if (over()) break;
      if (!(await visit(`https://www.careerjet.com.pk/jobs?s=${encodeURIComponent(kw)}&l=Pakistan&sort=date`))) continue;
      const rows = await page.evaluate(() => [...document.querySelectorAll('article.job')].map((a) => { const t = (s) => { const e = a.querySelector(s); return e ? e.textContent.trim().replace(/\s+/g, ' ') : ''; }; const h = a.querySelector('h2 a'); return h ? { title: h.textContent.trim(), url: new URL(a.dataset.url || h.getAttribute('href'), location.origin).href, company: t('.company'), location: t('.location'), desc: t('.desc'), age: t('footer .badge') } : null; }).filter(Boolean));
      for (const r of rows) add({ platform: 'Careerjet PK', ext_id: (r.url.match(/jobad\/([a-z0-9]+)/) || [])[1], title: r.title, company: r.company, location: (r.location || 'Pakistan') + (/pakistan/i.test(r.location) ? '' : ', Pakistan'), posted: rel2iso(r.age), description: r.desc, url: r.url, remote: /remote/i.test(r.title + ' ' + r.location), search_region: 'Pakistan' });
      say(`Careerjet PK "${kw}": ${rows.length}`);
    }
  }

  // ---------------- Jooble Pakistan (aggregator; real browser) ----------------
  async function jooble() {
    for (const kw of (CFG.pkKeywords || ['machine learning', 'artificial intelligence', 'AI engineer', 'automation engineer', 'data scientist', 'LLM'])) {
      if (over()) break;
      if (!(await visit(`https://pk.jooble.org/SearchResult?ukw=${encodeURIComponent(kw)}&date=${days <= 3 ? 2 : 3}`))) continue;
      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-test-name="_jobCard"]')].map((c) => {
        const a = c.querySelector('h2 a'); if (!a) return null;
        const leaves = [...c.querySelectorAll('div,span,p')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim()).filter(Boolean);
        const co = c.querySelector('[data-test-name="_companyName"]');
        const age = leaves.find((x) => /\bago\b|today|yesterday|hour/i.test(x)) || '';
        const ci = co ? leaves.indexOf(co.textContent.trim()) : -1;
        const loc = ci >= 0 ? (leaves.slice(ci + 1).find((x) => x !== age && x.length < 60) || '') : '';
        const tag = [...c.querySelectorAll('[data-test-name="_jobTag"]')].map((e) => e.textContent.trim()).join(' ');
        const hrs = +((a.href.match(/jobAge=(\d+)/) || [])[1] || 0);
        return { title: a.textContent.trim(), url: a.href.split('?')[0], company: co ? co.textContent.trim() : '', location: loc, age, hrs, tag, salary: (leaves.find((x) => /pkr|rs\.?\s?\d|\$\s?\d/i.test(x)) || ''), desc: (c.innerText || '').slice(0, 600) };
      }).filter(Boolean));
      for (const r of rows) add({ platform: 'Jooble PK', ext_id: (r.url.match(/(?:desc|away)\/(-?\d+)/) || [])[1], title: r.title, company: r.company, location: r.location || 'Pakistan', posted: r.hrs ? new Date(Date.now() - r.hrs * 3600e3).toISOString() : rel2iso(r.age), description: r.desc, url: r.url, remote: /remote/i.test(r.tag + ' ' + r.title), salary: r.salary, search_region: 'Pakistan' });
      say(`Jooble PK "${kw}": ${rows.length}`);
    }
  }

  // ---------------- Seek (AU API) ----------------
  async function seek() {
    for (const kw of KW) {
      const d = await get(`https://www.seek.com.au/api/jobsearch/v5/search?siteKey=AU-Main&where=All%20Australia&keywords=${encodeURIComponent(kw)}&page=1&sortmode=ListedDate&daterange=${days}`, { json: true }); await jitter(...D.api);
      for (const x of (d && d.data) || []) add({ platform: 'Seek', ext_id: String(x.id), title: x.title, company: (x.advertiser && x.advertiser.description) || x.companyName || '', location: ((x.locations && x.locations[0] && x.locations[0].label) || x.location || '') + ', Australia', posted: x.listingDate, description: [x.teaser, ...(x.bulletPoints || [])].join('\n'), url: `https://www.seek.com.au/job/${x.id}`, remote: /remote/i.test(JSON.stringify(x.workArrangements || '')), salary: x.salaryLabel || '', job_type: x.workType || '', search_region: 'Australia' });
      say(`Seek "${kw}": ${((d && d.data) || []).length}`);
    }
  }

  // ---------------- Remote boards (APIs) ----------------
  async function remotive() {
    for (const kw of KW_REMOTE) { const d = await get(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(kw)}&limit=100`, { json: true }); await jitter(...D.api);
      for (const x of (d && d.jobs) || []) add({ platform: 'Remotive', ext_id: String(x.id), title: x.title, company: x.company_name, location: x.candidate_required_location || 'Remote', posted: x.publication_date, description: strip(x.description), url: x.url, remote: true, salary: x.salary, job_type: x.job_type }); }
    say(`Remotive done`);
  }
  async function remoteok() {
    for (const tag of ['ai', 'machine-learning', 'ml', 'llm']) { const d = await get(`https://remoteok.com/api?tag=${tag}`, { json: true }); await jitter(2500, 5000);
      for (const x of (Array.isArray(d) ? d.slice(1) : [])) add({ platform: 'RemoteOK', ext_id: String(x.id), title: x.position, company: x.company, location: x.location || 'Remote', posted: x.date || x.epoch, description: strip(x.description), url: x.url, remote: true, salary: x.salary_min ? `$${x.salary_min}-${x.salary_max}` : '' }); }
    say(`RemoteOK done`);
  }
  async function wwr() {
    for (const cat of ['remote-programming-jobs', 'remote-full-stack-programming-jobs', 'remote-back-end-programming-jobs', 'remote-devops-sysadmin-jobs']) {
      const x = await get(`https://weworkremotely.com/categories/${cat}.rss`); await jitter(...D.api); if (!x) continue;
      const items = await page.evaluate((xml) => { const d = new DOMParser().parseFromString(xml, 'text/xml'); return [...d.querySelectorAll('item')].map((i) => ({ t: i.querySelector('title')?.textContent || '', l: i.querySelector('link')?.textContent || '', p: i.querySelector('pubDate')?.textContent || '', r: i.querySelector('region')?.textContent || 'Remote', d: i.querySelector('description')?.textContent || '' })); }, x);
      for (const i of items) { const [co, ...rest] = i.t.split(':'); add({ platform: 'WeWorkRemotely', ext_id: i.l, title: rest.join(':').trim() || i.t, company: co.trim(), location: i.r, posted: i.p, description: strip(i.d), url: i.l, remote: true }); }
    }
    say(`WWR done`);
  }
  async function arbeitnow() {
    for (let p = 1; p <= (CFG.arbeitnowPages || 4); p++) { const d = await get(`https://www.arbeitnow.com/api/job-board-api?page=${p}`, { json: true }); await jitter(...D.api);
      for (const x of (d && d.data) || []) add({ platform: 'Arbeitnow', ext_id: x.slug, title: x.title, company: x.company_name, location: (x.location || '') + (x.remote ? ' (Remote)' : ''), posted: x.created_at, description: strip(x.description), url: x.url, remote: !!x.remote, job_type: (x.job_types || []).join(', ') }); }
    say(`Arbeitnow done`);
  }
  async function jobicy() {
    for (const tag of ['machine learning', 'ai', 'llm', 'data science', 'automation']) { const d = await get(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`, { json: true }); await jitter(...D.api);
      for (const x of (d && d.jobs) || []) add({ platform: 'Jobicy', ext_id: String(x.id), title: x.jobTitle, company: x.companyName, location: x.jobGeo || 'Remote', posted: x.pubDate, description: strip(x.jobDescription || x.jobExcerpt), url: x.url, remote: true, seniority: x.jobLevel || '', job_type: [].concat(x.jobType || []).join(', '), salary: x.annualSalaryMin ? `${x.salaryCurrency || ''} ${x.annualSalaryMin}-${x.annualSalaryMax}` : '' }); }
    say(`Jobicy done`);
  }
  async function himalayas() {
    for (const q of KW_REMOTE) { const d = await get(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent`, { json: true }); await jitter(...D.api);
      for (const x of (d && d.jobs) || []) add({ platform: 'Himalayas', ext_id: x.guid || x.applicationLink, title: x.title, company: x.companyName, location: (x.locationRestrictions || []).join(', ') || 'Remote (Worldwide)', posted: x.pubDate, description: strip(x.description || x.excerpt), url: x.applicationLink || x.guid, remote: true, seniority: [].concat(x.seniority || []).join(', '), job_type: x.employmentType || '', salary: x.minSalary ? `${x.currency || ''} ${x.minSalary}-${x.maxSalary}` : '' }); }
    say(`Himalayas done`);
  }
  async function workingnomads() {
    const d = await get('https://www.workingnomads.com/api/exposed_jobs/', { json: true });
    for (const x of d || []) add({ platform: 'Working Nomads', ext_id: x.url, title: x.title, company: x.company_name, location: x.location || 'Remote', posted: x.pub_date, description: strip(x.description), url: x.url, remote: true });
    say(`Working Nomads done`);
  }
  async function hackernews() {
    const s = await get('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5', { json: true });
    const story = ((s && s.hits) || []).find((h) => /who is hiring/i.test(h.title)); if (!story) return;
    const it = await get(`https://hn.algolia.com/api/v1/items/${story.objectID}`, { json: true });
    let n = 0;
    for (const c of (it && it.children) || []) {
      const txt = strip(c.text || ''); if (!txt) continue;
      const first = txt.split('\n')[0]; const parts = first.split('|').map((x) => x.trim());
      const role = parts.find((p) => RELEVANT.test(p)) || (RELEVANT.test(first) ? first : '');
      if (!role) continue;
      add({ platform: 'HN Who\'s Hiring', ext_id: String(c.id), title: role.slice(0, 140), company: parts[0].slice(0, 80), location: parts.find((p) => /remote|onsite|hybrid|,/i.test(p) && p !== role) || '', posted: c.created_at, description: txt, url: `https://news.ycombinator.com/item?id=${c.id}`, remote: /remote/i.test(first) }); n++;
    }
    say(`HN: ${n}`);
  }
  async function atsboards() {
    for (const b of CFG.companyBoards || []) {
      let rows = [];
      if (b.type === 'ashby') { const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${b.slug}?includeCompensation=true`, { json: true }); rows = ((d && d.jobs) || []).map((x) => ({ id: x.id, title: x.title, location: x.location + (x.isRemote ? ' (Remote)' : ''), posted: x.publishedAt, desc: x.descriptionPlain || strip(x.descriptionHtml), url: x.jobUrl, remote: x.isRemote })); }
      if (b.type === 'greenhouse') { const d = await get(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`, { json: true }); rows = ((d && d.jobs) || []).map((x) => ({ id: x.id, title: x.title, location: (x.location || {}).name, posted: x.updated_at, desc: strip(x.content), url: x.absolute_url })); }
      if (b.type === 'lever') { const d = await get(`https://api.lever.co/v0/postings/${b.slug}?mode=json`, { json: true }); rows = (d || []).map((x) => ({ id: x.id, title: x.text, location: (x.categories || {}).location, posted: x.createdAt, desc: x.descriptionPlain, url: x.hostedUrl, remote: /remote/i.test(x.workplaceType || '') })); }
      for (const r of rows) add({ platform: `Company: ${b.name || b.slug}`, ext_id: String(r.id), title: r.title, company: b.name || b.slug, location: r.location || '', posted: r.posted, description: r.desc, url: r.url, remote: !!r.remote || /remote/i.test(r.location || '') });
      say(`${b.type}/${b.slug}: ${rows.length}`); await jitter(...D.api);
    }
  }

  if (!globalThis.__jhSink) { try { await page.goto('about:blank'); } catch (e) {} }  // MCP: clear the previous group's result
  const ALL = { linkedin, indeed, glassdoor, bayt, rozee, careerjet, jooble, seek, remotive, remoteok, wwr, arbeitnow, jobicy, himalayas, workingnomads, hackernews, atsboards };
  // interleave API & browser platforms so no single domain gets hammered
  const order = shuffle(Object.keys(ALL)).filter(enabled);
  say(`Starting scrape: ${order.join(', ')} | window ${days}d`);
  for (const p of order) {
    if (over()) { say(`time budget reached, skipping ${p}`); continue; }
    const t = Date.now(); const before = jobs.length;
    try { await ALL[p](); } catch (e) { say(`${p} FAILED: ${e.message.slice(0, 160)}`); }
    say(`${p}: +${jobs.length - before} relevant jobs (${Math.round((Date.now() - t) / 1000)}s)`);
    await jitter(1500, 4000);
  }
  const result = { version: 1, started: new Date(T0).toISOString(), finished: new Date().toISOString(), days, platforms: order, stats, log, jobs };
  try { if (globalThis.__jhSink) { globalThis.__jhSink(result); return { ok: true, n: jobs.length, stats }; } } catch (e) {}
  // MCP mode: stash on a blank page so browser_evaluate(..., filename) can persist it without passing through the model
  await page.goto('about:blank');
  await page.evaluate((r) => { window.__JH_RESULT = JSON.stringify(r); }, result);
  return JSON.stringify({ ok: true, n: jobs.length, stats, secs: Math.round((Date.now() - T0) / 1000), tail: log.slice(-6) });
}
