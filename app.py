"""JobHunter — personal AI/ML job radar + ATS resume tailor.  Run: python app.py  → http://localhost:8765"""
import csv, html, io, json, os, re, sys, threading, uuid, webbrowser
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, request, send_file, send_from_directory, Response, redirect

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jh import exthub  # noqa: E402
from jh import db, domains, ingest, profile, scraper, tailor, ats, render, apply as applier, applyprofile, gmail_sync  # noqa: E402

app = Flask(__name__, static_folder=None)
WEB = os.path.join(db.ROOT, "web")
TASKS = {}


def utc_since(days):
    return (datetime.now(timezone.utc) - timedelta(days=float(days))).isoformat()


@app.get("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.get("/web/<path:p>")
def static_web(p):
    return send_from_directory(WEB, p)


# ------------------------------------------------------------------ meta / stats
@app.get("/api/meta")
def meta():
    s = db.settings()
    return jsonify({
        "domains": [{"id": d[0], "label": d[1], "color": d[2]} for d in domains.DOMAINS],
        "templates": [{"id": k, "label": v["label"]} for k, v in profile.TEMPLATES.items()],
        "platforms": [r["platform"] for r in db.rows("SELECT platform, COUNT(*) n FROM jobs GROUP BY platform ORDER BY n DESC")],
        "countries": [r["country"] for r in db.rows("SELECT country, COUNT(*) n FROM jobs GROUP BY country ORDER BY n DESC")],
        "regions": [r["region"] for r in db.rows("SELECT region, COUNT(*) n FROM jobs GROUP BY region ORDER BY n DESC")],
        "statuses": ["new", "saved", "resume ready", "applied", "interview", "offer", "rejected"],
        "settings": {k: s[k] for k in ("days", "ats_target", "schedule_time", "schedule_enabled", "output_dir")},
        "llm": {"provider": s["llm"].get("provider"), "model": s["llm"].get("model")},
        "truth_skills": sorted(profile.truth_skills()),
    })


@app.get("/api/stats")
def stats():
    days = request.args.get("days", db.settings()["days"])
    since = utc_since(days)
    w = "hidden=0 AND posted>=? AND COALESCE(elig,'maybe')!='blocked'"
    total = db.one(f"SELECT COUNT(*) n, AVG(match) avg, SUM(match>=80) hot, SUM(work_mode='Remote') remote FROM jobs WHERE {w}", (since,))
    today = db.one("SELECT COUNT(*) n FROM jobs WHERE first_seen>=?", (utc_since(1),))
    by = lambda col: db.rows(f"SELECT {col} k, COUNT(*) n, ROUND(AVG(match),1) m FROM jobs WHERE {w} GROUP BY {col} ORDER BY n DESC", (since,))
    dom = {}
    for r in db.rows(f"SELECT domains, match FROM jobs WHERE {w}", (since,)):
        for d in (r["domains"] or "").split(","):
            if d:
                x = dom.setdefault(d, [0, 0]); x[0] += 1; x[1] += r["match"] or 0
    trend = db.rows("SELECT substr(posted,1,10) d, COUNT(*) n FROM jobs WHERE posted>=? AND COALESCE(elig,'maybe')!='blocked' GROUP BY d ORDER BY d", (utc_since(21),))
    blocked = db.one("SELECT COUNT(*) n FROM jobs WHERE hidden=0 AND posted>=? AND elig='blocked'", (since,))["n"]
    pipeline = db.rows("SELECT status k, COUNT(*) n FROM jobs WHERE status!='new' GROUP BY status")
    top = db.rows(f"SELECT id,title,company,platform,country,work_mode,match,best_template,posted,url,elig,elig_reason FROM jobs WHERE {w} AND seniority IN ('Mid','Junior') ORDER BY match DESC LIMIT 12", (since,))
    runs = db.rows("SELECT id, source, started, finished, n_found, n_new, platforms FROM runs ORDER BY id DESC LIMIT 6")
    res = db.rows("SELECT id, name, score, base_score, created FROM resumes ORDER BY id DESC LIMIT 6")
    return jsonify({"total": total, "new_24h": today["n"], "blocked": blocked, "by_platform": by("platform"), "by_country": by("country"),
                    "by_region": by("region"), "by_mode": by("work_mode"), "by_seniority": by("seniority"),
                    "by_domain": sorted([{"k": k, "n": v[0], "m": round(v[1] / v[0], 1)} for k, v in dom.items()], key=lambda x: -x["n"]),
                    "trend": trend, "pipeline": pipeline, "top": top, "runs": runs, "resumes": res,
                    "scrape": {k: scraper.STATE[k] for k in ("running", "started", "finished")}})


# ------------------------------------------------------------------ jobs
SORTS = {"newest": "posted DESC", "oldest": "posted ASC", "match": "match DESC", "company": "company COLLATE NOCASE ASC",
         "title": "title COLLATE NOCASE ASC", "platform": "platform ASC, posted DESC", "country": "country ASC, match DESC",
         "applicants": "CAST(applicants AS INTEGER) ASC", "seen": "first_seen DESC"}


def job_filter(a):
    where, args = ["1=1"], []
    if a.get("hidden") != "1":
        where.append("hidden=0")
    # The discovery list is for jobs still worth acting on. Applied jobs live in
    # Pipeline → applied, but explicit status queries (Pipeline/API) may retrieve them.
    if not a.get("status") and a.get("include_applied") != "1":
        where.append("COALESCE(status,'new')!='applied'")
    if a.get("days"):
        where.append("posted>=?"); args.append(utc_since(a["days"]))
    if a.get("q"):
        for tok in a["q"].split():
            where.append("(title LIKE ? OR company LIKE ? OR description LIKE ? OR location LIKE ?)"); args += [f"%{tok}%"] * 4
    for key, col in (("platform", "platform"), ("country", "country"), ("region", "region"), ("mode", "work_mode"),
                     ("seniority", "seniority"), ("status", "status"), ("template", "best_template")):
        v = a.get(key)
        if v:
            vals = v.split("|")
            remote = key == "country" and "Remote" in vals          # "Remote" acts as a pseudo-country
            vals = [x for x in vals if not (remote and x == "Remote")]
            conds = []
            if vals:
                conds.append(f"COALESCE({col},'Unknown') IN ({','.join('?' * len(vals))})"); args += vals
            if remote:
                conds.append("work_mode='Remote'")
            where.append("(" + " OR ".join(conds) + ")")
    if a.get("domain"):
        ds = a["domain"].split("|")
        where.append("(" + " OR ".join(["(','||domains||',') LIKE ?"] * len(ds)) + ")"); args += [f"%,{d},%" for d in ds]
    if a.get("min_match"):
        where.append("match>=?"); args.append(float(a["min_match"]))
    if a.get("starred") == "1":
        where.append("starred=1")
    ev = a.get("elig") or db.settings().get("eligibility_view", "ok")
    if ev == "eligible":
        where.append("elig='eligible'")
    elif ev == "ok":
        where.append("COALESCE(elig,'maybe')!='blocked'")
    elif ev == "blocked":
        where.append("elig='blocked'")
    if a.get("english") == "1":
        where.append("(lang IS NULL OR lang='English')")
    if a.get("with_jd") == "1":
        where.append("jd_quality='full'")
    return " AND ".join(where), args


@app.get("/api/jobs")
def jobs():
    a = request.args
    w, args = job_filter(a)
    order = SORTS.get(a.get("sort", "newest"), "posted DESC")
    per, page = min(int(a.get("per", 50)), 500), int(a.get("page", 1))
    cols = "id,lang,elig,elig_reason,platform,title,company,location,country,region,work_mode,posted,first_seen,url,salary,seniority,applicants,years_req,domains,match,match_auto,match_ml,best_template,status,applied_at,application_stage,stage_updated_at,stage_source,stage_confidence,starred,hidden,jd_quality,fp"
    allr = db.rows(f"SELECT {cols} FROM jobs WHERE {w} ORDER BY {order}", args)
    if a.get("dedupe", "1") == "1":
        seen, out = {}, []
        for r in allr:
            if r["fp"] in seen:
                seen[r["fp"]]["also_on"].append({"platform": r["platform"], "url": r["url"], "id": r["id"]})
                continue
            r["also_on"] = []
            seen[r["fp"]] = r
            out.append(r)
        allr = out
    total = len(allr)
    # facets: each one is counted with every filter EXCEPT its own, so picking a country doesn't hide the others
    facets = {}
    for f, key in (("platform", "platform"), ("country", "country"), ("work_mode", "mode"), ("seniority", "seniority"), ("region", "region"), ("domains", "domain")):
        sub = {k: v for k, v in a.items() if k != key}
        w2, args2 = job_filter(sub)
        c = {}
        for r in db.rows(f"SELECT {f}, work_mode FROM jobs WHERE {w2}", args2):
            if f == "domains":
                for d in (r["domains"] or "").split(","):
                    if d:
                        c[d] = c.get(d, 0) + 1
                continue
            c[r[f] or "Unknown"] = c.get(r[f] or "Unknown", 0) + 1
            if f == "country" and r["work_mode"] == "Remote":
                c["Remote"] = c.get("Remote", 0) + 1
        items = sorted(c.items(), key=lambda x: -x[1])
        if f == "country":   # Pakistan and Remote first
            items = [i for i in items if i[0] == "Pakistan"] + [i for i in items if i[0] == "Remote"] + [i for i in items if i[0] not in ("Pakistan", "Remote")]
        facets["domain" if f == "domains" else f] = items
    return jsonify({"total": total, "page": page, "per": per, "items": allr[(page - 1) * per: page * per], "facets": facets})


@app.get("/api/jobs/<int:jid>")
def job(jid):
    j = db.one("SELECT * FROM jobs WHERE id=?", (jid,))
    if not j:
        return jsonify({"error": "not found"}), 404
    res, best = profile.match_job(j["title"], j["description"])
    j["match_detail"] = res
    j["truth_skills"] = sorted(profile.truth_skills())
    j["resumes"] = db.rows("SELECT id, name, score, base_score, template, created FROM resumes WHERE job_id=? ORDER BY id DESC", (jid,))
    j["events"] = db.rows("SELECT * FROM events WHERE job_id=? ORDER BY id DESC", (jid,))
    j["also_on"] = db.rows("SELECT id, platform, url FROM jobs WHERE fp=? AND id!=?", (j["fp"], jid))
    return jsonify(j)


@app.patch("/api/jobs/<int:jid>")
def job_patch(jid):
    d = request.json or {}
    sets, args = [], []
    for k in ("status", "starred", "hidden", "notes"):
        if k in d:
            sets.append(f"{k}=?"); args.append(d[k])
    if d.get("status") == "applied":
        sets.append("applied_at=?"); args.append(datetime.now().isoformat(timespec="seconds"))
    if sets:
        db.exe(f"UPDATE jobs SET {','.join(sets)}, updated_at=? WHERE id=?", (*args, datetime.now().isoformat(timespec="seconds"), jid))
        if "status" in d:
            db.exe("INSERT INTO events (job_id, ts, kind, detail) VALUES (?,?,?,?)", (jid, datetime.now().isoformat(timespec="seconds"), "status", d["status"]))
    return jsonify({"ok": True})


@app.post("/api/jobs/bulk")
def job_bulk():
    d = request.json or {}
    for jid in d.get("ids", []):
        for k in ("status", "starred", "hidden"):
            if k in d:
                db.exe(f"UPDATE jobs SET {k}=? WHERE id=?", (d[k], jid))
    return jsonify({"ok": True})


@app.post("/api/jobs/manual")
def job_manual():
    d = request.json or {}
    j = {"platform": "Manual", "ext_id": str(uuid.uuid4())[:8], "title": d.get("title", "").strip(), "company": d.get("company", ""),
         "location": d.get("location", ""), "url": d.get("url") or "about:blank", "description": d.get("description", ""),
         "posted": datetime.now(timezone.utc).isoformat(), "remote": "remote" in (d.get("location", "") or "").lower()}
    ingest.ingest_result({"jobs": [j], "platforms": ["manual"]}, "manual")
    r = db.one("SELECT id FROM jobs WHERE ext_id=?", (j["ext_id"],))
    return jsonify({"id": r["id"] if r else None})


@app.post("/api/jobs/<int:jid>/fetch_jd")
def fetch_jd(jid):
    j = db.one("SELECT * FROM jobs WHERE id=?", (jid,))
    text = (request.json or {}).get("text") or scraper.fetch_jd(j["url"])
    if len(text or "") > len(j["description"] or ""):
        e = ingest.enrich({**j, "description": text, "remote": j["work_mode"] == "Remote"})
        db.exe("UPDATE jobs SET description=?, jd_quality=?, match_auto=?, match_ml=?, match=?, best_template=?, missing=?, domains=?, seniority=?, years_req=?, lang=?, elig=?, elig_reason=? WHERE id=?",
               (text, e["jd_quality"], e["match_auto"], e["match_ml"], e["match"], e["best_template"], e["missing"], e["domains"], e["seniority"], e["years_req"], e["lang"], e["elig"], e["elig_reason"], jid))
        return jsonify({"ok": True, "chars": len(text)})
    return jsonify({"ok": False, "chars": len(text or ""), "msg": "Could not get a longer description; paste it manually."})


# ------------------------------------------------------------------ resume generation
@app.post("/api/jobs/<int:jid>/generate")
def generate(jid):
    j = db.one("SELECT * FROM jobs WHERE id=?", (jid,))
    d = request.json or {}
    tid = uuid.uuid4().hex[:10]
    TASKS[tid] = {"status": "running", "log": [], "resume_id": None}

    def prog(m):
        TASKS[tid]["log"].append(m)

    def work():
        try:
            if j["jd_quality"] != "full" and d.get("fetch_jd", True) and j["platform"] not in ("Manual",):
                prog("Fetching the full job description…")
                try:
                    text = scraper.fetch_jd(j["url"])
                    if len(text) > len(j["description"] or ""):
                        j["description"] = text
                        db.exe("UPDATE jobs SET description=?, jd_quality='full' WHERE id=?", (text, jid))
                        prog(f"Got {len(text)} chars of JD.")
                except Exception as e:
                    prog(f"JD fetch failed ({e}); using the snippet.")
            cfg = dict(db.settings()["llm"])
            if d.get("provider"):
                cfg["provider"] = d["provider"]
            rid = tailor.generate(j, d.get("template") or j["best_template"], cfg, prog)
            TASKS[tid].update(status="done", resume_id=rid)
        except Exception as e:
            import traceback; traceback.print_exc()
            TASKS[tid].update(status="error", error=str(e))
            prog(f"ERROR: {e}")

    threading.Thread(target=work, daemon=True).start()
    return jsonify({"task": tid})


@app.get("/api/tasks/<tid>")
def task(tid):
    return jsonify(TASKS.get(tid) or {"status": "unknown"})


@app.get("/api/resumes")
def resumes():
    return jsonify(db.rows("""SELECT r.id, r.name, r.template, r.provider, r.score, r.base_score, r.created, r.updated, r.job_id,
                              j.title, j.company, j.status, j.url FROM resumes r LEFT JOIN jobs j ON j.id=r.job_id ORDER BY r.id DESC"""))


@app.get("/api/resumes/<int:rid>")
def resume(rid):
    r = db.one("SELECT * FROM resumes WHERE id=?", (rid,))
    if not r:
        return jsonify({"error": "Resume not found"}), 404
    r["content"] = json.loads(r.pop("content_json"))
    r["ats"] = json.loads(r.pop("ats_json") or "{}")
    r["warnings"] = json.loads(r["warnings"] or "[]")
    r["job"] = db.one("SELECT id,title,company,url,description,platform FROM jobs WHERE id=?", (r["job_id"],)) if r["job_id"] else None
    return jsonify(r)


@app.put("/api/resumes/<int:rid>")
def resume_save(rid):
    sc = tailor.rebuild(rid, (request.json or {})["content"])
    return jsonify({"ok": True, "ats": sc})


@app.delete("/api/resumes/<int:rid>")
def resume_del(rid):
    r = db.one("SELECT * FROM resumes WHERE id=?", (rid,))
    for p in (r["pdf_path"], r["docx_path"]):
        try:
            os.remove(p)
        except OSError:
            pass
    db.exe("DELETE FROM resumes WHERE id=?", (rid,))
    return jsonify({"ok": True})


@app.get("/files/resume/<int:rid>.<ext>")
def resume_file(rid, ext):
    r = db.one("SELECT * FROM resumes WHERE id=?", (rid,))
    p = r["pdf_path"] if ext == "pdf" else r["docx_path"]
    return send_file(p, as_attachment=request.args.get("dl") == "1", download_name=os.path.basename(p), max_age=0)


@app.get("/files/base/<t>.pdf")
def base_pdf(t):
    p = os.path.join(db.DATA, f"base_{t}.pdf")
    if not os.path.exists(p) or os.path.getmtime(p) < os.path.getmtime(profile.tpl_path(t)):   # template updated → rebuild
        dx = os.path.join(db.DATA, f"base_{t}.docx")
        render.build(profile.tpl_path(t), profile.base_content(t), dx)
        render.to_pdf(dx, p)
    return send_file(p, max_age=0)


# ------------------------------------------------------------------ ATS lab
@app.post("/api/ats")
def ats_check():
    d = request.json or {}
    jd, title = d.get("jd", ""), d.get("title", "")
    if d.get("resume_id"):
        r = db.one("SELECT pdf_path FROM resumes WHERE id=?", (d["resume_id"],))
        res = ats.score(r["pdf_path"], jd, title)
    else:
        t = d.get("template", "auto")
        res = ats.score_text(profile.base_text(t), jd, title, pages=2 if t == "ml" else 3)
    res["jd_skills"] = sorted(ats.jd_skills(jd))
    res["truth_skills"] = sorted(profile.truth_skills())
    return jsonify(res)


# ------------------------------------------------------------------ scraping
@app.post("/api/scrape")
def scrape():
    d = request.json or {}
    ok = scraper.run(d.get("platforms") or None)
    return jsonify({"started": ok})


@app.get("/api/scrape/status")
def scrape_status():
    since = int(request.args.get("since", 0))
    st = dict(scraper.STATE)
    st["log"] = scraper.STATE["log"][since:]
    st["offset"] = len(scraper.STATE["log"])
    return jsonify(st)


@app.post("/api/import")
def do_import():
    return jsonify(ingest.import_inboxes())


@app.get("/api/runs")
def runs():
    return jsonify(db.rows("SELECT id, source, started, finished, status, platforms, n_found, n_new, stats FROM runs ORDER BY id DESC LIMIT 50"))


@app.get("/api/runs/<int:rid>")
def run_log(rid):
    return jsonify(db.one("SELECT * FROM runs WHERE id=?", (rid,)))


# ------------------------------------------------------------------ settings / export / misc
@app.get("/api/settings")
def get_settings():
    s = db.settings()
    s = json.loads(json.dumps(s))
    if s["llm"].get("api_key"):
        s["llm"]["api_key_set"] = True
        s["llm"]["api_key"] = "••••" + s["llm"]["api_key"][-4:]
    return jsonify(s)


@app.put("/api/settings")
def put_settings():
    d = request.json or {}
    cur = db.settings()
    if "llm" in d and str(d["llm"].get("api_key", "")).startswith("••••"):
        d["llm"]["api_key"] = cur["llm"].get("api_key", "")
    s = db.save_settings(d)
    scraper.write_mcp_copies()
    if "extra_skills" in d:
        threading.Thread(target=ingest.rescore_all, daemon=True).start()
    elif "relocation" in d:
        threading.Thread(target=ingest.recompute_eligibility, daemon=True).start()
    return jsonify({"ok": True})


@app.post("/api/llm/test")
def llm_test():
    try:
        out = tailor.llm_call("Reply with JSON only.", 'Return {"ok": true, "model": "<your model name>"}', (request.json or {}).get("llm"), 200)
        return jsonify({"ok": True, "reply": out[:300]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:400]})


@app.get("/api/export.csv")
def export_csv():
    w, args = job_filter(request.args)
    rs = db.rows(f"SELECT * FROM jobs WHERE {w} ORDER BY {SORTS.get(request.args.get('sort','newest'))}", args)
    buf = io.StringIO()
    wr = csv.DictWriter(buf, fieldnames=ingest.CSV_COLS, extrasaction="ignore")
    wr.writeheader()
    for r in rs:
        wr.writerow(r)
    return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=jobs_{datetime.now():%Y-%m-%d}.csv"})


@app.post("/api/export_all")
def export_all():
    return jsonify({"folder": ingest.export_csvs()})


@app.post("/api/open")
def open_path():
    d = request.json or {}
    p = d.get("path") or db.settings()["output_dir"]
    if d.get("resume_id"):
        p = db.one("SELECT pdf_path FROM resumes WHERE id=?", (d["resume_id"],))["pdf_path"]
    try:
        if os.name == "nt":
            if d.get("reveal"):
                import subprocess
                subprocess.Popen(["explorer", "/select,", p])
            else:
                os.startfile(p)  # noqa
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.post("/api/rescore")
def rescore():
    threading.Thread(target=ingest.rescore_all, daemon=True).start()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ apply assistant
@app.get("/api/profile")
def get_profile():
    return jsonify({"schema": applyprofile.schema(), "values": applyprofile.load(), "completeness": applyprofile.completeness()})


@app.put("/api/profile")
def put_profile():
    applyprofile.save(request.json or {})
    return jsonify({"ok": True, "completeness": applyprofile.completeness()})


@app.get("/api/qa")
def get_qa():
    return jsonify(applyprofile.qa_load())


@app.post("/api/qa")
def add_qa():
    d = request.json or {}
    applyprofile.qa_add(d["q"], d["a"])
    return jsonify({"ok": True})


@app.delete("/api/qa")
def del_qa():
    applyprofile.qa_delete((request.json or {}).get("q_norm"))
    return jsonify({"ok": True})


@app.post("/api/apply/start")
def apply_start():
    d = request.json or {}
    if d.get("ids"):
        return jsonify({"ok": True, "queue": applier.enqueue([int(i) for i in d["ids"]])})
    return jsonify(applier.start(int(d["job_id"]), d.get("resume_id")))


# ------------------------------------------------------------------ JobHunter Apply Helper (extension in your own browser)
def _ext_ok():
    # custom header => browsers force a CORS preflight, which we never answer, so web pages can't call these
    return request.headers.get("X-JH") == "1"


@app.get("/api/ext/poll")
def ext_poll():
    if not _ext_ok():
        return jsonify({"error": "forbidden"}), 403
    op = exthub.poll(request.args.get("v"), request.args.get("b"))
    return jsonify({"op": op})


@app.post("/api/ext/result")
def ext_result():
    if not _ext_ok():
        return jsonify({"error": "forbidden"}), 403
    d = request.get_json(force=True) or {}
    exthub.result(d.get("id"), d)
    return jsonify({"ok": True})


@app.post("/api/ext/call")
def ext_call():
    if not _ext_ok():
        return jsonify({"error": "forbidden"}), 403
    d = request.get_json(force=True) or {}
    return jsonify(exthub.call(d, timeout=float(d.get("timeout") or 90)))


@app.get("/api/ext/file/<which>")
def ext_file(which):
    if not _ext_ok():
        return jsonify({"error": "forbidden"}), 403
    name = {"resume": "Candidate_Resume.pdf", "cover": "Candidate_Cover_Letter.pdf"}.get(which)
    path = os.path.join(db.DATA, "apply", name or "x")
    if not name or not os.path.exists(path):
        return jsonify({"error": "missing"}), 404
    return send_file(path, mimetype="application/pdf", download_name=name)


@app.get("/api/ext/status")
def ext_status():
    return jsonify({"connected": exthub.connected(), "version": exthub.STATE["version"], "browser": exthub.STATE["browser"],
                    "folder": os.path.join(db.ROOT, "extension")})


@app.post("/api/browser/open")
def browser_open():
    from jh import browser
    url = (request.json or {}).get("url")
    if url and not str(url).lower().startswith(("http://", "https://")):
        return jsonify({"ok": False, "error": "bad url"})
    ok, msg = browser.ensure(url)
    return jsonify({"ok": ok, "status": msg, "error": None if ok else msg})


@app.post("/api/apply/cmd")
def apply_cmd():
    return jsonify({"ok": applier.send(request.json or {})})


@app.get("/api/apply/status")
def apply_status():
    return jsonify(applier.status())


@app.post("/api/apply/queue/clear")
def apply_queue_clear():
    applier.STATE["queue"].clear()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ Gmail status sync (read-only, deterministic rules; no AI)
@app.get("/api/gmail/status")
def gmail_status():
    return jsonify(gmail_sync.status())


@app.post("/api/gmail/client")
def gmail_client():
    try:
        gmail_sync.save_client((request.json or {}).get("credentials") or {})
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.get("/api/gmail/connect")
def gmail_connect():
    try:
        return redirect(gmail_sync.authorization_url())
    except Exception as e:
        return Response(f"<h3>Could not connect Gmail</h3><p>{html.escape(str(e))}</p>", 400, mimetype="text/html")


@app.get("/api/gmail/callback")
def gmail_callback():
    if request.args.get("error"):
        return redirect("/#/pipeline?gmail=denied")
    try:
        gmail_sync.complete_oauth(request.args.get("code"), request.args.get("state"))
        gmail_sync.start_sync()
        return redirect("/#/pipeline?gmail=connected")
    except Exception as e:
        return Response(f"<h3>Gmail connection failed</h3><p>{html.escape(str(e))}</p><p><a href='/#/pipeline'>Back to Pipeline</a></p>", 400, mimetype="text/html")


@app.post("/api/gmail/sync")
def gmail_sync_now():
    if not gmail_sync.status()["connected"]:
        return jsonify({"ok": False, "error": "Gmail is not connected"}), 400
    return jsonify({"ok": gmail_sync.start_sync(), "status": gmail_sync.status()})


@app.post("/api/skills_bank")
def skills_bank_add():
    """'I have this skill' — add to the truth bank so tailoring may use it."""
    sk = ((request.json or {}).get("skill") or "").strip()
    s = db.settings()
    bank = list(s.get("extra_skills") or [])
    if sk and sk.lower() not in [b.lower() for b in bank]:
        bank.append(sk)
        db.save_settings({"extra_skills": bank})
        threading.Thread(target=ingest.rescore_all, daemon=True).start()
    return jsonify({"ok": True, "extra_skills": bank})


def main():
    os.makedirs(db.DATA, exist_ok=True)
    if sys.stdout is None or sys.stderr is None:      # started with pythonw (no console)
        log = open(os.path.join(db.DATA, "app.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
    import socket
    port = int(os.environ.get("JH_PORT", 8765))
    with socket.socket() as so:
        if so.connect_ex(("127.0.0.1", port)) == 0:
            print("JobHunter is already running.")
            if "--no-browser" not in sys.argv:
                webbrowser.open(f"http://localhost:{port}")
            return
    with db.cx():
        pass
    scraper.write_mcp_copies()
    try:
        ingest.recompute_eligibility(only_missing=True)
        ingest.hide_excluded()
    except Exception as e:
        print("eligibility:", e)
    try:
        ingest.import_inboxes()
    except Exception as e:
        print("import:", e)
    threading.Thread(target=scraper.scheduler_loop, daemon=True).start()
    threading.Thread(target=gmail_sync.scheduler_loop, daemon=True).start()
    if "--no-browser" not in sys.argv:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{port}")).start()
    print(f"JobHunter running on http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
