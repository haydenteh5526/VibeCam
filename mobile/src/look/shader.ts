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
uniform float uAmount;
uniform float uExposure;
uniform float uWarmth;
uniform vec2 uImageSize;
uniform float uDateStamp;
uniform vec3 uDate;

uniform float uHighlightRolloff;
uniform float uVignette;       // percent
uniform float uGrainShadow;    // 0-255 scale
uniform float uGrainHigh;
uniform float uChromaNoise;
uniform float uBlackLift;      // 0-255 scale
uniform float uSeed;

// Bundled PNGs store the .cube sequence directly: red fastest, green next,
// blue by row. A green slice occupies x in [g/size, (g+1)/size).
vec3 lutSlice(float g, vec2 rb) {
  // Address texel centres. Clamping slice edges alone distorts midtone interpolation.
  float x = (g * uLutSize + clamp(rb.x, 0.0, 1.0) * (uLutSize - 1.0) + 0.5)
    / (uLutSize * uLutSize);
  float y = (clamp(rb.y, 0.0, 1.0) * (uLutSize - 1.0) + 0.5) / uLutSize;
  return texture2D(uLut, vec2(x, y)).rgb;
}

// Bilinear filtering interpolates red/blue. Blend the two green slices explicitly.
vec3 applyLut(vec3 c) {
  float maxIdx = uLutSize - 1.0;
  vec3 p = clamp(c, 0.0, 1.0);
  float gPos = p.g * maxIdx;
  float g0 = floor(gPos);
  float g1 = min(g0 + 1.0, maxIdx);
  float fg = gPos - g0;

  vec2 rb = vec2(p.r, p.b);
  vec3 c0 = lutSlice(g0, rb);
  vec3 c1 = lutSlice(g1, rb);
  return mix(c0, c1, fg);
}

// Matches _highlight_rolloff in backend/character.py.
vec3 rolloff(vec3 c, float amount) {
  if (amount <= 0.0) return c;
  float knee = 0.6;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float over = max(0.0, lum - knee);
  float compressed = knee + over / (1.0 + amount * over / (1.0 - knee));
  return lum > knee ? c * (compressed / lum) : c;
}

// Cheap hash-based noise: deterministic for a given pixel and seed, so the same frame
// develops identically (the backend guarantees the same property).
float hash(vec2 p, float salt) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + salt) * 43758.5453);
}

float box(vec2 p, vec2 lo, vec2 hi) {
  return step(lo.x, p.x) * step(lo.y, p.y) * step(p.x, hi.x) * step(p.y, hi.y);
}
float digit(vec2 p, float d) {
  float mask = 63.0;
  if (d < 0.5) mask = 63.0;
  else if (d < 1.5) mask = 6.0;
  else if (d < 2.5) mask = 91.0;
  else if (d < 3.5) mask = 79.0;
  else if (d < 4.5) mask = 102.0;
  else if (d < 5.5) mask = 109.0;
  else if (d < 6.5) mask = 125.0;
  else if (d < 7.5) mask = 7.0;
  else if (d < 8.5) mask = 127.0;
  else mask = 111.0;
  float v = mod(mask, 2.0) * box(p, vec2(.18,.06), vec2(.82,.16));
  v += mod(floor(mask/2.0),2.0) * box(p,vec2(.78,.13),vec2(.90,.49));
  v += mod(floor(mask/4.0),2.0) * box(p,vec2(.78,.51),vec2(.90,.87));
  v += mod(floor(mask/8.0),2.0) * box(p,vec2(.18,.84),vec2(.82,.94));
  v += mod(floor(mask/16.0),2.0) * box(p,vec2(.10,.51),vec2(.22,.87));
  v += mod(floor(mask/32.0),2.0) * box(p,vec2(.10,.13),vec2(.22,.49));
  v += mod(floor(mask/64.0),2.0) * box(p,vec2(.18,.45),vec2(.82,.55));
  return min(v, 1.0);
}
float dateInk(vec2 pixel) {
  float h = min(uImageSize.x, uImageSize.y) * .032;
  vec2 origin = vec2(uImageSize.x - h * 5.6 - uImageSize.x * .035, uImageSize.y - h * 1.9);
  vec2 p = (pixel - origin) / vec2(h * .7, h);
  float slot = floor(p.x);
  if (slot < 0.0 || slot > 7.0 || slot == 2.0 || slot == 5.0) return 0.0;
  float n = slot < 2.0 ? uDate.x : slot < 5.0 ? uDate.y : uDate.z;
  float d = (slot == 0.0 || slot == 3.0 || slot == 6.0) ? floor(n / 10.0) : mod(n, 10.0);
  return digit(vec2(fract(p.x), p.y), d);
}

void main() {
  vec3 src = texture2D(uImage, vTexCoord).rgb;
  // Digital exposure and white-balance trim happen before the camera transform.
  src = clamp(src * pow(2.0, uExposure) * vec3(1.0 + uWarmth * .12, 1.0, 1.0 - uWarmth * .12), 0.0, 1.0);
  vec3 c = mix(src, applyLut(src), uAmount);

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

  if (uDateStamp > .5) {
    vec2 pixel = vTexCoord * uImageSize;
    c *= 1.0 - .65 * dateInk(pixel - vec2(max(1.0, uImageSize.x / 1400.0)));
    c = mix(c, vec3(1.0, .55, .16), dateInk(pixel));
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
