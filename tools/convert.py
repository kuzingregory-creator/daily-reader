#!/usr/bin/env python3
"""Convert a PDF, EPUB or TXT book into clean Daily Reader JSON.

Output format:
    {"title": ..., "author": ..., "chapters": [{"title": ..., "paragraphs": [...]}]}

Usage:
    python tools/convert.py BOOK.pdf [-o books/book.json] [--title T] [--author A] [--skip REGEX ...]
    python tools/convert.py --all     # every book listed in tools/library.json

Run with the Lute venv (PyMuPDF + ebooklib):  ~/Desktop/Lute/venv/bin/python tools/convert.py --all
"""
import argparse
import json
import re
import statistics
import sys
import unicodedata
import warnings
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "tools" / "library.json"
OUT_DIR = ROOT / "books"

# Front/back matter that is not worth reading as a daily excerpt.
SKIP_TITLES = re.compile(
    r"^\s*(cover|half ?title|title( page)?|copyright( page)?|dedication|(table of )?contents( page)?|epigraph|cover page"
    r"|acknowledge?ments?|(list of )?illustrations|index|notes|endnotes|footnotes|bibliography"
    r"|glossary|.*['’]s glossary|resources|credits|photo credits|about the (author|authors|publisher)"
    r"|also by .*|praise( for .*)?|keep reading|further confessions.*|what should you read next\??|about the book)\s*$",
    re.I,
)
# Promotion left in some files: a short paragraph built around a web address
# ("www.headline.co.uk", "You can download this chapter at: …"), or a note in another language.
AD_LINK = re.compile(r"https?://|www\.|\b[\w-]+\.(?:com|net|org|ru|co\.uk|io|info)\b(?:/\S*)?", re.I)
FOREIGN = re.compile(r"[А-Яа-яЁё]")
LIST_RE = re.compile(r"^\s*(\d{1,3}[.)]|[•●▪◦■□–-])\s")
TERMINAL = tuple(".!?…:;”\"’)")
SCENE_RE = re.compile(r"^[\s*#~•⁂·_.-]{1,12}$")
SMALL_WORDS = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"}
LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "­": "", "​": "", "﻿": ""}


# ---------------------------------------------------------------- text helpers

def clean(text):
    for k, v in LIGATURES.items():
        text = text.replace(k, v)
    text = text.replace(" ", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def norm_key(text):
    """Comparison key: lowercase letters/digits only."""
    text = unicodedata.normalize("NFKD", text.lower())
    return re.sub(r"[^a-z0-9]+", "", text)


def title_case(title):
    if title != title.upper():
        return title
    words = title.lower().split()
    return " ".join(w if i and w in SMALL_WORDS else w.capitalize() for i, w in enumerate(words))


def nice_chapter_title(title):
    title = clean(title)
    if re.fullmatch(r"\d+", title) or re.fullmatch(NUMBER_WORD, title, re.I):
        return f"Chapter {title.capitalize()}"
    return title_case(title)


def finish_chapter(title, paragraphs):
    out = []
    for p in paragraphs:
        p = clean(p)
        if FOREIGN.search(p) or (AD_LINK.search(p) and len(p.split()) <= 25):
            continue
        p = re.sub(r"^([“\"‘]?[A-Z]) ([A-Z]{2,})\b", r"\1\2", p)      # drop cap split off: "W HEN" → "WHEN"
        p = re.sub(r"(?<=[\w.,!?;:”’)])[*†‡]+(?=\s|$)", "", p)       # footnote marks
        if not p:
            continue
        if SCENE_RE.fullmatch(p):
            if out and out[-1] != "* * *" and re.search(r"[*#~•⁂·]", p):
                out.append("* * *")
            continue
        out.append(p)
    while out and out[-1] == "* * *":
        out.pop()
    return {"title": nice_chapter_title(title), "paragraphs": out}


# ---------------------------------------------------------------- PDF

class Line:
    __slots__ = ("text", "x0", "x1", "y0", "y1", "size", "fw", "block", "page", "kind",
                 "bleft", "bright", "blines")

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def pdf_raw_lines(doc):
    """All horizontal text lines with geometry, per page, in reading order."""
    import fitz

    flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP
    pages = []
    for pno, page in enumerate(doc):
        lines = []
        blocks = [b for b in page.get_text("rawdict", flags=flags)["blocks"] if b["type"] == 0]
        blocks.sort(key=lambda b: (round(b["bbox"][1]), b["bbox"][0]))
        for bno, b in enumerate(blocks):
            for ln in b["lines"]:
                if abs(ln["dir"][1]) > 0.01:      # rotated text
                    continue
                spans = [s for s in ln["spans"] if s["chars"]]
                if not spans:
                    continue
                chars = []
                for s in spans:
                    sup = bool(s["flags"] & 1)        # superscript: footnote marks
                    chars += [(c["c"], c["bbox"], s["size"]) for c in s["chars"]
                              if not (sup and (c["c"].isdigit() or c["c"] in "*†‡"))]
                vis = [c for c in chars if not c[0].isspace()]
                if not vis:
                    continue
                sizes = Counter(round(c[2], 1) for c in vis)
                # width of the first word: used to tell "line was full" from "paragraph ended"
                fw_end = vis[0][1][2]
                for c in chars[chars.index(vis[0]):]:
                    if c[0].isspace():
                        break
                    fw_end = c[1][2]
                lines.append(Line(
                    text="".join(c[0] for c in chars), x0=vis[0][1][0], x1=vis[-1][1][2],
                    y0=ln["bbox"][1], y1=ln["bbox"][3],
                    size=sizes.most_common(1)[0][0], fw=fw_end - vis[0][1][0],
                    block=(pno, bno), kind="body",
                ))
                lines[-1].page = pno
        pages.append(lines)
    return pages


def pdf_lines(doc):
    pages = pdf_raw_lines(doc)
    all_lines = [ln for p in pages for ln in p]

    size_chars = Counter()
    for ln in all_lines:
        size_chars[ln.size] += len(ln.text)
    body = size_chars.most_common(1)[0][0]

    body_lines = [ln for ln in all_lines if abs(ln.size - body) < 0.6]
    x1s = sorted(ln.x1 for ln in body_lines)
    right_edge = x1s[int(len(x1s) * 0.95)]
    left_edge = Counter(round(ln.x0) for ln in body_lines).most_common(1)[0][0]
    leads = [b.y0 - a.y0 for p in pages for a, b in zip(p, p[1:])
             if a.block == b.block and abs(a.size - body) < 0.6 and 0 < b.y0 - a.y0 < body * 3]
    leading = statistics.median(leads) if leads else body * 1.2

    # Running headers / footers: same text (digits ignored) in the top/bottom band of many pages.
    h = doc[0].rect.height
    band = Counter()
    for p in pages:
        seen = set()
        for ln in p:
            if ln.y0 < h * 0.1 or ln.y1 > h * 0.9:
                seen.add(re.sub(r"\d+", "#", norm_key(ln.text)))
        band.update(seen)
    min_repeat = max(4, len(pages) // 8)
    running = {k for k, n in band.items() if n >= min_repeat and k not in ("", "#")}

    for p in pages:
        keep = []
        for ln in p:
            t = ln.text.strip()
            edge = ln.y0 < h * 0.1 or ln.y1 > h * 0.9
            if re.fullmatch(r"\d{1,4}|[ivxlcdm]{1,6}", t, re.I) and (edge or ln.size <= body * 1.1):
                continue                                    # page number
            if edge and re.sub(r"\d+", "#", norm_key(t)) in running:
                continue                                    # running header/footer
            if ln.size < body * 0.8:
                continue                                    # captions, figure labels, footnotes
            if len(t) == 1 and t.isalpha() and t.isupper() and ln.size >= body * 1.5:
                ln.kind = "dropcap"
            elif ln.size >= body * 1.1:
                ln.kind = "head"
            keep.append(ln)
        # ALL-CAPS lines standing alone are section headings set in body size.
        for ln in keep:
            t = ln.text.strip()
            letters = re.sub(r"[^A-Za-z]", "", t)
            alone = sum(1 for x in keep if x.block == ln.block) <= 2
            if ln.kind == "body" and alone and len(letters) >= 4 and letters.isupper() and t[0] not in "“\"‘'":
                ln.kind = "head"
        p[:] = keep
        # Block geometry: the left edge of a block reveals first-line indents,
        # its right edge is the measure for "this line was full".
        by_block = {}
        for ln in keep:
            by_block.setdefault(ln.block, []).append(ln)
        for blk in by_block.values():
            left, right = min(x.x0 for x in blk), max(x.x1 for x in blk)
            for x in blk:
                x.bleft, x.bright, x.blines = left, right, len(blk)
    return pages, dict(body=body, right=right_edge, left=left_edge, leading=leading)


def join_lines(a, b, m):
    """Does line b continue the paragraph that line a belongs to?"""
    if a.kind != b.kind:
        return False
    if a.kind == "head":
        return a.page == b.page and b.y0 - a.y0 < a.size * 1.6 and abs(a.size - b.size) < 0.6
    at, bt = a.text.strip(), b.text.strip()
    if LIST_RE.match(bt):
        return False
    # A chapter heading on a line of its own ("Twenty-four") never joins a paragraph.
    if any(CHAPTER_LINE.match(t) and t[:1].isupper() for t in (at, bt)):
        return False
    if at.endswith(("“", "-", "—")):
        return True
    first = re.match(r"[“\"‘'(]*(\w)", bt)
    if first and first.group(1).islower():
        return True                                         # sentence goes on
    if re.search(r"[.!?…—–-]”$", at) and bt.startswith("“"):
        return False                                        # a new line of dialogue
    if a.page == b.page and b.y0 - a.y0 > m["leading"] * 1.45:
        return False                                        # blank line / paragraph spacing
    if b.x0 - b.bleft > m["body"] * 0.8:
        return False                                        # first-line indent
    right = a.bright if a.blines >= 3 else m["right"]
    gap = right - a.x1
    return gap < b.fw + m["body"] * 0.55                    # next word would not have fitted


def pdf_paragraphs(lines, m):
    """Rebuild paragraphs from a sequence of lines. Returns [(kind, size, text)]."""
    paras = []
    dropcap = ""
    dc_page, dc_bottom = -1, 0
    prev = None
    for ln in lines:
        if ln.kind == "dropcap":
            dropcap = ln.text.strip()
            dc_page, dc_bottom = ln.page, ln.y1
            continue
        if ln.page == dc_page and ln.y0 < dc_bottom:
            ln.x0 = ln.bleft                                # lines wrapped around a drop cap are not indented
        text = ln.text.strip()
        if dropcap:
            text, dropcap = dropcap + text, ""
            paras.append([ln.kind, ln.size, text])
        elif prev is not None and paras and join_lines(prev, ln, m):
            cur = paras[-1][2]
            sep = "" if cur.endswith(("-", "—", "/", "“")) else " "
            paras[-1][2] = cur + sep + text
        else:
            paras.append([ln.kind, ln.size, text])
        prev = ln
    return paras


def convert_pdf(path):
    import fitz

    doc = fitz.open(path)
    pages, m = pdf_lines(doc)
    toc = [(lvl, t, p - 1) for lvl, t, p in doc.get_toc() if p >= 1]
    meta = doc.metadata or {}
    if not toc:
        paras = pdf_paragraphs([ln for p in pages for ln in p], m)
        chapters = split_by_headings([p[2] for p in paras], Path(path).stem)
        return meta.get("title") or Path(path).stem, meta.get("author") or "", chapters
    chapters = []
    for i, (lvl, title, start) in enumerate(toc):
        end = toc[i + 1][2] if i + 1 < len(toc) else len(pages)
        if end <= start:
            end = start + 1 if i + 1 == len(toc) or toc[i + 1][2] != start else start
        lines = [ln for p in pages[start:end] for ln in p]
        paras = pdf_paragraphs(lines, m)
        # Drop the chapter heading itself (number, title, big display type).
        tkey = norm_key(title)
        while paras:
            kind, size, text = paras[0]
            k = norm_key(text)
            if re.fullmatch(r"\d{1,3}", text.strip()) or (k and k in tkey) or size >= m["body"] * 1.3:
                paras.pop(0)
            else:
                break
        chapters.append((title, [p[2] for p in paras]))
    return meta.get("title") or Path(path).stem, meta.get("author") or "", chapters


# ---------------------------------------------------------------- EPUB

BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "dd", "dt"]


def load_epub_ebooklib(path):
    """(title, author, [(name, html bytes)] in reading order, {name: toc title})."""
    from ebooklib import epub

    book = epub.read_epub(str(path), options={"ignore_ncx": False})
    titles = {}

    def walk(items):
        for it in items:
            node, kids = (it if isinstance(it, tuple) else (it, []))
            href = getattr(node, "href", None)
            if href:
                titles.setdefault(href.split("#")[0], node.title)
            walk(kids)

    walk(book.toc)
    docs = []
    for idref, _ in book.spine:
        item = book.get_item_with_id(idref)
        if item is not None:
            docs.append((item.get_name(), item.get_content()))

    def meta(name):
        vals = book.get_metadata("DC", name)
        return ", ".join(v[0] for v in vals) if vals else ""

    return meta("title"), meta("creator"), docs, titles


def load_epub_zip(path):
    """The same, read straight from the zip: for EPUBs ebooklib rejects (e.g. an OPF without
    its XML namespace)."""
    import posixpath
    import zipfile
    from urllib.parse import unquote

    from bs4 import BeautifulSoup

    z = zipfile.ZipFile(path)
    container = BeautifulSoup(z.read("META-INF/container.xml"), "xml")
    opf_path = container.find("rootfile")["full-path"]
    base = posixpath.dirname(opf_path)
    opf = BeautifulSoup(z.read(opf_path), "xml")

    def local(tag_name):                        # match "item", "opf:item" alike
        return lambda t: t.name and t.name.split(":")[-1] == tag_name

    manifest = {}
    for item in opf.find_all(local("item")):
        manifest[item.get("id")] = (posixpath.normpath(posixpath.join(base, unquote(item.get("href", "")))),
                                    item.get("media-type", ""), item.get("properties", ""))
    docs = []
    for ref in opf.find_all(local("itemref")):
        entry = manifest.get(ref.get("idref"))
        if entry and entry[0] in z.namelist():
            docs.append((entry[0], z.read(entry[0])))

    titles = {}
    ncx = next((m for m in manifest.values() if m[1] == "application/x-dtbncx+xml"), None)
    nav = next((m for m in manifest.values() if "nav" in m[2].split()), None)
    if ncx and ncx[0] in z.namelist():
        soup = BeautifulSoup(z.read(ncx[0]), "xml")
        for point in soup.find_all(local("navPoint")):
            label, content = point.find(local("text")), point.find(local("content"))
            if label and content:
                href = posixpath.normpath(posixpath.join(posixpath.dirname(ncx[0]), unquote(content["src"].split("#")[0])))
                titles.setdefault(href, label.get_text(" ", strip=True))
    elif nav and nav[0] in z.namelist():
        soup = BeautifulSoup(z.read(nav[0]), "lxml")
        for a in soup.select("nav a[href]"):
            href = posixpath.normpath(posixpath.join(posixpath.dirname(nav[0]), unquote(a["href"].split("#")[0])))
            titles.setdefault(href, a.get_text(" ", strip=True))

    def meta(name):
        return ", ".join(t.get_text(strip=True) for t in opf.find_all(local(name)))

    return meta("title"), meta("creator"), docs, titles


def convert_epub(path):
    from bs4 import BeautifulSoup

    warnings.filterwarnings("ignore")
    try:
        title_, author, docs, titles = load_epub_ebooklib(path)
    except Exception:
        title_, author, docs, titles = load_epub_zip(path)

    chapters = []
    for name, content in docs:
        soup = BeautifulSoup(content, "lxml")
        for tag in soup(["script", "style", "sup", "figcaption"]):
            tag.decompose()
        for tag in soup.find_all(class_=re.compile(r"caption", re.I)):
            tag.decompose()                           # photo captions
        for br in soup.find_all("br"):
            br.replace_with(" ")
        paras = []
        for el in soup.find_all(BLOCK_TAGS):
            if el.find(BLOCK_TAGS):                   # container; its children are visited instead
                continue
            # Inline text as a browser shows it: a drop cap in its own <span> stays part of the word.
            text = clean(el.get_text(""))
            text = re.sub(r" ([,.;:!?’”)])", r"\1", text)
            if text:
                paras.append(text)
        title = titles.get(name)
        if title is None:
            if chapters:                              # untitled spine part: continuation
                chapters[-1][1].extend(paras)
            continue
        tkey = norm_key(title)
        while paras and norm_key(paras[0]) and norm_key(paras[0]) in tkey:
            paras.pop(0)
        chapters.append((title, paras))

    return title_ or Path(path).stem, author, chapters


# ---------------------------------------------------------------- TXT

NUMBER_WORD = (r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
               r"sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?")
# A line that starts a chapter in a book without a table of contents: "Chapter 3", "Part Two", "Three", "12".
CHAPTER_LINE = re.compile(
    rf"^(?:(?:chapter|part|book)\s+(?:[0-9]+|[ivxlcdm]+|{NUMBER_WORD})\b.{{0,60}}|{NUMBER_WORD}|[0-9]{{1,3}}"
    r"|prologue|epilogue|introduction|afterword|foreword|preface|acknowledge?ments?)$",
    re.I,
)


def split_by_headings(paras, fallback_title):
    """Cut a flat list of paragraphs into chapters at heading lines. A short title on the next
    line joins its heading ("Chapter 1: Fellow Travellers"). Text before the first heading is
    title pages, blurbs and contents, and is left out."""
    chapters = []
    title, current = None, []
    i = 0
    while i < len(paras):
        b = clean(paras[i])
        if CHAPTER_LINE.match(b):
            chapters.append((title, current))
            title, current = b, []
            nxt = clean(paras[i + 1]) if i + 1 < len(paras) else ""
            if nxt and len(nxt) < 60 and not nxt.endswith(TERMINAL) and not CHAPTER_LINE.match(nxt):
                title, i = f"{b}: {nxt}", i + 1
        else:
            current.append(b)
        i += 1
    chapters.append((title, current))
    if len(chapters) > 2:
        return chapters[1:]
    return [(fallback_title, [p for _, ps in chapters for p in ps])]


def convert_txt(path):
    """Plain text: one paragraph per line, or paragraphs hard-wrapped and separated by blank lines.
    Chapters start at lines like "Chapter 3" (a short title on the next line joins it)."""
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    long_lines = sum(1 for l in lines if len(l) > 200)
    if long_lines > len(lines) * 0.05:
        blocks = [l.strip() for l in lines]                     # a paragraph per line
    else:
        blocks = [" ".join(b.split()) for b in re.split(r"\n\s*\n", text)]   # hard-wrapped
    blocks = [b for b in blocks if b and not re.search(r"[А-Яа-яЁё]", b)]  # drop other-language notes

    name = Path(path).stem.replace("_", " ")
    return name, "", split_by_headings(blocks, name)


# ---------------------------------------------------------------- main

def fix_openings(raw):
    """Chapter openings set in drop cap + small caps, judged by the book's own vocabulary:
    "IHAD BARELY HAD time" → "I had barely had time" ("ihad" appears nowhere else, "had" does),
    "I DIDN'T SEE RAYMOND on Monday" → "I didn't see Raymond on Monday" (Raymond is mostly
    written with a capital in this book), "REVEILLE was sounded" → "Reveille was sounded"."""
    words = [w for _, paras in raw for p in paras for w in re.findall(r"[A-Za-z’']+", p)]
    lower = Counter(w.lower() for w in words)
    exact = Counter(words)

    def is_caps(w):
        return re.fullmatch(r"[“\"‘(]?[A-Z][A-Z’'-]+[,.;:!?”\")]*", w) is not None

    def fix(p):
        m = re.match(r"^([“\"‘]?)([IA])([A-Za-z]+)\b", p)
        if m and lower[(m.group(2) + m.group(3)).lower()] <= 1 and lower[m.group(3).lower()] >= 3:
            p = f"{m.group(1)}{m.group(2)} {m.group(3)}{p[m.end():]}"
        ws = p.split(" ")
        first = next((i for i in range(min(12, len(ws)))
                      if is_caps(ws[i]) and (i == 0 or (i + 1 < len(ws) and is_caps(ws[i + 1])))), None)
        if first is None:
            return p
        i = first
        while i < len(ws) and (is_caps(ws[i]) or ws[i] in ("I", "A")):
            bare = re.sub(r"[^A-Za-z’']", "", ws[i])
            titled = bare[:1] + bare[1:].lower()
            capital = (i == 0 or re.search(r"[.!?]”?$", ws[i - 1])
                       or bare == "I" or exact[titled] > exact[bare.lower()])
            low = ws[i].lower()
            ws[i] = re.sub(r"[a-z]", lambda c: c.group().upper(), low, count=1) if capital else low
            i += 1
        return " ".join(ws)

    return [(title, [fix(paras[0])] + paras[1:] if paras else paras) for title, paras in raw]


def convert(path, title=None, author=None, skip=()):
    path = Path(path).expanduser()
    ext = path.suffix.lower()
    if ext == ".pdf":
        t, a, raw = convert_pdf(path)
    elif ext == ".epub":
        t, a, raw = convert_epub(path)
    elif ext == ".txt":
        t, a, raw = convert_txt(path)
    else:
        raise SystemExit(f"Unsupported file type: {path}")
    raw = fix_openings(raw)
    skip_res = [re.compile(s, re.I) for s in skip]
    chapters, skipped = [], []
    for ctitle, paras in raw:
        if SKIP_TITLES.match(ctitle) or any(r.search(ctitle) for r in skip_res):
            skipped.append(ctitle)
            continue
        ch = finish_chapter(ctitle, paras)
        if sum(len(p.split()) for p in ch["paragraphs"]) < 25:
            if ch["paragraphs"]:
                skipped.append(ctitle + " (too short)")
            continue
        chapters.append(ch)
    book = {"title": title or clean(t), "author": author or clean(a), "chapters": chapters}
    return book, skipped


def report(book, skipped, out):
    paras = [p for c in book["chapters"] for p in c["paragraphs"]]
    words = [len(p.split()) for p in paras]
    no_end = sum(1 for p in paras if not p.endswith(TERMINAL) and p != "* * *" and len(p.split()) > 6)
    print(f"✓ {book['title']} — {book['author']}")
    print(f"  {len(book['chapters'])} chapters, {len(paras)} paragraphs, {sum(words):,} words → {out}")
    print(f"  longest paragraph: {max(words)} words; paragraphs without final punctuation: {no_end}")
    if skipped:
        print("  skipped: " + "; ".join(skipped))


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="PDF, EPUB or TXT file")
    ap.add_argument("-o", "--output", help="output JSON (default: books/<title>.json)")
    ap.add_argument("--title")
    ap.add_argument("--author")
    ap.add_argument("--skip", action="append", default=[], help="regex of chapter titles to drop")
    ap.add_argument("--all", action="store_true", help=f"convert every book in {LIBRARY.name}")
    args = ap.parse_args()

    if args.all:
        lib = json.loads(LIBRARY.read_text())
        src_dir = Path(lib["source_dir"]).expanduser()
        jobs = [dict(input=src_dir / b["file"], title=b.get("title"), author=b.get("author"),
                     skip=b.get("skip", []), output=OUT_DIR / f"{b['id']}.json") for b in lib["books"]]
    elif args.input:
        jobs = [dict(input=Path(args.input), title=args.title, author=args.author, skip=args.skip,
                     output=Path(args.output) if args.output else None)]
    else:
        ap.print_help()
        return 1

    for job in jobs:
        book, skipped = convert(job["input"], job["title"], job["author"], job["skip"])
        out = job["output"] or OUT_DIR / f"{slug(book['title'])}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(book, ensure_ascii=False, indent=1))
        report(book, skipped, out.relative_to(ROOT) if out.is_relative_to(ROOT) else out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
