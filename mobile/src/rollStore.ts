import { Directory, File, Paths } from 'expo-file-system';
import { normalizeRoll, type RollEntry } from './roll';

export * from './roll';

/**
 * Film roll persistence — a JSON index of developed shots in the document directory.
 *
 * Only metadata is stored; the images live on disk and in the photo library. Validation
 * lives in `roll.ts` so it can be unit-tested without native modules.
 */
const FILE_NAME = 'vibecam-roll.json';

function rollFile(): File {
  return new File(Paths.document, FILE_NAME);
}

export async function loadRoll(): Promise<RollEntry[]> {
  try {
    const f = rollFile();
    if (!f.exists) return [];
    return normalizeRoll(JSON.parse(await f.text()));
  } catch {
    return [];
  }
}

export async function saveRoll(roll: RollEntry[]): Promise<void> {
  try {
    const dir = new Directory(Paths.document);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const f = rollFile();
    if (!f.exists) f.create({ overwrite: true, intermediates: true });
    f.write(JSON.stringify(roll));
  } catch {
    // Non-fatal: the roll just won't survive a restart.
  }
}

/**
 * Drop entries whose image file has disappeared.
 *
 * Graded images are written to the cache directory, which iOS can purge under storage
 * pressure — without this the roll would show broken tiles.
 */
export function pruneMissing(roll: RollEntry[]): RollEntry[] {
  return roll.filter(e => {
    try {
      return new File(e.uri).exists;
    } catch {
      return false;
    }
  });
}
