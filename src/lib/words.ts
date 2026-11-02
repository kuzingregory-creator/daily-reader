import common from '../data/common-words.json';

/** Word forms of the 3000 most frequent English lemmas (see scripts/build-wordlist.mjs). */
const COMMON = new Set<string>(common as string[]);

export const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

export function countWords(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(WORD_RE)) n++;
  return n;
}

const NEGATIONS: Record<string, string> = { "can't": 'can', "won't": 'will', "shan't": 'shall', "ain't": 'be' };

/** Lowercase form without contractions: "Don’t" → "do", "he’s" → "he". */
export function plainForm(token: string): string {
  const w = token.toLowerCase().replace(/’/g, "'");
  if (NEGATIONS[w]) return NEGATIONS[w];
  if (w.endsWith("n't")) return w.slice(0, -3);
  const i = w.indexOf("'");
  return i > 0 && !COMMON.has(w) ? w.slice(0, i) : w;
}

export function isCommon(form: string): boolean {
  return COMMON.has(form);
}

function startsSentence(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (/[\s“"‘'(\[—–-]/.test(c)) continue;
    return /[.!?…:]/.test(c);
  }
  return true;
}

/**
 * Share of uncommon words in a text: not among the top‑3000 lemmas and not known
 * by the user. Names (capitalised in mid‑sentence) are left out of the count.
 */
export function unknownShare(paragraphs: string[], isKnown: (form: string) => boolean = () => false): number {
  const tokens: { form: string; capital: boolean }[] = [];
  const names = new Set<string>();
  for (const p of paragraphs) {
    for (const m of p.matchAll(WORD_RE)) {
      const raw = m[0];
      const form = plainForm(raw);
      const capital = /^[A-Z][a-z]/.test(raw);
      if (capital && !COMMON.has(form) && !startsSentence(p, m.index!)) names.add(form);
      tokens.push({ form, capital });
    }
  }
  let counted = 0;
  let unknown = 0;
  for (const { form, capital } of tokens) {
    if (capital && names.has(form)) continue;
    counted++;
    if (!COMMON.has(form) && !isKnown(form)) unknown++;
  }
  return counted ? unknown / counted : 0;
}
