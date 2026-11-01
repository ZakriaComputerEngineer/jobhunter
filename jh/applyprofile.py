"""Application profile: answers the apply-assistant reuses on every form, plus a learned Q&A bank.
Stored locally in data/profile.json and data/qa_bank.json (never leaves this PC)."""
import json, os, re
from datetime import datetime
from . import db

PROFILE_PATH = os.path.join(db.DATA, "profile.json")
QA_PATH = os.path.join(db.DATA, "qa_bank.json")

YN = ["Yes", "No"]
DECLINE = "Decline to self-identify"
# (section, [(key, label, type, options, default)]) — personal fields intentionally start blank.
SCHEMA = [
    ("Personal", [
        ("first_name", "First name", "text", None, ""),
        ("middle_name", "Middle name", "text", None, ""),
        ("last_name", "Last name", "text", None, ""),
        ("preferred_name", "Preferred name", "text", None, ""),
        ("email", "Email", "email", None, ""),
        ("phone_country_code", "Phone country code", "text", None, ""),
        ("phone", "Phone (without country code)", "text", None, ""),
        ("phone_full", "Phone (full, international)", "text", None, ""),
        ("date_of_birth", "Date of birth (YYYY-MM-DD) — only filled when a form insists", "date", None, ""),
        ("pronouns", "Pronouns", "text", None, ""),
    ]),
    ("Address", [
        ("address_line1", "Street address", "text", None, ""),
        ("address_line2", "Address line 2", "text", None, ""),
        ("city", "City", "text", None, ""),
        ("state", "State / province", "text", None, ""),
        ("postal_code", "Postal / ZIP code", "text", None, ""),
        ("country", "Country", "text", None, ""),
        ("location_display", "Location (as one line)", "text", None, ""),
        ("nationality", "Nationality / citizenship", "text", None, ""),
        ("timezone", "Time zone", "text", None, ""),
    ]),
    ("Links", [
        ("linkedin", "LinkedIn URL", "url", None, ""),
        ("github", "GitHub URL", "url", None, ""),
        ("portfolio", "Portfolio / personal website", "url", None, ""),
        ("researchgate", "ResearchGate", "url", None, ""),
        ("google_scholar", "Google Scholar", "url", None, ""),
        ("kaggle", "Kaggle", "url", None, ""),
    ]),
    ("Work & experience", [
        ("current_company", "Current employer", "text", None, ""),
        ("current_title", "Current job title", "text", None, ""),
        ("years_experience", "Total years of professional experience", "number", None, ""),
        ("years_ml", "Years of AI / ML experience", "number", None, ""),
        ("notice_period", "Notice period", "text", None, "1 month"),
        ("earliest_start", "Earliest start date / availability", "text", None, "1 month after offer"),
        ("current_salary_pkr", "Current gross salary — PKR per month (number)", "number", None, ""),
        ("disclose_current", "Share current salary on forms?", "select", ["Only when the field is required", "Always", "Never (I'll type it myself)"], "Only when the field is required"),
        ("expected_pkr", "Expected salary for jobs in Pakistan — PKR per month (number)", "number", None, ""),
        ("expected_remote_usd", "Expected pay for remote jobs with foreign companies — USD per month (number)", "number", None, ""),
        ("expected_abroad_text", "Expected salary for relocation jobs abroad (text answer; the job's posted range is used when known)", "text", None,
         "Negotiable — in line with the market rate for this role and location"),
        ("work_preference", "Preferred work mode", "select", ["Remote", "Hybrid", "Onsite", "Any"], "Any"),
        ("willing_to_relocate", "Willing to relocate?", "select", YN, "Yes"),
        ("willing_to_travel", "Willing to travel?", "select", YN, "Yes"),
    ]),
    ("Education", [
        ("highest_degree", "Highest degree", "text", None, ""),
        ("degree_name", "Degree name", "text", None, ""),
        ("field_of_study", "Field of study / major", "text", None, ""),
        ("university", "University", "text", None, ""),
        ("grad_start_year", "Start year", "number", None, ""),
        ("grad_year", "Graduation year", "number", None, ""),
        ("gpa", "GPA / CGPA", "text", None, ""),
    ]),
    ("Work authorisation", [
        ("auth_home", "Authorised to work in Pakistan?", "select", YN, "Yes"),
        ("auth_other", "Authorised to work in the US / UK / EU / Australia / Canada etc. (without a visa)?", "select", YN, "No"),
        ("needs_sponsorship", "Will you require visa sponsorship (for jobs outside Pakistan)?", "select", YN, "Yes"),
        ("over_18", "Are you 18 or older?", "select", YN, "Yes"),
        ("security_clearance", "Do you hold a security clearance?", "select", YN, "No"),
        ("previously_employed", "Previously worked for the company you're applying to?", "select", YN, "No"),
        ("non_compete", "Bound by a non-compete?", "select", YN, "No"),
    ]),
    ("Voluntary self-identification (EEO) — your choice; defaults decline", [
        ("gender", "Gender", "select", ["Male", "Female", "Non-binary", DECLINE], DECLINE),
        ("race_ethnicity", "Race / ethnicity", "select", ["Asian", "South Asian", "White", "Black or African American", "Hispanic or Latino", "Middle Eastern or North African", "Two or more races", DECLINE], DECLINE),
        ("hispanic_latino", "Hispanic or Latino?", "select", ["Yes", "No", DECLINE], DECLINE),
        ("veteran_status", "Protected veteran status", "select", ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", DECLINE], DECLINE),
        ("disability_status", "Disability status", "select", ["No, I do not have a disability", "Yes, I have a disability", DECLINE], DECLINE),
        ("sexual_orientation", "Sexual orientation", "select", ["Heterosexual", "Gay or lesbian", "Bisexual", DECLINE], DECLINE),
        ("transgender", "Do you identify as transgender?", "select", ["Yes", "No", DECLINE], DECLINE),
    ]),
    ("Common questions", [
        ("how_heard", "How did you hear about us?", "text", None, "LinkedIn"),
        ("referral_name", "Referred by (name) — leave blank if none", "text", None, ""),
        ("languages", "Languages", "text", None, "English (fluent), Urdu (native)"),
        ("english_level", "English proficiency", "select", ["Native or bilingual", "Fluent", "Professional", "Intermediate"], "Fluent"),
        ("why_company", "Generic “Why do you want to work here?” answer ({company} / {role} are replaced)", "textarea", None,
         "I build production AI systems end to end — LLM agents, RAG and automation that cut real operating costs — and {company}'s work on {role} is exactly where I want to apply that experience."),
        ("about_me", "Short professional summary (for “Tell us about yourself”)", "textarea", None, ""),
        ("cover_letter", "Cover letter template ({company}, {role}, {date} are replaced)", "textarea", None,
         "Dear Hiring Team at {company},\n\nI'm applying for the {role} position. My background aligns with the role, and I would welcome the opportunity to discuss how I can contribute.\n\nThank you for your consideration."),
    ]),
    ("Accounts & assistant behaviour", [
        ("account_email", "Email to use for job-site accounts", "email", None, ""),
        ("account_password", "Password to use when creating job-site accounts (stored only on this PC; leave blank to type it yourself)", "password", None, ""),
        ("auto_submit", "Click the final Submit button automatically?", "select", ["No — pause so I review first", "Yes — submit when everything is filled"], "No — pause so I review first"),
        ("tick_consents", "Tick privacy-policy / data-processing consent boxes automatically?", "select", YN, "Yes"),
        ("upload_cover_letter", "Upload a cover-letter PDF when a form asks for one?", "select", YN, "Yes"),
    ]),
]
KEYS = {f[0]: f for _, fs in SCHEMA for f in fs}


def load():
    p = {k: f[4] for k, f in KEYS.items()}
    if os.path.exists(PROFILE_PATH):
        try:
            p.update(json.load(open(PROFILE_PATH, encoding="utf-8")))
        except Exception:
            pass
    return p


def save(data):
    cur = load()
    for k, v in (data or {}).items():
        if k in KEYS:
            cur[k] = v
    os.makedirs(db.DATA, exist_ok=True)
    json.dump(cur, open(PROFILE_PATH, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return cur


def schema():
    return [{"section": s, "fields": [{"key": k, "label": l, "type": t, "options": o} for k, l, t, o, _ in fs]} for s, fs in SCHEMA]


def completeness():
    p = load()
    important = ["first_name", "last_name", "email", "phone", "city", "country", "linkedin", "address_line1", "postal_code",
                 "current_salary_pkr", "expected_pkr", "expected_remote_usd", "gender", "race_ethnicity", "veteran_status", "disability_status"]
    important = [k for k in important if k in KEYS]          # never crash if a field is renamed
    missing = [KEYS[k][1] for k in important if not str(p.get(k) or "").strip()]
    return {"filled": len(important) - len(missing), "total": len(important), "missing": missing}


# ---------------- learned answers ----------------
def norm_q(q):
    q = re.sub(r"[*:?]+", " ", (q or "").lower())
    return re.sub(r"\s+", " ", q).strip()


def qa_load():
    if os.path.exists(QA_PATH):
        try:
            return json.load(open(QA_PATH, encoding="utf-8"))
        except Exception:
            pass
    return []


def qa_save(items):
    os.makedirs(db.DATA, exist_ok=True)
    json.dump(items, open(QA_PATH, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def qa_add(question, answer, kind="text"):
    items = qa_load()
    nq = norm_q(question)
    for it in items:
        if it["q_norm"] == nq:
            it.update(a=answer, kind=kind, updated=datetime.now().isoformat(timespec="seconds"))
            break
    else:
        items.append({"q": question.strip()[:300], "q_norm": nq, "a": answer, "kind": kind,
                      "updated": datetime.now().isoformat(timespec="seconds")})
    qa_save(items)
    return items


def qa_delete(q_norm):
    qa_save([i for i in qa_load() if i["q_norm"] != q_norm])
