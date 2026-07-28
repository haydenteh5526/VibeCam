import { Directory, File, Paths } from 'expo-file-system';
import { DEFAULT_SETTINGS, normalize, type Settings } from './settingsCore';

export { DEFAULT_SETTINGS, gradeHeaders, normalize } from './settingsCore';
export type { Settings } from './settingsCore';

/**
 * Settings persistence.
 *
 * Stored as JSON in the app's document directory via expo-file-system: no extra
 * dependency, and unlike the cache directory it isn't evicted under storage pressure.
 * All validation lives in `settingsCore` so it can be unit-tested without native modules.
 */
const FILE_NAME = 'vibecam-settings.json';

function settingsFile(): File {
  return new File(Paths.document, FILE_NAME);
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
