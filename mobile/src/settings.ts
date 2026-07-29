import { readJson, writeJson } from './services/storage';
import { DEFAULT_SETTINGS, normalize, type Settings } from './settingsCore';

export { DEFAULT_SETTINGS, gradeHeaders, normalize } from './settingsCore';
export type { Settings } from './settingsCore';

/**
 * Settings persistence.
 *
 * Storage is platform-aware (see services/storage): a JSON file in the document
 * directory on native, localStorage in a browser, since expo-file-system doesn't work on
 * web and the app is also run there for development. All validation lives in
 * `settingsCore` so it can be unit-tested without native modules.
 */
const FILE_NAME = 'vibecam-settings.json';

export async function loadSettings(): Promise<Settings> {
  const raw = await readJson(FILE_NAME);
  return raw === null ? DEFAULT_SETTINGS : normalize(raw);
}

export async function saveSettings(s: Settings): Promise<void> {
  await writeJson(FILE_NAME, s);
}
