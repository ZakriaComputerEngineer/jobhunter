"""Import scraper output into SQLite: normalise, classify, score, dedupe; export CSVs."""
import csv, glob, json, os, re, shutil
from datetime import datetime, timezone, timedelta
from . import db, domains, profile

INBOX = os.path.join(db.DATA, "inbox")
MCP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Temp", ".playwright-mcp")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def fingerprint(j):
    t = re.sub(r"\b(senior|sr|junior|jr|mid|level|remote|hybrid|m w d|f h|h f)\b", "", norm(j.get("title")))
    return f"{norm(t)[:60]}|{norm(j.get('company'))[:40]}"


def load_result(path):
    raw = open(path, encoding="utf-8").read()
    d = json.loads(raw)
    if isinstance(d, str):          # browser_evaluate(filename=...) stores the JSON string quoted
        d = json.loads(d)
    return d


def fix_url(j):
    if j.get("platform") == "Glassdoor" and j.get("ext_id") and "jl=" not in (j.get("url") or ""):
        j["url"] = (j.get("url") or "").split("?")[0] + "?jl=" + str(j["ext_id"])
    return j


def enrich(j):
    title, desc = j.get("title", ""), j.get("description", "") or ""
    country = domains.country_of(j.get("location", ""), j.get("search_region", ""))
    mode = domains.work_mode(j.get("location", ""), desc, bool(j.get("remote")), title)
    res, best = profile.match_job(title, desc)
    jdq = res[best]["jd_quality"]
    base_e = dict(
        fp=fingerprint(j), country=country, region=domains.region_of(country), work_mode=mode,
        seniority=domains.seniority(title, j.get("seniority", ""), desc),
        years_req=domains.years_required(desc), domains=",".join(domains.classify(title, desc)),
        match_auto=res["auto"]["score"], match_ml=res["ml"]["score"], match=res[best]["score"], best_template=best,
        missing=json.dumps(res[best]["skills_missing"]), jd_quality=jdq, lang=domains.language(desc),
    )
    out = dict(country=country, region=domains.region_of(country), work_mode=mode, location=j.get("location"),
               title=title, description=desc)
    out["elig"], out["elig_reason"] = domains.eligibility(out, db.settings())
    return {**base_e, "elig": out["elig"], "elig_reason": out["elig_reason"]}


EXCLUDE = re.compile(r"plc|scada|controls engineer|electrical|mechanical|instrumentation|test automation|qa automation|sdet|quality engineer|quality assurance|\bqa\b|tester|sales|"
                     r"account (?:executive|manager)|marketing|recruit|go-to-market|\bgtm\b|governance|product manager|project manager|"
                     r"program manager|designer|copywriter|writer|annotat|tutor|trainer|customer success|business development|legal|"
                     r"counsel|accountant|payroll|teacher|lecturer|nurse|physician|\beditor\b|videograph|graphic design|content creator", re.I)


def ingest_result(d, source="app", file=None):
    found, new = 0, 0
    ts = now()
    for j in d.get("jobs", []):
        if source != "manual" and EXCLUDE.search(j.get("title") or ""):
            continue
        fix_url(j)
        found += 1
        uid = f"{j.get('platform')}|{j.get('ext_id') or j.get('url')}"
        ex = db.one("SELECT id, description FROM jobs WHERE uid=?", (uid,))
        if ex:
            # refresh last_seen; upgrade description if we now have a longer one
            if len(j.get("description") or "") > len(ex["description"] or ""):
                e = enrich(j)
                db.exe("UPDATE jobs SET description=?, last_seen=?, match_auto=?, match_ml=?, match=?, best_template=?, missing=?, jd_quality=?, domains=?, lang=?, elig=?, elig_reason=? WHERE id=?",
                       (j["description"], ts, e["match_auto"], e["match_ml"], e["match"], e["best_template"], e["missing"], e["jd_quality"], e["domains"], e["lang"], e["elig"], e["elig_reason"], ex["id"]))
            else:
                db.exe("UPDATE jobs SET last_seen=? WHERE id=?", (ts, ex["id"]))
            continue
        e = enrich(j)
        db.exe("""INSERT INTO jobs (uid, fp, platform, ext_id, title, company, location, country, region, work_mode, posted,
                  first_seen, last_seen, url, description, jd_quality, salary, job_type, seniority_raw, seniority, applicants,
                  experience, years_req, domains, match_auto, match_ml, match, best_template, missing, updated_at, lang, elig, elig_reason)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (uid, e["fp"], j.get("platform"), j.get("ext_id"), j.get("title"), j.get("company"), j.get("location"),
                e["country"], e["region"], e["work_mode"], j.get("posted") or ts, ts, ts, j.get("url"), j.get("description"),
                e["jd_quality"], j.get("salary"), j.get("job_type"), j.get("seniority"), e["seniority"], j.get("applicants"),
                j.get("experience"), e["years_req"], e["domains"], e["match_auto"], e["match_ml"], e["match"],
                e["best_template"], e["missing"], ts, e["lang"], e["elig"], e["elig_reason"]))
        new += 1
    db.exe("INSERT INTO runs (source, started, finished, status, platforms, n_found, n_new, stats, log, file) VALUES (?,?,?,?,?,?,?,?,?,?)",
           (source, d.get("started"), d.get("finished") or ts, "ok", ",".join(d.get("platforms", [])), found, new,
            json.dumps(d.get("stats", {})), "\n".join(d.get("log", [])[-400:]), file))
    return found, new


def import_inboxes():
    """Pick up results from the app's inbox and from the Playwright-MCP folder (Claude's scheduled task)."""
    os.makedirs(INBOX, exist_ok=True)
    done = os.path.join(INBOX, "imported")
    os.makedirs(done, exist_ok=True)
    total_new, files = 0, []
    cands = glob.glob(os.path.join(INBOX, "*.json")) + glob.glob(os.path.join(MCP_DIR, "jh_inbox_*.json"))
    for f in sorted(cands, key=os.path.getmtime):
        try:
            d = load_result(f)
            src = "claude-schedule" if MCP_DIR in f else "app"
            _, n = ingest_result(d, src, os.path.basename(f))
            total_new += n
            files.append(os.path.basename(f))
            shutil.move(f, os.path.join(done, os.path.basename(f)))
        except Exception as e:
            print("import failed", f, e)
    if files:
        export_csvs()
    return {"files": files, "new": total_new}


def rescore_all():
    profile.base_content.cache_clear(); profile.base_text.cache_clear()
    for j in db.rows("SELECT id, title, description FROM jobs"):
        res, best = profile.match_job(j["title"], j["description"])
        db.exe("UPDATE jobs SET match_auto=?, match_ml=?, match=?, best_template=?, missing=? WHERE id=?",
               (res["auto"]["score"], res["ml"]["score"], res[best]["score"], best, json.dumps(res[best]["skills_missing"]), j["id"]))
    recompute_eligibility()


def hide_excluded():
    """Hide already-stored jobs whose titles match the (updated) exclusion list, e.g. QA roles."""
    for j in db.rows("SELECT id, title FROM jobs WHERE hidden=0 AND platform!='Manual'"):
        if EXCLUDE.search(j["title"] or ""):
            db.exe("UPDATE jobs SET hidden=1 WHERE id=?", (j["id"],))


def recompute_eligibility(only_missing=False):
    prefs = db.settings()
    db.exe("UPDATE jobs SET country='United States', region='North America' WHERE platform IN ('Glassdoor','Indeed') "
           "AND work_mode='Remote' AND country IN ('Unknown','Worldwide') AND (url LIKE '%glassdoor.com%' OR url LIKE '%//www.indeed.com%')")
    q = "SELECT id, title, location, description, country, region, work_mode, platform FROM jobs" + (" WHERE elig IS NULL" if only_missing else "")
    for j in db.rows(q):
        if j["country"] == "Worldwide" and not domains.OPEN_RX.search(j["location"] or ""):
            j["country"], j["region"] = "Unknown", "Remote/Global"     # older versions over-assumed "worldwide"
            db.exe("UPDATE jobs SET country='Unknown' WHERE id=?", (j["id"],))
        st, why = domains.eligibility(j, prefs)
        db.exe("UPDATE jobs SET elig=?, elig_reason=? WHERE id=?", (st, why, j["id"]))


CSV_COLS = ["id", "posted", "platform", "title", "company", "location", "country", "region", "work_mode", "elig", "elig_reason", "seniority",
            "years_req", "domains", "match", "best_template", "status", "salary", "applicants", "url"]


def _write(path, rs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLS, extrasaction="ignore")
        w.writeheader()
        for r in rs:
            r = dict(r); r["domains"] = ", ".join(domains.DOMAIN_LABEL.get(x, x) for x in (r.get("domains") or "").split(",") if x)
            w.writerow(r)


def safe(s):
    return re.sub(r"[^\w\- ]+", "", s or "").strip().replace(" ", "_")[:60] or "other"


def export_csvs(days=None):
    s = db.settings()
    days = days or s.get("days", 7)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rs = db.rows("SELECT * FROM jobs WHERE hidden=0 AND posted>=? AND COALESCE(elig,'maybe')!='blocked' ORDER BY posted DESC", (since,))
    base = os.path.join(s["output_dir"], "job_csvs")
    stamp = datetime.now().strftime("%Y-%m-%d")
    for root in (os.path.join(base, stamp), os.path.join(base, "latest")):
        if os.path.isdir(root) and root.endswith("latest"):
            shutil.rmtree(root, ignore_errors=True)
        _write(os.path.join(root, "all_jobs.csv"), rs)
        _write(os.path.join(root, "top_matches_70plus.csv"), sorted([r for r in rs if (r["match"] or 0) >= 70], key=lambda r: -r["match"]))
        _write(os.path.join(root, "remote_only.csv"), [r for r in rs if r["work_mode"] == "Remote"])
        _write(os.path.join(root, "mid_level.csv"), [r for r in rs if r["seniority"] == "Mid"])
        _write(os.path.join(root, "eligible_only.csv"), [r for r in rs if r["elig"] == "eligible"])
        for key, sub in (("platform", "by_platform"), ("country", "by_country"), ("region", "by_region")):
            groups = {}
            for r in rs:
                groups.setdefault(r[key] or "Unknown", []).append(r)
            for g, items in groups.items():
                _write(os.path.join(root, sub, safe(g) + ".csv"), items)
        dg = {}
        for r in rs:
            for d in (r["domains"] or "").split(","):
                if d:
                    dg.setdefault(d, []).append(r)
        for d, items in dg.items():
            _write(os.path.join(root, "by_domain", safe(domains.DOMAIN_LABEL.get(d, d)) + ".csv"), items)
    return os.path.join(base, stamp)
