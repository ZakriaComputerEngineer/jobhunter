"""Runs the Node/Playwright scraper as a subprocess, streams its log, ingests results.
Also writes ready-to-run copies of the scraper into the Playwright-MCP folder for Claude's scheduled task."""
import json, os, shutil, subprocess, threading, time
from datetime import datetime
from . import db, ingest, discovery

SCRAPER_DIR = os.path.join(db.ROOT, "scraper")
STATE = {"running": False, "log": [], "started": None, "finished": None, "result": None, "platforms": None}
_lock = threading.Lock()

# Claude's scheduled task runs these through the Playwright connector, which stops a call after ~2-3 minutes,
# so the work is split into small groups, each with a 140 s budget.
def mcp_groups(cfg):
    """Groups sized to finish in ~100 s (the connector stops longer calls). Pakistan gets its own, deeper groups."""
    L, I, B = cfg["linkedinLocations"], cfg["indeedSites"], cfg["baytRegions"]
    chunk = lambda xs, n: [xs[i:i + n] for i in range(0, len(xs), n)]
    g = {}
    pk = [l for l in L if "pakistan" in l["name"].lower()]
    rest = [l for l in L if l not in pk]
    for i, loc in enumerate(pk):
        g[f"linkedin_pk{i + 1 if i else ''}"] = (["linkedin"], {"linkedinLocations": [loc], "linkedinDetailCap": 35})
    for i, locs in enumerate(chunk(rest, 2)):
        g[f"linkedin_{i + 1}"] = (["linkedin"], {"linkedinLocations": locs, "linkedinDetailCap": 30})
    ipk = [s for s in I if s["host"].startswith("pk.")]
    irest = [s for s in I if s not in ipk]
    if ipk:
        g["indeed_pk"] = (["indeed"], {"indeedSites": ipk, "indeedKeywordsPerSite": 5})
    for i, sites in enumerate(chunk(irest, 3)):
        g[f"indeed_{i + 1}"] = (["indeed"], {"indeedSites": sites, "indeedKeywordsPerSite": 2})
    g["pk_boards"] = (["careerjet", "jooble"], {"pkKeywords": ["machine learning", "AI engineer", "artificial intelligence", "automation engineer", "data scientist"]})
    g["rozee_1"] = (["rozee"], {"rozeeKeywords": ["machine learning", "ai engineer", "automation engineer", "artificial intelligence", "llm"]})
    g["rozee_2"] = (["rozee"], {"rozeeKeywords": ["data scientist", "python ai", "computer vision", "nlp", "mlops"]})
    bh = chunk(B, 2) + [[]]
    g["glassdoor_bayt"] = (["glassdoor", "bayt"], {"glassdoorKeywords": 3, "baytRegions": bh[0]})
    if len(bh) > 2:
        g["bayt_2"] = (["bayt"], {"baytRegions": bh[1]})
    g["seek_hn"] = (["seek", "hackernews", "atsboards"], {})
    g["remote_boards"] = (["remotive", "remoteok", "wwr", "arbeitnow", "jobicy", "himalayas", "workingnomads"], {"arbeitnowPages": 3})
    return g


def _valid_js(code):
    """Never ship a scraper file with a syntax error (node is available wherever the scraper runs)."""
    try:
        r = subprocess.run([_node(), "-e", "new Function('page', 'return (' + require('fs').readFileSync(0, 'utf8') + ')')"],
                           input=code, capture_output=True, text=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0
    except Exception:
        return True   # node missing: can't check, don't block


def _minify(js):
    out = []
    for line in js.splitlines():
        t = line.strip()
        if not t or t.startswith("//"):
            continue
        out.append(t)
    js = "\n".join(out)
    i, j = js.find("/*"), js.find("*/")
    if 0 <= i < 200 and j > i:          # header comment only
        js = js[:i] + js[j + 2:]
    return js


def scraper_config():
    s = db.settings()
    discovery_filters, filter_bags = discovery.scraper_payload(s.get("discovery_filters"))
    return {
        "days": s["days"], "keywords": s["keywords"], "remoteKeywords": s["remote_keywords"],
        "linkedinLocations": s["linkedin_locations"], "linkedinExperience": s["linkedin_experience"],
        "linkedinDetailCap": s["linkedin_detail_cap"], "indeedSites": s["indeed_sites"],
        "glassdoorLocations": s["glassdoor_locations"], "baytRegions": s["bayt_regions"],
        "companyBoards": s["company_boards"], "platforms": s["platforms"], "delays": s["delays"],
        "headless": s["headless"], "browser_channel": s["browser_channel"], "timezone": "Asia/Karachi",
        "discoveryFilters": discovery_filters, "filterBags": filter_bags,
    }


def write_mcp_copies():
    """Write one scraper file per group into the Playwright-MCP folder (the only folder that connector may read)."""
    try:
        os.makedirs(ingest.MCP_DIR, exist_ok=True)
        for f in os.listdir(ingest.MCP_DIR):
            if f.startswith("jh_core_") and f.endswith(".js"):
                os.remove(os.path.join(ingest.MCP_DIR, f))
        tpl = open(os.path.join(SCRAPER_DIR, "core.template.js"), encoding="utf-8").read()
        cfg = scraper_config()
        cfg["delays"] = {"api": [900, 2200], "page": [4000, 8000], "detail": [1000, 2500], "backoff": [15000, 30000]}
        cfg["budgetMs"] = 100000
        names = []
        for name, (only, over) in mcp_groups(cfg).items():
            if not any(cfg["platforms"].get(p, True) for p in only):
                continue
            c = {**cfg, **over}
            code = tpl.replace("/*__CONFIG__*/{}", json.dumps(c, separators=(",", ":"))).replace("/*__ONLY__*/null", json.dumps(only))
            code = _minify(code)
            if not _valid_js(code):
                print(f"scraper group {name}: generated code failed the syntax check, skipped")
                continue
            open(os.path.join(ingest.MCP_DIR, f"jh_core_{name}.js"), "w", encoding="utf-8").write(code)
            names.append(name)
        json.dump({"groups": names, "written": datetime.now().isoformat(timespec="seconds")},
                  open(os.path.join(ingest.MCP_DIR, "jh_manifest.json"), "w"), indent=1)
        return names
    except Exception as e:
        print("could not write MCP scraper copies:", e)
        return []


def _node():
    return shutil.which("node") or r"C:\Program Files\nodejs\node.exe"


def _say(m):
    with _lock:
        STATE["log"].append(m)
        STATE["log"] = STATE["log"][-2000:]


def run(platforms=None, source="app"):
    if STATE["running"]:
        return False
    os.makedirs(ingest.INBOX, exist_ok=True)
    cfg_path = os.path.join(db.DATA, "scraper_config.json")
    json.dump(scraper_config(), open(cfg_path, "w"), indent=1)
    out = os.path.join(db.DATA, f"scrape_{datetime.now():%Y%m%d_%H%M%S}.json")
    STATE.update(running=True, log=[], started=datetime.now().isoformat(timespec="seconds"), finished=None, result=None, platforms=platforms)

    def work():
        try:
            cmd = [_node(), os.path.join(SCRAPER_DIR, "run.mjs"), "scrape", cfg_path, out] + ([",".join(platforms)] if platforms else [])
            _say("$ node run.mjs scrape " + (",".join(platforms) if platforms else "(all platforms)"))
            p = subprocess.Popen(cmd, cwd=SCRAPER_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            for line in p.stdout:
                _say(line.rstrip())
            p.wait()
            if os.path.exists(out):
                d = ingest.load_result(out)
                found, new = ingest.ingest_result(d, source, os.path.basename(out))
                shutil.move(out, os.path.join(ingest.INBOX, "imported", os.path.basename(out))) if os.path.isdir(os.path.join(ingest.INBOX, "imported")) else None
                folder = ingest.export_csvs()
                _say(f"Imported {found} jobs ({new} new). CSVs → {folder}")
                STATE["result"] = {"found": found, "new": new, "csv": folder}
            else:
                _say(f"Scraper exited with code {p.returncode} and produced no file.")
        except Exception as e:
            _say(f"ERROR: {e}")
        finally:
            STATE["running"] = False
            STATE["finished"] = datetime.now().isoformat(timespec="seconds")

    threading.Thread(target=work, daemon=True).start()
    return True


def fetch_jd(url, timeout=120):
    out = os.path.join(db.DATA, f"jd_{int(time.time())}.json")
    subprocess.run([_node(), os.path.join(SCRAPER_DIR, "run.mjs"), "jd", url, out], cwd=SCRAPER_DIR, timeout=timeout,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if os.path.exists(out):
        d = json.load(open(out, encoding="utf-8"))
        os.remove(out)
        return d.get("text", "")
    return ""


# ---------------- daily scheduler (in-app; Claude's scheduled task is the second line of defence) ----------------
def scheduler_loop():
    last = None
    while True:
        try:
            s = db.settings()
            ingest.import_inboxes()              # pick up anything Claude's scheduled task dropped
            if s.get("schedule_enabled"):
                now = datetime.now()
                hh, mm = map(int, s.get("schedule_time", "18:30").split(":"))
                if now.hour == hh and now.minute >= mm and now.minute < mm + 15 and last != now.date():
                    last = now.date()
                    recent = db.one("SELECT finished FROM runs WHERE finished >= ? ORDER BY id DESC LIMIT 1",
                                    ((now.replace(hour=0, minute=0)).isoformat(),))
                    if not STATE["running"] and not recent:
                        _say("Fallback schedule: no scrape imported today yet, running now.")
                        run(source="app-schedule")
        except Exception as e:
            print("scheduler:", e)
        time.sleep(60)
