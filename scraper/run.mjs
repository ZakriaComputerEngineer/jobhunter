// JobHunter scraper runner (Node + Playwright, uses your installed Chrome/Edge).
// usage:
//   node run.mjs scrape <config.json> <out.json> [platform,platform]
//   node run.mjs jd <url> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }

const [, , mode, a1, a2, a3] = process.argv;
const cfg = mode === 'scrape' ? JSON.parse(fs.readFileSync(a1, 'utf8')) : JSON.parse(fs.existsSync(path.join(HERE, '..', 'data', 'scraper_config.json')) ? fs.readFileSync(path.join(HERE, '..', 'data', 'scraper_config.json'), 'utf8') : '{}');
const profileDir = path.join(HERE, '..', 'data', mode === 'jd' ? 'browser-profile-jd' : 'browser-profile');  // separate so a JD fetch works during a scrape

const STEALTH = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = window.chrome || { runtime: {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  const q = window.navigator.permissions && window.navigator.permissions.query;
  if (q) window.navigator.permissions.query = (p) => (p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : q(p));
};

async function launch() {
  const vw = 1280 + Math.floor(Math.random() * 300), vh = 760 + Math.floor(Math.random() * 200);
  const opts = {
    headless: !!cfg.headless,
    viewport: { width: vw, height: vh },
    locale: 'en-US',
    timezoneId: cfg.timezone || 'Asia/Karachi',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      ...(cfg.headless ? [] : ['--window-position=-2400,-2400'])],  // headful but off-screen: far fewer bot challenges
    ignoreDefaultArgs: ['--enable-automation'],
  };
  for (const channel of [cfg.browser_channel || 'chrome', 'msedge', undefined]) {
    try {
      const ctx = await chromium.launchPersistentContext(profileDir, { ...opts, ...(channel ? { channel } : {}) });
      await ctx.addInitScript(STEALTH);
      console.log(`[runner] browser: ${channel || 'bundled chromium'} headless=${!!cfg.headless}`);
      return ctx;
    } catch (e) { console.log(`[runner] ${channel || 'chromium'} unavailable: ${e.message.split('\n')[0]}`); }
  }
  throw new Error('No browser available. Install Google Chrome or run: npx playwright install chromium');
}

if (mode === 'scrape') {
  const only = a3 ? a3.split(',') : null;
  let code = fs.readFileSync(path.join(HERE, 'core.template.js'), 'utf8');
  code = code.replace('/*__CONFIG__*/{}', JSON.stringify(cfg)).replace('/*__ONLY__*/null', JSON.stringify(only));
  const fn = (0, eval)('(' + code + ')');
  const ctx = await launch();
  const page = ctx.pages()[0] || (await ctx.newPage());
  globalThis.__jhLog = (s) => console.log(s);
  globalThis.__jhSink = (r) => { fs.writeFileSync(a2, JSON.stringify(r)); console.log(`[runner] wrote ${r.jobs.length} jobs -> ${a2}`); };
  try { await fn(page); } finally { await ctx.close(); }
} else if (mode === 'jd') {
  const url = a1;
  const ctx = await launch();
  const page = ctx.pages()[0] || (await ctx.newPage());
  let text = '';
  try {
    const li = url.match(/linkedin\.com\/jobs\/view\/(?:.*-)?(\d{6,})/);
    if (li) {
      const r = await page.request.get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${li[1]}`);
      await page.setContent(await r.text());
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000 + Math.random() * 3000);
    }
    text = await page.evaluate(() => {
      const sels = ['.show-more-less-html__markup', '#jobDescriptionText', '[class*="JobDetails_jobDescription"]', '[data-test="jobDescriptionContent"]',
        '.jb-descr', '#job-description', '[class*="job-description"]', '[class*="jobDescription"]', '[data-automation="jobAdDetails"]', '.jblk', 'article', 'main'];
      for (const s of sels) { const e = document.querySelector(s); if (e && e.innerText && e.innerText.trim().length > 200) return e.innerText.trim(); }
      let best = ''; document.querySelectorAll('div,section').forEach((d) => { const t = d.innerText || ''; if (t.length > best.length && t.length < 20000 && d.querySelectorAll('li,p').length > 3) best = t; });
      return best.trim();
    });
  } finally { await ctx.close(); }
  fs.writeFileSync(a2, JSON.stringify({ url, text }));
  console.log(`[runner] JD ${text.length} chars`);
}
