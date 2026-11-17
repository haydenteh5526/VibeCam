import test from 'node:test';
import assert from 'node:assert/strict';
import { createRollRepository } from '../rollRepository';
import type { RollEntry } from '../roll';

const shot = (uri = 'cache/photo', originalUri: string | null = 'cache/original'): RollEntry => ({
  uri, originalUri, cameraId: 'g7x', cameraName: 'G7X', takenAt: 100, seed: 42,
});
function fixture(initial: RollEntry[] = []) {
  let disk = structuredClone(initial);
  let failWrite = false;
  const files = new Set(['cache/photo', 'cache/original', 'cache/edit', ...initial.flatMap(e => [e.uri, e.originalUri!])]);
  const removed: string[] = [];
  const storage = {
    read: async () => structuredClone(disk),
    write: async (roll: RollEntry[]) => { if (failWrite) throw new Error('Disk full'); disk = structuredClone(roll); },
    retain: async (uri: string) => {
      assert.ok(files.has(uri), `Missing image: ${uri}`);
      if (uri.startsWith('documents/')) return uri;
      const dest = uri.replace('cache/', 'documents/'); files.add(dest); return dest;
    },
    resolve: async (uri: string) => uri,
    exists: async (uri: string) => files.has(uri),
    remove: async (uri: string) => { if (uri.startsWith('documents/')) { files.delete(uri); removed.push(uri); } },
  };
  return { repo: createRollRepository(storage), storage, files, removed, disk: () => disk, fail: (value: boolean) => { failWrite = value; } };
}

test('retains original and developed photo through cache eviction and a fresh launch', async () => {
  const f = fixture();
  const { entry } = await f.repo.put(shot());
  for (const uri of f.files) if (uri.startsWith('cache/')) f.files.delete(uri);
  const reopened = await createRollRepository(f.storage).load();
  assert.deepEqual(reopened, [entry]);
  assert.equal(entry.originalUri, 'documents/original');
});
test('migrates old cache entries and disables redeveloping when the original is missing', async () => {
  const f = fixture([shot()]);
  f.files.delete('cache/original');
  const roll = await f.repo.load();
  assert.equal(roll[0].uri, 'documents/photo');
  assert.equal(roll[0].originalUri, null);
  assert.deepEqual(f.disk(), roll);
});
test('a failed index write preserves the current photo and original, then accepts a retry', async () => {
  const f = fixture();
  const { entry } = await f.repo.put(shot());
  f.fail(true);
  await assert.rejects(f.repo.put({ ...entry, uri: 'cache/edit' }, entry.uri), /Disk full/);
  assert.deepEqual(f.disk(), [entry]);
  assert.ok(f.files.has(entry.uri));
  assert.ok(f.files.has(entry.originalUri!));
  assert.ok(!f.files.has('documents/edit'));
  f.fail(false);
  const updated = await f.repo.put({ ...entry, uri: 'cache/edit', cameraId: 'ai' }, entry.uri);
  assert.equal(updated.roll.length, 1);
  assert.equal(updated.entry.cameraId, 'ai');
  assert.equal(updated.entry.originalUri, entry.originalUri);
  assert.ok(!f.files.has(entry.uri));
});
test('concurrent captures are serialized without losing a shot', async () => {
  const f = fixture();
  await Promise.all([f.repo.put(shot()), f.repo.put(shot('cache/edit'))]);
  assert.equal((await f.repo.load()).length, 2);
});
test('deletion cleans owned files after commit and preserves a shared original', async () => {
  const f = fixture();
  const a = await f.repo.put(shot());
  const b = await f.repo.put(shot('cache/edit'));
  await f.repo.remove(a.entry.uri);
  assert.ok(f.files.has(b.entry.originalUri!));
  assert.ok(!f.files.has(a.entry.uri));
  await f.repo.remove(b.entry.uri);
  assert.ok(!f.files.has(b.entry.originalUri!));
});
test('failed deletion keeps both the index and photo files', async () => {
  const f = fixture();
  const { entry } = await f.repo.put(shot());
  f.fail(true);
  await assert.rejects(f.repo.remove(entry.uri));
  assert.deepEqual(f.disk(), [entry]);
  assert.ok(f.files.has(entry.uri));
});
test('editing an original-only entry never deletes its retained original', async () => {
  const f = fixture();
  const { entry } = await f.repo.put(shot('cache/original'));
  const updated = await f.repo.put({ ...entry, uri: 'cache/edit' }, entry.uri);
  assert.ok(f.files.has(entry.uri));
  assert.equal(updated.entry.originalUri, entry.uri);
});

test('a styled clip, original and poster survive restart and are removed together', async () => {
  const f = fixture();
  f.files.add('cache/clip.mp4'); f.files.add('cache/clip.mov'); f.files.add('cache/poster.jpg');
  const clip: RollEntry = { ...shot('cache/clip.mp4', 'cache/clip.mov'),
    mediaType: 'video', thumbnailUri: 'cache/poster.jpg', durationMs: 15_000 };
  const { entry } = await f.repo.put(clip);
  assert.equal(entry.uri, 'documents/clip.mp4');
  assert.equal(entry.originalUri, 'documents/clip.mov');
  assert.equal(entry.thumbnailUri, 'documents/poster.jpg');
  for (const uri of f.files) if (uri.startsWith('cache/')) f.files.delete(uri);
  const reopened = createRollRepository(f.storage);
  assert.deepEqual(await reopened.load(), [entry]);
  await reopened.remove(entry.uri);
  assert.ok(!f.files.has(entry.uri));
  assert.ok(!f.files.has(entry.originalUri!));
  assert.ok(!f.files.has(entry.thumbnailUri!));
});

test('favourites, save status and recipes survive restart without copying or deleting media', async () => {
  const f = fixture();
  const { entry } = await f.repo.put(shot());
  const recipe = { amount: .8, exposure: .5, warmth: -.2, character: .75, dateStamp: true };
  await f.repo.put({ ...entry, favorite: true, savedToLibrary: true, recipe }, entry.uri);
  const [reopened] = await createRollRepository(f.storage).load();
  assert.deepEqual([reopened.favorite, reopened.savedToLibrary, reopened.recipe], [true, true, recipe]);
  assert.equal(reopened.uri, entry.uri);
  assert.equal(reopened.originalUri, entry.originalUri);
  assert.deepEqual(f.removed, []);
});

test('bulk deletion is atomic and leaves shared originals until the last photo is removed', async () => {
  const f = fixture();
  const a = await f.repo.put(shot());
  const b = await f.repo.put(shot('cache/edit'));
  f.fail(true);
  await assert.rejects(f.repo.removeMany([a.entry.uri, b.entry.uri]), /Disk full/);
  assert.equal(f.disk().length, 2);
  assert.deepEqual(f.removed, []);
  f.fail(false);
  await f.repo.removeMany([a.entry.uri, a.entry.uri, 'missing']);
  assert.ok(f.files.has(b.entry.originalUri!));
  assert.equal(f.disk().length, 1);
  await f.repo.removeMany([b.entry.uri]);
  assert.equal(f.disk().length, 0);
  assert.ok(!f.files.has(b.entry.originalUri!));
});

test('a photo whose developed file is missing falls back to its original', async () => {
  const recipe = { amount: .8, exposure: .5, warmth: -.2, character: .75, dateStamp: true };
  const f = fixture();
  const { entry } = await f.repo.put({ ...shot(), favorite: true, savedToLibrary: true, recipe });
  f.files.delete('documents/photo');
  const [recovered, ...rest] = await createRollRepository(f.storage).load();
  assert.equal(rest.length, 0);
  assert.equal(recovered.uri, 'documents/original');
  assert.equal(recovered.originalUri, 'documents/original');
  assert.equal(recovered.cameraId, 'original');
  assert.equal(recovered.cameraName, 'Original');
  assert.equal(recovered.savedToLibrary, false);
  assert.equal(recovered.favorite, true);
  assert.deepEqual(recovered.recipe, recipe);
  assert.equal(recovered.takenAt, entry.takenAt);
  assert.equal(recovered.seed, entry.seed);
  assert.deepEqual(f.disk(), [recovered]);
  assert.deepEqual(f.removed, []);
  assert.ok(f.files.has('documents/original'));

  const moved = fixture([{ ...shot('old/photo', 'old/original'), favorite: true }]);
  moved.files.add('documents/original');
  moved.files.delete('old/original'); moved.files.delete('old/photo');
  const rebased = createRollRepository({ ...moved.storage, resolve: async (uri: string) => uri.replace(/^old\//, 'documents/') });
  const [resolved] = await rebased.load();
  assert.equal(resolved.uri, 'documents/original');
  assert.equal(resolved.originalUri, 'documents/original');
  assert.deepEqual(moved.removed, []);
});

test('a clip whose styled file is missing falls back to its recording', async () => {
  const f = fixture();
  f.files.add('cache/clip.mp4'); f.files.add('cache/clip.mov'); f.files.add('cache/poster.jpg');
  const clip: RollEntry = { ...shot('cache/clip.mp4', 'cache/clip.mov'),
    mediaType: 'video', thumbnailUri: 'cache/poster.jpg', durationMs: 15_000 };
  await f.repo.put(clip);
  f.files.delete('documents/clip.mp4');
  const [recovered] = await createRollRepository(f.storage).load();
  assert.equal(recovered.uri, 'documents/clip.mov');
  assert.equal(recovered.originalUri, 'documents/clip.mov');
  assert.equal(recovered.mediaType, 'video');
  assert.equal(recovered.durationMs, 15_000);
  assert.equal(recovered.thumbnailUri, 'documents/poster.jpg');
  assert.deepEqual(f.removed, []);

  const g = fixture();
  g.files.add('cache/clip.mp4'); g.files.add('cache/clip.mov'); g.files.add('cache/poster.jpg');
  await g.repo.put(clip);
  g.files.delete('documents/clip.mp4'); g.files.delete('documents/poster.jpg');
  const [posterless] = await createRollRepository(g.storage).load();
  assert.equal(posterless.uri, 'documents/clip.mov');
  assert.equal(posterless.mediaType, 'video');
  assert.equal(posterless.thumbnailUri, null);
  assert.deepEqual(g.removed, []);
});

test('intact entries are unchanged beside a recovered one', async () => {
  const f = fixture();
  for (const name of ['a', 'b', 'c']) { f.files.add(`cache/${name}`); f.files.add(`cache/o${name}`); }
  await f.repo.put({ ...shot('cache/a', 'cache/oa'), takenAt: 1 });
  await f.repo.put({ ...shot('cache/b', 'cache/ob'), takenAt: 2 });
  await f.repo.put({ ...shot('cache/c', 'cache/oc'), takenAt: 3 });
  const before = await createRollRepository(f.storage).load();
  assert.deepEqual(before.map(e => e.uri), ['documents/c', 'documents/b', 'documents/a']);
  f.files.delete('documents/b');
  const after = await createRollRepository(f.storage).load();
  assert.equal(after.length, 3);
  assert.deepEqual(after[0], before[0]);
  assert.equal(after[1].uri, 'documents/ob');
  assert.equal(after[1].takenAt, 2);
  assert.deepEqual(after[2], before[2]);
});

test('entries that fall back to the same original become one entry', async () => {
  const f = fixture();
  f.files.add('cache/a'); f.files.add('cache/b'); f.files.add('cache/o');
  await f.repo.put({ ...shot('cache/a', 'cache/o'), takenAt: 100 });
  await f.repo.put({ ...shot('cache/b', 'cache/o'), takenAt: 200 });
  f.files.delete('documents/a'); f.files.delete('documents/b');
  const merged = await createRollRepository(f.storage).load();
  assert.equal(merged.length, 1);
  assert.equal(merged[0].uri, 'documents/o');
  assert.equal(merged[0].takenAt, 200);

  const g = fixture();
  g.files.add('cache/o'); g.files.add('cache/x');
  await g.repo.put({ ...shot('cache/o', 'cache/o'), takenAt: 100 });
  await g.repo.put({ ...shot('cache/x', 'cache/o'), takenAt: 200 });
  const [, intact] = await createRollRepository(g.storage).load();
  g.files.delete('documents/x');
  const result = await createRollRepository(g.storage).load();
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], intact);
});

test('an entry with neither file is dropped, and a recovered one can be edited and removed', async () => {
  const f = fixture();
  await f.repo.put(shot());
  f.files.delete('documents/photo'); f.files.delete('documents/original');
  assert.deepEqual(await createRollRepository(f.storage).load(), []);
  assert.deepEqual(f.removed, []);

  const g = fixture();
  await g.repo.put(shot());
  g.files.delete('documents/photo');
  const repo = createRollRepository(g.storage);
  const [recovered] = await repo.load();
  const edited = await repo.put({ ...recovered, uri: 'cache/edit', cameraId: 'g7x' }, recovered.uri);
  assert.ok(g.files.has('documents/original'));
  assert.equal(edited.entry.originalUri, 'documents/original');
  assert.equal(edited.entry.uri, 'documents/edit');
  await repo.remove(edited.entry.uri);
  assert.ok(!g.files.has('documents/edit'));
  assert.ok(!g.files.has('documents/original'));
});

test('a recovered entry and an intact entry may share one original, which outlives either removal', async () => {
  const f = fixture();
  for (const name of ['dev_a', 'dev_b', 'o', 'poster_a']) f.files.add(`cache/${name}`);
  await f.repo.put({ ...shot('cache/dev_a', 'cache/o'), takenAt: 100, thumbnailUri: 'cache/poster_a' });
  await f.repo.put({ ...shot('cache/dev_b', 'cache/o'), takenAt: 200 });
  const before = await createRollRepository(f.storage).load();
  const intact = before.find(e => e.uri === 'documents/dev_a')!;
  f.files.delete('documents/dev_b');
  const repo = createRollRepository(f.storage);
  const roll = await repo.load();
  assert.deepEqual(roll.map(e => e.uri), ['documents/o', 'documents/dev_a']);
  assert.equal(roll[0].cameraId, 'original');
  assert.equal(roll[0].takenAt, 200);
  assert.deepEqual(roll[1], intact);
  await repo.remove('documents/o');
  assert.ok(f.files.has('documents/o'));
  assert.ok(f.files.has('documents/dev_a'));
  await repo.remove('documents/dev_a');
  for (const uri of ['documents/o', 'documents/dev_a', 'documents/poster_a']) assert.ok(!f.files.has(uri), uri);
});
