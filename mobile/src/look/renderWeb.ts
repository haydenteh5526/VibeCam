import type { ExpoWebGLRenderingContext } from 'expo-gl';
import type { DevelopOptions } from './renderStill';
import { renderToFramebuffer } from './renderFrame';

const decode = (uri: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new window.Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not decode this photo. Try a JPEG or PNG.'));
  image.src = uri;
});

/** Use the same shader for browser previews and iPhone stills. Never use a CSS tint. */
export async function developWeb(opts: DevelopOptions, lutUri: string): Promise<string> {
  const [photo, lut] = await Promise.all([decode(opts.uri), decode(lutUri)]);
  const width = photo.naturalWidth, height = photo.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error('This browser cannot render camera looks. Enable graphics acceleration or use the iPhone app.');
  try {
    await renderToFramebuffer(gl as ExpoWebGLRenderingContext, photo, lut, width, height, opts);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const output = document.createElement('canvas');
    output.width = width; output.height = height;
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('Could not export this photo.');
    const image = ctx.createImageData(width, height);
    for (let row = 0; row < height; row++) {
      image.data.set(pixels.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
    }
    ctx.putImageData(image, 0, 0);
    return output.toDataURL('image/jpeg', 0.95);
  } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}
