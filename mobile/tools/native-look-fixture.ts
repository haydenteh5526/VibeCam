import { writeFileSync } from 'node:fs';
import { VIDEO_LUTS } from '../src/look/videoLuts';
import { identityGrid, sampleLut, type Rgb } from '../src/look/lut';

// A colour sweep independent of Core Image: compare the actual native filter
// with the CPU reference already checked against the browser/photo shader.
const pixels: Rgb[] = [];
for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) pixels.push([r, g, b]);
const cubes = { identity: Buffer.from(identityGrid(17).data).toString('base64'), ...VIDEO_LUTS };
writeFileSync(process.argv[2], JSON.stringify({ pixels, looks: Object.entries(cubes).map(([name, cube]) => ({
  name, cube, expected: pixels.map(rgb => sampleLut({ size: 17, data: Buffer.from(cube, 'base64') }, rgb)),
})) }));
