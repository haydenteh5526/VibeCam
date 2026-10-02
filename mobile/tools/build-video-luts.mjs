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
  // The PNG already stores Core Image's order: red fastest, green next, blue last.
  // Treating this as tiled blue slices swaps green and blue in every video.
  cubes[name] = data.toString('base64');
}
await writeFile(new URL('../src/look/videoLuts.ts', import.meta.url),
  '// Generated from assets/luts/*.png by npm run assets:video-luts.\n' +
  `export const VIDEO_LUTS: Record<string, string> = ${JSON.stringify(cubes, null, 2)};\n`);
console.log('Video colour cubes generated from photo LUTs');
