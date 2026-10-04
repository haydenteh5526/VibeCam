import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewDimensions } from '../look/previewDimensions';

test('48 MP previews upload at most 1280 pixels on the long edge', () => {
  assert.deepEqual(previewDimensions(8064, 6048), { width: 1280, height: 960 });
  assert.deepEqual(previewDimensions(6048, 8064), { width: 960, height: 1280 });
});

test('small originals are not upscaled and panoramic previews keep a positive dimension', () => {
  assert.deepEqual(previewDimensions(640, 480), { width: 640, height: 480 });
  assert.deepEqual(previewDimensions(100000, 1), { width: 1280, height: 1 });
});

test('invalid sizes cannot allocate a preview', () => {
  for (const size of [0, -1, Infinity, NaN]) assert.throws(() => previewDimensions(size, 100));
});
