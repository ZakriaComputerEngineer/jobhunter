#!/usr/bin/env python3
"""ATS-style match score of a resume PDF against a job description (0-100).

Mirrors what Jobscan / Workday / Greenhouse-style parsers check:
  45  hard-skill coverage   (JD skills from a tech lexicon found in resume text)
  15  keyword coverage      (top recurring JD terms/phrases found in resume)
  10  job-title alignment   (JD title words in headline / summary)
  20  parse & structure     (text extractable, standard headings, contact info, length)
  10  qualifications        (degree + years of experience)

usage: python ats.py <resume.pdf> <jd.txt> "<job title>" [--json]
"""
import json, re, sys
from collections import Counter
import pdfplumber

# canonical skill -> regex alternatives (lowercase)
LEX = {
 "python": r"python", "sql": r"\bsql\b", "javascript": r"javascript|\bjs\b", "typescript": r"typescript",
 "java": r"\bjava\b", "c++": r"c\+\+", "go": r"\bgolang\b", "rust": r"\brust\b", "r": r"\br\b(?: programming| language)",
 "bash": r"\bbash\b|shell scripting", "node.js": r"node\.?js",
 "pytorch": r"pytorch", "tensorflow": r"tensorflow", "keras": r"keras", "scikit-learn": r"scikit[- ]learn|sklearn",
 "jax": r"\bjax\b", "xgboost": r"xgboost|lightgbm|gradient boost", "pandas": r"pandas", "numpy": r"numpy",
 "spark": r"\bspark\b|pyspark", "hugging face": r"hugging ?face", "transformers": r"transformer",
 "llm": r"\bllms?\b|large language model", "generative ai": r"generative ai|gen ?ai",
 "rag": r"\brag\b|retrieval[- ]augmented", "prompt engineering": r"prompt engineering|prompting|prompt design",
 "fine-tuning": r"fine[- ]?tun", "lora/qlora": r"q?lora|peft", "rlhf": r"rlhf|dpo",
 "langchain": r"langchain", "langgraph": r"langgraph", "llamaindex": r"llama ?index", "crewai": r"crew ?ai", "autogen": r"autogen",
 "ai agents": r"agentic|ai agents?|multi[- ]agent|autonomous agents?", "function calling": r"function calling|tool[- ]calling|tool use",
 "mcp": r"\bmcp\b|model context protocol", "openai api": r"openai|gpt-?4|gpt-?3|chatgpt|gpt",
 "claude/anthropic": r"anthropic|claude", "gemini": r"gemini", "llama": r"\bllama", "mistral": r"mistral",
 "embeddings": r"embedding", "vector database": r"vector (?:db|database|store|search)|pinecone|faiss|chroma|weaviate|milvus|qdrant|pgvector",
 "semantic search": r"semantic search|hybrid search", "nlp": r"\bnlp\b|natural language", "computer vision": r"computer vision|image (?:classification|segmentation)|object detection",
 "speech/voice ai": r"speech|voice|\bstt\b|\btts\b|whisper|asr", "deep learning": r"deep learning|neural network",
 "machine learning": r"machine learning|\bml\b", "mlops": r"mlops|ml ops|model monitoring|ml pipelines?|model deployment",
 "llmops / evaluation": r"llmops|evals?\b|evaluation framework|model evaluation|llm evaluation",
 "statistics": r"statistic", "a/b testing": r"a/b test|experiment(?:ation|al design)", "feature engineering": r"feature engineering",
 "time series": r"time[- ]series|forecast", "recommendation systems": r"recommend(?:er|ation) (?:system|engine)",
 "classification": r"classification|classifier", "data pipelines": r"data pipelines?|\betl\b|\belt\b",
 "data engineering": r"data engineering|data warehous|data lake", "airflow": r"airflow", "dbt": r"\bdbt\b", "kafka": r"kafka",
 "aws": r"\baws\b|amazon web services|ec2|sagemaker|bedrock|lambda", "sagemaker": r"sagemaker", "bedrock": r"bedrock",
 "azure": r"azure", "azure openai": r"azure openai", "gcp": r"\bgcp\b|google cloud|vertex", "vertex ai": r"vertex",
 "docker": r"docker|container", "kubernetes": r"kubernetes|\bk8s\b|\beks\b|\baks\b", "terraform": r"terraform|infrastructure as code",
 "ci/cd": r"ci/cd|cicd|github actions|gitlab ci|jenkins|continuous (?:integration|delivery)", "git": r"\bgit\b|github|gitlab",
 "linux": r"linux", "microservices": r"microservice", "rest apis": r"rest(?:ful)? api|\bapis?\b", "fastapi": r"fastapi",
 "flask": r"flask", "django": r"django", "graphql": r"graphql", "websockets/webrtc": r"websocket|webrtc",
 "postgresql": r"postgres", "mongodb": r"mongo", "mysql": r"mysql", "redis": r"redis", "snowflake": r"snowflake",
 "databricks": r"databricks", "bigquery": r"bigquery", "elasticsearch": r"elasticsearch|opensearch",
 "n8n": r"\bn8n\b", "zapier": r"zapier", "make.com": r"make\.com|integromat", "power automate": r"power automate",
 "rpa": r"\brpa\b|uipath|automation anywhere|blue prism", "workflow automation": r"workflow automation|process automation|automat(?:e|ion) (?:workflows?|processes)",
 "crm": r"\bcrm\b|salesforce|hubspot|zendesk|gorgias", "salesforce": r"salesforce", "hubspot": r"hubspot",
 "shopify": r"shopify", "webhooks": r"webhook", "integrations": r"integration",
 "onnx/tensorrt": r"onnx|tensorrt", "quantization": r"quantiz", "vllm": r"vllm", "ollama": r"ollama", "triton": r"triton",
 "gpu": r"\bgpus?\b|cuda", "distributed training": r"distributed training|multi[- ]gpu|deepspeed|fsdp",
 "mlflow": r"mlflow", "weights & biases": r"weights ?& ?biases|wandb", "streamlit": r"streamlit", "power bi": r"power bi",
 "tableau": r"tableau", "excel": r"\bexcel\b", "jira": r"\bjira\b", "agile": r"agile|scrum",
 "security": r"owasp|security|guardrail", "copilot studio": r"copilot studio", "microsoft foundry": r"ai foundry|azure ai studio",
 "opencv": r"opencv", "pydantic": r"pydantic", "ragas": r"ragas|promptfoo|deepeval",
 "a2a": r"\ba2a\b|agent2agent", "ai coding tools": r"cursor|github copilot|claude code|codex", "livekit": r"livekit",
 "openai agents sdk": r"agents sdk", "semantic kernel": r"semantic kernel", "nosql": r"nosql|dynamodb|cosmos ?db", "yolo": r"\byolo", "segmentation": r"segmentation", "self-supervised learning": r"self[- ]supervised",
}
STOP = set("""a an the and or of to in for on with by at from as is are be this that will you your our we us it its
 their they them who what which into across within about over more most such other than also any all can may must should
 would could have has had do does did not no yes including include includes using use used new work working role team teams
 strong experience experienced ability able skills skill knowledge understanding years year plus etc e.g i.e job company
 candidate candidates looking join help build building based well highly great good best world global day days level
 opportunity opportunities environment business businesses within requirements responsibilities preferred required
 nice have bonus benefits salary apply applicants position full time part remote hybrid onsite office location
 equal employer gender race religion disability status veteran please email apply via apply now via""".split())
SECTIONS = {"summary": r"summary|profile|objective", "skills": r"skills", "experience": r"experience|employment",
            "education": r"education", "projects": r"projects|publications"}


def text_of(pdf):
    with pdfplumber.open(pdf) as d:
        pages = [p.extract_text() or "" for p in d.pages]
        n_tables = sum(len(p.find_tables()) for p in d.pages)
        n_images = sum(len(p.images) for p in d.pages)
    return "\n".join(pages), len(pages), n_tables, n_images


def jd_skills(jd):
    jl = jd.lower()
    return {k for k, pat in LEX.items() if re.search(pat, jl)}


def top_terms(jd, n=25):
    words = re.findall(r"[a-z][a-z0-9+#./-]{1,}", jd.lower())
    words = [w.strip(".,/-") for w in words]
    words = [w for w in words if w and w not in STOP and len(w) > 2]
    uni = Counter(words)
    bi = Counter(zip(words, words[1:]))
    terms = [(" ".join(b), c * 1.5) for b, c in bi.items() if c >= 2]
    terms += [(u, c) for u, c in uni.items() if c >= 2]
    terms.sort(key=lambda x: -x[1])
    seen, out = set(), []
    for t, _ in terms:
        if t in seen:
            continue
        seen.add(t); out.append(t)
        if len(out) >= n:
            break
    return out


def score(pdf, jd, title):
    txt, pages, ntab, nimg = text_of(pdf)
    return score_text(txt, jd, title, pages, ntab, nimg)


def score_text(txt, jd, title, pages=2, ntab=0, nimg=0):
    jd = jd or ""
    title = title or ""
    rl = txt.lower()
    # 1 hard skills
    req = jd_skills(jd)
    have = {k for k in req if re.search(LEX[k], rl)}
    s_skill = 45 * (len(have) / len(req) if req else 0.45)  # no JD text -> neutral, not perfect
    # 2 keywords
    terms = top_terms(jd)
    khave = [t for t in terms if t in rl]
    s_kw = 15 * (len(khave) / len(terms) if terms else 0.4)
    # 3 title
    head = " ".join(rl.splitlines()[:6]) + " " + rl[:1500]
    tw = [w for w in re.findall(r"[a-z]+", title.lower()) if w not in STOP and w not in ("m", "w", "d", "f", "h", "mid", "senior", "sr", "junior", "ii", "iii", "remote", "pakistan", "time", "opportunity")]
    tw = [{"ml": "machine learning", "ai": "ai"}.get(w, w) for w in tw]
    th = [w for w in tw if w in head]
    s_title = 10 * (len(th) / len(tw) if tw else 1)
    # 4 parse & structure
    s_parse = 0
    s_parse += 5 if len(txt) > 1500 else 0
    s_parse += 5 * sum(bool(re.search(p, rl)) for p in SECTIONS.values()) / len(SECTIONS)
    s_parse += 4 if re.search(r"[\w.]+@[\w.]+", txt) and re.search(r"\+?\d[\d -]{8,}", txt) else 0
    s_parse += 3 if ntab == 0 and nimg == 0 else 0
    s_parse += 3 if pages <= 3 else 1
    # 5 qualifications
    s_q = 0
    if re.search(r"bachelor|b\.?e\.?|b\.?s\.?|degree|computer science|engineering", jd.lower()):
        s_q += 5 if re.search(r"b\.e\.|bachelor|computer engineering", rl) else 0
    else:
        s_q += 5
    yrs_req = [int(x) for x in re.findall(r"(\d+)\s*\+?\s*(?:-|–|to)?\s*\d*\s*\+?\s*years", jd.lower()) if int(x) < 15]
    need = min(yrs_req) if yrs_req else 0
    s_q += 5 if need <= 2 else (3 if need <= 3 else 1)
    total = round(s_skill + s_kw + s_title + s_parse + s_q, 1)
    return {"score": total,
            "breakdown": {"hard_skills": round(s_skill, 1), "keywords": round(s_kw, 1), "title": round(s_title, 1),
                          "parse_structure": round(s_parse, 1), "qualifications": round(s_q, 1)},
            "skills_matched": sorted(have), "skills_missing": sorted(req - have),
            "keywords_missing": [t for t in terms if t not in khave], "title_missing": [w for w in tw if w not in th],
            "years_required_min": need, "pages": pages, "jd_chars": len(jd),
            "jd_quality": "full" if len(jd) > 1200 else ("partial" if len(jd) > 300 else "snippet")}


if __name__ == "__main__":
    r = score(sys.argv[1], open(sys.argv[2]).read(), sys.argv[3])
    if "--json" in sys.argv:
        print(json.dumps(r, indent=1))
    else:
        print(f"ATS score: {r['score']}/100  {r['breakdown']}")
        print("missing skills:", ", ".join(r["skills_missing"]) or "-")
        print("missing keywords:", ", ".join(r["keywords_missing"]) or "-")
        print("title words missing:", ", ".join(r["title_missing"]) or "-")
