import { beforeAll, describe, expect, it } from 'vitest';
import { parseSimpleWiktionary, pickSenses, stripWiki } from './explain';
import { addPersonalPhrases, compile, findAll, loadPhrases, phraseAt } from './phrases';
import { sentenceRange } from './textpos';

beforeAll(() => loadPhrases());

/** The expression found when tapping `word` in `text`. */
function tap(text: string, word: string) {
  const offset = text.indexOf(word);
  const m = phraseAt(text, offset, sentenceRange(text, offset));
  return m && { phrase: m.phrase, surface: text.slice(m.start, m.end) };
}

describe('fixed expressions', () => {
  it('finds an idiom with a possessive slot, in any form', () => {
    expect(tap('She finally made up her mind and left.', 'mind')).toEqual({
      phrase: "make up one's mind",
      surface: 'made up her mind',
    });
  });

  it('finds phrasal verbs, also split around the particle', () => {
    expect(tap('The meeting took place in 1953.', 'took')?.phrase).toBe('take place');
    expect(tap('Please turn the light off now.', 'off')).toEqual({ phrase: 'turn off', surface: 'turn the light off' });
  });

  it('finds set phrases and multi-word prepositions', () => {
    expect(tap('On the other hand, he was right.', 'hand')?.phrase).toBe('on the other hand');
    expect(tap('We stayed in spite of the rain.', 'spite')?.phrase).toBe('in spite of');
  });

  it('stays quiet when the word is used on its own', () => {
    expect(tap('I bought a red book yesterday.', 'book')).toBeNull();
  });

  it('does not reach into the next sentence', () => {
    expect(tap('He gave. Up the hill they went.', 'gave')?.phrase).not.toBe('give up');
  });

  it('adds the reader’s own collocations and prefers them', async () => {
    expect(tap('There was heavy rain all night.', 'rain')).toBeNull();
    await addPersonalPhrases(['heavy rain', 'make a decision']);
    expect(tap('There was heavy rain all night.', 'rain')?.phrase).toBe('heavy rain');
    expect(tap('She made a quick decision.', 'decision')).toBeNull();
    expect(tap('She made a decision at last.', 'decision')?.phrase).toBe('make a decision');
    await addPersonalPhrases(['have a break', 'wind dies down']);
    expect(tap('We had a break at noon.', 'break')?.phrase).toBe('have a break');
    expect(tap('It had a broken leg.', 'broken')).toBeNull();
    expect(tap('By evening the wind died down.', 'wind')?.phrase).toBe('wind dies down');
  });

  it('underlines a learned expression wherever it appears', () => {
    const found = findAll('They gave it up at last, and later gave up again.', [compile('give up', true)]);
    expect(found.map((m) => m.parts.length)).toEqual([2, 2]);
  });
});

describe('Simple English Wiktionary', () => {
  const wikitext = [
    '== Pronunciation ==',
    '* {{IPA|/ˈdrɪzəl/}}',
    '== Noun ==',
    '{{noun|uncountable}}',
    "# '''Drizzle''' means light [[rain]].",
    "#: ''It was a gray day with drizzle.''",
    '== Verb ==',
    "# If it is '''drizzling''', [[water]] is falling from the [[sky|skies]].",
  ].join('\n');

  it('strips wiki markup', () => {
    expect(stripWiki("If it is '''drizzling''', [[water]] falls {{tl|x}} from the [[sky|skies]].")).toBe(
      'If it is drizzling, water falls from the skies.',
    );
  });

  it('turns a page into simple definitions with an example', () => {
    const ex = pickSenses(parseSimpleWiktionary('drizzle', wikitext), 'verb', 'drizzle', 'Simple English Wiktionary')!;
    expect(ex.senses[0]).toEqual({ pos: 'verb', definition: 'If it is drizzling, water is falling from the skies.' });
    expect(ex.phonetic).toBe('/ˈdrɪzəl/');
    const noun = pickSenses(parseSimpleWiktionary('drizzle', wikitext), 'noun', 'drizzle')!;
    expect(noun.senses[0].definition).toBe('Drizzle means light rain.');
    expect(noun.example).toBe('It was a gray day with drizzle.');
  });
});
