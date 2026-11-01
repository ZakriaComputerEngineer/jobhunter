"""Domain taxonomy, seniority, country and work-mode detection."""
import re

# Each domain: (id, label, colour, title/description regex)
DOMAINS = [
    ("llm", "LLM & GenAI Engineering", "#7c5cff",
     r"\bllms?\b|large language|gen ?ai|generative|\brag\b|retrieval[- ]augmented|prompt|gpt|langchain|llama ?index|fine[- ]?tun|foundation model"),
    ("agentic", "Agentic AI & Automation", "#00b894",
     r"agentic|ai agents?|multi[- ]agent|automation|\bn8n\b|langgraph|workflow|\brpa\b|power automate|zapier|make\.com|orchestrat|crm|copilot studio|integration engineer|forward deployed"),
    ("mle", "Machine Learning Engineering", "#0984e3",
     r"machine learning|\bml\b|ml engineer|deep learning|pytorch|tensorflow|model training|applied scien|ai/ml|ai engineer|artificial intelligence"),
    ("mlops", "MLOps & LLM Deployment", "#e17055",
     r"mlops|llmops|ml platform|ai platform|model serving|inference|vllm|triton|kubernetes|sagemaker|deployment|ml infra|gpu|quantiz"),
    ("cv", "Computer Vision", "#d63031",
     r"computer vision|\bcv\b engineer|image|video|object detection|segmentation|yolo|opencv|vision transformer|\bvit\b|perception|lidar|autonomous"),
    ("nlp", "NLP & Language", "#6c5ce7",
     r"\bnlp\b|natural language|text classification|transformers?\b|bert|named entity|information extraction|conversational"),
    ("voice", "Voice & Speech AI", "#fd79a8",
     r"speech|voice|\basr\b|\btts\b|\bstt\b|whisper|audio|call cent"),
    ("ds", "Data Science & Analytics", "#00cec9",
     r"data scien|analytics|statistic|forecast|a/b test|experimentation|business intelligence|insights"),
    ("edge", "Edge / Embedded AI", "#fdcb6e",
     r"edge ai|embedded|jetson|on[- ]device|tinyml|fpga|robotics|iot"),
    ("research", "AI Research", "#a29bfe",
     r"research (?:engineer|scientist)|phd|publication|self[- ]supervised|novel (?:model|method)"),
]
DOMAIN_LABEL = {d[0]: d[1] for d in DOMAINS}
DOMAIN_COLOR = {d[0]: d[2] for d in DOMAINS}
_DRX = [(d[0], re.compile(d[3], re.I)) for d in DOMAINS]


def classify(title, desc=""):
    t = title or ""
    d = (desc or "")[:6000]
    hits = []
    for k, rx in _DRX:
        score = 3 * len(rx.findall(t)) + min(len(rx.findall(d)), 6) * 0.5
        if score >= 1.5:
            hits.append((score, k))
    hits.sort(reverse=True)
    out = [k for _, k in hits[:3]]
    return out or ["mle"]


def seniority(title, given="", desc=""):
    t = (title or "").lower()
    g = (given or "").lower()
    if re.search(r"\bintern|internship|trainee|graduate|new grad|fresher|apprentice|working student|werkstudent", t):
        return "Intern/Graduate"
    if re.search(r"\bjunior|\bjr\.?\b|entry|associate\b(?! director)|\bi\b$|level 1", t) or "entry" in g or "internship" in g:
        return "Junior"
    if re.search(r"\bprincipal|\bstaff\b|\bhead of|director|\bvp\b|chief|distinguished|\bmanager\b", t) or "director" in g or "executive" in g:
        return "Principal/Lead+"
    if re.search(r"\bsenior|\bsr\.?\b|\blead\b|\bii{1,2}\b|\biii\b|expert|architect", t):
        return "Senior"
    if re.search(r"\bmid\b|mid[- ]level|intermediate|\bii\b", t):
        return "Mid"
    yrs = re.findall(r"(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*\d*\s*\+?\s*years?", (desc or "").lower())
    yrs = [int(y) for y in yrs if 0 < int(y) < 20]
    if yrs:
        m = min(yrs)
        if m <= 1:
            return "Junior"
        if m <= 4:
            return "Mid"
        return "Senior"
    if "mid-senior" in g or "associate" in g:
        return "Mid"
    return "Mid"  # unspecified engineer titles are usually mid-level


def years_required(desc):
    yrs = [int(y) for y in re.findall(r"(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*\d*\s*\+?\s*years?", (desc or "").lower()) if 0 < int(y) < 20]
    return min(yrs) if yrs else None


COUNTRIES = {
    "Pakistan": r"pakistan|hyderabad, sindh|islamabad|lahore|karachi|karāchi|rawalpindi|peshawar|faisalabad|multan|punjab, pk|sindh|\bpk\b",
    "United Arab Emirates": r"united arab emirates|\buae\b|dubai|abu dhabi|sharjah",
    "Saudi Arabia": r"saudi|riyadh|jeddah|dammam",
    "Qatar": r"qatar|doha", "Bahrain": r"bahrain|manama", "Oman": r"\boman\b|muscat", "Kuwait": r"kuwait",
    "Australia": r"australia|sydney|melbourne|brisbane|perth|adelaide|canberra|queensland|victoria, au|\bnsw\b|\bvic\b|\bqld\b|\bact\b",
    "New Zealand": r"new zealand|auckland|wellington",
    "United Kingdom": r"united kingdom|\buk\b|england|london|manchester|edinburgh|scotland|cambridge, uk|bristol",
    "Ireland": r"ireland|dublin|cork",
    "Germany": r"germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|aachen|düsseldorf|bavaria|pullach",
    "Netherlands": r"netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague",
    "France": r"france|paris|lyon|toulouse|marseille|nantes",
    "Spain": r"spain|madrid|barcelona|valencia|zaragoza|seville|málaga",
    "Portugal": r"portugal|lisbon|lisboa|porto|oeiras|braga",
    "Italy": r"italy|milan|rome|turin|bologna", "Belgium": r"belgium|brussels|liège|antwerp|ghent",
    "Switzerland": r"switzerland|zurich|zürich|geneva|basel|lausanne", "Austria": r"austria|vienna|wien|linz|graz",
    "Sweden": r"sweden|stockholm|gothenburg|malmö", "Norway": r"norway|oslo", "Denmark": r"denmark|copenhagen",
    "Finland": r"finland|helsinki|espoo", "Poland": r"poland|warsaw|kraków|krakow|wrocław|wroclaw|gdańsk",
    "Czechia": r"czech|prague|brno", "Romania": r"romania|bucharest|cluj", "Bulgaria": r"bulgaria|sofia",
    "Greece": r"greece|athens|thessaloniki", "Estonia": r"estonia|tallinn", "Lithuania": r"lithuania|vilnius",
    "Hungary": r"hungary|budapest", "Luxembourg": r"luxembourg", "Cyprus": r"cyprus|limassol|nicosia",
    "Turkey": r"turkey|türkiye|istanbul|ankara|izmir",
    "United States": r"united states|\busa\b|\bus\b|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia, us|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington, d|washington state|wisconsin|wyoming|new york|, (?:ca|ny|wa|tx|ma|il|co|ga|fl|nc|va|ut|pa|oh|mi|az|mn|or|nj|md)\b|san francisco|new york|seattle|austin|boston|chicago|bay area|los angeles",
    "Canada": r"canada|toronto|vancouver|montreal|ontario|alberta|calgary|waterloo|ottawa",
    "India": r"india|bengaluru|bangalore|hyderabad, (?:telangana|india)|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kochi|kerala",
    "Singapore": r"singapore", "Malaysia": r"malaysia|kuala lumpur", "Japan": r"japan|tokyo|osaka",
    "South Korea": r"korea|seoul", "Vietnam": r"vietnam|hanoi|ho chi minh", "Indonesia": r"indonesia|jakarta",
    "Philippines": r"philippines|manila", "China": r"china|shanghai|beijing|shenzhen", "Hong Kong": r"hong kong",
    "Egypt": r"egypt|cairo", "South Africa": r"south africa|cape town|johannesburg", "Nigeria": r"nigeria|lagos",
    "Kenya": r"kenya|nairobi", "Brazil": r"brazil|são paulo|sao paulo", "Mexico": r"mexico", "Chile": r"chile|santiago",
    "Argentina": r"argentina|buenos aires", "Israel": r"israel|tel aviv",
}
_CRX = [(c, re.compile(rx, re.I)) for c, rx in COUNTRIES.items()]
REGION = {"Pakistan": "Pakistan", "Australia": "Oceania", "New Zealand": "Oceania",
          "United Arab Emirates": "Middle East", "Saudi Arabia": "Middle East", "Qatar": "Middle East", "Bahrain": "Middle East", "Oman": "Middle East", "Kuwait": "Middle East", "Turkey": "Middle East", "Israel": "Middle East",
          "United States": "North America", "Canada": "North America", "Mexico": "Latin America", "Brazil": "Latin America", "Chile": "Latin America", "Argentina": "Latin America",
          "India": "Asia", "Singapore": "Asia", "Malaysia": "Asia", "Japan": "Asia", "South Korea": "Asia", "Vietnam": "Asia", "Indonesia": "Asia", "Philippines": "Asia", "China": "Asia", "Hong Kong": "Asia",
          "Egypt": "Africa", "South Africa": "Africa", "Nigeria": "Africa", "Kenya": "Africa"}
EUROPE = {"United Kingdom", "Ireland", "Germany", "Netherlands", "France", "Spain", "Portugal", "Italy", "Belgium", "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland", "Poland", "Czechia", "Romania", "Bulgaria", "Greece", "Estonia", "Lithuania", "Hungary", "Luxembourg", "Cyprus"}


def _fold(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c))


def country_of(location, hint=""):
    loc = _fold(location or "")
    # Indeed/Bayt hosts sometimes give a bare city; the search region is the hint
    if re.search(r"hyderabad", loc, re.I) and not re.search(r"telangana|india|sindh|pakistan", loc, re.I):
        return "Unknown"  # bare "Hyderabad" from PK searches is usually Hyderabad, India — don't guess
    for c, rx in _CRX:
        if rx.search(loc):
            return c
    if re.search(r"emea|europe|\beu\b", loc, re.I):
        return "Europe (any)"
    if re.search(r"worldwide|anywhere|global", loc, re.I):
        return "Worldwide"
    if re.search(r"remote", loc, re.I) and not hint:
        return "Unknown"   # "Remote" alone doesn't mean worldwide
    for c, rx in _CRX:
        if hint and rx.search(hint):
            return c
    if hint and re.search(r"european union|europe", hint, re.I):
        return "Europe (any)"
    return "Unknown"


def region_of(country):
    if country in EUROPE or country == "Europe (any)":
        return "Europe"
    return REGION.get(country, "Remote/Global" if country in ("Worldwide", "Unknown") else "Other")


def work_mode(location, desc="", remote_flag=False, title=""):
    s = f"{title} {location}".lower()
    d = (desc or "")[:4000].lower()
    if remote_flag or "remote" in s or re.search(r"work from home|\bwfh\b|work from anywhere", s):
        if "hybrid" in s:
            return "Hybrid"
        return "Remote"
    if "hybrid" in s or re.search(r"\bhybrid\b", d):
        return "Hybrid"
    if re.search(r"fully remote|100% remote|remote[- ]first|work from anywhere", d):
        return "Remote"
    return "Onsite"


_LANG = {
    "German": r"\b(und|der|die|das|wir|sie|mit|für|bei|unsere?n?|kenntnisse|erfahrung)\b",
    "French": r"\b(et|le|la|les|nous|vous|avec|pour|une|des|expérience|connaissances)\b",
    "Spanish": r"\b(y|el|la|los|las|con|para|una|experiencia|conocimientos|nuestro)\b",
    "Portuguese": r"\b(e|o|os|as|com|para|uma|você|experiência|conhecimentos)\b",
    "Dutch": r"\b(en|de|het|wij|jij|met|voor|een|ervaring|kennis)\b",
}
_EN = re.compile(r"\b(and|the|with|you|we|for|our|experience|skills|will)\b", re.I)


def language(text):
    t = (text or "")[:3000]
    if len(t) < 200:
        return "English"
    en = len(_EN.findall(t))
    best, bn = "English", en
    for lang, rx in _LANG.items():
        n = len(re.findall(rx, t, re.I))
        if n > bn * 1.3 and n > 12:
            best, bn = lang, n
    return best


# ---------------------------------------------------------------- eligibility for a Pakistan-based candidate
HOME = "Pakistan"
OPEN_RX = re.compile(r"worldwide|anywhere|global(?:ly)?|work from anywhere|all countries|any country|any location|"
                     r"no location restriction|location[- ]independent|fully distributed", re.I)
FRIENDLY_RX = re.compile(r"pakistan|south asia|\bapac\b|asia[- ]pacific|\basia\b|\bmena\b|middle east", re.I)
BLOCK_RX = re.compile(
    r"(?:must|should|need to|required to)\s+(?:be\s+)?(?:currently\s+)?(?:located|based|residing|reside|live|living)\s+in\s+(?:the\s+)?"
    r"(?:us\b|u\.s|usa|united states|uk\b|united kingdom|canada|eu\b|european union|europe|australia|new zealand|germany|"
    r"france|spain|portugal|netherlands|india|latam|latin america|north america|americas|[a-z]+ time ?zones?)"
    r"|(?:us|u\.s\.|usa|uk|eu|canadian|australian|nz|american|british|german)\s+(?:citizens?|residents?|nationals?)\s*(?:only|required)?"
    r"|(?:citizenship|permanent residency|green card)\s+(?:is\s+)?required"
    r"|(?:no|not able to|unable to|cannot|can ?not|will not|won't|do not|don't|does not)\s+(?:provide\s+|offer\s+)?(?:visa\s+)?sponsor"
    r"|without (?:the need for |requiring )?(?:visa )?sponsorship"
    r"|(?:full |unrestricted |existing )?(?:right|authori[sz]ation|eligib\w+|permission) to work in (?:the )?(?:us|u\.s|usa|united states|uk|united kingdom|australia|canada|eu|europe|germany|new zealand|netherlands|ireland|uae)"
    r"|security clearance|\bclearance required|baseline clearance|\bnv1\b|\bts/sci\b", re.I)
SPONSOR_RX = re.compile(r"visa sponsorship (?:is )?(?:available|provided|offered|possible)|(?:we|will|can|happy to|able to) sponsor"
                        r"|sponsorship (?:is )?available|relocation (?:support|package|assistance|bonus|allowance)|support (?:your|with) (?:visa|relocation)"
                        r"|blue card|work permit (?:support|provided)|help (?:you )?relocate", re.I)
DESC_OPEN_RX = re.compile(r"work from anywhere|remote[- ](?:from )?anywhere|anywhere in the world|(?:hire|hiring|candidates?) (?:from )?(?:anywhere|worldwide|globally)"
                          r"|100% remote,? worldwide|remote,? worldwide|worldwide remote|location[- ]independent|fully distributed team"
                          r"|any time ?zone|regardless of (?:your )?location", re.I)
RESTRICTED_REMOTE_RX = re.compile(r"\b(?:only|exclusively)\b|^\s*(?:us|usa|uk|eu|europe|canada|latam|americas|emea|north america)\b", re.I)


def eligibility(job, prefs=None):
    """-> (status, reason). status: 'eligible' | 'maybe' | 'blocked' for a candidate living in Pakistan who will
    relocate (with sponsorship) to the countries/regions in prefs['relocation']."""
    prefs = prefs or {}
    reloc = set(prefs.get("relocation") or [])
    title, loc, desc = job.get("title") or "", job.get("location") or "", (job.get("description") or "")[:12000]
    country, region, mode = job.get("country") or "Unknown", job.get("region") or "", job.get("work_mode") or ""
    text = f"{title}\n{loc}\n{desc}"
    blocked = BLOCK_RX.search(desc)
    sponsor = SPONSOR_RX.search(desc)
    in_reloc = country in reloc or (region == "Europe" and "Europe" in reloc) or (region == "Oceania" and "Australia" in reloc) \
        or (region == "Middle East" and "Middle East" in reloc)

    if country == HOME:
        if blocked and re.search(r"united states|\bus\b|usa|uk|canada|europe|australia", blocked.group(0), re.I):
            return "blocked", f"JD restriction: “{blocked.group(0)[:60]}”"
        return "eligible", "Based in Pakistan"

    if mode == "Remote":
        if FRIENDLY_RX.search(loc) or re.search(r"\bpakistan\b|south asia", desc, re.I):
            return "eligible", "Remote — open to Pakistan / APAC"
        if blocked:
            return "blocked", f"JD restriction: “{blocked.group(0)[:60]}”"
        if OPEN_RX.search(loc) or country == "Worldwide":
            return "eligible", "Remote — worldwide"
        if re.search(r"emea", loc, re.I):
            return "maybe", "Remote — EMEA (Pakistan is sometimes included)"
        if DESC_OPEN_RX.search(desc) and country in ("Unknown", "Worldwide") and not RESTRICTED_REMOTE_RX.search(loc):
            return "eligible", "Remote — JD says work from anywhere"
        if country not in ("Unknown",) or RESTRICTED_REMOTE_RX.search(loc):
            return "blocked", f"Remote only within {loc.strip() or country}"
        return "maybe", "Remote — location rules not stated"

    # onsite / hybrid abroad
    if blocked:
        return "blocked", f"JD restriction: “{blocked.group(0)[:60]}”"
    if in_reloc:
        if sponsor:
            return "eligible", f"Relocation to {country} — sponsorship/relocation mentioned"
        return "maybe", f"Onsite in {country} — visa sponsorship not mentioned"
    if country == "Unknown":
        return "maybe", "Location unclear"
    return "blocked", f"Onsite in {country} (not in your relocation list)"
