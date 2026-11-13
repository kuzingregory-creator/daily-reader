import { lemmaReadings, loadLemmas, posHint } from './lemma';
import { WORD_RE } from './words';

/**
 * Fixed expressions (idioms, phrasal verbs, set phrases) found around a tapped word.
 * The list comes from Wiktionary (scripts/fetch-phrases.py → scripts/build-phrases.mjs).
 */

type Slot =
  | { kind: 'word'; lemmas: Set<string> }
  | { kind: 'poss' } // one's, someone's → my, her, John's…
  | { kind: 'refl' } // oneself → myself, themselves…
  | { kind: 'np' } // someone, something → 1–4 words
  | { kind: 'gap' }; // a separable phrasal verb: turn [the light] off → 0–3 words

export interface Pattern {
  /** Dictionary form: "make up one's mind". */
  text: string;
  slots: Slot[];
  /** A verb phrase: its first word must be used as a verb ("the light off" is not "light off"). */
  verb: boolean;
  /** Shown on tap (see worthShowing); saved expressions are underlined either way. */
  useful: boolean;
}

export interface PhraseMatch {
  /** Dictionary form, used as the key when the expression is learned. */
  phrase: string;
  /** Character ranges in the paragraph of the words that belong to the expression. */
  parts: [number, number][];
  /** From the first to the last of them: "made up her mind". */
  start: number;
  end: number;
}

interface Token {
  text: string;
  start: number;
  end: number;
  lemmas: string[];
  /** Punctuation before the next word: an open slot or a gap may not run across it. */
  breakAfter: boolean;
}

const POSSESSIVES = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their', "one's", 'whose']);
const REFLEXIVES = new Set(['myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves', 'oneself']);
const PARTICLES = new Set(['up', 'down', 'off', 'on', 'out', 'in', 'away', 'back', 'over', 'through', 'about', 'around', 'round', 'along', 'by', 'apart', 'aside', 'together', 'forward', 'across']);

const SEPARABLE = new Set(['up', 'down', 'off', 'out', 'away', 'back', 'over', 'around', 'round', 'apart', 'aside', 'together', 'forward']);

const norm = (w: string) => w.toLowerCase().replace(/’/g, "'");

/** Grammar words: a pair of these alone ("to the", "do you", "is all") is not worth showing. */
const FUNCTION = new Set(
  ("a an the this that these those my your his her its our their i you he she it we they me him us them one " +
    "be am is are was were been being have has had do does did will would can could shall should may might must " +
    "to of for on in at by with from as and or but so there what who all not no if than then " +
    "up down out off over about").split(' '),
);
/** Common verbs that pair with almost anything; with a preposition they are rarely an idiom ("go to"). */
const LIGHT = new Set('go get make take come give put let know think say see like want need look keep feel'.split(' '));

/**
 * Is this expression worth showing when a word of it is tapped? Two words need a real word
 * among them ("in fact", "take place") or must be a phrasal verb ("give up"); longer ones need
 * at least one word that is not grammar.
 */
function worthShowing(fixed: string[]): boolean {
  const base = (w: string) => lemmaReadings(w)[0] ?? w;
  const content = fixed.filter((w) => !FUNCTION.has(w) && !FUNCTION.has(base(w)));
  if (fixed.length >= 3) return content.length > 0;
  if (fixed.length !== 2) return false;
  if (content.some((w) => !LIGHT.has(base(w)))) return true;
  return LIGHT.has(base(fixed[0])) && PARTICLES.has(fixed[1]);
}

/** "make up one's mind" → word(make) word(up) poss word(mind). Verb phrases may split around a particle. */
export function compile(text: string, isVerb = false): Pattern {
  const words = norm(text).split(/\s+/).filter(Boolean);
  const slots: Slot[] = words.map((w) => {
    if (w === "one's" || w === "someone's" || w === "somebody's") return { kind: 'poss' };
    if (w === 'oneself') return { kind: 'refl' };
    if (w === 'someone' || w === 'somebody' || w === 'something' || w === 'sb' || w === 'sth') return { kind: 'np' };
    // A base form matches all its forms (make → made); a fixed form only itself ("have someone going").
    const readings = lemmaReadings(w);
    return { kind: 'word', lemmas: new Set(readings[0] === w ? [w, ...readings] : [w]) };
  });
  // "for someone", "something to": an open slot at the edge would match anything — leave it out.
  while (slots.length && slots[0].kind === 'np') slots.shift();
  while (slots.length && slots[slots.length - 1].kind === 'np') slots.pop();
  // "turn off" also matches "turn the light off" (only adverb particles: "in"/"on" are mostly prepositions).
  if (isVerb && slots.length === 2 && SEPARABLE.has(words[words.length - 1])) slots.splice(1, 0, { kind: 'gap' });
  const fixed = words.filter((w) => !["one's", "someone's", "somebody's", 'oneself', 'someone', 'somebody', 'something', 'sb', 'sth'].includes(w));
  return { text: norm(text), slots, verb: isVerb, useful: worthShowing(fixed) };
}

export function tokenize(text: string): Token[] {
  const matches = [...text.matchAll(WORD_RE)];
  return matches.map((m, i) => {
    const end = m.index! + m[0].length;
    const between = text.slice(end, matches[i + 1]?.index ?? text.length);
    return { text: m[0], start: m.index!, end, lemmas: [norm(m[0]), ...lemmaReadings(m[0])], breakAfter: /[,;:()—–"“”]/.test(between) };
  });
}

interface Hit {
  /** Tokens that belong to the expression (fixed words and filled slots), in order. */
  used: number[];
  /** Of those, the ones matched by fixed words. */
  fixed: number[];
}

/** Tries to match the pattern starting exactly at token `i`. */
function matchAt(p: Pattern, tokens: Token[], i: number): Hit | null {
  const used: number[] = [];
  const fixed: number[] = [];
  const step = (s: number, t: number): boolean => {
    if (s === p.slots.length) return true;
    const slot = p.slots[s];
    if (slot.kind === 'gap' || slot.kind === 'np') {
      const [min, max] = slot.kind === 'gap' ? [0, 3] : [1, 3];
      for (let n = min; n <= max && t + n <= tokens.length; n++) {
        // "look for and — in": no running across punctuation.
        if (n > 0 && tokens.slice(Math.max(0, t - 1), t + n).some((tok) => tok.breakAfter)) break;
        const mark = used.length;
        if (slot.kind === 'np') for (let k = 0; k < n; k++) used.push(t + k);
        if (step(s + 1, t + n)) return true;
        used.length = mark;
      }
      return false;
    }
    if (t >= tokens.length) return false;
    const tok = tokens[t];
    const w = norm(tok.text);
    const ok =
      slot.kind === 'poss'
        ? POSSESSIVES.has(w) || /'s$/.test(w)
        : slot.kind === 'refl'
          ? REFLEXIVES.has(w)
          : tok.lemmas.some((l) => slot.lemmas.has(l));
    if (!ok) return false;
    used.push(t);
    if (slot.kind === 'word') fixed.push(t);
    if (step(s + 1, t + 1)) return true;
    used.pop();
    if (slot.kind === 'word') fixed.pop();
    return false;
  };
  return step(0, i) ? { used: [...used], fixed: [...fixed] } : null;
}

function toMatch(p: Pattern, tokens: Token[], used: number[]): PhraseMatch {
  const parts = used.map((k) => [tokens[k].start, tokens[k].end] as [number, number]);
  return { phrase: p.text, parts, start: parts[0][0], end: parts[parts.length - 1][1] };
}

// ------------------------------------------------------------------ the expression list

let index: Map<string, Pattern[]> | undefined;
let loading: Promise<void> | undefined;

/** Loads the expression list (~100 KB) and indexes it by the base form of each fixed word. */
export function loadPhrases(): Promise<void> {
  // Patterns compare base forms, so the base-form table must be there first.
  loading ??= loadLemmas().then(() => import('../data/phrases.json')).then((m) => {
    const data = m.default as { verb: string[]; other: string[] };
    index = new Map();
    const add = (text: string, isVerb: boolean) => {
      const p = compile(text, isVerb);
      if (!p.useful) return;
      for (const slot of p.slots) {
        if (slot.kind !== 'word') continue;
        for (const l of slot.lemmas) {
          const list = index!.get(l) ?? [];
          if (!list.includes(p)) list.push(p);
          index!.set(l, list);
        }
      }
    };
    data.verb.forEach((t) => add(t, true));
    data.other.forEach((t) => add(t, false));
  });
  return loading;
}

export const phrasesReady = () => !!index;

/**
 * The longest known expression in the sentence `range` of a paragraph that has the word
 * at `offset` among its fixed words ("mind" in "she made up her mind" → "make up one's mind").
 */
export function phraseAt(paragraph: string, offset: number, range: [number, number]): PhraseMatch | null {
  if (!index) return null;
  const tokens = tokenize(paragraph.slice(range[0], range[1])).map((t) => ({ ...t, start: t.start + range[0], end: t.end + range[0] }));
  const at = tokens.findIndex((t) => offset >= t.start && offset < t.end);
  if (at < 0) return null;
  const candidates = new Set(tokens[at].lemmas.flatMap((l) => index!.get(l) ?? []));
  let best: { p: Pattern; hit: Hit } | null = null;
  for (const p of candidates) {
    for (let i = Math.max(0, at - 8); i <= at; i++) {
      const hit = matchAt(p, tokens, i);
      if (!hit || !hit.fixed.includes(at)) continue;
      if (p.verb && i > 0 && posHint(tokens[i].text, tokens[i - 1].text) === 'noun') continue;
      const better = !best || hit.fixed.length > best.hit.fixed.length ||
        (hit.fixed.length === best.hit.fixed.length && p.text.length > best.p.text.length);
      if (better) best = { p, hit };
      break;
    }
  }
  return best ? toMatch(best.p, tokens, best.hit.used) : null;
}

/** The pattern for a saved expression: from the list when it is there (keeps "turn off" separable). */
export function patternFor(key: string): Pattern {
  const first = compile(key).slots.find((s) => s.kind === 'word');
  const known = first?.kind === 'word' ? [...first.lemmas].flatMap((l) => index?.get(l) ?? []) : [];
  return known.find((p) => p.text === key) ?? compile(key);
}

/** Every occurrence of the given expressions in a paragraph (to underline the ones being learned). */
export function findAll(paragraph: string, patterns: Pattern[]): PhraseMatch[] {
  if (!patterns.length) return [];
  const tokens = tokenize(paragraph);
  const out: PhraseMatch[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const p of patterns) {
      const hit = matchAt(p, tokens, i);
      if (hit) out.push(toMatch(p, tokens, hit.used));
    }
  }
  return out;
}
