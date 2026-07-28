import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHARACTER, characterFor } from '../look/characterParams';
import { FRAGMENT_SHADER, VERTEX_SHADER } from '../look/shader';

const CAMERAS = ['g7x', 'rx100', 'gr', 'x100', 'ccd', 'powershot'] as const;

test('every camera has character parameters', () => {
  for (const c of CAMERAS) {
    assert.ok(CHARACTER[c], `${c} missing`);
  }
});

test('characterFor scales linearly with strength', () => {
  const full = characterFor('ccd', 1);
  const half = characterFor('ccd', 0.5);
  assert.ok(Math.abs(half.vignette - full.vignette / 2) < 1e-6);
  assert.ok(Math.abs(half.grainShadow - full.grainShadow / 2) < 1e-6);
});

test('characterFor returns a neutral set at zero strength', () => {
  const p = characterFor('ccd', 0);
  for (const v of Object.values(p)) assert.equal(v, 0);
});

test('characterFor is neutral for unknown cameras', () => {
  const p = characterFor('hasselblad', 1);
  for (const v of Object.values(p)) assert.equal(v, 0);
});

test('characterFor clamps strength to the backend range', () => {
  // Backend accepts 0..1.5; anything beyond must not amplify further.
  const high = characterFor('ccd', 99);
  const max = characterFor('ccd', 1.5);
  assert.deepEqual(high, max);
  const negative = characterFor('ccd', -5);
  for (const v of Object.values(negative)) assert.equal(v, 0);
});

test('characterFor survives non-finite strength', () => {
  const p = characterFor('ccd', NaN);
  // Falls back to normal strength rather than producing NaN uniforms, which would
  // render a black or transparent frame.
  assert.deepEqual(p, characterFor('ccd', 1));
});

test('ccd is the grittiest camera and rx100 the cleanest', () => {
  // Sanity check that the values weren't transcribed in the wrong order.
  const noisiest = CAMERAS.reduce((a, b) =>
    CHARACTER[a].grainShadow > CHARACTER[b].grainShadow ? a : b,
  );
  const cleanest = CAMERAS.reduce((a, b) =>
    CHARACTER[a].grainShadow < CHARACTER[b].grainShadow ? a : b,
  );
  assert.equal(noisiest, 'ccd');
  assert.equal(cleanest, 'rx100');
});

test('all parameters are finite and non-negative', () => {
  for (const c of CAMERAS) {
    for (const [k, v] of Object.entries(CHARACTER[c])) {
      assert.ok(Number.isFinite(v), `${c}.${k} not finite`);
      assert.ok(v >= 0, `${c}.${k} negative`);
    }
  }
});

// ─── Shader source sanity ───────────────────────────────────────────────────────
// The shader can only be compiled on a device, so these guard against the mistakes
// that are otherwise silent until runtime: a missing uniform, or a uniform the
// renderer sets that the shader never declares.

test('fragment shader declares every uniform the renderer sets', () => {
  const required = [
    'uImage', 'uLut', 'uLutSize', 'uHighlightRolloff', 'uVignette',
    'uGrainShadow', 'uGrainHigh', 'uChromaNoise', 'uBlackLift', 'uSeed',
  ];
  for (const name of required) {
    assert.ok(FRAGMENT_SHADER.includes(name), `shader missing uniform ${name}`);
  }
});

test('shaders declare matching attributes', () => {
  for (const name of ['aPosition', 'aTexCoord']) {
    assert.ok(VERTEX_SHADER.includes(name), `vertex shader missing ${name}`);
  }
  assert.ok(VERTEX_SHADER.includes('vTexCoord'));
  assert.ok(FRAGMENT_SHADER.includes('vTexCoord'));
});

test('fragment shader sets a precision qualifier', () => {
  // Required in GLSL ES 1.00; omitting it fails to compile on some drivers.
  assert.match(FRAGMENT_SHADER, /precision\s+(highp|mediump)\s+float/);
});

test('fragment shader clamps its output', () => {
  // Unclamped values can render as artefacts on some GPUs.
  assert.match(FRAGMENT_SHADER, /gl_FragColor\s*=\s*vec4\(\s*clamp\(/);
});

test('shader uses no GLSL ES 3.00-only syntax', () => {
  // expo-gl provides a WebGL 1 context, so these would fail to compile.
  for (const banned of ['texture3D', 'texture(', 'out vec4', 'in vec2 ', '#version 300']) {
    assert.ok(!FRAGMENT_SHADER.includes(banned), `shader uses unsupported ${banned}`);
  }
});
