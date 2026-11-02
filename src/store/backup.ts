import { db, getKV, setKV } from '../db';
import { dayKey } from '../lib/day';
import type { CardRecord } from '../lib/review';

/** Everything except the dictionary cache, which can be fetched again. */
const STORES = ['books', 'texts', 'positions', 'days', 'kv', 'words', 'cards'] as const;
type StoreName = (typeof STORES)[number];

const FORMAT = 1;
const REMIND_AFTER_DAYS = 7;
const SNOOZE_DAYS = 3;

interface Backup {
  app: 'daily-reader';
  format: number;
  version: string;
  exportedAt: string;
  data: Record<StoreName, unknown[]>;
  /** kv has no key path, so its keys travel separately. */
  kvKeys: string[];
}

// ------------------------------------------------------------------ storage protection

/** Safari may clear site data when space runs low, unless the site's storage is persistent. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function isPersistent(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ export

export async function makeBackup(): Promise<Backup> {
  const d = await db();
  const data = {} as Backup['data'];
  for (const name of STORES) data[name] = await d.getAll(name);
  return {
    app: 'daily-reader',
    format: FORMAT,
    version: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    data,
    kvKeys: (await d.getAllKeys('kv')) as string[],
  };
}

/** Hands the backup file to the user: the share sheet on iPhone ("Save to Files"), a download elsewhere. */
export async function saveBackup(): Promise<'saved' | 'cancelled'> {
  const json = JSON.stringify(await makeBackup());
  const file = new File([json], `daily-reader-backup-${dayKey()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Daily Reader backup' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
  } else {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await setKV('lastBackup', Date.now());
  return 'saved';
}

// ------------------------------------------------------------------ import

/** JSON turns the dates inside FSRS cards into strings; turn them back. */
function reviveCard(c: CardRecord): CardRecord {
  const card = { ...c.card };
  card.due = new Date(card.due);
  if (card.last_review) card.last_review = new Date(card.last_review);
  return { ...c, card };
}

export function parseBackup(text: string): Backup {
  let b: Backup;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  if (b?.app !== 'daily-reader' || typeof b.data !== 'object') throw new Error('not a Daily Reader backup');
  if (b.format > FORMAT) throw new Error('made by a newer version of the app');
  return b;
}

/** Replaces all data on this device with the backup. The page reloads afterwards. */
export async function restoreBackup(b: Backup): Promise<void> {
  const d = await db();
  const tx = d.transaction([...STORES], 'readwrite');
  for (const name of STORES) await tx.objectStore(name).clear();
  for (const name of STORES) {
    if (name === 'kv') continue;
    const store = tx.objectStore(name);
    for (const row of b.data[name] ?? []) await store.put((name === 'cards' ? reviveCard(row as CardRecord) : row) as never);
  }
  const kv = tx.objectStore('kv');
  (b.data.kv ?? []).forEach((value, i) => kv.put(value, b.kvKeys[i]));
  await tx.done;
}

// ------------------------------------------------------------------ weekly reminder

/** Days since the last backup, when it's time for a gentle reminder; otherwise null. */
export async function backupReminder(): Promise<number | null> {
  const [last, snooze] = await Promise.all([getKV<number>('lastBackup', 0), getKV<number>('backupSnooze', 0)]);
  if (Date.now() < snooze) return null;
  const d = await db();
  const hasData = (await d.count('words')) > 0 || (await d.count('positions')) > 0;
  if (!hasData) return null;
  // Never backed up: start counting from the first day of reading.
  const since = last || Math.min(...(await d.getAllKeys('days')).map((k) => new Date(`${k}T12:00`).getTime()), Date.now());
  const days = Math.floor((Date.now() - since) / 86400_000);
  return days >= REMIND_AFTER_DAYS ? days : null;
}

export async function snoozeReminder(): Promise<void> {
  await setKV('backupSnooze', Date.now() + SNOOZE_DAYS * 86400_000);
}

export async function lastBackupAt(): Promise<number> {
  return getKV<number>('lastBackup', 0);
}
