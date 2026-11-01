"""Candidate profile: the two base CVs (templates) + the 'truth bank' of skills that tailoring may use."""
import json, os, re
from functools import lru_cache
from . import render, ats, db

TPL_DIR = os.path.join(db.ROOT, "templates")
TEMPLATES = {
    "auto": {"label": "AI Automation Engineer CV", "file": "auto.docx"},
    "ml": {"label": "ML Engineer / Data Scientist CV", "file": "ml.docx"},
}


def tpl_path(t):
    return os.path.join(TPL_DIR, TEMPLATES[t]["file"])


@lru_cache(maxsize=None)
def base_content(t):
    p = os.path.join(TPL_DIR, f"{t}.base.json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return render.extract(tpl_path(t))


def content_text(content):
    out = [content.get("headline", "")]
    for s in content["sections"]:
        out.append(s["heading"])
        for b in s["blocks"]:
            if "text" in b:
                out.append(b["text"].replace("**", ""))
            elif b.get("preview"):
                out.append(b["preview"])
    return "\n".join(out)


@lru_cache(maxsize=None)
def base_text(t):
    # full text incl. header/contact (for parse checks) + raw blocks
    return render.docx_text(tpl_path(t)) if os.path.exists(tpl_path(t)) else content_text(base_content(t))


def truth_text():
    """Everything the candidate has actually claimed across both CVs + skills he added in Settings."""
    extra = db.settings().get("extra_skills") or []
    return "\n\n".join(base_text(t) for t in TEMPLATES) + "\n" + ", ".join(extra)


def truth_skills():
    tl = truth_text().lower()
    return {k for k, pat in ats.LEX.items() if re.search(pat, tl)}


def match_job(title, desc):
    """Score both base CVs against a JD (text mode). Returns dict."""
    res = {}
    for t in TEMPLATES:
        r = ats.score_text(base_text(t), desc or title, title, pages=2 if t == "ml" else 3)
        n = len(desc or "")
        if n < 300:        # no real JD yet: a capped estimate so snippet-only jobs never outrank real matches
            r["score"] = round(30 + 0.4 * r["score"], 1)
        elif n < 1200:
            r["score"] = round(0.75 * r["score"] + 10, 1)
        res[t] = r
    best = max(res, key=lambda k: res[k]["score"])
    return res, best
