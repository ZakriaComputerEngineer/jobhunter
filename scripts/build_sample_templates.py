"""Build fictional resume templates safe to include in the public repository."""
from pathlib import Path
import json
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from jh.render import extract  # noqa: E402


def add_bullet(document, text):
    paragraph = document.add_paragraph()
    properties = paragraph._p.get_or_add_pPr()
    numbering = OxmlElement("w:numPr")
    level = OxmlElement("w:ilvl")
    level.set(qn("w:val"), "0")
    number_id = OxmlElement("w:numId")
    number_id.set(qn("w:val"), "1")
    numbering.extend((level, number_id))
    properties.append(numbering)
    paragraph.add_run(text)


def add_heading(document, text):
    paragraph = document.add_paragraph()
    run = paragraph.add_run(text)
    run.bold = True
    run.font.color.rgb = RGBColor(0x0D, 0x2B, 0x4E)
    run.font.size = Pt(11)


def add_role(document, title, company, dates):
    paragraph = document.add_paragraph()
    run = paragraph.add_run(f"{title} | {company}")
    run.bold = True
    paragraph.add_run(f" | {dates}")


def build(path, headline, skills):
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.45)
    section.bottom_margin = Inches(0.45)
    section.left_margin = Inches(0.65)
    section.right_margin = Inches(0.65)
    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(9)

    name = document.add_paragraph()
    name.alignment = WD_ALIGN_PARAGRAPH.CENTER
    name_run = name.add_run("YOUR NAME")
    name_run.bold = True
    name_run.font.size = Pt(19)

    title = document.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.add_run(headline)

    contact = document.add_paragraph()
    contact.alignment = WD_ALIGN_PARAGRAPH.CENTER
    contact.add_run("you@example.com | +1 555 010 0000 | City, Country | github.com/example")

    add_heading(document, "SUMMARY")
    document.add_paragraph("Software engineer with experience building reliable services, data products, and practical automation. Replace this fictional content with your own verified experience before applying.")

    add_heading(document, "EXPERIENCE")
    add_role(document, "Software Engineer", "Example Labs", "2023–Present")
    add_bullet(document, "Built maintainable services and automated repeatable workflows with measurable quality checks.")
    add_bullet(document, "Collaborated with product and engineering partners to deliver documented, tested features.")
    add_role(document, "Engineering Intern", "Sample Systems", "2022–2023")
    add_bullet(document, "Created internal tools and improved test coverage for a fictional sample project.")

    add_heading(document, "EDUCATION")
    add_role(document, "BSc, Computer Science", "Sample University", "2022")

    add_heading(document, "SKILLS")
    document.add_paragraph(skills)

    properties = document.core_properties
    properties.title = "JobHunter fictional resume template"
    properties.subject = "Replace all sample content before use"
    properties.author = "JobHunter contributors"
    properties.last_modified_by = "JobHunter contributors"
    properties.keywords = "sample, fictional, resume"
    properties.comments = "Contains no real personal information."
    path.parent.mkdir(parents=True, exist_ok=True)
    document.save(path)


def main():
    variants = {
        "auto": ("Software Engineer | Automation", "Python, JavaScript, SQL, APIs, testing, browser automation"),
        "ml": ("Machine Learning Engineer", "Python, machine learning, data pipelines, evaluation, APIs, SQL"),
    }
    for stem, (headline, skills) in variants.items():
        path = ROOT / "templates" / f"{stem}.docx"
        build(path, headline, skills)
        base_path = path.with_suffix(".base.json")
        base_path.write_text(json.dumps(extract(path), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Created {path.relative_to(ROOT)} and {base_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
