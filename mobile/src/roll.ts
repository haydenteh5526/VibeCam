/**
 * Film roll: the app's own record of developed shots.
 *
 * Pure logic, no native imports, so it can be unit-tested. The list is an index of
 * URIs plus metadata — the images themselves live on disk (cache/document dirs) and in
 * the photo library. Capped so the index can't grow without bound.
 */

export type RollEntry = {
  /** Developed image URI. */
  uri: string;
  /** Untouched frame, kept so a shot can be re-developed later. */
  originalUri: string | null;
  /** Camera id the shot was developed with, e.g. 'g7x'. */
  cameraId: string;
  /** Display name, e.g. 'Canon G7X III'. */
  cameraName: string;
  /** Epoch millis. */
  takenAt: number;
  /** Seed used for leak/dust/grain, so a re-develop reproduces it exactly. */
  seed: number;
};

/** Keeping the most recent 60 shots is plenty for a personal camera app. */
export const MAX_ROLL = 60;

export function addEntry(roll: RollEntry[], entry: RollEntry, max: number = MAX_ROLL): RollEntry[] {
  // Newest first, de-duplicated by uri so a re-develop replaces rather than appends.
  const withoutDupe = roll.filter(e => e.uri !== entry.uri);
  return [entry, ...withoutDupe].slice(0, max);
}

export function removeEntry(roll: RollEntry[], uri: string): RollEntry[] {
  return roll.filter(e => e.uri !== uri);
}

/** Replace an entry's developed image, preserving its place and metadata. */
export function updateEntry(roll: RollEntry[], oldUri: string, patch: Partial<RollEntry>): RollEntry[] {
  return roll.map(e => (e.uri === oldUri ? { ...e, ...patch } : e));
}

/** Validate a persisted roll, dropping anything malformed. */
export function normalizeRoll(raw: unknown, max: number = MAX_ROLL): RollEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RollEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.uri !== 'string' || r.uri.length === 0) continue;
    out.push({
      uri: r.uri,
      originalUri: typeof r.originalUri === 'string' ? r.originalUri : null,
      cameraId: typeof r.cameraId === 'string' ? r.cameraId : 'unknown',
      cameraName: typeof r.cameraName === 'string' ? r.cameraName : 'Unknown',
      takenAt: typeof r.takenAt === 'number' && Number.isFinite(r.takenAt) ? r.takenAt : 0,
      seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.trunc(r.seed) : 0,
    });
  }
  return out.slice(0, max);
}

/** Group entries by calendar day for a sectioned roll view. */
export function groupByDay(roll: RollEntry[]): { day: string; items: RollEntry[] }[] {
  const groups = new Map<string, RollEntry[]>();
  for (const e of roll) {
    const d = new Date(e.takenAt);
    const key = Number.isFinite(e.takenAt) && e.takenAt > 0
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : 'unknown';
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }));
}
