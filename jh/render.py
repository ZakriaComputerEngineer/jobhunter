#!/usr/bin/env python3
"""Resume renderer that preserves the original .docx layout.

  extract:  python render.py extract <template.docx> <out.json>
  build:    python render.py build <template.docx> <content.json> <out.docx> [--pdf]

content.json schema:
{
  "headline": "text of the centred title line under the name",
  "sections": [
    {"heading": "SUMMARY", "blocks": [
        {"t": "para",   "text": "plain text with **bold** spans"},
        {"t": "header", "text": "**AI Engineer | Company** | dates | place", "proto": <idx>},
        {"t": "bullet", "text": "..."},
        {"t": "raw",    "src": <paragraph index in template>},      # kept verbatim (hyperlinks)
        {"t": "spacer", "src": <paragraph index in template>}
    ]}
  ]
}
"""
import copy, json, re, subprocess, sys, os
import docx
from docx.oxml.ns import qn

HEADING_COLOR = "0D2B4E"


def _runs(p):
    return p._p.findall(qn("w:r"))


def _is_bold(r):
    rpr = r.find(qn("w:rPr"))
    if rpr is None:
        return False
    b = rpr.find(qn("w:b"))
    return b is not None and b.get(qn("w:val")) not in ("0", "false")


def _text_md(p):
    """Paragraph -> text with **bold** markup (top-level runs only)."""
    out, cur_b, buf = [], None, ""
    for r in _runs(p):
        t = "".join(x.text or "" for x in r.findall(qn("w:t")))
        if not t:
            continue
        b = _is_bold(r)
        if cur_b is None or b == cur_b:
            buf += t
        else:
            out.append((cur_b, buf)); buf = t
        cur_b = b
    if buf:
        out.append((cur_b, buf))
    s = ""
    for b, t in out:
        if b and t.strip():
            lead = t[: len(t) - len(t.lstrip())]; trail = t[len(t.rstrip()):]
            s += f"{lead}**{t.strip()}**{trail}"
        else:
            s += t
    return s


def _classify(p):
    x = p._p
    has_num = x.find(qn("w:pPr")) is not None and x.find(qn("w:pPr")).find(qn("w:numPr")) is not None
    has_link = x.find(qn("w:hyperlink")) is not None
    text = p.text.strip()
    if not text and not has_link:
        return "spacer"
    rs = [r for r in _runs(p) if "".join(t.text or "" for t in r.findall(qn("w:t"))).strip()]
    if rs and all(_is_bold(r) for r in rs):
        rpr = rs[0].find(qn("w:rPr"))
        col = rpr.find(qn("w:color")) if rpr is not None else None
        if col is not None and col.get(qn("w:val")).upper() == HEADING_COLOR:
            return "heading"
    if has_link:
        return "raw"
    if has_num:
        return "bullet"
    if rs and _is_bold(rs[0]):
        return "header"
    return "para"


def extract(template):
    d = docx.Document(template)
    P = d.paragraphs
    first_head = next(i for i, p in enumerate(P) if _classify(p) == "heading")
    head_lines = [i for i in range(first_head) if P[i].text.strip()]
    headline_idx = head_lines[1]  # line after the name
    data = {"template": os.path.basename(template), "headline_idx": headline_idx,
            "headline": P[headline_idx].text.strip(), "sections": []}
    sec = None
    for i in range(first_head, len(P)):
        k = _classify(P[i])
        if k == "heading":
            sec = {"heading": P[i].text.strip(), "src": i, "blocks": []}
            data["sections"].append(sec)
        elif k in ("spacer", "raw"):
            sec["blocks"].append({"t": k, "src": i, **({"preview": P[i].text[:90]} if k == "raw" else {})})
        else:
            sec["blocks"].append({"t": k, "text": _text_md(P[i]).rstrip("\n"), "proto": i})
    return data


def _set_text(p_el, md_text):
    """Replace runs of paragraph element with md_text, cloning normal/bold run formatting."""
    runs = p_el.findall(qn("w:r"))
    text_runs = [r for r in runs if r.find(qn("w:t")) is not None]
    normal = next((r for r in text_runs if not _is_bold(r)), None)
    bold = next((r for r in text_runs if _is_bold(r)), None)
    trailing_br = [r for r in runs if r.find(qn("w:br")) is not None and r.find(qn("w:t")) is None]
    for el in list(p_el):
        if el.tag in (qn("w:r"), qn("w:proofErr"), qn("w:hyperlink"), qn("w:bookmarkStart"), qn("w:bookmarkEnd")):
            p_el.remove(el)

    def mk(base, t, want_bold):
        if base is None:
            base = normal if normal is not None else bold
        r = copy.deepcopy(base)
        for c in list(r):
            if c.tag != qn("w:rPr"):
                r.remove(c)
        rpr = r.find(qn("w:rPr"))
        if rpr is None:
            rpr = r.makeelement(qn("w:rPr"), {}); r.insert(0, rpr)
        for tag in ("w:b", "w:bCs"):
            e = rpr.find(qn(tag))
            if want_bold and e is None:
                rpr.append(rpr.makeelement(qn(tag), {}))
            if not want_bold and e is not None:
                rpr.remove(e)
        te = r.makeelement(qn("w:t"), {}); te.text = t
        te.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        r.append(te)
        return r

    parts = re.split(r"(\*\*.+?\*\*)", md_text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            p_el.append(mk(bold, part[2:-2], True))
        else:
            p_el.append(mk(normal, part, False))
    for br in trailing_br:
        p_el.append(copy.deepcopy(br))


def build(template, content, out_docx):
    d = docx.Document(template)
    P = d.paragraphs
    base = extract(template)
    protos = {}
    for s in base["sections"]:
        for b in s["blocks"]:
            protos.setdefault(b["t"], b.get("proto", b.get("src")))
    heading_proto = base["sections"][0]["src"]
    src_el = {i: p._p for i, p in enumerate(P)}

    # headline
    if content.get("headline"):
        _set_text(src_el[base["headline_idx"]], content["headline"])

    body = d.element.body
    first_sec = base["sections"][0]["src"]
    anchor = src_el[first_sec].getprevious()
    new_els = []
    for s in content["sections"]:
        h = copy.deepcopy(src_el[s.get("src", heading_proto)])
        _set_text(h, f"**{s['heading']}**"); new_els.append(h)
        for b in s["blocks"]:
            t = b["t"]
            if t in ("raw", "spacer"):
                el = copy.deepcopy(src_el[b["src"]])
                if t == "raw" and b.get("text"):
                    # replace only the leading (non-hyperlink) run text, keep link
                    rs = el.findall(qn("w:r"))
                    if rs:
                        ts = rs[0].findall(qn("w:t"))
                        ts[0].text = b["text"]
                        for extra in rs[1:]:
                            el.remove(extra)
                new_els.append(el)
            else:
                proto = b.get("proto", protos.get(t))
                el = copy.deepcopy(src_el[proto])
                _set_text(el, b["text"])
                new_els.append(el)
    # remove old section paragraphs
    for i in range(first_sec, len(P)):
        body.remove(src_el[i])
    for el in reversed(new_els):
        anchor.addnext(el)
    d.save(out_docx)


def _soffice():
    import shutil
    for c in [shutil.which("soffice"), shutil.which("libreoffice"),
              r"C:\Program Files\LibreOffice\program\soffice.exe",
              r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"]:
        if c and os.path.exists(c):
            return c
    return None


def to_pdf(docx_path, out_pdf=None):
    """DOCX -> PDF. Windows: Microsoft Word (via docx2pdf / COM) first, then LibreOffice."""
    docx_path = os.path.abspath(docx_path)
    out_pdf = os.path.abspath(out_pdf or os.path.splitext(docx_path)[0] + ".pdf")
    errors = []
    if os.name == "nt":
        try:
            import pythoncom, win32com.client  # noqa
            pythoncom.CoInitialize()
            word = win32com.client.DispatchEx("Word.Application")
            word.Visible = False
            word.DisplayAlerts = 0
            try:
                doc = word.Documents.Open(docx_path, ReadOnly=True)
                doc.SaveAs2(out_pdf, FileFormat=17)  # wdFormatPDF
                doc.Close(False)
            finally:
                word.Quit()
            if os.path.exists(out_pdf):
                return out_pdf
        except Exception as e:  # pragma: no cover
            errors.append(f"Word: {e}")
    so = _soffice()
    if so:
        outdir = os.path.dirname(out_pdf)
        subprocess.run([so, "--headless", "--convert-to", "pdf", "--outdir", outdir, docx_path],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        produced = os.path.join(outdir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
        if produced != out_pdf and os.path.exists(produced):
            os.replace(produced, out_pdf)
        if os.path.exists(out_pdf):
            return out_pdf
    raise RuntimeError("PDF conversion failed. Install Microsoft Word or LibreOffice. " + "; ".join(errors))


def docx_text(path):
    d = docx.Document(path)
    return "\n".join(p.text for p in d.paragraphs)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "extract":
        json.dump(extract(sys.argv[2]), open(sys.argv[3], "w"), indent=1, ensure_ascii=False)
    elif cmd == "build":
        build(sys.argv[2], json.load(open(sys.argv[3])), sys.argv[4])
        if "--pdf" in sys.argv:
            print(to_pdf(sys.argv[4]))
