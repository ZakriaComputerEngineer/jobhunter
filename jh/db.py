import json, os, sqlite3, threading
from contextlib import contextmanager
from . import discovery

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA, "jobhunter.db")
_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE, fp TEXT, platform TEXT, ext_id TEXT, title TEXT, company TEXT, location TEXT,
  country TEXT, region TEXT, work_mode TEXT, posted TEXT, first_seen TEXT, last_seen TEXT, url TEXT,
  description TEXT, jd_quality TEXT, salary TEXT, job_type TEXT, seniority_raw TEXT, seniority TEXT,
  applicants TEXT, experience TEXT, years_req INTEGER, domains TEXT,
  match_auto REAL, match_ml REAL, match REAL, best_template TEXT, missing TEXT,
  status TEXT DEFAULT 'new', starred INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, notes TEXT DEFAULT '',
  applied_at TEXT, updated_at TEXT, lang TEXT
);
CREATE INDEX IF NOT EXISTS ix_jobs_posted ON jobs(posted);
CREATE INDEX IF NOT EXISTS ix_jobs_fp ON jobs(fp);
CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, name TEXT, template TEXT, provider TEXT,
  content_json TEXT, ats_json TEXT, score REAL, base_score REAL, pdf_path TEXT, docx_path TEXT,
  warnings TEXT, created TEXT, updated TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, started TEXT, finished TEXT, status TEXT,
  platforms TEXT, n_found INTEGER, n_new INTEGER, stats TEXT, log TEXT, file TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, ts TEXT, kind TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS email_status_messages (
  message_id TEXT PRIMARY KEY, thread_id TEXT, received_at TEXT, sender TEXT, subject TEXT,
  stage TEXT, job_id INTEGER, confidence REAL, processed_at TEXT
);
"""


def connect():
    os.makedirs(DATA, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


_conn = None


@contextmanager
def cx():
    global _conn
    with _lock:
        if _conn is None:
            _conn = connect()
            _conn.executescript(SCHEMA)
            cols = {r[1] for r in _conn.execute("PRAGMA table_info(jobs)")}
            for col, typ in (("lang", "TEXT"), ("elig", "TEXT"), ("elig_reason", "TEXT"),
                             ("application_stage", "TEXT"), ("stage_updated_at", "TEXT"),
                             ("stage_source", "TEXT"), ("stage_email_id", "TEXT"),
                             ("stage_confidence", "REAL")):
                if col not in cols:
                    _conn.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")
            # repair Glassdoor links saved without the ?jl=<id> parameter (they open a 404 page)
            _conn.execute("UPDATE jobs SET url = url || '?jl=' || ext_id WHERE platform='Glassdoor' "
                          "AND ext_id IS NOT NULL AND ext_id != '' AND url NOT LIKE '%jl=%'")
            _conn.commit()
        try:
            yield _conn
            _conn.commit()
        except Exception:
            _conn.rollback()
            raise


def rows(sql, args=()):
    with cx() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def one(sql, args=()):
    r = rows(sql, args)
    return r[0] if r else None


def exe(sql, args=()):
    with cx() as c:
        cur = c.execute(sql, args)
        return cur.lastrowid


# ---------------- settings ----------------
SETTINGS_PATH = os.path.join(DATA, "settings.json")
DEFAULTS = {
    "output_dir": os.path.dirname(ROOT),          # the "new resumes" folder (app lives inside it)
    "days": 7,
    "ats_target": 80,
    "schedule_enabled": True,
    "schedule_time": "19:30",   # fallback; Claude's scheduled task scrapes at 18:30
    "keywords": ["AI Engineer", "Machine Learning Engineer", "AI Automation Engineer", "LLM Engineer", "MLOps Engineer"],
    "remote_keywords": ["machine learning", "AI engineer", "LLM", "automation", "MLOps"],
    "linkedin_locations": [
        {"name": "Pakistan", "pages": 2}, {"name": "European Union"}, {"name": "Australia"},
        {"name": "United Arab Emirates"}, {"name": "United Kingdom"},
        {"name": "Remote (Worldwide)", "geoId": "92000000", "remote": True}],
    "linkedin_experience": "3%2C4",
    "linkedin_detail_cap": 120,
    "indeed_sites": [
        {"host": "pk.indeed.com", "l": "Pakistan", "kw": 5}, {"host": "au.indeed.com", "l": "Australia"},
        {"host": "uk.indeed.com", "l": "United Kingdom"}, {"host": "ae.indeed.com", "l": "United Arab Emirates"},
        {"host": "de.indeed.com", "l": "Germany"}, {"host": "www.indeed.com", "l": "Remote", "remote": True}],
    "glassdoor_locations": [{"name": "Pakistan", "slug": "pakistan", "il": "IN192"}, {"name": "Remote", "q": "remoteWorkType=1"}],
    "bayt_regions": ["pakistan", "uae", "saudi-arabia", "qatar"],
    "company_boards": [{"type": "ashby", "slug": "cohere", "name": "Cohere"}],
    "platforms": {"linkedin": True, "indeed": True, "glassdoor": True, "bayt": True, "rozee": True, "careerjet": True, "jooble": True, "seek": True,
                  "remotive": True, "remoteok": True, "wwr": True, "arbeitnow": True, "jobicy": True,
                  "himalayas": True, "workingnomads": True, "hackernews": True, "atsboards": True},
    "delays": {"api": [1200, 3500], "page": [5000, 11000], "detail": [1500, 4000], "backoff": [30000, 75000]},
    "headless": False,
    "browser_channel": "chrome",
    "apply_browser": "auto",
    "llm": {"provider": "none", "model": "", "api_key": "", "base_url": ""},
    "extra_skills": [],
    "relocation": ["Australia", "Europe"],      # where you'd relocate (with sponsorship); Pakistan is always home
    "eligibility_view": "ok",                    # ok = eligible + maybe, eligible = strict, all = everything
    "preferred_countries": ["Pakistan", "Remote", "Australia", "Germany", "Netherlands", "United Kingdom", "United Arab Emirates"],
    "discovery_filters": discovery.default_filters(),
}


def settings():
    os.makedirs(DATA, exist_ok=True)
    s = dict(DEFAULTS)
    if os.path.exists(SETTINGS_PATH):
        try:
            s.update(json.load(open(SETTINGS_PATH, encoding="utf-8")))
        except Exception:
            pass
    s["discovery_filters"] = discovery.normalize(s.get("discovery_filters"))
    return s


def save_settings(new):
    """Persist only user-changed keys, so improved defaults in future versions still apply."""
    os.makedirs(DATA, exist_ok=True)
    stored = {}
    if os.path.exists(SETTINGS_PATH):
        try:
            stored = json.load(open(SETTINGS_PATH, encoding="utf-8"))
        except Exception:
            stored = {}
    for k, v in (new or {}).items():
        if DEFAULTS.get(k) == v:
            stored.pop(k, None)
        else:
            stored[k] = v
    json.dump(stored, open(SETTINGS_PATH, "w", encoding="utf-8"), indent=1)
    return settings()
