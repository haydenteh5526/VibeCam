/**
 * GLSL for the on-device look engine.
 *
 * One fragment pass: LUT colour transform, then highlight rolloff, black lift, vignette
 * and grain. Written against GLSL ES 1.00 (WebGL 1 / expo-gl), so no texture3D — the LUT
 * arrives as a 2D strip and trilinear interpolation is done manually, matching
 * `look/lut.ts` and `backend/lut.py`.
 */

export const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vTexCoord;

uniform sampler2D uImage;
uniform sampler2D uLut;
uniform float uLutSize;        // points per axis, e.g. 17.0

uniform float uHighlightRolloff;
uniform float uVignette;       // percent
uniform float uGrainShadow;    // 0-255 scale
uniform float uGrainHigh;
uniform float uChromaNoise;
uniform float uBlackLift;      // 0-255 scale
uniform float uSeed;

// Sample one blue slice of the LUT strip at (r, g). The strip is size*size wide by
// size tall: slice b occupies x in [b/size, (b+1)/size).
vec3 lutSlice(float b, vec2 rg) {
  float sliceWidth = 1.0 / uLutSize;
  // Half-texel inset stops bilinear filtering from bleeding across slice boundaries.
  float half_ = 0.5 / (uLutSize * uLutSize);
  float x = (b + clamp(rg.x, 0.0, 1.0)) * sliceWidth;
  x = clamp(x, b * sliceWidth + half_, (b + 1.0) * sliceWidth - half_);
  float y = clamp(rg.y, 0.0, 1.0);
  return texture2D(uLut, vec2(x, y)).rgb;
}

// Trilinear LUT lookup: interpolate red and green within a slice (bilinear filtering
// handles those), then blend between the two nearest blue slices.
vec3 applyLut(vec3 c) {
  float maxIdx = uLutSize - 1.0;
  vec3 p = clamp(c, 0.0, 1.0);
  float bPos = p.b * maxIdx;
  float b0 = floor(bPos);
  float b1 = min(b0 + 1.0, maxIdx);
  float fb = bPos - b0;

  // Red/green are addressed in normalised slice space.
  vec2 rg = vec2(p.r, p.g);
  vec3 c0 = lutSlice(b0, rg);
  vec3 c1 = lutSlice(b1, rg);
  return mix(c0, c1, fb);
}

// Matches _highlight_rolloff in backend/character.py.
vec3 rolloff(vec3 c, float amount) {
  if (amount <= 0.0) return c;
  float knee = 0.6;
  vec3 over = clamp((c - knee) / (1.0 - knee), 0.0, 1.0);
  vec3 compressed = knee + (1.0 - knee) * (1.0 - pow(1.0 - over, vec3(1.0 + 2.2 * amount)));
  return mix(c, compressed, step(vec3(knee), c));
}

// Cheap hash-based noise: deterministic for a given pixel and seed, so the same frame
// develops identically (the backend guarantees the same property).
float hash(vec2 p, float salt) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + salt) * 43758.5453);
}

void main() {
  vec3 src = texture2D(uImage, vTexCoord).rgb;
  vec3 c = applyLut(src);

  c = rolloff(c, uHighlightRolloff);

  if (uBlackLift > 0.0) {
    float lift = uBlackLift / 255.0;
    c = c * (1.0 - lift) + lift;
  }

  if (uVignette > 0.0) {
    vec2 d = vTexCoord - vec2(0.5);
    // Normalised so 1.0 is the corner, matching _radial in character.py.
    float r = length(d) / length(vec2(0.5));
    c *= 1.0 - (uVignette / 100.0) * pow(r, 2.2);
  }

  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float gain = (uGrainShadow * pow(1.0 - clamp(lum, 0.0, 1.0), 1.5) + uGrainHigh * lum) / 255.0;
  if (gain > 0.0) {
    // Two hashes combined approximate a normal distribution better than one.
    float n = (hash(vTexCoord * 1024.0, uSeed) + hash(vTexCoord * 1024.0, uSeed + 17.0)) - 1.0;
    c += n * gain;
  }
  if (uChromaNoise > 0.0) {
    float s = uChromaNoise / 255.0;
    c += vec3(
      (hash(vTexCoord * 977.0, uSeed + 1.0) - 0.5) * s,
      (hash(vTexCoord * 977.0, uSeed + 2.0) - 0.5) * s,
      (hash(vTexCoord * 977.0, uSeed + 3.0) - 0.5) * s
    );
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
