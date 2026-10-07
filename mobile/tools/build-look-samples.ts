import { renderToFramebuffer } from '../src/look/renderFrame';
import { FILTERS } from '../src/filters';
import { DEFAULT_RECIPE } from '../src/photoRecipe';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

async function image(url: string) { const image = new Image(); image.src = url; await image.decode(); return image; }
async function build() {
  const source = await image('/original.jpg');
  const { naturalWidth: width, naturalHeight: height } = source;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL required to render the app looks');
  try {
    for (const look of FILTERS.filter(f => f.id !== 'original')) {
      await renderToFramebuffer(gl as ExpoWebGLRenderingContext, source, await image('/luts/' + look.id + '.png'), width, height,
        { camera: look.id, seed: 2026, characterStrength: 1, recipe: DEFAULT_RECIPE });
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const output = document.createElement('canvas'); output.width = width; output.height = height;
      const ctx = output.getContext('2d')!; const decoded = ctx.createImageData(width, height);
      for (let row = 0; row < height; row++) decoded.data.set(pixels.subarray((height - row - 1) * width * 4, (height - row) * width * 4), row * width * 4);
      ctx.putImageData(decoded, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(b => b ? resolve(b) : reject(new Error('JPEG failed')), 'image/jpeg', .9));
      if (!(await fetch('/save/' + look.id, { method: 'POST', body: blob })).ok) throw new Error('Could not save ' + look.id);
    }
    document.querySelector('pre')!.textContent = 'PASS: rendered all six samples with the app shader';
  } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
void build().catch(error => { document.querySelector('pre')!.textContent = String(error); });
