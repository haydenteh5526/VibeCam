import { createPhotoRenderer, renderToFramebuffer } from '../src/look/renderFrame';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { DEFAULT_RECIPE } from '../src/photoRecipe';
import { gridFromStrip, sampleLut } from '../src/look/lut';

// Browser verification of the same GL draw calls and GLSL used on iPhone.
// Native image decoding, orientation and Photos still require the device checklist.
document.querySelector('button')!.onclick = async () => {
  const output = document.querySelector('pre')!;
  const canvas = document.querySelector('canvas')!;
  canvas.width = 256; canvas.height = 128;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) { output.textContent = 'FAIL: WebGL unavailable'; return; }
  try {
    const width = 256, height = 128, size = 17;
    const photo = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) photo.set([i % 256, (i * 37) % 256, (i * 71) % 256, 255], i * 4);
    const lut = new Uint8Array(size ** 3 * 4);
    for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) for (let r = 0; r < size; r++) {
      lut.set([Math.round(r * 255 / 16), Math.round(g * 255 / 16), Math.round(b * 255 / 16), 255], (b * size * size + g * size + r) * 4);
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
    const render = async (recipe: typeof DEFAULT_RECIPE) => {
      await renderToFramebuffer(gl as ExpoWebGLRenderingContext, { localUri: 'photo' }, { localUri: 'lut' }, width, height,
        { camera: 'ccd', characterStrength: 1, seed: 42, recipe, takenAt: new Date(2026, 9, 2).getTime() });
      const bytes = new Uint8Array(photo.length);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const zero = await render({ ...DEFAULT_RECIPE, amount: 0 });
    for (let i = 0; i < zero.length; i++) if (Math.abs(zero[i] - actual[i]) > 2) throw new Error('Zero look strength still changes the image');
    const brighter = await render({ ...DEFAULT_RECIPE, amount: 0, exposure: 1 });
    for (let i = 0; i < brighter.length; i++) if (i % 4 !== 3 && Math.abs(brighter[i] - Math.min(255, zero[i] * 2)) > 2) throw new Error('Exposure does not match +1 EV');
    const stamped = await render({ ...DEFAULT_RECIPE, amount: 0, dateStamp: true });
    let changed = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ([0, 1, 2].some(c => Math.abs(stamped[i + c] - zero[i + c]) > 2)) {
        changed++;
        // Framebuffer rows start at bottom. Export flips them to image coordinates.
        if (x < width * .7 || y > height * .15) throw new Error('Date stamp is outside the lower-right corner');
      }
    }
    if (changed < 6) throw new Error('Date stamp is missing');
    let bundledError = 0;
    for (const camera of ['g7x', 'rx100', 'gr', 'x100', 'ccd', 'powershot']) {
      const source = new Image();
      source.src = '/luts/' + camera + '.png';
      await source.decode();
      const decoded = document.createElement('canvas'); decoded.width = size * size; decoded.height = size;
      const ctx = decoded.getContext('2d')!; ctx.drawImage(source, 0, 0);
      const grid = gridFromStrip(new Uint8Array(ctx.getImageData(0, 0, decoded.width, size).data), decoded.width, size);
      await renderToFramebuffer(gl as ExpoWebGLRenderingContext, { localUri: 'photo' }, source, width, height, { camera, characterStrength: 0, seed: 42 });
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, j = ((height - 1 - y) * width + x) * 4;
        const expected = sampleLut(grid, [photo[j], photo[j + 1], photo[j + 2]]);
        for (let c = 0; c < 3; c++) bundledError = Math.max(bundledError, Math.abs(actual[i + c] - expected[c]));
      }
    }
    if (bundledError > 2) throw new Error('Bundled camera LUT differs from CPU reference by ' + bundledError);
    // An on-screen surface uses the default framebuffer. Compare it with export,
    // then change uniforms and restore them without another upload or compilation.
    const live = createPhotoRenderer(gl as ExpoWebGLRenderingContext, { localUri: 'photo' }, { localUri: 'lut' }, width, height);
    const options = { camera: 'ccd', characterStrength: 1, seed: 42, recipe: { ...DEFAULT_RECIPE, amount: 0 } };
    let previewError = 0;
    try {
      for (const exposure of [0, 1, 0]) {
        live.draw(width, height, { ...options, recipe: { ...options.recipe, exposure } });
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, actual);
        const expected = exposure === 1 ? brighter : zero;
        for (let i = 0; i < actual.length; i++) previewError = Math.max(previewError, Math.abs(actual[i] - expected[i]));
      }
    } finally { live.dispose(); }
    if (previewError > 2) throw new Error('Interactive preview differs from export by ' + previewError);
    // Camera frames replace only the photo texture. A changing source must be
    // visible immediately without losing the LUT or allocating another renderer.
    const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
    const frameContext = frame.getContext('2d')!;
    frameContext.fillStyle = 'rgb(40,100,190)'; frameContext.fillRect(0, 0, width, height);
    const stream = createPhotoRenderer(gl as ExpoWebGLRenderingContext, frame, { localUri: 'lut' }, width, height);
    try {
      for (const colour of [[40, 100, 190], [180, 70, 25], [20, 220, 140]]) {
        frameContext.fillStyle = `rgb(${colour.join(',')})`; frameContext.fillRect(0, 0, width, height);
        stream.updatePhoto(frame);
        stream.draw(width, height, { camera: 'g7x', characterStrength: 0, seed: 0 });
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, actual);
        for (let i = 0; i < actual.length; i++) {
          if (i % 4 < 3 && Math.abs(actual[i] - colour[i % 4]) > 2) throw new Error('Camera frame update kept stale pixels');
        }
      }
    } finally { stream.dispose(); }
    const status = gl.getError();
    if (status !== gl.NO_ERROR) throw new Error(`GL error ${status}`);
    const lossExtension = gl.getExtension('WEBGL_lose_context');
    let lossCheck = 'Context-loss check skipped: extension unavailable.';
    if (lossExtension) {
      const interrupted = createPhotoRenderer(gl as ExpoWebGLRenderingContext, { localUri: 'photo' }, { localUri: 'lut' }, width, height);
      canvas.addEventListener('webglcontextlost', event => event.preventDefault(), { once: true });
      lossExtension.loseContext();
      await new Promise(resolve => setTimeout(resolve, 25));
      // Drain the one-shot error; later adjustments still have to reject the lost context.
      gl.getError();
      for (let attempt = 0; attempt < 3; attempt++) {
        let rejected = false;
        try { interrupted.draw(width, height, options); } catch { rejected = true; }
        if (!rejected) throw new Error('Lost context was incorrectly reported as a successful preview');
      }
      interrupted.dispose();
      lossCheck = 'Lost context rejects every subsequent adjustment.';
    }
    output.textContent = `PASS: shader compiled and rendered ${width * height} pixels.\nIdentity LUT maximum channel error: ${maxError}/255.\nSix bundled PNG LUTs match CPU reference within ${bundledError.toFixed(2)}/255.\nZero strength preserves source; +1 EV matches expected pixels.\nDate stamp draws ${changed} pixels in the lower-right corner.\nInteractive preview matches export within ${previewError}/255, including repeated adjustment/revert.\nNo texture feedback or framebuffer errors.\n${lossCheck}`;
  } catch (error) { output.textContent = `FAIL: ${String(error)}`; }
  finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
};
