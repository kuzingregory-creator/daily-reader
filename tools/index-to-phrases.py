#!/usr/bin/env python3
"""Turn the index of a collocations textbook into a Daily Reader expression list.

Made for the "… Collocations in Use" index layout:

    absolute                  ← a headword line (may carry "verb"/"noun"/…)
    ~ beginner 51             ← "~" stands for the headword: "absolute beginner"
    abrupt end 51             ← a whole collocation
    achieve your goals 11, 30

The result stays private (books/ is not in git): import it on the phone with
Library → Add books. It contains only the expressions, no text from the book.

    ../venv/bin/python tools/index-to-phrases.py BOOK.pdf --first-page 162 \
        --title "Collocations in Use (Intermediate)" -o books/collocations.phrases.json
"""
import argparse
import itertools
from collections import Counter
import json
import re
from pathlib import Path

LABEL = re.compile(r"\s+(verb|noun|adjective|adverb|adj|adv|n|v)$", re.I)
REFS = re.compile(r"\s*\d+(?:\s*,\s*\d+)*\s*$")        # "51" or "11, 30" at the end
GENERIC_POSSESSIVE = {"your": "one's", "someone's": "one's", "somebody's": "one's", "his/her": "one's"}


def expand(phrase):
    """'make/take a decision' → both; '(of)' optional words are dropped; 'your' → one's."""
    phrase = re.sub(r"\([^)]*\)", " ", phrase)
    words = phrase.replace("’", "'").lower().split()
    words = [GENERIC_POSSESSIVE.get(w, w) for w in words]
    options = [w.split("/") if "/" in w and w not in GENERIC_POSSESSIVE else [w] for w in words]
    for combo in itertools.product(*options):
        text = " ".join(w for w in combo if w)
        if len(text.split()) >= 2 and re.fullmatch(r"[a-z' -]+", text):
            yield text


def parse_index(lines):
    head = ""
    for raw in lines:
        line = raw.strip()
        if not line or line.isdigit() or line.lower() == "index":
            continue
        # A wrapped line like "~ occasion 21 have": keep the entry, drop the trailer.
        m = re.match(r"^(.*?\D)\s(\d+(?:\s*,\s*\d+)*)\b(.*)$", line)
        if m and not REFS.fullmatch(" " + m.group(3).strip() or "0"):
            entry = m.group(1)
        elif REFS.search(line):
            entry = REFS.sub("", line)
        else:
            head = LABEL.sub("", line)           # a headword line
            continue
        entry = entry.strip()
        if "~" in entry:
            if not head:
                continue
            entry = entry.replace("~", head)
        yield from expand(entry)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--first-page", type=int, required=True, help="first index page (1-based)")
    ap.add_argument("--title", required=True)
    ap.add_argument("-o", "--output", required=True)
    args = ap.parse_args()

    import fitz

    doc = fitz.open(args.pdf)
    pages = [p.get_text().splitlines() for p in doc.pages(args.first_page - 1, doc.page_count)]
    # Running headers/footers (the book title, a copyright line) repeat on many pages: not headwords.
    seen = Counter(l.strip() for page in pages for l in set(page))
    running = {l for l, n in seen.items() if n > len(pages) * 0.3 and not REFS.search(l)}
    lines = [l for page in pages for l in page if l.strip() not in running]
    phrases = sorted(set(parse_index(lines)))
    out = {"type": "daily-reader-phrases", "title": args.title, "phrases": phrases}
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"{len(phrases)} expressions → {args.output}")


if __name__ == "__main__":
    main()
