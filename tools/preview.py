#!/usr/bin/env python3
"""Build books/preview.html: a few paragraphs from every converted book, to eyeball the quality.

    python tools/preview.py            # then open books/preview.html
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "books"

CSS = """
:root { --bg:#f4ecd8; --fg:#3b2f22; --muted:#8a7a63; --line:#e2d6bb; }
@media (prefers-color-scheme: dark) { :root { --bg:#1d1a16; --fg:#e8dcc4; --muted:#9a8b72; --line:#3a332a; } }
body { background:var(--bg); color:var(--fg); margin:0; padding:24px 16px 64px;
       font:19px/1.6 Georgia, "Iowan Old Style", serif; }
main { max-width:640px; margin:0 auto; }
h1 { font-size:26px; margin:0 0 4px; }
h2 { font-size:22px; margin:48px 0 2px; padding-top:24px; border-top:1px solid var(--line); }
.meta, .label { color:var(--muted); font:14px/1.4 -apple-system, system-ui, sans-serif; }
.label { margin:20px 0 6px; text-transform:uppercase; letter-spacing:.06em; }
p { margin:0 0 .8em; }
details { font:14px/1.5 -apple-system, system-ui, sans-serif; color:var(--muted); margin-top:6px; }
"""


def words(paragraphs):
    return sum(len(p.split()) for p in paragraphs)


def sample(paragraphs, start, n=3, min_words=12):
    out = []
    for p in paragraphs[start:]:
        out.append(p)
        if len([q for q in out if len(q.split()) >= min_words]) >= n:
            break
    return out


def main():
    parts = []
    for f in sorted(BOOKS.glob("*.json")):
        book = json.loads(f.read_text())
        chapters = book["chapters"]
        allp = [p for c in chapters for p in c["paragraphs"]]
        mid_ch = chapters[len(chapters) // 2]
        mid_start = len(mid_ch["paragraphs"]) // 2
        parts.append(f"<h2>{html.escape(book['title'])}</h2>")
        parts.append(f"<div class=meta>{html.escape(book['author'])} · {len(chapters)} chapters · "
                     f"{len(allp):,} paragraphs · {words(allp):,} words · {f.name}</div>")
        toc = ", ".join(html.escape(c["title"]) for c in chapters)
        parts.append(f"<details><summary>Chapters</summary>{toc}</details>")
        for label, ch, start in [("Start · " + chapters[0]["title"], chapters[0], 0),
                                 ("Middle · " + mid_ch["title"], mid_ch, mid_start)]:
            parts.append(f"<div class=label>{html.escape(label)}</div>")
            parts += [f"<p>{html.escape(p)}</p>" for p in sample(ch["paragraphs"], start)]
    page = (f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>Books preview</title><style>{CSS}</style><main><h1>Books preview</h1>"
            f"<div class=meta>Daily Reader · converter check</div>{''.join(parts)}</main>")
    out = BOOKS / "preview.html"
    out.write_text(page)
    print(f"→ {out}")


if __name__ == "__main__":
    main()
