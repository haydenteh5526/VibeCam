import { Asset } from 'expo-asset';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { File, Paths } from 'expo-file-system';

import { characterFor } from './characterParams';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';

/**
 * On-device look rendering.
 *
 * Develops a captured still entirely on the GPU: LUT colour transform plus the character
 * effects a single pass can do. This is what makes capture instant and available offline
 * — no backend round-trip, no cold start.
 *
 * Deliberate limits, so expectations are clear:
 *  - The LUT carries each camera's *static* colour signature. The backend's adaptive
 *    reference match cannot be baked into a fixed table (see backend/lut.py), so a
 *    server render remains slightly different — and better — when reachable.
 *  - Halation, chromatic aberration, corner softness and unsharp masking need extra blur
 *    passes and stay server-side.
 */

/** LUT strips are bundled per camera; keys must match FilterId. */
const LUT_MODULES: Record<string, number> = {
  g7x: require('../../assets/luts/g7x.png'),
  rx100: require('../../assets/luts/rx100.png'),
  gr: require('../../assets/luts/gr.png'),
  x100: require('../../assets/luts/x100.png'),
  ccd: require('../../assets/luts/ccd.png'),
  powershot: require('../../assets/luts/powershot.png'),
};

/** Points per axis in the baked LUTs — must match backend lut.DEFAULT_SIZE. */
export const LUT_SIZE = 17;

export function hasOnDeviceLook(camera: string): boolean {
  return camera in LUT_MODULES;
}

function compile(gl: ExpoWebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function buildProgram(gl: ExpoWebGLRenderingContext): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('could not create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    throw new Error(`program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

async function loadTexture(gl: ExpoWebGLRenderingContext, asset: Asset, smooth: boolean): Promise<WebGLTexture> {
  const texture = gl.createTexture();
  if (!texture) throw new Error('could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // expo-gl accepts an Asset (anything with a localUri) where the web API expects an
  // HTMLImageElement. That path is untyped in the bindings, hence the cast.
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
    asset as unknown as TexImageSource,
  );
  const filter = smooth ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export type DevelopOptions = {
  uri: string;
  camera: string;
  characterStrength: number;
  seed: number;
};

/**
 * Develop a still on-device. Returns a new file URI, or null when the camera has no
 * bundled LUT (caller should fall back to the backend or the untouched frame).
 */
export async function developOnDevice(opts: DevelopOptions): Promise<string | null> {
  const module = LUT_MODULES[opts.camera];
  if (module === undefined) return null;

  const [photo, lutAsset] = await Promise.all([
    Asset.fromURI(opts.uri).downloadAsync(),
    Asset.fromModule(module).downloadAsync(),
  ]);

  const width = photo.width ?? 0;
  const height = photo.height ?? 0;
  if (!width || !height) throw new Error('could not determine image size');

  const gl = await GLView.createContextAsync();
  try {
    const program = buildProgram(gl);
    gl.useProgram(program);

    // Full-screen quad. Texture V is flipped because GL samples bottom-up.
    const verts = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0,
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const stride = 4 * 4;
    const aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0);
    const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, stride, 2 * 4);

    // The photo is filtered smoothly; the LUT uses LINEAR too, so red/green
    // interpolation comes free from the sampler (blue is blended in the shader).
    const imageTex = await loadTexture(gl, photo, true);
    const lutTex = await loadTexture(gl, lutAsset, true);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.uniform1i(gl.getUniformLocation(program, 'uLut'), 1);

    const p = characterFor(opts.camera, opts.characterStrength);
    const set = (name: string, value: number) =>
      gl.uniform1f(gl.getUniformLocation(program, name), value);
    set('uLutSize', LUT_SIZE);
    set('uHighlightRolloff', p.highlightRolloff);
    set('uVignette', p.vignette);
    set('uGrainShadow', p.grainShadow);
    set('uGrainHigh', p.grainHigh);
    set('uChromaNoise', p.chromaNoise);
    set('uBlackLift', p.blackLift);
    // Keep the seed in a range where sin() stays well-conditioned.
    set('uSeed', (opts.seed % 1000) + 1);

    // Render at the photo's own resolution so no detail is lost.
    const target = gl.createFramebuffer();
    const colour = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colour);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.endFrameEXP();

    const snapshot = await GLView.takeSnapshotAsync(gl, {
      format: 'jpeg',
      compress: 0.95,
      flip: false,
    });

    // Move the snapshot somewhere stable and predictable.
    const out = new File(Paths.cache, `vibecam_dev_${Date.now()}_${opts.seed}.jpg`);
    const snapUri = typeof snapshot.uri === 'string' ? snapshot.uri : String(snapshot.uri);
    const src = new File(snapUri);
    if (out.exists) out.delete();
    src.move(out);
    return out.uri;
  } finally {
    // Release the context even if rendering threw, so repeated failures can't leak.
    const loseContext = (gl as unknown as { getExtension?: (n: string) => unknown }).getExtension?.(
      'WEBGL_lose_context',
    ) as { loseContext?: () => void } | undefined;
    loseContext?.loseContext?.();
  }
}
