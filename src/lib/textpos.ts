import { WORD_RE } from './words';

export interface TextHit {
  /** The word or phrase as written. */
  text: string;
  /** Paragraph index and character offset of `text` inside it. */
  para: number;
  offset: number;
  range: Range;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

/** Character offset of (node, offset) from the start of `container`'s text. */
function offsetIn(container: Element, node: Node, offset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return total + offset;
    total += (n as Text).data.length;
  }
  return total;
}

const inside = (r: DOMRect, x: number, y: number, pad = 4) =>
  x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

/** The word under a tap, or null when the tap was on empty space. */
export function wordAt(x: number, y: number, root: Element): TextHit | null {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !root.contains(caret.node)) return null;
  const paraEl = caret.node.parentElement?.closest<HTMLElement>('[data-i]');
  if (!paraEl) return null;
  const data = (caret.node as Text).data;
  for (const m of data.matchAll(WORD_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (caret.offset < start || caret.offset > end) continue;
    const range = document.createRange();
    range.setStart(caret.node, start);
    range.setEnd(caret.node, end);
    if (![...range.getClientRects()].some((r) => inside(r, x, y))) return null;
    return { text: m[0], para: Number(paraEl.dataset.i), offset: offsetIn(paraEl, caret.node, start), range };
  }
  return null;
}

/** The selected text (long press / drag), if it lies inside one paragraph of `root`. */
export function selectionHit(root: Element): TextHit | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const paraEl = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>('[data-i]');
  if (!paraEl || !root.contains(paraEl) || !paraEl.contains(range.endContainer)) return null;
  const raw = range.toString();
  const text = raw.trim().replace(/^[^\w]+|[^\w’']+$/g, '');
  if (!text) return null;
  const offset = offsetIn(paraEl, range.startContainer, range.startOffset) + raw.indexOf(text[0]);
  return { text, para: Number(paraEl.dataset.i), offset, range };
}

const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|i\.e|e\.g|a\.m|p\.m)\.$/i;

/** The sentence around a character offset of a paragraph. */
export function sentenceAt(text: string, offset: number): string {
  const isEnd = (i: number) => {
    if (!/[.!?…]/.test(text[i])) return false;
    let j = i + 1;
    while (j < text.length && /[”"’')\]]/.test(text[j])) j++;
    if (j < text.length && !/\s/.test(text[j])) return false;
    return !ABBREVIATIONS.test(text.slice(Math.max(0, i - 5), i + 1));
  };
  let start = offset;
  while (start > 0 && !isEnd(start - 1)) start--;
  let end = offset;
  while (end < text.length && !isEnd(end)) end++;
  while (end < text.length && /[.!?…”"’')\]]/.test(text[end])) end++;
  let s = text.slice(start, end).trim();
  if (s.length > 320) {
    const from = Math.max(0, offset - start - 150);
    s = '…' + s.slice(from, from + 300).trim() + '…';
  }
  return s;
}

/** The word right before an offset ("the" in "the leaves"). */
export function wordBefore(text: string, offset: number): string | undefined {
  const before = text.slice(Math.max(0, offset - 40), offset);
  if (/[.!?;:—–]\s*["“]?\s*$/.test(before)) return undefined;
  const m = [...before.matchAll(WORD_RE)];
  return m.length ? m[m.length - 1][0] : undefined;
}
