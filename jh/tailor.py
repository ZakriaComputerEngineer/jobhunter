"""JD-optimised resume generation.

Pipeline: base CV content -> (LLM rewrite | rule-based optimiser) -> truthfulness guard -> render DOCX (original
layout) -> PDF -> ATS score -> refine with missing keywords until score >= target (max N passes).
"""
import copy, json, os, re
from datetime import datetime
import requests
from . import ats, db, profile, render

LOCKED_TYPES = ("header", "raw", "spacer")


# ------------------------------------------------------------------ LLM providers
def llm_call(system, user, cfg=None, max_tokens=6000):
    cfg = cfg or db.settings().get("llm", {})
    p = (cfg.get("provider") or "none").lower()
    key, model, base = cfg.get("api_key", ""), cfg.get("model", ""), (cfg.get("base_url") or "").rstrip("/")
    if p == "anthropic":
        r = requests.post("https://api.anthropic.com/v1/messages", timeout=240, headers={
            "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model or "claude-sonnet-4-5", "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": user}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json()["content"])
    if p == "ollama":
        r = requests.post((base or "http://localhost:11434") + "/api/chat", timeout=600, json={
            "model": model or "qwen2.5:14b", "stream": False, "format": "json", "options": {"temperature": 0.3, "num_ctx": 16384},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        r.raise_for_status()
        return r.json()["message"]["content"]
    endpoints = {"openai": "https://api.openai.com/v1", "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
                 "lmstudio": "http://localhost:1234/v1", "openrouter": "https://openrouter.ai/api/v1", "custom": base}
    defaults = {"openai": "gpt-4.1", "gemini": "gemini-2.5-flash", "lmstudio": "local-model", "openrouter": "anthropic/claude-sonnet-4.5", "custom": ""}
    if p in endpoints:
        url = (base if (base and p in ("lmstudio", "custom")) else endpoints[p]) + "/chat/completions"
        body = {"model": model or defaults[p], "temperature": 0.3, "max_tokens": max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if p in ("openai", "gemini", "openrouter"):
            body["response_format"] = {"type": "json_object"}
        r = requests.post(url, timeout=600, json=body, headers={"Authorization": f"Bearer {key or 'lm-studio'}"})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    raise RuntimeError("No LLM provider configured")


def parse_json(s):
    s = s.strip()
    s = re.sub(r"^```(?:json)?|```$", "", s, flags=re.M).strip()
    i, j = s.find("{"), s.rfind("}")
    return json.loads(s[i:j + 1])


# ------------------------------------------------------------------ helpers
def editable_blocks(content):
    out = {}
    for si, s in enumerate(content["sections"]):
        for bi, b in enumerate(s["blocks"]):
            if b["t"] not in LOCKED_TYPES and "text" in b:
                out[f"{si}.{bi}"] = {"section": s["heading"], "type": b["t"], "text": b["text"]}
    return out


NUM_RX = re.compile(r"(?<![\w.])(\$?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|\+)?)")


def numbers(s):
    return {re.sub(r"[\s,]", "", m).lower().rstrip("+") for m in NUM_RX.findall(s or "")}


def guard(content, truth):
    """Revert any block that introduces numbers not present anywhere in the real CVs."""
    tn = numbers(truth)
    warnings = []
    base = profile.base_content(content.get("_template", "auto"))
    for si, s in enumerate(content["sections"]):
        for bi, b in enumerate(s["blocks"]):
            if "text" not in b or b["t"] in LOCKED_TYPES:
                continue
            new = numbers(b["text"]) - tn
            new = {n for n in new if not re.fullmatch(r"\d{4}", n)}  # years like 2025 are fine
            if new:
                warnings.append(f"Reverted a line in {s['heading']} that introduced unverified numbers: {', '.join(sorted(new))}")
                orig = b.get("_orig")
                if orig is not None:
                    b["text"] = orig
                else:
                    b["text"] = NUM_RX.sub("", b["text"])
    return warnings


def apply_edits(base, data):
    c = copy.deepcopy(base)
    for si, s in enumerate(c["sections"]):
        for b in s["blocks"]:
            if "text" in b:
                b["_orig"] = b["text"]
    if data.get("headline"):
        c["headline"] = data["headline"].strip()
    for k, v in (data.get("edits") or {}).items():
        try:
            si, bi = map(int, k.split("."))
            b = c["sections"][si]["blocks"][bi]
            if b["t"] not in LOCKED_TYPES and isinstance(v, str) and v.strip():
                b["text"] = v.strip()
        except Exception:
            pass
    drops = set(data.get("drop") or [])
    for si, s in enumerate(c["sections"]):
        s["blocks"] = [b for bi, b in enumerate(s["blocks"]) if f"{si}.{bi}" not in drops or b["t"] in ("header", "raw")]
    for si, s in enumerate(c["sections"]):           # optional extra bullets (skills lines only)
        for nb in (data.get("add") or []):
            if nb.get("section") == s["heading"] and nb.get("text"):
                proto = next((b for b in s["blocks"] if b["t"] == "bullet"), None)
                if proto:
                    s["blocks"].append({"t": "bullet", "text": nb["text"], "proto": proto["proto"]})
    return c


def strip_private(c):
    c = copy.deepcopy(c)
    for s in c["sections"]:
        for b in s["blocks"]:
            b.pop("_orig", None)
    return c


SYSTEM = """You are an expert technical recruiter and resume writer who optimises resumes to pass Applicant Tracking
Systems (Workday, Greenhouse, Lever, iCIMS, Taleo) for AI / ML / automation engineering roles.
HARD RULES (never break):
1. Never invent employers, job titles, dates, degrees, certifications, publications, metrics or numbers. Every number you
   write must already appear in the candidate's source CVs.
2. Only claim skills/tools that appear in the candidate's source CVs or 'extra skills' list. If the JD wants something the
   candidate does not have, leave it out (you will list it in "gaps").
3. Keep the same sections and roughly the same length (it must stay within the same page count). Keep **bold** markup
   for metrics and key phrases, max ~2 bold spans per bullet.
4. Use the JD's exact terminology where it is truthful (e.g. if the JD says "LLMOps" and the candidate did LLM deployment &
   monitoring, use "LLMOps"). Mirror the job title in the headline and in the first sentence of the summary.
5. Bullets: strong action verb + what + tech + measurable impact. No first person. No buzzword stuffing.
6. Skills lines: keep "**Category:** item, item" format; put JD-matching skills first; you may rename categories to match JD.
Return ONLY JSON."""


def build_prompt(base, job, truth, missing=None, prev_score=None):
    blocks = editable_blocks(base)
    lines = [f"JOB TITLE: {job['title']}\nCOMPANY: {job.get('company','')}\nLOCATION: {job.get('location','')}\n",
             "JOB DESCRIPTION:\n" + (job.get("description") or "")[:9000],
             "\nCANDIDATE SOURCE CVs (ground truth, do not exceed):\n" + truth[:14000],
             "\nCURRENT RESUME HEADLINE: " + base.get("headline", ""),
             "\nEDITABLE BLOCKS (id -> section/type/text):\n" + json.dumps(blocks, ensure_ascii=False, indent=0)]
    if missing:
        lines.append(f"\nPREVIOUS ATS SCORE: {prev_score}. Still missing (include ONLY if truthful per source CVs): " + json.dumps(missing))
    lines.append("""
Return JSON: {
 "headline": "new centred title line (mirror JD title, keep ' | ' separated style)",
 "edits": {"<block id>": "rewritten text", ...},   // rewrite summary, skills lines and the most relevant bullets
 "drop": ["<block id>", ...],                      // optional: least relevant bullets to keep length
 "gaps": ["JD requirement the candidate lacks", ...],
 "notes": "one line on the strategy"
}""")
    return "\n".join(lines)


# ------------------------------------------------------------------ rule-based optimiser (no LLM)
PRETTY = {"llm": "LLMs", "rag": "RAG", "mcp": "MCP (Model Context Protocol)", "aws": "AWS", "gcp": "GCP", "nlp": "NLP",
          "ci/cd": "CI/CD", "sql": "SQL", "crm": "CRM", "rest apis": "REST APIs", "lora/qlora": "LoRA / QLoRA",
          "openai api": "OpenAI API", "claude/anthropic": "Anthropic Claude", "n8n": "n8n", "mlops": "MLOps",
          "llmops / evaluation": "LLM Evaluation", "ai agents": "AI Agents", "vllm": "vLLM", "fastapi": "FastAPI"}


def jd_phrase(key, jd):
    """The JD's own wording for a lexicon skill (ATS parsers match literal strings)."""
    m = re.search(ats.LEX[key], jd, re.I)
    if m:
        w = jd[m.start():m.end()].strip(" .,;:()")
        if len(w) >= 2 and not w.islower() or len(w) > 3:
            return w if not w.islower() else PRETTY.get(key, w)
    return PRETTY.get(key, key.title() if key.islower() and len(key) > 3 else key.upper() if len(key) <= 3 else key)


def rule_based(base, job, truth_sk):
    """No-AI optimiser: mirrors the job title, adds a 'Key Skills' line with EVERY JD skill/keyword the candidate
    really has (JD's exact wording), surfaces matching skills first. Never adds skills that aren't in the truth bank."""
    c = copy.deepcopy(base)
    for s in c["sections"]:
        for b in s["blocks"]:
            if "text" in b:
                b["_orig"] = b["text"]
    jd = (job.get("description") or "") + " " + job["title"]
    req = ats.jd_skills(jd)
    truth_l = profile.truth_text().lower()
    title = re.sub(r"\s*[\(\[].*?[\)\]]", "", job["title"]).strip()
    title = re.sub(r"\s*[-–—|].*$", "", title).strip() or job["title"]
    parts = [p.strip() for p in base.get("headline", "").split("|")]
    c["headline"] = " | ".join([title] + [p for p in parts if p.lower() != title.lower()][:2])

    have = sorted(req & truth_sk)
    phrases, seen = [], set()
    for k in have:
        p = jd_phrase(k, jd)
        if p.lower() not in seen:
            seen.add(p.lower()); phrases.append(p)
    # recurring JD keyword phrases (non-lexicon) that also appear in the candidate's CVs — multi-word or proper-noun only
    GENERIC = r"(software|engineer|engineering|enterprise|architecture|pipelines?|workflows?|solutions?|systems?|team|production|experience|ml|ai)"
    norm = lambda x: re.sub(r"s$", "", x.lower())
    have_norm = {norm(x) for x in phrases}
    for t in ats.top_terms(jd, 30):
        m = re.search(re.escape(t), jd, re.I)
        form = jd[m.start():m.end()] if m else t
        if t not in truth_l or norm(t) in have_norm or re.fullmatch(GENERIC, t):
            continue
        if " " in t or re.search(r"[A-Z0-9]", form[1:]):
            phrases.append(form); have_norm.add(norm(t))
    # drop plural/singular duplicates
    out, keys = [], set()
    for p in phrases:
        if norm(p) not in keys:
            keys.add(norm(p)); out.append(p)
    phrases = out
    for s in c["sections"]:
        if re.search(r"skill", s["heading"], re.I):
            bl = [b for b in s["blocks"] if b["t"] == "bullet"]
            for b in bl:   # reorder items: JD-matching first
                m = re.match(r"(\*\*[^*]+\*\*)\s*(.*)", b["text"])
                if not m:
                    continue
                items = [x.strip() for x in re.split(r",(?![^()]*\))", m.group(2).rstrip(".")) if x.strip()]
                items.sort(key=lambda x: 0 if any(re.search(ats.LEX[k], x.lower()) for k in req) else 1)
                b["text"] = f"{m.group(1)} {', '.join(items)}."
            if phrases and bl:
                i = s["blocks"].index(bl[0])
                s["blocks"].insert(i, {"t": "bullet", "proto": bl[0]["proto"],
                                       "text": f"**Key Skills for {title}:** " + ", ".join(phrases[:28]) + "."})
        if re.search(r"summary|profile", s["heading"], re.I):
            for b in s["blocks"]:
                if b["t"] == "para":
                    first = b["text"].split(" with ")[0] if " with " in b["text"][:80] else ""
                    if first and len(first) < 60:
                        b["text"] = b["text"].replace(first, title, 1)
                    break
    gaps = sorted(req - truth_sk)
    return c, {"gaps": gaps, "notes": f"Rule-based: title mirrored; {len(phrases)} JD keywords you have added verbatim in a Key Skills line"
                                     + (f"; {len(gaps)} JD skills not in your CVs left out (add them to your skills bank if you have them)." if gaps else ".")}


# ------------------------------------------------------------------ main entry
def slug(s):
    return re.sub(r"[^\w\-]+", "_", s or "").strip("_")[:40]


def generate(job, template=None, provider_cfg=None, progress=lambda m: None):
    s = db.settings()
    target = s.get("ats_target", 80)
    cfg = provider_cfg or s.get("llm", {})
    template = template or job.get("best_template") or "auto"
    base = copy.deepcopy(profile.base_content(template))
    base["_template"] = template
    truth = profile.truth_text()
    truth_sk = profile.truth_skills()
    out_dir = os.path.join(db.DATA, "resumes")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"Candidate_Resume_{slug(job.get('company'))}_{slug(job['title'])}"
    work = os.path.join(out_dir, f"{stamp}_{name}")

    def build_and_score(content, tag):
        content["_template"] = template
        dx = f"{work}_{tag}.docx"
        render.build(profile.tpl_path(template), strip_private(content), dx)
        pdf = render.to_pdf(dx)
        return pdf, dx, ats.score(pdf, job.get("description") or job["title"], job["title"])

    progress("Scoring your base CV against the JD…")
    base_pdf, base_docx, base_score = build_and_score(copy.deepcopy(base), "base")
    best = (base_score["score"], base, base_pdf, base_docx, base_score, {"gaps": [], "notes": "base"})
    use_llm = (cfg.get("provider") or "none") != "none"
    warnings = []
    missing, prev = None, None
    passes = 3 if use_llm else 1
    for i in range(passes):
        progress(f"Pass {i + 1}: {'LLM rewrite (' + cfg.get('provider') + ')' if use_llm else 'rule-based optimisation'}…")
        try:
            if use_llm:
                raw = llm_call(SYSTEM, build_prompt(best[1] if i else base, job, truth, missing, prev), cfg)
                data = parse_json(raw)
                content = apply_edits(best[1] if i else base, data)
                meta = {"gaps": data.get("gaps", []), "notes": data.get("notes", "")}
            else:
                content, meta = rule_based(base, job, truth_sk)
        except Exception as e:
            warnings.append(f"LLM pass {i + 1} failed ({e}); falling back to rule-based optimiser.")
            content, meta = rule_based(base, job, truth_sk)
            use_llm = False
        content["_template"] = template
        warnings += guard(content, truth)
        pdf, dx, sc = build_and_score(content, f"p{i + 1}")
        progress(f"Pass {i + 1} ATS score: {sc['score']}")
        if sc["pages"] > best[4]["pages"] + 0 and sc["pages"] > base_score["pages"]:
            warnings.append(f"Pass {i + 1} grew to {sc['pages']} pages; kept previous version.")
        elif sc["score"] >= best[0]:
            best = (sc["score"], content, pdf, dx, sc, meta)
        if best[0] >= target or not use_llm:
            break
        missing = [k for k in best[4]["skills_missing"] if k in truth_sk] + best[4]["keywords_missing"][:10]
        prev = best[0]
    # final files go to the output folder
    score, content, pdf, dx, sc, meta = best
    final_pdf = os.path.join(s["output_dir"], name + ".pdf")
    n = 2
    while os.path.exists(final_pdf):
        final_pdf = os.path.join(s["output_dir"], f"{name}_v{n}.pdf"); n += 1
    os.makedirs(s["output_dir"], exist_ok=True)
    import shutil
    shutil.copyfile(pdf, final_pdf)
    final_docx = os.path.join(out_dir, os.path.basename(final_pdf).replace(".pdf", ".docx"))
    shutil.copyfile(dx, final_docx)
    for f in os.listdir(out_dir):     # clean intermediate pass files
        if f.startswith(stamp) and (f.endswith(".pdf") or f.endswith(".docx")):
            try: os.remove(os.path.join(out_dir, f))
            except OSError: pass
    sc["gaps"] = meta.get("gaps", [])
    sc["notes"] = meta.get("notes", "")
    rid = db.exe("""INSERT INTO resumes (job_id, name, template, provider, content_json, ats_json, score, base_score, pdf_path,
                    docx_path, warnings, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (job.get("id"), os.path.basename(final_pdf), template, cfg.get("provider") or "none",
                  json.dumps(strip_private(content)), json.dumps(sc), score, base_score["score"], final_pdf, final_docx,
                  json.dumps(warnings), datetime.now().isoformat(timespec="seconds"), datetime.now().isoformat(timespec="seconds")))
    if job.get("id"):
        db.exe("UPDATE jobs SET status=CASE WHEN status='new' THEN 'resume ready' ELSE status END WHERE id=?", (job["id"],))
        db.exe("INSERT INTO events (job_id, ts, kind, detail) VALUES (?,?,?,?)", (job["id"], datetime.now().isoformat(timespec="seconds"), "resume", f"{score}"))
    progress(f"Done: {score} (base {base_score['score']}) → {final_pdf}")
    return rid


def rebuild(resume_id, content):
    r = db.one("SELECT * FROM resumes WHERE id=?", (resume_id,))
    job = db.one("SELECT * FROM jobs WHERE id=?", (r["job_id"],)) if r["job_id"] else {"title": "", "description": ""}
    content = strip_private(content)
    render.build(profile.tpl_path(r["template"]), content, r["docx_path"])
    render.to_pdf(r["docx_path"], r["pdf_path"])
    sc = ats.score(r["pdf_path"], (job or {}).get("description") or (job or {}).get("title", ""), (job or {}).get("title", ""))
    old = json.loads(r["ats_json"] or "{}")
    sc["gaps"], sc["notes"] = old.get("gaps", []), old.get("notes", "")
    db.exe("UPDATE resumes SET content_json=?, ats_json=?, score=?, updated=? WHERE id=?",
           (json.dumps(content), json.dumps(sc), sc["score"], datetime.now().isoformat(timespec="seconds"), resume_id))
    return sc
