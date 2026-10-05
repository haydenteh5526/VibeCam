import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCaption, previewCrop } from '../look/livePreview';

test('live viewfinder centre crops without stretching photo and video sources', () => {
  assert.deepEqual(previewCrop(640, 480, 300, 400), { x: 140, y: 0, width: 360, height: 480 });
  assert.deepEqual(previewCrop(720, 1280, 360, 640), { x: 0, y: 0, width: 720, height: 1280 });
  assert.deepEqual(previewCrop(720, 1280, 300, 400), { x: 0, y: 160, width: 720, height: 960 });
  assert.equal(previewCrop(0, 480, 300, 400), null);
  assert.equal(previewCrop(640, NaN, 300, 400), null);
});

test('camera explains what is live, what is original, and when the look is added', () => {
  assert.equal(previewCaption('ccd', 'photo', false, 'live'), 'Live colour · texture added after capture');
  assert.equal(previewCaption('ccd', 'video', false, 'live'), 'Live colour');
  assert.equal(previewCaption('ccd', 'photo', true, 'live'), 'Original preview · look still applied to your shot');
  assert.equal(previewCaption('original', 'photo', false, 'loading'), 'Original · no look applied');
  assert.equal(previewCaption('auto', 'photo', false, 'live'), 'Look chosen after capture');
  assert.equal(previewCaption('ccd', 'video', false, 'unavailable'), 'Look applied after recording');
});
