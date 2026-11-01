"""Read-only Gmail application-status sync using deterministic rules (no AI calls)."""
import base64, html, json, os, re, secrets, threading, time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime, parseaddr
from urllib.parse import urlencode

import requests

from . import db

CLIENT_PATH = os.path.join(db.DATA, "gmail_oauth_client.json")
TOKEN_PATH = os.path.join(db.DATA, "gmail_oauth_token.json")
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
REDIRECT_URI = "http://127.0.0.1:8765/api/gmail/callback"
STATE = {"running": False, "last_sync": None, "last_error": None, "last_result": None, "oauth_state": None}
_lock = threading.RLock()

STAGE_RULES = [
    ("accepted", [r"offer acceptance (?:is )?confirmed", r"welcome (?:aboard|to (?:our|the) team)", r"excited to welcome you"]),
    ("offer", [r"pleased to (?:extend|make|present) (?:you )?an? offer", r"delighted to offer", r"offer of employment", r"your (?:job |employment )?offer"]),
    ("rejected", [r"not moving forward", r"won't be moving forward", r"will not be moving forward", r"decided not to (?:move|proceed)", r"not selected", r"other candidates", r"regret to inform", r"unable to offer", r"unfortunately.{0,100}(?:position|application|candidate|proceed|move forward)"]),
    ("interview", [r"schedule (?:an? |your )?interview", r"invitation to interview", r"interview invitation", r"phone screen", r"availability.{0,80}interview", r"meet with (?:the|our) (?:team|hiring manager)"]),
    ("action required", [r"complete.{0,80}(?:assessment|coding challenge|take-home|questionnaire)", r"assessment invitation", r"coding challenge", r"take-home (?:test|exercise|assignment)", r"additional information (?:is )?required"]),
    ("waiting", [r"application (?:has been )?received", r"received your application", r"thank you for applying", r"successfully submitted", r"application is (?:being |now )?reviewed", r"under review"]),
]
STOP = {"the", "and", "for", "with", "from", "your", "our", "job", "role", "position", "engineer", "engineering", "developer", "group", "company", "limited", "ltd", "llc", "inc", "gmbh", "team", "application"}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _dt(value):
    d = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)


def _read_json(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return None


def save_client(data):
    root = (data or {}).get("installed") or (data or {}).get("web")
    if not root or not root.get("client_id") or not root.get("client_secret") or not root.get("auth_uri") or not root.get("token_uri"):
        raise ValueError("This is not a valid Google OAuth client JSON file")
    os.makedirs(db.DATA, exist_ok=True)
    json.dump(data, open(CLIENT_PATH, "w", encoding="utf-8"), indent=2)
    return True


def _client():
    data = _read_json(CLIENT_PATH) or {}
    return data.get("installed") or data.get("web")


def authorization_url():
    c = _client()
    if not c:
        raise RuntimeError("Google OAuth client JSON has not been added")
    state = secrets.token_urlsafe(32)
    with _lock:
        STATE["oauth_state"] = state
    q = {"client_id": c["client_id"], "redirect_uri": REDIRECT_URI, "response_type": "code", "scope": SCOPE,
         "access_type": "offline", "prompt": "consent", "state": state, "include_granted_scopes": "true"}
    return (c.get("auth_uri") or "https://accounts.google.com/o/oauth2/auth") + "?" + urlencode(q)


def complete_oauth(code, state):
    with _lock:
        expected = STATE.get("oauth_state")
        STATE["oauth_state"] = None
    if not expected or not secrets.compare_digest(str(expected), str(state or "")):
        raise RuntimeError("OAuth state check failed; start Connect Gmail again")
    c = _client()
    r = requests.post(c.get("token_uri") or "https://oauth2.googleapis.com/token", timeout=30, data={
        "code": code, "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": REDIRECT_URI, "grant_type": "authorization_code"})
    r.raise_for_status()
    tok = r.json(); tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600)) - 60
    os.makedirs(db.DATA, exist_ok=True)
    json.dump(tok, open(TOKEN_PATH, "w", encoding="utf-8"), indent=2)
    return True


def _token():
    tok, c = _read_json(TOKEN_PATH), _client()
    if not tok or not c:
        raise RuntimeError("Gmail is not connected")
    if tok.get("access_token") and float(tok.get("expires_at", 0)) > time.time():
        return tok["access_token"]
    if not tok.get("refresh_token"):
        raise RuntimeError("Gmail authorization expired; reconnect Gmail")
    r = requests.post(c.get("token_uri") or "https://oauth2.googleapis.com/token", timeout=30, data={
        "refresh_token": tok["refresh_token"], "client_id": c["client_id"], "client_secret": c["client_secret"],
        "grant_type": "refresh_token"})
    r.raise_for_status()
    fresh = r.json(); tok.update(fresh); tok["expires_at"] = time.time() + int(fresh.get("expires_in", 3600)) - 60
    json.dump(tok, open(TOKEN_PATH, "w", encoding="utf-8"), indent=2)
    return tok["access_token"]


def status():
    tok = _read_json(TOKEN_PATH) or {}
    return {"client_configured": bool(_client()), "connected": bool(tok.get("refresh_token") or tok.get("access_token")),
            "running": STATE["running"], "last_sync": STATE["last_sync"], "last_error": STATE["last_error"],
            "last_result": STATE["last_result"], "scope": "Gmail read-only", "client_path": CLIENT_PATH}


def _gmail(path, params=None):
    r = requests.get("https://gmail.googleapis.com/gmail/v1/users/me/" + path, params=params, timeout=30,
                     headers={"Authorization": "Bearer " + _token()})
    if r.status_code == 401:
        tok = _read_json(TOKEN_PATH) or {}; tok["expires_at"] = 0; json.dump(tok, open(TOKEN_PATH, "w", encoding="utf-8"), indent=2)
        r = requests.get("https://gmail.googleapis.com/gmail/v1/users/me/" + path, params=params, timeout=30,
                         headers={"Authorization": "Bearer " + _token()})
    r.raise_for_status()
    return r.json()


def _decode(data):
    if not data:
        return ""
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
    except Exception:
        return ""


def _body(part):
    out = []
    if (part.get("mimeType") or "").startswith("text/") and not part.get("filename"):
        out.append(_decode((part.get("body") or {}).get("data")))
    for child in part.get("parts") or []:
        out.append(_body(child))
    text = " ".join(out)
    text = re.sub(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def _message(raw):
    payload = raw.get("payload") or {}
    hs = {h.get("name", "").lower(): h.get("value", "") for h in payload.get("headers") or []}
    try:
        dt = datetime.fromtimestamp(int(raw.get("internalDate", "0")) / 1000, timezone.utc)
    except Exception:
        try: dt = parsedate_to_datetime(hs.get("date", "")).astimezone(timezone.utc)
        except Exception: dt = datetime.now(timezone.utc)
    return {"id": raw.get("id"), "thread_id": raw.get("threadId"), "sender": hs.get("from", ""),
            "subject": hs.get("subject", ""), "body": _body(payload) or raw.get("snippet", ""),
            "received_at": dt.isoformat(timespec="seconds")}


def classify(subject, body):
    text = (subject + " " + body[:8000]).lower()
    for stage, rules in STAGE_RULES:
        if any(re.search(rx, text, re.I | re.S) for rx in rules):
            return stage
    return None


def _norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def _tokens(s):
    return {x for x in _norm(s).split() if len(x) > 2 and x not in STOP}


def _match(msg, jobs):
    sender_name, sender_addr = parseaddr(msg["sender"])
    sender_domain = sender_addr.rsplit("@", 1)[-1].split(".")[0].lower() if "@" in sender_addr else ""
    hay = _norm(sender_name + " " + sender_addr + " " + msg["subject"] + " " + msg["body"][:10000])
    ht = _tokens(hay)
    best = None
    for j in jobs:
        try:
            if j.get("applied_at") and _dt(msg["received_at"]) < _dt(j["applied_at"]) - timedelta(days=3):
                continue
        except Exception:
            pass
        company, title = _norm(j.get("company")), _tokens(j.get("title"))
        ct = _tokens(company); common_c = ct & ht; common_t = title & ht
        company_ratio = len(common_c) / max(1, len(ct)); title_ratio = len(common_t) / max(1, len(title))
        phrase = bool(company and len(company) >= 4 and company in hay)
        domain_hit = any(t in sender_domain for t in ct if len(t) >= 4)
        score = (48 if phrase else 0) + company_ratio * 32 + title_ratio * 28 + (18 if domain_hit else 0)
        if not (phrase or domain_hit or company_ratio >= 0.6) or score < 48:
            continue
        if best is None or score > best[0]:
            best = (score, j)
    return (best[1], min(0.99, best[0] / 100)) if best else (None, 0)


def sync(limit=250):
    with _lock:
        if STATE["running"]:
            return STATE.get("last_result") or {"running": True}
        STATE["running"] = True; STATE["last_error"] = None
    try:
        jobs = db.rows("SELECT id,title,company,platform,url,status,applied_at,application_stage,stage_updated_at,stage_source FROM jobs WHERE applied_at IS NOT NULL OR status IN ('applied','interview','offer','rejected')")
        known = {r["message_id"] for r in db.rows("SELECT message_id FROM email_status_messages")}
        query = 'newer_than:365d -in:spam -in:trash {application interview assessment offer candidate applying}'
        ids, token = [], None
        while len(ids) < limit:
            d = _gmail("messages", {"q": query, "maxResults": min(100, limit - len(ids)), **({"pageToken": token} if token else {})})
            ids.extend(x["id"] for x in d.get("messages") or []); token = d.get("nextPageToken")
            if not token: break
        checked = matched = updated = 0
        for mid in ids:
            if mid in known: continue
            raw = _gmail("messages/" + mid, {"format": "full"}); msg = _message(raw); checked += 1
            stage = classify(msg["subject"], msg["body"])
            job, confidence = _match(msg, jobs) if stage else (None, 0)
            if job: matched += 1
            if job and confidence >= 0.55:
                current = job.get("application_stage")
                newer = not job.get("stage_updated_at") or _dt(msg["received_at"]) >= _dt(job["stage_updated_at"])
                should = newer and (not current or current == "waiting" or stage != "waiting") and not str(job.get("stage_source") or "").startswith("manual")
                if should:
                    db.exe("UPDATE jobs SET application_stage=?,stage_updated_at=?,stage_source=?,stage_email_id=?,stage_confidence=?,updated_at=? WHERE id=?",
                           (stage, msg["received_at"], "gmail keyword rules", mid, confidence, _now(), job["id"]))
                    db.exe("INSERT INTO events (job_id,ts,kind,detail) VALUES (?,?,?,?)", (job["id"], _now(), "email status", f"{stage}: {msg['subject'][:160]}"))
                    job.update(application_stage=stage, stage_updated_at=msg["received_at"], stage_source="gmail keyword rules")
                    updated += 1
            db.exe("INSERT OR REPLACE INTO email_status_messages (message_id,thread_id,received_at,sender,subject,stage,job_id,confidence,processed_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   (mid, msg["thread_id"], msg["received_at"], msg["sender"], msg["subject"], stage, job["id"] if job else None, confidence, _now()))
        result = {"checked": checked, "matched": matched, "updated": updated, "messages_seen": len(ids)}
        with _lock:
            STATE["last_sync"] = _now(); STATE["last_result"] = result
        return result
    except Exception as e:
        with _lock: STATE["last_error"] = str(e)
        raise
    finally:
        with _lock: STATE["running"] = False


def start_sync():
    with _lock:
        if STATE["running"]: return False
    def work():
        try: sync()
        except Exception as e: print("gmail sync:", e)
    threading.Thread(target=work, daemon=True).start()
    return True


def scheduler_loop():
    time.sleep(20)
    while True:
        try:
            if status()["connected"]: sync()
        except Exception as e:
            print("gmail scheduler:", e)
        time.sleep(600)
