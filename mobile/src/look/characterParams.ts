/**
 * Per-camera character parameters for the on-device shader.
 *
 * Mirrors the subset of `backend/character.py` CHARACTER that a fragment shader can do
 * cheaply in one pass. Deliberately not the whole thing:
 *
 *   included — highlight rolloff, vignette, luminance-dependent grain, chroma noise
 *   omitted  — halation, chromatic aberration, corner softness, unsharp mask
 *
 * The omitted effects need neighbourhood sampling (blur passes), which would mean
 * multiple render targets. They stay server-side; when the backend is reachable it
 * re-renders with the full character layer. Keeping the on-device set honest matters more
 * than matching every parameter, because a half-applied blur looks worse than none.
 */
import type { FilterId } from '../filters';

export type CharacterParams = {
  /** Early highlight compression, 0–1. */
  highlightRolloff: number;
  /** Corner light falloff, percent. */
  vignette: number;
  /** Luminance noise sigma in shadows (0–255 scale). */
  grainShadow: number;
  /** Luminance noise sigma in highlights. */
  grainHigh: number;
  /** Per-channel colour speckle. */
  chromaNoise: number;
  /** Raised black floor, 0–255. */
  blackLift: number;
};

/** Values copied from backend/character.py so the two stay comparable. */
export const CHARACTER: Record<Exclude<FilterId, 'original'>, CharacterParams> = {
  g7x: { highlightRolloff: 0.30, vignette: 12, grainShadow: 2.6, grainHigh: 0.8, chromaNoise: 0.5, blackLift: 2 },
  rx100: { highlightRolloff: 0.24, vignette: 9, grainShadow: 2.0, grainHigh: 0.6, chromaNoise: 0.35, blackLift: 1 },
  gr: { highlightRolloff: 0.20, vignette: 16, grainShadow: 3.2, grainHigh: 1.0, chromaNoise: 0.3, blackLift: 0 },
  x100: { highlightRolloff: 0.34, vignette: 14, grainShadow: 3.0, grainHigh: 1.2, chromaNoise: 0.3, blackLift: 3 },
  ccd: { highlightRolloff: 0.55, vignette: 26, grainShadow: 6.5, grainHigh: 2.4, chromaNoise: 2.6, blackLift: 7 },
  powershot: { highlightRolloff: 0.46, vignette: 22, grainShadow: 5.0, grainHigh: 1.8, chromaNoise: 1.7, blackLift: 5 },
};

const NEUTRAL: CharacterParams = {
  highlightRolloff: 0,
  vignette: 0,
  grainShadow: 0,
  grainHigh: 0,
  chromaNoise: 0,
  blackLift: 0,
};

/**
 * Resolve parameters for a camera, scaled by the user's character strength.
 *
 * Unknown cameras and zero strength both yield a neutral (no-op) set, so the shader can
 * always run with valid uniforms rather than branching.
 */
export function characterFor(camera: string, strength: number): CharacterParams {
  const base = (CHARACTER as Record<string, CharacterParams | undefined>)[camera];
  if (!base) return NEUTRAL;
  const s = Number.isFinite(strength) ? Math.min(1.5, Math.max(0, strength)) : 1;
  if (s === 0) return NEUTRAL;
  return {
    highlightRolloff: base.highlightRolloff * s,
    vignette: base.vignette * s,
    grainShadow: base.grainShadow * s,
    grainHigh: base.grainHigh * s,
    chromaNoise: base.chromaNoise * s,
    blackLift: base.blackLift * s,
  };
}
