import { addEntry, normalizeRoll, removeEntry, updateEntry, type RollEntry } from './roll';

type Storage = {
  read: () => Promise<unknown>;
  write: (roll: RollEntry[]) => Promise<void>;
  retain: (uri: string) => Promise<string>;
  exists: (uri: string) => Promise<boolean>;
  resolve: (uri: string) => Promise<string>;
  remove: (uri: string) => Promise<void>;
};

const images = (roll: RollEntry[]) => new Set(roll.flatMap(e => [e.uri, ...(e.originalUri ? [e.originalUri] : []), ...(e.thumbnailUri ? [e.thumbnailUri] : [])]));

/** Image copies commit before the index; cleanup happens only after a successful write. */
export function createRollRepository(storage: Storage) {
  let current: RollEntry[] | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };
  const cleanup = async (uris: Iterable<string>) => {
    await Promise.allSettled([...uris].map(uri => storage.remove(uri)));
  };
  async function persist(next: RollEntry[]): Promise<RollEntry[]> {
    const old = images(current ?? []);
    const copied = new Map<string, string>();
    const retain = async (uri: string): Promise<string> => {
      if (!copied.has(uri)) copied.set(uri, await storage.retain(uri));
      return copied.get(uri)!;
    };
    try {
      const stable: RollEntry[] = [];
      for (const entry of next) {
        stable.push({ ...entry, uri: await retain(entry.uri), originalUri: entry.originalUri ? await retain(entry.originalUri) : null,
          thumbnailUri: entry.thumbnailUri ? await retain(entry.thumbnailUri) : null });
      }
      await storage.write(stable);
      current = stable;
      const used = images(stable);
      await cleanup([...old].filter(uri => !used.has(uri)));
      return [...stable];
    } catch (error) {
      await cleanup([...copied].filter(([source, dest]) => source !== dest && !old.has(dest)).map(([, dest]) => dest));
      throw error;
    }
  }
  async function load(): Promise<RollEntry[]> {
    if (current) return [...current];
    const raw = normalizeRoll(await storage.read());
    const recovered: RollEntry[] = [];
    for (const entry of raw) {
      const uri = await storage.resolve(entry.uri);
      if (!await storage.exists(uri)) continue;
      const original = entry.originalUri ? await storage.resolve(entry.originalUri) : null;
      const thumbnail = entry.thumbnailUri ? await storage.resolve(entry.thumbnailUri) : null;
      recovered.push({ ...entry, uri, originalUri: original && await storage.exists(original) ? original : null,
        thumbnailUri: thumbnail && await storage.exists(thumbnail) ? thumbnail : null });
    }
    return persist(recovered);
  }
  return {
    load: () => serial(load),
    put: (entry: RollEntry, previousUri?: string) => serial(async () => {
      const roll = await load();
      const index = previousUri ? roll.findIndex(e => e.uri === previousUri) : -1;
      const next = await persist(index >= 0 ? updateEntry(roll, previousUri!, entry) : addEntry(roll, entry));
      return { roll: next, entry: next[index >= 0 ? index : 0] };
    }),
    remove: (uri: string) => serial(async () => persist(removeEntry(await load(), uri))),
  };
}
