import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { characterFor } from './characterParams';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';
import { normalizeRecipe, type PhotoRecipe } from '../photoRecipe';

export const LUT_SIZE = 17;

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

export type TextureSource = { localUri: string | null } | TexImageSource;
function loadTexture(gl: ExpoWebGLRenderingContext, asset: TextureSource, smooth: boolean): WebGLTexture {
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

export type RenderOptions = { camera: string; characterStrength: number; seed: number; recipe?: PhotoRecipe; takenAt?: number };
export type PhotoRenderer = {
  draw: (width: number, height: number, opts: RenderOptions, target?: WebGLFramebuffer | null) => void;
  dispose: () => void;
};

/** Upload once; only uniforms change while adjusting a photo. No files or per-frame loop. */
export function createPhotoRenderer(
  gl: ExpoWebGLRenderingContext, photo: TextureSource, lutAsset: TextureSource,
  width: number, height: number,
): PhotoRenderer {
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (!width || !height || width > max || height > max) throw new Error('Photo exceeds this device GPU limit');
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

  // LINEAR filtering handles red/blue; green slices are blended in the shader.
  const imageTex = loadTexture(gl, photo, true);
  const lutTex = loadTexture(gl, lutAsset, true);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imageTex);
  gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.uniform1i(gl.getUniformLocation(program, 'uLut'), 1);

  let disposed = false;
  return {
    draw(drawWidth, drawHeight, opts, target = null) {
      if (disposed) throw new Error('Photo preview has closed');
      // WebGL reports CONTEXT_LOST only once through getError(). Later no-op draws
      // must not be mistaken for a recovered preview. Expo GL implements this too.
      if (gl.isContextLost()) throw new Error('Photo graphics context is unavailable');
      gl.useProgram(program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, drawWidth, drawHeight);
      const recipe = normalizeRecipe(opts.recipe ?? { character: opts.characterStrength });
      const p = characterFor(opts.camera, recipe.character * recipe.amount);
      const set = (name: string, value: number) =>
        gl.uniform1f(gl.getUniformLocation(program, name), value);
      set('uLutSize', LUT_SIZE);
      set('uAmount', recipe.amount);
      set('uExposure', recipe.exposure);
      set('uWarmth', recipe.warmth);
      gl.uniform2f(gl.getUniformLocation(program, 'uImageSize'), width, height);
      const date = new Date(opts.takenAt ?? 0);
      set('uDateStamp', recipe.dateStamp && !!opts.takenAt ? 1 : 0);
      gl.uniform3f(gl.getUniformLocation(program, 'uDate'), date.getFullYear() % 100, date.getMonth() + 1, date.getDate());
      set('uHighlightRolloff', p.highlightRolloff);
      set('uVignette', p.vignette);
      set('uGrainShadow', p.grainShadow);
      set('uGrainHigh', p.grainHigh);
      set('uChromaNoise', p.chromaNoise);
      set('uBlackLift', p.blackLift);
      // Keep the seed in a range where sin() stays well-conditioned.
      set('uSeed', (opts.seed % 1000) + 1);

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.flush();
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Photo rendering failed');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteTexture(imageTex); gl.deleteTexture(lutTex);
      gl.deleteBuffer(buffer); gl.deleteProgram(program);
    },
  };
}

export async function renderToFramebuffer(
  gl: ExpoWebGLRenderingContext, photo: TextureSource, lutAsset: TextureSource,
  width: number, height: number, opts: RenderOptions,
): Promise<WebGLFramebuffer> {
  const renderer = createPhotoRenderer(gl, photo, lutAsset, width, height);
  try {
    // Render at the photo's own resolution so no detail is lost.
    const target = gl.createFramebuffer();
    const colour = gl.createTexture();
    if (!target || !colour) throw new Error('Could not allocate photo render target');
    // Allocate on a separate unit; units 0 and 1 must keep the photo and LUT.
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, colour);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Photo render target is incomplete');
    }
    renderer.draw(width, height, opts, target);
    return target;
  } finally { renderer.dispose(); }
}
