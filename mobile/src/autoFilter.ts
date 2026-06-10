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
 * Picks the best filter based on scene context.
 * 
 * Logic:
 * - Golden hour → Kodak Gold (warm tones complement golden light)
 * - Night/low light → Cinema (cool blue tones suit night scenes)
 * - Bright daylight + portrait → Fuji 400H (flattering skin tones, soft greens)
 * - Bright daylight + no portrait → Fade (airy, editorial feel)
 * - Normal light + portrait → CCD (slight pink warmth, trendy)
 * - Normal light + no portrait → Polaroid (nostalgic, versatile)
 */
export function pickBestFilter(context: Partial<SceneContext> = {}): FilterId {
  const time = context.timeOfDay ?? getTimeOfDay();
  const brightness = context.brightness ?? 'normal';
  const hasPortrait = context.hasPortrait ?? false;

  if (time === 'golden') return 'kodak';
  if (time === 'night' || brightness === 'low') return 'cinema';
  if (brightness === 'bright' && hasPortrait) return 'fuji';
  if (brightness === 'bright' && !hasPortrait) return 'fade';
  if (hasPortrait) return 'ccd';
  return 'polaroid';
}

export function getFilterName(id: FilterId): string {
  return FILTERS.find(f => f.id === id)?.name ?? 'Original';
}
