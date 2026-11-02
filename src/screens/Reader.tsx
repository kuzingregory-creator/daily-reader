import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../i18n';
import { isHeadingLike, SCENE_BREAK } from '../lib/excerpt';
import { contextPos, lemmaOf, lemmaReadings, lemmasReady, loadLemmas, phraseKey } from '../lib/lemma';
import { selectionHit, sentenceAt, wordAt, wordBefore, type TextHit } from '../lib/textpos';
import { WORD_RE } from '../lib/words';
import { chapterAt, getPosition, loadBook, savePosition, type LoadedBook } from '../store/books';
import { finishToday, getToday } from '../store/today';
import { fillMissingExplanations, learningKeys, loadWords, onWordsChange } from '../store/words';
import { Icon, Sheet, TypeControls, go } from '../components/ui';
import { WordPopover, type WordTarget } from '../components/WordPopover';

/** Paragraph text with words being learned wrapped for a dotted underline. */
function markLearning(text: string, learning: Set<string>): ComponentChildren {
  if (!learning.size) return text;
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (!lemmaReadings(m[0]).some((l) => learning.has(l))) continue;
    out.push(text.slice(last, m.index), <span class="lw">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): HighlightRegistry | undefined => (globalThis.CSS as unknown as { highlights?: HighlightRegistry })?.highlights;

/** Tint the word the popover is about (CSS Custom Highlight API; no DOM changes). */
function markActive(range: Range | null) {
  const reg = highlights();
  const H = (globalThis as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
  if (!reg || !H) return;
  if (range) reg.set('active-word', new H(range));
  else reg.delete('active-word');
}

const fillMissingExplanationsQuietly = () => fillMissingExplanations().catch(() => {});

/** Free reading renders the book in chunks of about this many words. */
const CHUNK_WORDS = 3000;
const HEADER = 56;

interface Session {
  book: LoadedBook;
  mode: 'today' | 'free';
  /** Paragraph range to show; for today it is the excerpt. */
  start: number;
  end: number;
  /** Paragraph to open at. */
  at: number;
}

export function ReaderScreen({ bookId }: { bookId: 'today' | string }) {
  const { t } = useApp();
  const [session, setSession] = useState<Session | null | 'missing'>(null);

  useEffect(() => {
    (async () => {
      if (bookId === 'today') {
        const today = await getToday();
        const plan = today.record.plan;
        if (!today.book || !plan) return setSession('missing');
        const para = today.position?.para ?? plan.start;
        const at = para >= plan.start && para < plan.end ? para : plan.start;
        setSession({ book: today.book, mode: 'today', start: plan.start, end: plan.end, at });
      } else {
        const book = await loadBook(bookId);
        if (!book) return setSession('missing');
        const n = book.paragraphs.length;
        const pos = await getPosition(bookId);
        setSession({ book, mode: 'free', start: 0, end: n, at: Math.min(pos.para, n - 1) });
      }
    })();
  }, [bookId]);

  if (session === 'missing') {
    return (
      <div class="screen">
        <p class="pad">{t('not_found')}</p>
        <button class="secondary" onClick={() => go('#/')}>{t('back')}</button>
      </div>
    );
  }
  return session ? <ReaderView key={`${session.mode}-${session.book.meta.id}`} {...session} /> : null;
}

function chunkEnd(book: LoadedBook, from: number, limit: number): number {
  let to = from;
  while (to < limit && book.cum[to] - book.cum[from] < CHUNK_WORDS) to++;
  return Math.max(to, Math.min(limit, from + 1));
}

function chunkStart(book: LoadedBook, to: number): number {
  let from = to;
  while (from > 0 && book.cum[to] - book.cum[from] < CHUNK_WORDS) from--;
  return from;
}

/** Index of the first paragraph whose bottom is below the header. */
function topParagraph(root: HTMLElement | null): number | undefined {
  if (!root) return undefined;
  const els = root.querySelectorAll<HTMLElement>('[data-i]');
  let lo = 0;
  let hi = els.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (els[mid].getBoundingClientRect().bottom > HEADER) hi = mid;
    else lo = mid + 1;
  }
  return Number(els[lo].dataset.i);
}

function ReaderView({ book, mode, start, end, at }: Session) {
  const { t } = useApp();
  const n = book.paragraphs.length;
  const [win, setWin] = useState<[number, number]>(() => (mode === 'today' ? [start, end] : [at, chunkEnd(book, at, end)]));
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<'type' | 'toc' | null>(null);
  const [top, setTop] = useState(at);
  const [scrolled, setScrolled] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scrollTo = useRef<number | null>(mode === 'today' && at > start ? at : null);
  const prependFrom = useRef<number | null>(null);
  const topRef = useRef(at);
  const jumped = useRef(false);
  const [target, setTarget] = useState<WordTarget | null>(null);
  const targetY = useRef<number | null>(null);
  const [learning, setLearning] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (scrollTo.current === null) window.scrollTo(0, 0);
  }, []);

  // Saved words and base forms load in the background; underlines appear when ready.
  useEffect(() => {
    const refresh = () => setLearning(learningKeys());
    Promise.all([loadWords(), loadLemmas()]).then(refresh);
    fillMissingExplanations().catch(() => {});
    const off = onWordsChange(refresh);
    addEventListener('online', fillMissingExplanationsQuietly);
    return () => {
      off();
      removeEventListener('online', fillMissingExplanationsQuietly);
    };
  }, []);

  const open = (hit: TextHit, kind: 'word' | 'phrase') => {
    const text = book.paragraphs[hit.para];
    const before = wordBefore(text, hit.offset);
    const pos = kind === 'word' ? contextPos(hit.text, before) : undefined;
    setTarget({
      kind,
      text: hit.text,
      key: kind === 'word' ? lemmaOf(hit.text, pos) : phraseKey(hit.text),
      pos,
      sentence: sentenceAt(text, hit.offset),
      bookId: book.meta.id,
      bookTitle: book.meta.title,
      para: hit.para,
      rect: hit.range.getBoundingClientRect(),
    });
    targetY.current = scrollY;
    markActive(hit.range);
  };

  const close = () => {
    setTarget(null);
    targetY.current = null;
    markActive(null);
    getSelection()?.removeAllRanges();
  };

  const onTap = (e: MouseEvent) => {
    if (getSelection()?.toString() || !root.current) return;
    const hit = wordAt(e.clientX, e.clientY, root.current);
    if (hit) return open(hit, 'word');
    if (target) return close();
    setChrome((c) => !c);
  };

  // Long press or drag-select: a word or a phrase ("give up", "on the other hand").
  useEffect(() => {
    let timer = 0;
    const onSelect = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!root.current) return;
        const hit = selectionHit(root.current);
        if (!hit) return;
        const words = [...hit.text.matchAll(WORD_RE)].length;
        if (words >= 1 && words <= 8) open(hit, words === 1 ? 'word' : 'phrase');
      }, 500);
    };
    document.addEventListener('selectionchange', onSelect);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelect);
    };
  }, [book]);

  useEffect(() => () => markActive(null), []);

  // Open where the reader stopped; keep the view steady when earlier text is added above.
  useLayoutEffect(() => {
    if (scrollTo.current !== null) {
      const el = root.current?.querySelector<HTMLElement>(`[data-i="${scrollTo.current}"]`);
      window.scrollTo(0, el ? el.getBoundingClientRect().top + scrollY - HEADER - 8 : 0);
      scrollTo.current = null;
    } else if (prependFrom.current !== null) {
      window.scrollBy(0, document.documentElement.scrollHeight - prependFrom.current);
      prependFrom.current = null;
    }
  }, [win]);

  useEffect(() => {
    let lastY = scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = scrollY;
        if (targetY.current !== null && Math.abs(y - targetY.current) > 60) {
          setTarget(null);
          targetY.current = null;
          markActive(null);
        }
        if (y > lastY + 6 && y > HEADER) setChrome(false);
        else if (y < lastY - 6) setChrome(true);
        lastY = y;
        const max = document.documentElement.scrollHeight - innerHeight;
        setScrolled(max > 0 ? y / max : 1);
        const i = topParagraph(root.current);
        if (i !== undefined) setTop(i);
      });
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  // Autosave the reading place: shortly after scrolling stops, and when leaving the app.
  useEffect(() => {
    topRef.current = top;
    const timer = setTimeout(() => {
      savePosition(book, top, jumped.current);
      jumped.current = false;
    }, 600);
    return () => clearTimeout(timer);
  }, [top]);
  useEffect(() => {
    const flush = () => document.visibilityState === 'hidden' && savePosition(book, topRef.current);
    document.addEventListener('visibilitychange', flush);
    addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      removeEventListener('pagehide', flush);
      savePosition(book, topRef.current);
    };
  }, []);

  // Free reading: add the next chunk before the reader gets to the bottom.
  useEffect(() => {
    if (mode !== 'free' || win[1] >= end || !sentinel.current) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && setWin(([a, b]) => [a, chunkEnd(book, b, end)]),
      { rootMargin: '1500px 0px' },
    );
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [win[1]]);

  const showEarlier = () => {
    prependFrom.current = document.documentElement.scrollHeight;
    setWin(([a, b]) => [chunkStart(book, a), b]);
  };

  const jumpTo = (para: number) => {
    jumped.current = true;
    setSheet(null);
    setWin([para, chunkEnd(book, para, end)]);
    setTop(para);
    window.scrollTo(0, 0);
  };

  const finish = async () => {
    topRef.current = end;
    await finishToday();
    go('#/');
  };

  const progress = mode === 'today' ? scrolled : book.cum[top] / (book.cum[n] || 1);
  const bookPercent = Math.round((book.cum[top] / (book.cum[n] || 1)) * 100);

  // Rebuilt only when the range or the learning list changes, not on every scroll frame.
  const items = useMemo(() => {
    const chapterTitles = new Map(book.meta.chapters.map((c) => [c.start, c.title]));
    const marks = lemmasReady() ? learning : new Set<string>();
    const out = [];
    for (let i = win[0]; i < win[1]; i++) {
      const title = chapterTitles.get(i);
      if (title) out.push(<h2 key={`c${i}`} class="chapter-title">{title}</h2>);
      const p = book.paragraphs[i];
      if (p === SCENE_BREAK) {
        out.push(<p key={i} data-i={i} class="scene" aria-label="Scene break">⁂</p>);
      } else {
        const sub = isHeadingLike(p) && /[A-Z]/.test(p) && p === p.toUpperCase();
        out.push(<p key={i} data-i={i} class={sub ? 'subhead' : undefined}>{markLearning(p, marks)}</p>);
      }
    }
    return out;
  }, [win, learning]);

  return (
    <div class="reader">
      <div class="reading-progress" style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
      <header class={`reader-head ${chrome ? '' : 'hidden'}`}>
        <button class="home-btn" onClick={() => go('#/')}>
          <Icon name="back" />
          <span>{t('today')}</span>
        </button>
        <div class="reader-title">
          <div class="title">{book.meta.title}</div>
          <div class="muted">{chapterAt(book, top)} · {bookPercent}%</div>
        </div>
        {mode === 'free' && (
          <button class="icon-btn" aria-label={t('contents')} onClick={() => setSheet('toc')}>
            <Icon name="list" />
          </button>
        )}
        <button class="icon-btn type-btn" aria-label={t('text_size')} onClick={() => setSheet('type')}>
          Aa
        </button>
      </header>

      {target && <WordPopover key={`${target.key}-${target.para}`} target={target} onClose={close} />}

      <article class="page" lang="en" ref={root} onClick={onTap}>
        {mode === 'free' && win[0] > 0 && (
          <button class="secondary earlier" onClick={(e) => { e.stopPropagation(); showEarlier(); }}>
            {t('earlier')}
          </button>
        )}
        {items}
        {mode === 'today' && (
          <div class="finish" onClick={(e) => e.stopPropagation()}>
            <p>{t('finish_text')}</p>
            <button class="primary big" onClick={finish}>{t('finish')}</button>
          </div>
        )}
        {mode === 'free' && (win[1] < end ? <div ref={sentinel} class="sentinel" /> : <p class="the-end">{t('the_end')}</p>)}
      </article>

      {sheet === 'type' && (
        <Sheet onClose={() => setSheet(null)}>
          <TypeControls />
        </Sheet>
      )}
      {sheet === 'toc' && (
        <Sheet title={t('contents')} onClose={() => setSheet(null)}>
          <div class="pick-list">
            {book.meta.chapters.map((c) => (
              <button key={c.start} class={`pick ${chapterAt(book, top) === c.title ? 'on' : ''}`} onClick={() => jumpTo(c.start)}>
                <span class="title">{c.title}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
