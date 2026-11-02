import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from '../i18n';
import { FONT_SIZES, LINE_HEIGHTS } from '../store/settings';
import type { Theme } from '../types';

export function go(path: string) {
  location.hash = path;
}

/** Bottom sheet; tap outside to close. */
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div class="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-grip" />
        {title && <h3 class="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

/** Text size, line spacing and theme — used in the reader and in Settings. */
export function TypeControls() {
  const { settings, update, t } = useApp();
  const size = (d: number) =>
    update({ fontSize: Math.max(FONT_SIZES.min, Math.min(FONT_SIZES.max, settings.fontSize + d)) });
  const themes: Theme[] = ['sepia', 'light', 'dark'];
  return (
    <div class="type-controls">
      <div class="row">
        <span class="row-label">{t('text_size')}</span>
        <div class="segmented">
          <button aria-label="Smaller" onClick={() => size(-1)} disabled={settings.fontSize <= FONT_SIZES.min}>
            <span style={{ fontSize: '15px' }}>A</span>
          </button>
          <span class="value">{settings.fontSize}</span>
          <button aria-label="Bigger" onClick={() => size(1)} disabled={settings.fontSize >= FONT_SIZES.max}>
            <span style={{ fontSize: '22px' }}>A</span>
          </button>
        </div>
      </div>
      <div class="row">
        <span class="row-label">{t('line_spacing')}</span>
        <div class="segmented">
          {LINE_HEIGHTS.map((lh, i) => (
            <button
              key={lh}
              class={settings.lineHeight === lh ? 'on' : ''}
              aria-label={`${t('line_spacing')} ${i + 1}`}
              onClick={() => update({ lineHeight: lh })}
            >
              <SpacingIcon gap={3 + i * 2} />
            </button>
          ))}
        </div>
      </div>
      <div class="row">
        <span class="row-label">{t('theme')}</span>
        <div class="swatches">
          {themes.map((th) => (
            <button key={th} class={`swatch swatch-${th} ${settings.theme === th ? 'on' : ''}`} onClick={() => update({ theme: th })}>
              {t(th)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpacingIcon({ gap }: { gap: number }) {
  const ys = [0, 1, 2].map((i) => 4 + i * gap);
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      {ys.map((y) => (
        <rect x="3" y={y} width="16" height="2" rx="1" fill="currentColor" />
      ))}
    </svg>
  );
}

const icons = {
  today: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1 -3.9 15 -3.8-1z',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  words: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6',
  stats: 'M5 20V11M12 20V5M19 20v-7',
  back: 'M15 5l-7 7 7 7',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};

export function Icon({ name, size = 24 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}

export function TabBar({ active }: { active: 'today' | 'library' | 'words' | 'stats' | 'settings' }) {
  const { t } = useApp();
  const tabs = [
    { id: 'today', href: '#/' },
    { id: 'library', href: '#/library' },
    { id: 'words', href: '#/words' },
    { id: 'stats', href: '#/stats' },
    { id: 'settings', href: '#/settings' },
  ] as const;
  return (
    <nav class="tabbar">
      {tabs.map((tab) => (
        <a key={tab.id} href={tab.href} class={active === tab.id ? 'on' : ''}>
          <Icon name={tab.id} />
          <span>{t(tab.id)}</span>
        </a>
      ))}
    </nav>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div class="bar" role="progressbar" aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

export const minutes = (words: number) => Math.max(1, Math.round(words / 130));
