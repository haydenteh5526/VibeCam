import { Directory, File, Paths } from 'expo-file-system';
import type { FilterId } from './filters';

/**
 * Persisted user settings.
 *
 * Stored as JSON in the app's document directory via expo-file-system rather than
 * AsyncStorage, so no new dependency is needed and the file survives cache eviction.
 */
export type Settings = {
  /** Camera selected when the app opens. 'auto' lets the backend choose. */
  defaultCamera: FilterId | 'auto';
  /** Optical/sensor character intensity, 0–1.5. Sent as X-Character. */
  characterStrength: number;
  /** Burn an LED date into the corner. */
  dateStamp: boolean;
  /** Printed border style, or 'none'. */
  frame: 'none' | 'white' | 'black' | 'print';
  /** Warm edge light leak, 0–1. */
  lightLeak: number;
  /** Dust and scratches, 0–1. */
  dust: number;
  /** Save the graded photo to the camera roll automatically after capture. */
  autoSave: boolean;
  /** Also keep the untouched original in the camera roll. */
  saveOriginal: boolean;
  /** Haptic feedback on controls and shutter. */
  haptics: boolean;
  /** Show the grid overlay by default. */
  grid: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  defaultCamera: 'auto',
  characterStrength: 1,
  dateStamp: false,
  frame: 'none',
  lightLeak: 0,
  dust: 0,
  autoSave: true,
  saveOriginal: false,
  haptics: true,
  grid: false,
};

const FILE_NAME = 'vibecam-settings.json';

function settingsFile(): File {
  return new File(Paths.document, FILE_NAME);
}

const FRAMES: Settings['frame'][] = ['none', 'white', 'black', 'print'];

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Merge stored values over the defaults, validating each field.
 *
 * Anything missing, malformed or out of range falls back to its default, so a corrupt
 * or older settings file can never put the app into a broken state.
 */
export function normalize(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    defaultCamera: typeof r.defaultCamera === 'string' ? (r.defaultCamera as Settings['defaultCamera']) : DEFAULT_SETTINGS.defaultCamera,
    characterStrength: clamp(r.characterStrength, 0, 1.5, DEFAULT_SETTINGS.characterStrength),
    dateStamp: typeof r.dateStamp === 'boolean' ? r.dateStamp : DEFAULT_SETTINGS.dateStamp,
    frame: FRAMES.includes(r.frame as Settings['frame']) ? (r.frame as Settings['frame']) : DEFAULT_SETTINGS.frame,
    lightLeak: clamp(r.lightLeak, 0, 1, DEFAULT_SETTINGS.lightLeak),
    dust: clamp(r.dust, 0, 1, DEFAULT_SETTINGS.dust),
    autoSave: typeof r.autoSave === 'boolean' ? r.autoSave : DEFAULT_SETTINGS.autoSave,
    saveOriginal: typeof r.saveOriginal === 'boolean' ? r.saveOriginal : DEFAULT_SETTINGS.saveOriginal,
    haptics: typeof r.haptics === 'boolean' ? r.haptics : DEFAULT_SETTINGS.haptics,
    grid: typeof r.grid === 'boolean' ? r.grid : DEFAULT_SETTINGS.grid,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const f = settingsFile();
    if (!f.exists) return DEFAULT_SETTINGS;
    return normalize(JSON.parse(await f.text()));
  } catch {
    return DEFAULT_SETTINGS;   // never let bad state block the camera
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    const dir = new Directory(Paths.document);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const f = settingsFile();
    if (!f.exists) f.create({ overwrite: true, intermediates: true });
    f.write(JSON.stringify(s));
  } catch {
    // Non-fatal: settings simply won't persist across launches.
  }
}

/** Translate settings into the request headers the backend understands. */
export function gradeHeaders(s: Settings, seed: number): Record<string, string> {
  const h: Record<string, string> = {
    'X-Character': String(s.characterStrength),
    'X-Seed': String(seed),
  };
  if (s.dateStamp) h['X-Date-Stamp'] = '1';
  if (s.frame !== 'none') h['X-Frame'] = s.frame;
  if (s.lightLeak > 0) h['X-Light-Leak'] = String(s.lightLeak);
  if (s.dust > 0) h['X-Dust'] = String(s.dust);
  return h;
}
