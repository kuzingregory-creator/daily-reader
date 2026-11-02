import { plainForm } from './words';

/** form → suffix edits, see scripts/build-wordlist.mjs. Loaded lazily: ~100 KB. */
let table: Record<string, string> | undefined;
let loading: Promise<void> | undefined;

export function loadLemmas(): Promise<void> {
  loading ??= import('../data/lemmas.json').then((m) => {
    table = m.default as Record<string, string>;
  });
  return loading;
}

export const lemmasReady = () => !!table;

function applyEdit(form: string, edit: string): string {
  const m = /^(\d+)(.*)$/.exec(edit)!;
  return form.slice(0, form.length - Number(m[1])) + m[2];
}

export type PosHint = 'noun' | 'verb' | 'adjective' | 'adverb' | undefined;

/** Regular endings for words the table doesn't know (rare forms like "snogging"). */
function byRules(w: string): string {
  if (w.length <= 4) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/ied$/.test(w)) return w.slice(0, -3) + 'y';
  if (/([b-df-hj-np-tv-z])\1(ing|ed)$/.test(w) && !/(ll|ss|ff|zz)(ing|ed)$/.test(w)) return w.replace(/.(ing|ed)$/, '');
  if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);
  if (/[^aeious]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * Base form of a word: "went" → "go", "children" → "child".
 * With a noun/adjective hint from context, "leaves" → "leaf", "saw" stays "saw".
 */
export function lemmaOf(token: string, hint?: PosHint): string {
  const form = plainForm(token);
  const edit = table?.[form];
  if (edit === undefined) return table ? byRules(form) : form;
  const [main, other] = edit.split('|');
  const useOther = other !== undefined && (hint === 'noun' || hint === 'adjective');
  return applyEdit(form, useOther ? other : main);
}

/** Every base form a token may stand for ("leaves" → leave, leaf). Used to find saved words in text. */
export function lemmaReadings(token: string): string[] {
  const form = plainForm(token);
  const edit = table?.[form];
  if (edit === undefined) return [table ? byRules(form) : form];
  return edit.split('|').map((e) => applyEdit(form, e));
}

/** Key of a phrase: each word in base form, "gave up" → "give up". */
export function phraseKey(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? lemmaOf(w) : w))
    .join(' ');
}

const DETERMINERS = new Set(
  'a an the this that these those my your his her its our their some any no every each many few several much one two three four five whose'.split(' '),
);
const VERB_BEFORE = new Set(
  "to will would can could shall should may might must do does did don't didn't doesn't won't can't couldn't wouldn't i you we they he she it who let's please".split(' '),
);
const DEGREE = new Set('very so too quite really rather extremely pretty more most less least'.split(' '));
const LINKING = new Set('is are was were be been being am seem seems seemed look looks looked feel feels felt become became get got'.split(' '));

/**
 * Part of speech of a word in its sentence: the guess from the word before, corrected by
 * what the word itself can be. "was sounded" → verb (passive), but "was tired" → adjective.
 */
export function contextPos(word: string, before: string | undefined): PosHint {
  const pos = posHint(word, before);
  const form = plainForm(word);
  const readings = lemmaReadings(word);
  const fromVerb = /(ed|ing)$/.test(form) && readings[0] !== form;
  if (pos === 'adjective' && fromVerb && !readings.includes(form)) return 'verb';
  if (!pos && fromVerb) return 'verb';
  return pos;
}

/** A rough part-of-speech guess from the word before: "the leaves" → noun, "to leave" → verb. */
export function posHint(word: string, before: string | undefined): PosHint {
  const w = word.toLowerCase();
  const prev = before?.toLowerCase().replace(/’/g, "'");
  if (w.endsWith('ly') && w.length > 4) return 'adverb';
  if (!prev) return undefined;
  if (DETERMINERS.has(prev)) return 'noun';
  if (VERB_BEFORE.has(prev)) return 'verb';
  if (DEGREE.has(prev)) return 'adjective';
  if (LINKING.has(prev)) return w.endsWith('ing') ? 'verb' : 'adjective';
  return undefined;
}
