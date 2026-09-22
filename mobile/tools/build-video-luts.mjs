import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const names = ['g7x', 'rx100', 'gr', 'x100', 'ccd', 'powershot'];
const size = 17;
const cubes = {};
for (const name of names) {
  const source = await readFile(new URL(`../assets/luts/${name}.png`, import.meta.url));
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== size * size || info.height !== size || info.channels !== 3) {
    throw new Error(`${name} LUT has unexpected dimensions or channels`);
  }
  // Core Image's cube varies red fastest, then green, then blue.
  const cube = Buffer.alloc(size ** 3 * 3);
  let index = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const offset = (g * info.width + b * size + r) * 3;
    cube[index++] = data[offset];
    cube[index++] = data[offset + 1];
    cube[index++] = data[offset + 2];
  }
  cubes[name] = cube.toString('base64');
}
await writeFile(new URL('../src/look/videoLuts.ts', import.meta.url),
  '// Generated from assets/luts/*.png by npm run assets:video-luts.\n' +
  `export const VIDEO_LUTS: Record<string, string> = ${JSON.stringify(cubes, null, 2)};\n`);
console.log('Video colour cubes generated from photo LUTs');
