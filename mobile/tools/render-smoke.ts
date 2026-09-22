import { renderToFramebuffer } from '../src/look/renderFrame';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

// Browser verification of the same GL draw calls and GLSL used on iPhone.
// Native image decoding, orientation and Photos still require the device checklist.
document.querySelector('button')!.onclick = async () => {
  const output = document.querySelector('pre')!;
  const canvas = document.querySelector('canvas')!;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) { output.textContent = 'FAIL: WebGL unavailable'; return; }
  try {
    const width = 256, height = 2, size = 17;
    const photo = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) photo.set([i % 256, (i * 37) % 256, (i * 71) % 256, 255], i * 4);
    const lut = new Uint8Array(size ** 3 * 4);
    for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) for (let r = 0; r < size; r++) {
      lut.set([Math.round(r * 255 / 16), Math.round(g * 255 / 16), Math.round(b * 255 / 16), 255], (g * size * size + b * size + r) * 4);
    }
    // Match expo-gl's Asset upload extension using deterministic pixel buffers.
    const texImage = gl.texImage2D.bind(gl);
    gl.texImage2D = ((...args: unknown[]) => {
      const asset = args[5] as { localUri?: string };
      if (args.length === 6 && asset?.localUri) {
        const isPhoto = asset.localUri === 'photo';
        texImage(gl.TEXTURE_2D, 0, gl.RGBA, isPhoto ? width : size * size, isPhoto ? height : size, 0, gl.RGBA, gl.UNSIGNED_BYTE, isPhoto ? photo : lut);
      } else Reflect.apply(texImage, gl, args);
    }) as typeof gl.texImage2D;
    await renderToFramebuffer(gl as ExpoWebGLRenderingContext, { localUri: 'photo' }, { localUri: 'lut' }, width, height, { camera: 'g7x', characterStrength: 0, seed: 42 });
    const actual = new Uint8Array(photo.length);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    let maxError = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      maxError = Math.max(maxError, Math.abs(actual[(y * width + x) * 4 + c] - photo[((height - 1 - y) * width + x) * 4 + c]));
    }
    if (maxError > 2) throw new Error(`Identity LUT changed pixels by ${maxError}/255`);
    const status = gl.getError();
    if (status !== gl.NO_ERROR) throw new Error(`GL error ${status}`);
    output.textContent = `PASS: shader compiled and rendered ${width * height} pixels.\nIdentity LUT maximum channel error: ${maxError}/255.\nNo texture feedback or framebuffer errors.`;
  } catch (error) { output.textContent = `FAIL: ${String(error)}`; }
  finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
};
