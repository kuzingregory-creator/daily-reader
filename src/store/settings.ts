import { getKV, setKV } from '../db';
import type { Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = { theme: 'sepia', fontSize: 20, lineHeight: 1.6, lang: 'en' };

export const FONT_SIZES = { min: 15, max: 30 };
export const LINE_HEIGHTS = [1.4, 1.6, 1.85];

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getKV<Partial<Settings>>('settings', {})) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await setKV('settings', s);
}
