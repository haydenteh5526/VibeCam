import { fileExists, readJson, writeJson } from './services/storage';
import { normalizeRoll, type RollEntry } from './roll';

export * from './roll';

/**
 * Film roll persistence — a JSON index of developed shots.
 *
 * Only metadata is stored; the images live on disk (or as blob URLs on web) and in the
 * photo library. Storage is platform-aware (see services/storage). Validation lives in
 * `roll.ts` so it can be unit-tested without native modules.
 */
const FILE_NAME = 'vibecam-roll.json';

export async function loadRoll(): Promise<RollEntry[]> {
  const raw = await readJson(FILE_NAME);
  return raw === null ? [] : normalizeRoll(raw);
}

export async function saveRoll(roll: RollEntry[]): Promise<void> {
  await writeJson(FILE_NAME, roll);
}

/**
 * Drop entries whose image has disappeared.
 *
 * Graded images are written to the cache directory, which iOS can purge under storage
 * pressure — without this the roll would show broken tiles.
 */
export async function pruneMissing(roll: RollEntry[]): Promise<RollEntry[]> {
  const keep = await Promise.all(roll.map(e => fileExists(e.uri)));
  return roll.filter((_, i) => keep[i]);
}
