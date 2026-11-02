"""Apply-assistant session manager: spawns scraper/apply.mjs (visible Chrome), relays its events to the UI,
forwards your commands, learns answers, runs a queue of jobs one after another."""
import json, os, shutil, subprocess, threading, time
from datetime import datetime
import docx
from . import db, applyprofile, render, scraper, tailor, browser, exthub

APPLY_DIR = os.path.join(db.DATA, "apply")
QUEUE_PATH = os.path.join(db.DATA, "apply_queue.json")


def _load_queue():
    try:
        with open(QUEUE_PATH, encoding="utf-8") as f:
            return [int(x) for x in json.load(f)]
    except Exception:
        return []


STATE = {"session": None, "queue": _load_queue(), "history": []}
_lock = threading.RLock()


class _ApplyCancelled(Exception):
    def __init__(self, action):
        self.action = action


def _check_cancel(sess):
    if sess.get("_cancel") in ("stop", "skip"):
        raise _ApplyCancelled(sess["_cancel"])


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _save_queue():
    os.makedirs(db.DATA, exist_ok=True)
    tmp = QUEUE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(STATE["queue"], f)
    os.replace(tmp, QUEUE_PATH)


def cover_letter_pdf(job, prof):
    text = (prof.get("cover_letter") or "").replace("{company}", job.get("company") or "your company") \
        .replace("{role}", job.get("title") or "this role").replace("{date}", datetime.now().strftime("%d %B %Y"))
    if not text.strip():
        return None
    d = docx.Document()
    for para in text.split("\n"):
        p = d.add_paragraph(para)
        for r in p.runs:
            r.font.name = "Arial"
    path = os.path.join(APPLY_DIR, "Candidate_Cover_Letter.docx")
    d.save(path)
    try:
        return render.to_pdf(path)
    except Exception:
        return None


def pick_resume(job, progress):
    r = db.one("SELECT * FROM resumes WHERE job_id=? ORDER BY id DESC LIMIT 1", (job["id"],))
    if r and os.path.exists(r["pdf_path"]):
        return r["pdf_path"], r["id"]
    progress("No resume for this job yet — generating the keyword-optimised one…")
    cfg = {"provider": db.settings().get("apply_writer", "none")}
    rid = tailor.generate(job, job.get("best_template"), cfg, progress)
    r = db.one("SELECT * FROM resumes WHERE id=?", (rid,))
    return r["pdf_path"], rid


def _event(sess, ev):
    t = ev.get("type")
    with _lock:
        sess["events"].append(ev)
        sess["events"] = sess["events"][-400:]
        if t == "needs_input":
            sess.update(status="needs_input", need=ev, need_since=_now())
        elif t == "resumed":
            sess.update(status="running", need=None)
        elif t == "stop_requested":
            sess.update(status="stopping", need=None)
        elif t == "skip_requested":
            sess.update(status="skipping", need=None)
        elif t == "done":
            sess.pop("_cancel", None)
            already_done = sess.get("status") == "done"
            sess.update(status="done", need=None, completion=ev)
            if not already_done:
                now = _now()
                via = ev.get("via") or "apply assistant"
                db.exe("UPDATE jobs SET status='applied', applied_at=?, updated_at=? WHERE id=?", (now, now, sess["job"]["id"]))
                db.exe("INSERT INTO events (job_id, ts, kind, detail) VALUES (?,?,?,?)", (sess["job"]["id"], now, "applied", f"via {via}"))
        elif t in ("skipped", "stopped", "gave_up", "error"):
            sess.update(status=t, need=None)
        elif t == "finished":
            _finish(sess)


def _finish(sess):
    """Finalize once even when the worker is killed before it can emit `finished`."""
    with _lock:
        if sess.get("_finish_scheduled"):
            return
        sess["_finish_scheduled"] = True
        sess["finished"] = sess.get("finished") or _now()
        if sess["status"] in ("running", "starting"):
            sess["status"] = "ended"
        delay = 4 if sess["status"] == "done" else 1 if sess["status"] == "skipped" else 0.1
    threading.Timer(delay, _after_finish, args=(sess,)).start()


def _after_finish(sess):
    with _lock:
        STATE["history"].insert(0, {k: sess[k] for k in ("id", "job", "status", "started", "finished")})
        STATE["history"] = STATE["history"][:50]
    if sess["status"] in ("done", "skipped") and STATE["queue"]:
        close_current(sess)                # close this window, open the next job
        start_next()


def _reader(sess, proc):
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            _event(sess, json.loads(line))
        except Exception:
            _event(sess, {"type": "log", "msg": line[:300], "t": int(time.time() * 1000)})
    proc.wait()
    with _lock:
        sess["alive"] = False
        if sess["status"] == "skipping":
            sess["status"] = "skipped"
        elif sess["status"] == "stopping":
            sess["status"] = "stopped"
        elif sess["status"] in ("running", "starting", "needs_input"):
            sess["status"] = "ended"
    _finish(sess)


def start(job_id, resume_id=None):
    with _lock:
        cur = STATE["session"]
        if cur and cur.get("alive"):
            if cur["status"] in ("done", "skipped", "stopped", "error", "ended", "gave_up"):
                close_current(cur)          # finished session whose window is still open: close it
            else:
                return {"ok": False, "error": "An application is already open. Finish, skip or stop it first."}
    job = db.one("SELECT * FROM jobs WHERE id=?", (job_id,))
    if not job:
        return {"ok": False, "error": "job not found"}
    mode = db.settings().get("apply_browser", "auto")
    if mode in ("auto", "mine") and not exthub.connected():
        return {"ok": False, "error": "JobHunter Apply Helper is not connected. Open Apply assistant and complete the one-time browser-extension setup."}
    os.makedirs(APPLY_DIR, exist_ok=True)
    sess = {"id": f"s{int(time.time())}", "job": {k: job[k] for k in ("id", "title", "company", "url", "country", "platform", "work_mode", "salary")},
            "status": "starting", "events": [], "need": None, "started": _now(), "alive": True, "resume_id": resume_id}
    with _lock:
        STATE["session"] = sess

    def boot():
        try:
            def prog(m):
                _check_cancel(sess)
                _event(sess, {"type": "log", "msg": m, "t": int(time.time() * 1000)})
            _check_cancel(sess)
            if resume_id:
                r = db.one("SELECT * FROM resumes WHERE id=?", (resume_id,))
                pdf, rid = r["pdf_path"], r["id"]
            else:
                pdf, rid = pick_resume(job, prog)
            _check_cancel(sess)
            sess["resume_id"] = rid
            up = os.path.join(APPLY_DIR, "Candidate_Resume.pdf")
            shutil.copyfile(pdf, up)
            prof = applyprofile.load()
            cover = cover_letter_pdf(job, prof) if str(prof.get("upload_cover_letter", "Yes")).startswith("Yes") else None
            _check_cancel(sess)
            cdp, ext = None, None
            mode = db.settings().get("apply_browser", "auto")
            if mode in ("auto", "mine"):
                if not exthub.connected():
                    raise RuntimeError("JobHunter Apply Helper disconnected before the application tab opened. Reconnect it and try again.")
                ext = "http://127.0.0.1:8765/api/ext/call"
                exthub.flush()
                prog("Using your own browser (JobHunter Apply Helper) — new tab in your current window, your logins.")
            if not ext and mode == "shared":
                ok, msg = browser.ensure()
                if ok:
                    cdp = browser.endpoint()
                    prog("Using your JobHunter Chrome window (new tab, your logins).")
                else:
                    prog(f"Shared Chrome unavailable ({msg}) — opening a separate window instead.")
            cfg = {"ext": ext, "cdp": cdp, "job": sess["job"], "profile": prof, "qa": applyprofile.qa_load(), "resume": up, "cover_pdf": cover,
                   "browser_channel": db.settings().get("browser_channel", "chrome")}
            sess["uses_extension"] = bool(ext)
            path = os.path.join(APPLY_DIR, "session.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False)
            _check_cancel(sess)
            prog(f"Opening {job['url']} in a visible browser window…")
            proc = subprocess.Popen([scraper._node(), os.path.join(scraper.SCRAPER_DIR, "apply.mjs"), path], cwd=scraper.SCRAPER_DIR,
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    encoding="utf-8", errors="replace", bufsize=1,
                                    # Windows: node launched from pythonw (no console) dies with "Assertion failed: process_title"
                                    # unless it gets its own hidden console
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            sess["proc"] = proc
            sess["status"] = "running"
            threading.Thread(target=_reader, args=(sess, proc), daemon=True).start()
        except _ApplyCancelled as e:
            if not sess.get("_finish_scheduled"):
                final_status = "stopped" if e.action == "stop" else "skipped"
                _event(sess, {"type": final_status, "message": f"Apply flow {final_status} during startup.",
                               "t": int(time.time() * 1000)})
            sess["alive"] = False
            _finish(sess)
        except Exception as e:
            _event(sess, {"type": "error", "message": str(e), "t": int(time.time() * 1000)})
            sess["alive"] = False

    threading.Thread(target=boot, daemon=True).start()
    return {"ok": True, "session": sess["id"]}


def send(cmd):
    s = STATE["session"]
    if not s:
        return False
    action = cmd.get("cmd")
    if action in ("stop", "skip"):
        if s.get("status") in ("done", "skipped", "stopped", "error", "ended", "gave_up"):
            return False
        s["_cancel"] = action
        requested = "stop_requested" if action == "stop" else "skip_requested"
        message = "Stop requested — shutting down the apply flow…" if action == "stop" else "Skip requested — ending this job and moving to the next…"
        _event(s, {"type": requested, "message": message, "t": int(time.time() * 1000)})
        proc = s.get("proc")
        if proc and proc.poll() is None:
            try:
                proc.stdin.write(json.dumps(cmd) + "\n")
                proc.stdin.flush()
            except Exception:
                pass

        def cancel_watchdog():
            time.sleep(4)
            if s.get("_finish_scheduled"):
                return
            final_status = "stopped" if action == "stop" else "skipped"
            worker = s.get("proc")
            if worker and worker.poll() is None and s.get("_cancel") == action:
                _kill_tree(worker)
                if s.get("uses_extension") and exthub.connected():
                    try:
                        exthub.call({"op": "close"}, timeout=12)
                    except Exception:
                        pass
            if s.get("_cancel") == action:
                _event(s, {"type": final_status, "message": f"Apply flow {final_status} by you.",
                           "t": int(time.time() * 1000)})
                s["alive"] = False
            if s.get("status") in ("stopped", "skipped") or (worker and worker.poll() is not None):
                _finish(s)

        threading.Thread(target=cancel_watchdog, daemon=True).start()
        return True
    if not s.get("proc") or s["proc"].poll() is not None:
        return False
    if cmd.get("cmd") == "answers":       # remember answers for next time
        qs = {q["fid"]: q for q in ((s.get("need") or {}).get("questions") or [])}
        for fid, val in (cmd.get("answers") or {}).items():
            if fid in qs and str(val).strip() and cmd.get("remember", True):
                applyprofile.qa_add(qs[fid]["label"], val, qs[fid].get("type", "text"))
    try:
        s["proc"].stdin.write(json.dumps(cmd) + "\n")
        s["proc"].stdin.flush()
        return True
    except Exception:
        return False


def close_current(sess=None):
    sess = sess or STATE["session"]
    pr = sess and sess.get("proc")
    if pr and pr.poll() is None:
        try:
            pr.stdin.write(json.dumps({"cmd": "stop"}) + "\n"); pr.stdin.flush()
            pr.wait(timeout=6)
        except Exception:
            _kill_tree(pr)
    if sess:
        sess["alive"] = False


def _kill_tree(proc):
    """Terminate only this apply worker and any browser processes it launched."""
    if not proc or proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        else:
            proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def start_next():
    with _lock:
        if not STATE["queue"]:
            return None
        jid = STATE["queue"].pop(0)
        _save_queue()
    return start(jid)


def enqueue(ids):
    ids = [int(i) for i in ids]
    if ids:
        marks = ",".join("?" * len(ids))
        allowed = {r["id"] for r in db.rows(f"SELECT id FROM jobs WHERE id IN ({marks}) AND COALESCE(status,'new')!='applied'", ids)}
        ids = [i for i in ids if i in allowed]
    with _lock:
        current_id = ((STATE.get("session") or {}).get("job") or {}).get("id")
        for i in ids:
            if i != current_id and i not in STATE["queue"]:
                STATE["queue"].append(i)
        _save_queue()
        busy = STATE["session"] and STATE["session"].get("alive")
    if not busy:
        start_next()
    return list(STATE["queue"])


def clear_queue():
    with _lock:
        STATE["queue"].clear()
        _save_queue()


def status():
    s = STATE["session"]
    out = {"queue": [db.one("SELECT id,title,company FROM jobs WHERE id=?", (i,)) for i in STATE["queue"]], "history": STATE["history"][:15]}
    if s:
        out["session"] = {k: v for k, v in s.items() if k != "proc" and not k.startswith("_")}
    return out
