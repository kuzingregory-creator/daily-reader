import { useState } from 'preact/hooks';
import { useApp } from '../i18n';
import { googleTranslateUrl } from '../lib/explain';
import { setStatus, translate } from '../store/words';
import type { WordEntry } from '../types';
import { speak } from './WordPopover';

/** Explanation, example, sentence from the book and RU on demand — the back of a card, the word sheet. */
export function WordDetails({ word, showSentence = true }: { word: WordEntry; showSentence?: boolean }) {
  const { t } = useApp();
  const [ru, setRu] = useState<string[] | null | 'loading' | 'failed' | undefined>(word.translation);
  const [showRu, setShowRu] = useState(false);
  const ex = word.explanation;

  const toggleRu = async () => {
    setShowRu((s) => !s);
    if (ru !== undefined && ru !== 'failed') return;
    setRu('loading');
    try {
      const tr = await translate(word.key);
      setRu(tr ?? null);
      if (tr) await setStatus({ ...word, translation: tr }, word.status);
    } catch {
      setRu('failed');
    }
  };

  return (
    <div class="word-details">
      <div class="wd-head">
        <span class="wd-word">{word.key}</span>
        <button class="icon-btn" aria-label={t('speak')} onClick={() => speak(word.key)}>🔊</button>
      </div>
      {(ex?.phonetic || ex?.senses[0]) && (
        <div class="pop-meta">
          {ex.phonetic && <span>{ex.phonetic}</span>}
          {ex.senses[0] && <span class="pos">{ex.senses[0].pos}</span>}
        </div>
      )}
      {ex ? (
        <ol class={ex.senses.length > 1 ? 'senses' : 'senses single'}>
          {ex.senses.map((s) => <li key={s.definition}>{s.definition}</li>)}
        </ol>
      ) : (
        <p class="muted">{ex === null ? t('no_entry') : t('offline_word')}</p>
      )}
      {showSentence && word.context && (
        <blockquote class="wd-sentence">
          <Highlighted sentence={word.context.sentence} form={word.form ?? word.key} />
          <cite>— {word.context.bookTitle}</cite>
        </blockquote>
      )}
      <div class="ru">
        <button class={`chip ${showRu ? 'on' : ''}`} onClick={toggleRu}>RU</button>
        {showRu && (
          <span class="ru-text">
            {ru === 'loading' && '…'}
            {Array.isArray(ru) && ru.join(', ')}
            {(ru === null || ru === 'failed') && (
              <a href={googleTranslateUrl(word.key)} target="_blank" rel="noopener noreferrer">{t('google_translate')}</a>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function Highlighted({ sentence, form }: { sentence: string; form: string }) {
  const i = sentence.toLowerCase().indexOf(form.toLowerCase());
  if (i < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, i)}
      <mark>{sentence.slice(i, i + form.length)}</mark>
      {sentence.slice(i + form.length)}
    </>
  );
}
