import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../i18n';
import { googleTranslateUrl, NetworkError, type Explanation } from '../lib/explain';
import type { PosHint } from '../lib/lemma';
import { explain, forget, getWord, setStatus, translate } from '../store/words';
import type { WordStatus } from '../types';

export interface WordTarget {
  kind: 'word' | 'phrase';
  /** As written in the book. */
  text: string;
  /** Saved under this key: base form or phrase key. */
  key: string;
  pos?: PosHint;
  sentence: string;
  bookId: string;
  bookTitle: string;
  para: number;
  rect: DOMRect;
}

type Lookup = { state: 'loading' } | { state: 'ok'; data: Explanation } | { state: 'none' } | { state: 'offline' };

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.9;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === 'en-US' && v.localService) ?? voices.find((v) => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

export function WordPopover({ target, onClose }: { target: WordTarget; onClose: () => void }) {
  const { t } = useApp();
  const saved = getWord(target.key);
  const [lookup, setLookup] = useState<Lookup>(() =>
    saved?.explanation ? { state: 'ok', data: saved.explanation } : saved?.explanation === null ? { state: 'none' } : { state: 'loading' },
  );
  const [ru, setRu] = useState<string[] | null | 'loading' | 'failed' | undefined>(saved?.translation);
  const [showRu, setShowRu] = useState(false);
  const [status, setStatusState] = useState<WordStatus | undefined>(saved?.status);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number }>({ left: 12, top: target.rect.bottom + 8 });

  useEffect(() => {
    if (lookup.state !== 'loading') return;
    let live = true;
    explain({ lemma: target.key, form: target.text, pos: target.pos, sentence: target.sentence })
      .then((data) => live && setLookup(data ? { state: 'ok', data } : { state: 'none' }))
      .catch((e) => live && setLookup(e instanceof NetworkError ? { state: 'offline' } : { state: 'none' }));
    return () => {
      live = false;
    };
  }, [target.key, lookup.state]);

  // Below the word when it fits, otherwise above; never wider than the screen.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(12, Math.min(innerWidth - w - 12, target.rect.left + target.rect.width / 2 - w / 2));
    const below = target.rect.bottom + 10;
    if (below + h < innerHeight - 12 || target.rect.top < innerHeight / 2) setPlace({ left, top: Math.min(below, innerHeight - h - 12) });
    else setPlace({ left, bottom: innerHeight - target.rect.top + 10 });
  }, [lookup.state, showRu, ru]);

  const toggleRu = async () => {
    setShowRu((s) => !s);
    if (ru !== undefined && ru !== 'failed') return;
    setRu('loading');
    try {
      setRu((await translate(target.kind === 'word' ? target.key : target.text.toLowerCase())) ?? null);
    } catch {
      setRu('failed');
    }
  };

  const save = async (next: WordStatus) => {
    if (status === next) {
      await forget(target.key);
      setStatusState(undefined);
      return;
    }
    await setStatus(
      {
        key: target.key,
        kind: target.kind,
        form: target.text,
        context: { sentence: target.sentence, bookId: target.bookId, bookTitle: target.bookTitle, para: target.para },
        explanation: lookup.state === 'ok' ? lookup.data : lookup.state === 'none' ? null : undefined,
        translation: Array.isArray(ru) ? ru : undefined,
      },
      next,
    );
    setStatusState(next);
    setTimeout(onClose, 350);
  };

  const lower = target.text.toLowerCase().replace(/’/g, "'");
  const showBase = target.kind === 'word' && target.key !== lower;
  const data = lookup.state === 'ok' ? lookup.data : undefined;

  return (
    <div class="popover" ref={box} style={place} role="dialog" aria-label={target.text} onClick={(e) => e.stopPropagation()}>
      <div class="pop-head">
        <div class="pop-word">
          <span class="w">{target.text}</span>
          {showBase && <span class="base">→ {target.key}</span>}
        </div>
        <button class="icon-btn" aria-label={t('speak')} onClick={() => speak(target.kind === 'word' ? target.key : target.text)}>
          🔊
        </button>
      </div>
      {(data?.phonetic || data?.senses[0]) && (
        <div class="pop-meta">
          {data.phonetic && <span>{data.phonetic}</span>}
          {data.senses[0] && <span class="pos">{data.senses[0].pos}</span>}
        </div>
      )}

      <div class="pop-body">
        {lookup.state === 'loading' && <div class="skeleton" aria-label={t('loading')}><i /><i /></div>}
        {data && (
          <>
            <ol class={data.senses.length > 1 ? 'senses' : 'senses single'}>
              {data.senses.map((s) => <li key={s.definition}>{s.definition}</li>)}
            </ol>
            {data.example && <p class="example">{/^["“‘']/.test(data.example) ? data.example : `“${data.example}”`}</p>}
          </>
        )}
        {lookup.state === 'none' && <p class="muted">{t('no_entry')}</p>}
        {lookup.state === 'offline' && (
          <p class="muted">
            {navigator.onLine ? t('lookup_failed') : t('offline_word')}{' '}
            <button class="link" onClick={() => setLookup({ state: 'loading' })}>{t('try_again')}</button>
          </p>
        )}

        <div class="ru">
          <button class={`chip ${showRu ? 'on' : ''}`} onClick={toggleRu}>RU</button>
          {showRu && (
            <span class="ru-text">
              {ru === 'loading' && '…'}
              {Array.isArray(ru) && ru.join(', ')}
              {(ru === null || ru === 'failed') && (
                <a href={googleTranslateUrl(target.kind === 'word' ? target.key : target.text)} target="_blank" rel="noopener noreferrer">
                  {t('google_translate')}
                </a>
              )}
            </span>
          )}
        </div>
      </div>

      <div class="pop-actions">
        <button class={status === 'learning' ? 'primary on' : 'primary'} onClick={() => save('learning')}>
          {status === 'learning' ? `✓ ${t('learning')}` : t('learn')}
        </button>
        <button class={status === 'known' ? 'secondary on' : 'secondary'} onClick={() => save('known')}>
          {status === 'known' ? `✓ ${t('known')}` : t('know')}
        </button>
      </div>
    </div>
  );
}
