import type { FilterId } from '../filters';

/** One scene, rendered with the actual photo shader and default recipe. */
export const LOOK_SAMPLES: Record<FilterId, number> = {
  original: require('../../assets/look-samples/original.jpg'),
  g7x: require('../../assets/look-samples/g7x.jpg'),
  rx100: require('../../assets/look-samples/rx100.jpg'),
  gr: require('../../assets/look-samples/gr.jpg'),
  x100: require('../../assets/look-samples/x100.jpg'),
  ccd: require('../../assets/look-samples/ccd.jpg'),
  powershot: require('../../assets/look-samples/powershot.jpg'),
};
