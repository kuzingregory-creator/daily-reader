#!/usr/bin/env python3
"""Collect English multi-word expressions from Wiktionary (kaikki.org extracts).

Streams kaikki.org's per-part-of-speech files and keeps only entries with two or more
words: phrasal verbs (give up), idioms (make up one's mind), set phrases (of course,
on the other hand). Nothing big is saved: the result is scripts/data/phrases.tsv
(expression, part of speech, short gloss); literal-only entries such as "go to" are left out. Wiktionary text is CC BY-SA 4.0.

    python3 scripts/fetch-phrases.py           # takes a few minutes: ~600 MB is streamed
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

POS = ["phrase", "prep_phrase", "prep", "conj", "adv", "verb"]
URL = "https://kaikki.org/dictionary/English/pos-{0}/kaikki.org-dictionary-English-by-pos-{0}.jsonl"
OUT = Path(__file__).resolve().parent / "data" / "phrases.tsv"

DROP_TAGS = {"obsolete", "archaic", "rare", "dialectal", "historical", "nonstandard", "misspelling",
             "pronunciation-spelling", "eye-dialect", "Scotland", "Ireland", "Northern-England",
             "Australia", "New-Zealand", "South-Africa", "India", "Singapore", "Philippines",
             "Nigeria", "Caribbean", "Jamaica", "Hawaii", "Appalachia", "Southern-US", "AAVE"}
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z' -]*[A-Za-z']$")


def usable(entry):
    word = entry.get("word", "")
    if " " not in word or not WORD_RE.match(word) or len(word.split()) > 6:
        return None
    if word[0].isupper():                       # names, titles
        return None
    for sense in entry.get("senses", []):
        tags = set(sense.get("tags", []))
        if tags & DROP_TAGS or "form-of" in tags or "alt-of" in tags:
            continue
        glosses = sense.get("glosses") or []
        # "Used other than figuratively or idiomatically: see go, to." — a literal sense, not an idiom.
        if glosses and glosses[-1].startswith(("Used other than", "Used in phrasal verbs")):
            continue
        if glosses:
            return word, glosses[-1].replace("\t", " ").replace("\n", " ")[:160]
    return None


def main():
    found = {}
    for pos in POS:
        n = kept = 0
        with urllib.request.urlopen(URL.format(pos), timeout=60) as r:
            for line in r:
                n += 1
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                hit = usable(entry)
                if hit and hit[0] not in found:
                    found[hit[0]] = (pos, hit[1])
                    kept += 1
        print(f"{pos:12} {n:>8} entries → {kept:>6} expressions", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as f:
        for word in sorted(found):
            pos, gloss = found[word]
            f.write(f"{word}\t{pos}\t{gloss}\n")
    print(f"{len(found)} expressions → {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
