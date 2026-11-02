import { useEffect, useMemo, useState } from 'preact/hooks';
import { Ctx, translator } from './i18n';
import { loadSettings, saveSettings } from './store/settings';
import type { Settings } from './types';
import { TodayScreen } from './screens/Today';
import { LibraryScreen } from './screens/Library';
import { SettingsScreen } from './screens/Settings';
import { ReaderScreen } from './screens/Reader';
import { ReviewScreen } from './screens/Review';
import { WordsScreen } from './screens/Words';
import { StatsScreen } from './screens/Stats';

const THEME_COLORS = { sepia: '#efe1bd', light: '#ffffff', dark: '#1b1a18' };

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function applySettings(s: Settings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.lang = s.lang;
  root.style.setProperty('--reader-size', `${s.fontSize}px`);
  root.style.setProperty('--reader-lh', String(s.lineHeight));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[s.theme]);
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const hash = useHash();

  useEffect(() => {
    loadSettings().then((s) => {
      applySettings(s);
      setSettings(s);
    });
  }, []);

  const ctx = useMemo(
    () =>
      settings && {
        settings,
        t: translator(settings.lang),
        update: (patch: Partial<Settings>) => {
          const next = { ...settings, ...patch };
          applySettings(next);
          setSettings(next);
          saveSettings(next);
        },
      },
    [settings],
  );
  if (!ctx) return null;

  const [, route, arg] = hash.replace(/^#/, '').split('/');
  let screen;
  if (route === 'read' && arg) screen = <ReaderScreen key={arg} bookId={decodeURIComponent(arg)} />;
  else if (route === 'library') screen = <LibraryScreen />;
  else if (route === 'review') screen = <ReviewScreen />;
  else if (route === 'words') screen = <WordsScreen />;
  else if (route === 'stats') screen = <StatsScreen />;
  else if (route === 'settings') screen = <SettingsScreen />;
  else screen = <TodayScreen />;

  return <Ctx.Provider value={ctx}>{screen}</Ctx.Provider>;
}
