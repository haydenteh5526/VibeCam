/**
 * Pure settings logic — no native or Expo imports.
 *
 * Kept separate from `settings.ts` (which does file I/O) so this can be unit-tested in
 * plain Node. Validation lives here because it's the part most worth testing: a corrupt
 * or outdated settings file must never put the app into a broken state.
 */
import type { FilterId } from './filters';

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
  /**
   * Develop on the device instead of waiting for the backend.
   *
   * Instant and works offline, but the on-device look is an approximation: the backend's
   * adaptive reference match can't be baked into a fixed LUT, and halation, chromatic
   * aberration and corner softness need extra render passes.
   */
  onDeviceLook: boolean;
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
  onDeviceLook: false,
};

const FRAMES: Settings['frame'][] = ['none', 'white', 'black', 'print'];

/** Every valid camera id, plus 'auto'. Anything else is rejected on load. */
const CAMERA_IDS: (FilterId | 'auto')[] = [
  'auto', 'original', 'g7x', 'rx100', 'gr', 'x100', 'ccd', 'powershot',
];

function clampNumber(n: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Merge stored values over the defaults, validating each field.
 *
 * Anything missing, malformed or out of range falls back to its default.
 */
export function normalize(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const camera = r.defaultCamera as Settings['defaultCamera'];
  return {
    defaultCamera: CAMERA_IDS.includes(camera) ? camera : DEFAULT_SETTINGS.defaultCamera,
    characterStrength: clampNumber(r.characterStrength, 0, 1.5, DEFAULT_SETTINGS.characterStrength),
    dateStamp: bool(r.dateStamp, DEFAULT_SETTINGS.dateStamp),
    frame: FRAMES.includes(r.frame as Settings['frame']) ? (r.frame as Settings['frame']) : DEFAULT_SETTINGS.frame,
    lightLeak: clampNumber(r.lightLeak, 0, 1, DEFAULT_SETTINGS.lightLeak),
    dust: clampNumber(r.dust, 0, 1, DEFAULT_SETTINGS.dust),
    autoSave: bool(r.autoSave, DEFAULT_SETTINGS.autoSave),
    saveOriginal: bool(r.saveOriginal, DEFAULT_SETTINGS.saveOriginal),
    haptics: bool(r.haptics, DEFAULT_SETTINGS.haptics),
    grid: bool(r.grid, DEFAULT_SETTINGS.grid),
    onDeviceLook: bool(r.onDeviceLook, DEFAULT_SETTINGS.onDeviceLook),
  };
}

/**
 * Translate settings into the request headers the backend understands.
 *
 * Only non-default effects are sent, keeping requests minimal and making it obvious
 * from the headers alone what was asked for.
 */
export function gradeHeaders(s: Settings, seed: number): Record<string, string> {
  const h: Record<string, string> = {
    'X-Character': String(s.characterStrength),
    'X-Seed': String(Math.trunc(seed)),
  };
  if (s.dateStamp) h['X-Date-Stamp'] = '1';
  if (s.frame !== 'none') h['X-Frame'] = s.frame;
  if (s.lightLeak > 0) h['X-Light-Leak'] = String(s.lightLeak);
  if (s.dust > 0) h['X-Dust'] = String(s.dust);
  return h;
}
