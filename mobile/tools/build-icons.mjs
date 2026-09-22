import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('../../docs/icons/icon.svg', import.meta.url));
const output = name => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
// Keep the repository's vector identity; iOS icons must be fully opaque.
await sharp(source, { density: 192 }).resize(1024, 1024).flatten({ background: '#1a1a2e' }).png().toFile(output('icon.png'));
await sharp(source, { density: 192 }).resize(1024, 1024).png().toFile(output('adaptive-icon.png'));
await sharp(source, { density: 192 }).resize(512, 512).png().toFile(output('splash-icon.png'));
await sharp(source).resize(48, 48).png().toFile(output('favicon.png'));
console.log('App icons generated from docs/icons/icon.svg');
