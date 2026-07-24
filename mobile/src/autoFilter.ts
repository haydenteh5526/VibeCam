import { FILTERS, type FilterId } from './filters';

type SceneContext = {
  brightness: 'low' | 'normal' | 'bright';
  timeOfDay: 'golden' | 'day' | 'night';
  hasPortrait: boolean;
};

function getTimeOfDay(): 'golden' | 'day' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 6 && hour <= 8) return 'golden';   // sunrise
  if (hour >= 17 && hour <= 19) return 'golden';  // sunset
  if (hour >= 9 && hour <= 16) return 'day';
  return 'night';
}

/**
 * Picks the best point-and-shoot camera emulation for the current scene.
 * This drives the live-preview wash only; on capture the backend re-analyzes
 * the full-resolution pixels and may refine the choice.
 *
 * - Golden hour            -> Canon G7X III (warm, flattering skin tones)
 * - Night / low light      -> CCD digicam (nostalgic noisy flash look)
 * - Bright daylight + face  -> Canon G7X III (great skin rendering)
 * - Bright daylight, no face-> Ricoh GR III (punchy high-contrast scenes)
 * - Normal light + face     -> Canon G7X III
 * - Normal light, no face   -> Sony RX100 (crisp, true-to-life)
 */
export function pickBestFilter(context: Partial<SceneContext> = {}): FilterId {
  const time = context.timeOfDay ?? getTimeOfDay();
  const brightness = context.brightness ?? 'normal';
  const hasPortrait = context.hasPortrait ?? false;

  if (time === 'night' || brightness === 'low') return 'ccd';
  if (time === 'golden') return 'g7x';
  if (brightness === 'bright' && hasPortrait) return 'g7x';
  if (brightness === 'bright' && !hasPortrait) return 'gr';
  if (hasPortrait) return 'g7x';
  return 'rx100';
}

export function getFilterName(id: FilterId): string {
  return FILTERS.find(f => f.id === id)?.name ?? 'Original';
}
