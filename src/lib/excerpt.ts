export interface ExcerptOptions {
  /** Target length in words. */
  min: number;
  max: number;
  /** How far outside [min, max] a chapter or scene end may be to win. */
  slack: number;
  /** Never leave a book tail shorter than this for another day. */
  minTail: number;
}

export const EXCERPT: ExcerptOptions = { min: 1200, max: 1500, slack: 300, minTail: 300 };

export const SCENE_BREAK = '* * *';
const TERMINAL = /[.!?…:;”"’)]$/;

/** Short line without final punctuation: a heading, a list label, a date line. */
export function isHeadingLike(p: string): boolean {
  return p === SCENE_BREAK || (!TERMINAL.test(p) && p.split(/\s+/).length <= 12);
}

/** Where an excerpt starting at `start` should begin (skips a leading scene mark). */
export function excerptStart(paragraphs: string[], start: number): number {
  while (start < paragraphs.length && paragraphs[start] === SCENE_BREAK) start++;
  return start;
}

/**
 * End (exclusive) of the excerpt that begins at `start`. Cuts only between paragraphs.
 * Prefers a chapter end, then a scene break, within ±slack of [min, max] words;
 * otherwise the first paragraph end past `min`. Never ends right after a heading.
 */
export function excerptEnd(
  paragraphs: string[],
  words: number[],
  chapterStarts: Set<number>,
  start: number,
  o: ExcerptOptions = EXCERPT,
): number {
  const n = paragraphs.length;
  if (start >= n) return n;
  let cum = 0;
  let best = -1;
  let bestScore = Infinity;
  let i = start;
  for (; i < n; i++) {
    cum += words[i];
    const end = i + 1;
    if (cum >= o.min - o.slack) {
      const atChapter = end === n || chapterStarts.has(end);
      const atScene = paragraphs[end] === SCENE_BREAK;
      if (atChapter || !isHeadingLike(paragraphs[i])) {
        const dist = cum < o.min ? o.min - cum : cum > o.max ? cum - o.max : 0;
        const rank = atChapter ? 0 : atScene ? 1 : 2;
        const outOfSlack = dist > o.slack;
        const score = (outOfSlack ? 3 : rank) * 10000 + dist;
        if (score < bestScore) {
          best = end;
          bestScore = score;
        }
      }
    }
    if (cum > o.max + o.slack) break;
  }
  if (best < 0) best = Math.min(n, i + 1);

  let tail = 0;
  for (let j = best; j < n && tail < o.minTail; j++) tail += words[j];
  if (tail < o.minTail) best = n;
  return best;
}
