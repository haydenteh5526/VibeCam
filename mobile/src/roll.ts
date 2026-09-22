/**
 * Film roll: the app's own record of developed shots.
 *
 * Pure logic, no native imports, so it can be unit-tested. The list is an index of
 * URIs plus metadata — media files live in app documents; Save makes a separate copy
 * in Photos. Never evict a shot merely because another one was taken.
 */

export type RollEntry = {
  /** Developed photo or styled video URI. */
  uri: string;
  /** Untouched recording, kept so an item can be restyled later. */
  originalUri: string | null;
  /** Camera id the shot was developed with, e.g. 'g7x'. */
  cameraId: string;
  /** Display name, e.g. 'Canon G7X III'. */
  cameraName: string;
  /** Epoch millis. */
  takenAt: number;
  /** Seed used for leak/dust/grain, so a re-develop reproduces it exactly. */
  seed: number;
  /** Omitted in old rolls; they contain photos. */
  mediaType?: 'photo' | 'video';
  /** First frame for a video tile. */
  thumbnailUri?: string | null;
  durationMs?: number;
};

export function addEntry(roll: RollEntry[], entry: RollEntry): RollEntry[] {
  // Newest first, de-duplicated by uri so a re-develop replaces rather than appends.
  const withoutDupe = roll.filter(e => e.uri !== entry.uri);
  return [entry, ...withoutDupe];
}

export function removeEntry(roll: RollEntry[], uri: string): RollEntry[] {
  return roll.filter(e => e.uri !== uri);
}

/** Replace an entry's developed image, preserving its place and metadata. */
export function updateEntry(roll: RollEntry[], oldUri: string, patch: Partial<RollEntry>): RollEntry[] {
  return roll.map(e => (e.uri === oldUri ? { ...e, ...patch } : e));
}

/** Validate a persisted roll, dropping anything malformed. */
export function normalizeRoll(raw: unknown): RollEntry[] {
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
      ...(r.mediaType === 'video' ? { mediaType: 'video' as const } : {}),
      thumbnailUri: typeof r.thumbnailUri === 'string' && r.thumbnailUri.length > 0 ? r.thumbnailUri : null,
      ...(r.mediaType === 'video' ? { durationMs: typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) && r.durationMs >= 0 ? r.durationMs : 0 } : {}),
    });
  }
  return out;
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
