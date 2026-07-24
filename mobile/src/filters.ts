// Point-and-shoot pocket camera emulations.
// `FilterId` values MUST match the backend camera ids (see backend/grading.py CAMERAS),
// because the selected id is sent to POST /grade via the `X-Camera` header and the
// backend applies that camera's color science to the captured photo.
//
// The `style` here only drives the *live viewfinder* preview wash — a lightweight
// approximation. The real, high-quality look is rendered server-side on capture.

export type FilterId = 'original' | 'g7x' | 'rx100' | 'gr' | 'x100' | 'ccd' | 'powershot';

export type FilterPreset = {
  id: FilterId;
  name: string;      // short label shown on the chip
  tagline: string;   // one-line description of the camera's look
  dot: string;       // chip indicator color
  style: {
    overlayColor?: string;
    overlayOpacity?: number;
  };
};

export const FILTERS: FilterPreset[] = [
  { id: 'original', name: 'Original', tagline: 'No processing', dot: '#8e8e93', style: {} },
  { id: 'g7x', name: 'G7X III', tagline: 'Canon warmth · punchy skin tones', dot: '#ff9e3d', style: { overlayColor: '#ff9e3d', overlayOpacity: 0.06 } },
  { id: 'rx100', name: 'RX100', tagline: 'Sony crisp · true-to-life', dot: '#5b8cff', style: { overlayColor: '#5b8cff', overlayOpacity: 0.03 } },
  { id: 'gr', name: 'Ricoh GR', tagline: 'High-contrast street · deep blacks', dot: '#c9ccd1', style: { overlayColor: '#15181d', overlayOpacity: 0.07 } },
  { id: 'x100', name: 'X100', tagline: 'Classic Chrome · muted film', dot: '#b09a6a', style: { overlayColor: '#8a7d5a', overlayOpacity: 0.08 } },
  { id: 'ccd', name: 'CCD', tagline: 'Y2K digicam · nostalgic flash', dot: '#38d6b0', style: { overlayColor: '#2fbfa6', overlayOpacity: 0.05 } },
  { id: 'powershot', name: 'PowerShot', tagline: 'Retro Canon · party flash', dot: '#ffb84d', style: { overlayColor: '#ffb84d', overlayOpacity: 0.07 } },
];
