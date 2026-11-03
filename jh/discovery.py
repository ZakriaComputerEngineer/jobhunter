"""Deterministic, AI-free job discovery settings and synonym bags."""
import copy


PLATFORMS = [
    ("linkedin", "LinkedIn"), ("indeed", "Indeed"), ("glassdoor", "Glassdoor"),
    ("bayt", "Bayt"), ("rozee", "Rozee.pk"), ("careerjet", "Careerjet Pakistan"),
    ("jooble", "Jooble Pakistan"), ("seek", "SEEK Australia"),
    ("remotive", "Remotive"), ("remoteok", "Remote OK"),
    ("wwr", "We Work Remotely"), ("arbeitnow", "Arbeitnow"),
    ("jobicy", "Jobicy"), ("himalayas", "Himalayas"),
    ("workingnomads", "Working Nomads"), ("hackernews", "HN Who's Hiring"),
    ("atsboards", "Company ATS boards"),
]

REGIONS = [
    ("pakistan", "Pakistan", r"pakistan|islamabad|lahore|karachi|rawalpindi"),
    ("remote_worldwide", "Remote worldwide", r"remote|worldwide|anywhere|global"),
    ("europe", "Europe", r"europe|eu\b|germany|netherlands|france|spain|italy|poland|portugal|sweden|norway|denmark|finland|switzerland|austria"),
    ("uk_ireland", "UK & Ireland", r"united kingdom|\buk\b|england|scotland|wales|ireland|london"),
    ("middle_east", "Middle East", r"middle east|uae|united arab emirates|dubai|abu dhabi|saudi|qatar|bahrain|oman|kuwait"),
    ("australia_nz", "Australia & New Zealand", r"australia|new zealand|sydney|melbourne|brisbane|perth|auckland"),
    ("north_america", "North America", r"united states|\busa?\b|canada|north america"),
    ("asia", "Asia", r"asia|singapore|malaysia|indonesia|india|japan|south korea|hong kong"),
]

DOMAINS = [
    ("ai_ml", "AI / ML engineering", r"\bai\b|artificial intelligence|machine learning|\bml\b|deep learning|applied scientist"),
    ("data_science", "Data science", r"data scien|predictive model|statistical model|experimentation|forecasting"),
    ("genai_llm", "Generative AI / LLM", r"generative ai|genai|\bllm|large language model|rag\b|prompt engineer|foundation model"),
    ("agents_automation", "AI agents & automation", r"agentic|ai agents?|multi-agent|automation engineer|workflow automation|\bn8n\b|langgraph|mcp\b"),
    ("mlops", "MLOps / model platform", r"mlops|llmops|model deployment|model serving|model monitoring|feature store|kubeflow|sagemaker"),
    ("computer_vision", "Computer vision", r"computer vision|image processing|object detection|opencv|yolo|vision engineer"),
    ("nlp_speech", "NLP / speech / voice", r"\bnlp\b|natural language|speech recognition|voice ai|text-to-speech|tts\b|stt\b"),
    ("data_engineering", "Data engineering", r"data engineer|etl\b|data pipeline|data warehouse|spark\b|airflow\b|dbt\b"),
]

WORK_MODES = [
    ("remote", "Remote", r"remote|work from home|distributed|anywhere"),
    ("hybrid", "Hybrid", r"hybrid|flexible location|days? (?:in|at) (?:the )?office"),
    ("onsite", "On-site", r"on[ -]?site|in[ -]?office|office[ -]?based|work location"),
]

SENIORITY = [
    ("junior", "Junior / entry", r"junior|entry[ -]?level|graduate|intern(?:ship)?|associate"),
    ("mid", "Mid-level", r"mid[ -]?(?:level|senior)?|intermediate|experienced"),
    ("senior", "Senior+", r"senior|sr\.?\b|lead\b|staff\b|principal|architect|head of|director"),
]


def default_filters():
    return {
        "regions": ["pakistan", "remote_worldwide", "europe", "uk_ireland", "middle_east", "australia_nz"],
        "domains": ["ai_ml", "data_science", "genai_llm", "agents_automation", "mlops", "computer_vision", "nlp_speech"],
        "work_modes": ["remote", "hybrid", "onsite"],
        "seniority": ["junior", "mid"],
        "salary_min": 0, "salary_max": 0, "salary_currency": "any", "require_salary": False,
        "experience_min": 0, "experience_max": 5, "require_experience": False,
    }


def normalize(value):
    out = default_filters()
    if isinstance(value, dict):
        out.update(value)
    valid = {
        "regions": {x[0] for x in REGIONS}, "domains": {x[0] for x in DOMAINS},
        "work_modes": {x[0] for x in WORK_MODES}, "seniority": {x[0] for x in SENIORITY},
    }
    for key, allowed in valid.items():
        vals = out.get(key)
        out[key] = [x for x in vals if x in allowed] if isinstance(vals, list) else []
    for key in ("salary_min", "salary_max", "experience_min", "experience_max"):
        try:
            out[key] = max(0, float(out.get(key) or 0))
        except (TypeError, ValueError):
            out[key] = 0
    out["salary_currency"] = str(out.get("salary_currency") or "any").lower()
    if out["salary_currency"] not in ("any", "usd", "pkr", "eur", "gbp", "aud", "aed"):
        out["salary_currency"] = "any"
    out["require_salary"] = bool(out.get("require_salary"))
    out["require_experience"] = bool(out.get("require_experience"))
    return out


def options():
    def choices(rows):
        return [{"id": row[0], "label": row[1]} for row in rows]
    return {
        "platforms": choices(PLATFORMS), "regions": choices(REGIONS), "domains": choices(DOMAINS),
        "work_modes": choices(WORK_MODES), "seniority": choices(SENIORITY),
        "salary_currencies": [{"id": x, "label": y} for x, y in (
            ("any", "Any / no conversion"), ("usd", "USD"), ("pkr", "PKR"), ("eur", "EUR"),
            ("gbp", "GBP"), ("aud", "AUD"), ("aed", "AED"))],
    }


def scraper_payload(filters):
    filters = normalize(filters)
    bags = {
        "regions": {x[0]: x[2] for x in REGIONS}, "domains": {x[0]: x[2] for x in DOMAINS},
        "work_modes": {x[0]: x[2] for x in WORK_MODES}, "seniority": {x[0]: x[2] for x in SENIORITY},
    }
    return copy.deepcopy(filters), bags
