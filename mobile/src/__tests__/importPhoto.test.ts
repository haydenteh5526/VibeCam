import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_FAILED, PHOTOS_UNAVAILABLE, importPhoto, importSourcesFor, type ImportDeps, type PickedImage } from '../importPhoto';

type Setup = { photos?: PickedImage | null | Error; files?: PickedImage | null | Error; convert?: string | Error };
function fakeDeps(setup: Setup = {}) {
  const calls = { photos: 0, files: 0, converted: [] as string[] };
  const settle = <T>(value: T | Error): Promise<T> => value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  const deps: ImportDeps = {
    pickFromPhotos: () => { calls.photos++; return settle(setup.photos === undefined ? null : setup.photos); },
    pickFromFiles: () => { calls.files++; return settle(setup.files === undefined ? null : setup.files); },
    toUprightJpeg: uri => { calls.converted.push(uri); return settle(setup.convert ?? 'cache/converted.jpg'); },
  };
  return { deps, calls };
}

test('a photo from the library is converted before import', async () => {
  const { deps, calls } = fakeDeps({ photos: { uri: 'cache/IMG_1.heic' }, convert: 'cache/IMG_1.jpg' });
  assert.equal(await importPhoto('photos', deps), 'cache/IMG_1.jpg');
  assert.deepEqual(calls.converted, ['cache/IMG_1.heic']);
  assert.equal(calls.files, 0);
});
test('a JPEG from the library is converted too', async () => {
  const { deps, calls } = fakeDeps({ photos: { uri: 'cache/IMG_2.jpg' }, convert: 'cache/IMG_2_upright.jpg' });
  assert.equal(await importPhoto('photos', deps), 'cache/IMG_2_upright.jpg');
  assert.deepEqual(calls.converted, ['cache/IMG_2.jpg']);
});
test('cancelling the library picker imports nothing', async () => {
  const { deps, calls } = fakeDeps({ photos: null });
  assert.equal(await importPhoto('photos', deps), null);
  assert.equal(calls.converted.length, 0);
});
test('files import is unchanged, and cancelling it imports nothing', async () => {
  const picked = fakeDeps({ files: { uri: 'cache/a.png' } });
  assert.equal(await importPhoto('files', picked.deps), 'cache/a.png');
  assert.equal(picked.calls.converted.length, 0);
  const cancelled = fakeDeps({ files: null });
  assert.equal(await importPhoto('files', cancelled.deps), null);
  assert.equal(cancelled.calls.converted.length, 0);
});
test('a library that will not open points to Files, which still works', async () => {
  const { deps } = fakeDeps({ photos: new Error('native failure'), files: { uri: 'cache/b.jpg' } });
  await assert.rejects(importPhoto('photos', deps), (error: unknown) => error instanceof Error && error.message === PHOTOS_UNAVAILABLE);
  assert.equal(PHOTOS_UNAVAILABLE, "Couldn't open your photo library. You can still import from Files.");
  assert.equal(await importPhoto('files', deps), 'cache/b.jpg');
});
test('a photo that cannot be converted is not imported', async () => {
  const { deps } = fakeDeps({ photos: { uri: 'cache/IMG_3.heic' }, convert: new Error('decode failure') });
  await assert.rejects(importPhoto('photos', deps), (error: unknown) => error instanceof Error && error.message === IMPORT_FAILED);
  assert.equal(IMPORT_FAILED, "This photo couldn't be imported. Try another photo, or import it from Files.");
});
test('only the iPhone offers the library', () => {
  assert.deepEqual(importSourcesFor('ios'), ['photos', 'files']);
  assert.deepEqual(importSourcesFor('web'), ['files']);
  assert.deepEqual(importSourcesFor('android'), ['files']);
});
