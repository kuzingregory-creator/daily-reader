import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../i18n';
import { isPersistent, lastBackupAt, parseBackup, restoreBackup, saveBackup } from '../store/backup';
import { TabBar, TypeControls } from '../components/ui';
import type { Lang } from '../types';

export function SettingsScreen() {
  const { t, settings, update } = useApp();
  const langs: [Lang, string][] = [['en', 'English'], ['ru', 'Русский']];
  return (
    <div class="screen">
      <header class="page-head">
        <h1>{t('settings')}</h1>
      </header>
      <BackupCard />
      <section class="card">
        <div class="row">
          <span class="row-label">{t('language')}</span>
          <div class="segmented">
            {langs.map(([id, name]) => (
              <button key={id} class={settings.lang === id ? 'on' : ''} onClick={() => update({ lang: id })}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section class="card">
        <TypeControls />
        <p class="preview-text">
          The quick brown fox jumps over the lazy dog. Reading a little every day is how words stay with you.
        </p>
      </section>
      <p class="muted pad small">{t('storage_note')} · v{__APP_VERSION__}</p>
      <TabBar active="settings" />
    </div>
  );
}

function BackupCard() {
  const { t, settings } = useApp();
  const [last, setLast] = useState(0);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    lastBackupAt().then(setLast);
    isPersistent().then(setPersistent);
  }, []);

  const save = async () => {
    try {
      if ((await saveBackup()) === 'saved') {
        setLast(Date.now());
        setMessage(t('backup_saved'));
      }
    } catch (e) {
      setMessage(t('backup_failed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const restore = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const when = new Date(backup.exportedAt).toLocaleString(settings.lang);
      if (!confirm(t('restore_confirm', { when }))) return;
      await restoreBackup(backup);
      location.hash = '#/';
      location.reload();
    } catch (err) {
      setMessage(t('restore_failed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const lastText = last
    ? new Intl.DateTimeFormat(settings.lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(last)
    : t('never');

  return (
    <section class="card">
      <h2 class="chart-title">{t('backup')}</h2>
      <p class="muted small no-margin">{t('backup_hint')}</p>
      <div class="muted small">{t('last_backup', { when: lastText })}</div>
      {persistent === false && <div class="small warn-text">{t('storage_not_protected')}</div>}
      <button class="primary" onClick={save}>{t('backup_save')}</button>
      <button class="secondary" onClick={() => input.current?.click()}>{t('backup_restore')}</button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={restore} />
      {message && <div class="toast no-margin">{message}</div>}
    </section>
  );
}
