import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { characterFor } from './characterParams';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';

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

async function loadTexture(gl: ExpoWebGLRenderingContext, asset: { localUri: string | null }, smooth: boolean): Promise<WebGLTexture> {
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

export async function renderToFramebuffer(
  gl: ExpoWebGLRenderingContext, photo: { localUri: string | null }, lutAsset: { localUri: string | null },
  width: number, height: number, opts: { camera: string; characterStrength: number; seed: number },
): Promise<WebGLFramebuffer> {
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
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.flush();
  if (gl.getError() !== gl.NO_ERROR) throw new Error('Photo rendering failed');
  return target;

}
