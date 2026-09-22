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
