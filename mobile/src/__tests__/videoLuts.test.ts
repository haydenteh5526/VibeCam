import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fileURLToPath, URL } from 'node:url';
import { VIDEO_LUTS } from '../look/videoLuts';

test('video cubes preserve the real bundled PNG colour axes for all six cameras', async () => {
  for (const camera of ['g7x', 'rx100', 'gr', 'x100', 'ccd', 'powershot']) {
    const { data, info } = await sharp(fileURLToPath(new URL('../../assets/luts/' + camera + '.png', import.meta.url)))
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [289, 17, 3]);
    assert.deepEqual(Buffer.from(VIDEO_LUTS[camera], 'base64'), data, camera + ': green and blue axes must not be swapped');
  }
});
