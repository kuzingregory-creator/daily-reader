import { beforeAll, describe, expect, it } from 'vitest';
import { myMemory, pickSenses } from './explain';
import { contextPos, lemmaOf, lemmaReadings, loadLemmas, phraseKey, posHint } from './lemma';
import { sentenceAt, wordBefore } from './textpos';

beforeAll(() => loadLemmas());

describe('base forms', () => {
  it('handles irregular and regular forms', () => {
    expect(lemmaOf('went')).toBe('go');
    expect(lemmaOf('Children')).toBe('child');
    expect(lemmaOf('running')).toBe('run');
    expect(lemmaOf('interesting')).toBe('interesting');
    expect(lemmaOf('was')).toBe('be');
  });

  it('uses context for words with two readings', () => {
    expect(lemmaOf('leaves', 'verb')).toBe('leave');
    expect(lemmaOf('leaves', 'noun')).toBe('leaf');
    expect(lemmaReadings('leaves')).toEqual(['leave', 'leaf']);
  });

  it('falls back to rules for rare forms', () => {
    expect(lemmaOf('snogging')).toBe('snog');
  });

  it('keys phrases by the base form of the first word', () => {
    expect(phraseKey('Gave up')).toBe('give up');
  });

  it('guesses the part of speech from the word before', () => {
    expect(posHint('leaves', 'the')).toBe('noun');
    expect(posHint('leave', 'to')).toBe('verb');
    expect(posHint('quickly', 'ran')).toBe('adverb');
    expect(posHint('tired', 'was')).toBe('adjective');
  });

  it('tells a passive verb from an adjective', () => {
    expect(contextPos('sounded', 'was')).toBe('verb');
    expect(contextPos('tired', 'was')).toBe('adjective');
    expect(contextPos('stopped', 'sound')).toBe('verb');
  });
});

describe('text around a tap', () => {
  const p = 'Mr. Brown came in. “Where are the leaves?” she asked. Nobody knew.';

  it('cuts out the sentence', () => {
    expect(sentenceAt(p, p.indexOf('leaves'))).toBe('“Where are the leaves?”');
    expect(sentenceAt(p, p.indexOf('Brown'))).toBe('Mr. Brown came in.');
    expect(sentenceAt(p, p.indexOf('knew'))).toBe('Nobody knew.');
  });

  it('finds the word before, but not across a sentence end', () => {
    expect(wordBefore(p, p.indexOf('leaves'))).toBe('the');
    expect(wordBefore(p, p.indexOf('Nobody'))).toBeUndefined();
  });
});

describe('Free Dictionary answers', () => {
  const run = [
    {
      word: 'run',
      phonetics: [{}, { text: '/ɹʌn/' }],
      meanings: [
        { partOfSpeech: 'verb', definitions: [{ definition: 'To run.' }] },
        {
          partOfSpeech: 'noun',
          definitions: [
            { definition: 'Act or instance of running, of moving rapidly using the feet.', example: 'I just got back from my morning run.' },
            { definition: 'A pleasure trip.' },
          ],
        },
        {
          partOfSpeech: 'verb',
          definitions: [
            { definition: 'To move swiftly.' },
            { definition: '(intransitive) To go at a pace faster than a walk.' },
            { definition: 'Plural of something.' },
          ],
        },
      ],
    },
  ];

  it('skips stubs and prefers the part of speech from context', () => {
    const verb = pickSenses(run, 'verb', 'run')!;
    expect(verb.senses.map((s) => s.definition)).toEqual(['To move swiftly.', 'To go at a pace faster than a walk.']);
    expect(verb.phonetic).toBe('/ɹʌn/');
    const noun = pickSenses(run, 'noun', 'run')!;
    expect(noun.senses[0].pos).toBe('noun');
    expect(noun.example).toBe('I just got back from my morning run.');
  });

  it('returns null when nothing useful is left', () => {
    expect(pickSenses([{ word: 'x', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'Plural of y.' }] }] }], undefined, 'x')).toBeNull();
  });
});

describe('MyMemory answers', () => {
  it('collects distinct Russian translations', async () => {
    const mm = myMemory(async () => ({
      responseStatus: 200,
      responseData: { translatedText: 'Листья' },
      matches: [{ translation: 'листья', quality: 74 }, { translation: 'уходит', quality: 70 }, { translation: 'leaves', quality: 90 }],
    }));
    expect(await mm.translate('leaves')).toEqual(['Листья', 'уходит']);
  });
});
