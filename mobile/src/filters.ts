export type FilterId = 'original' | 'fuji' | 'kodak' | 'ccd' | 'vintage' | 'bw' | 'polaroid' | 'cinema' | 'fade';

export type FilterPreset = {
  id: FilterId;
  name: string;
  style: {
    opacity?: number;
    tintColor?: string;
    overlayColor?: string;
    overlayOpacity?: number;
    contrast?: number;
    saturate?: number;
  };
};

export const FILTERS: FilterPreset[] = [
  { id: 'original', name: 'Original', style: {} },
  { id: 'fuji', name: 'Fuji 400H', style: { overlayColor: '#1a5c3a', overlayOpacity: 0.08, opacity: 0.95 } },
  { id: 'kodak', name: 'Kodak Gold', style: { overlayColor: '#d4a017', overlayOpacity: 0.12, opacity: 0.93 } },
  { id: 'ccd', name: 'CCD', style: { overlayColor: '#ff6b9d', overlayOpacity: 0.06, opacity: 0.97 } },
  { id: 'vintage', name: 'Vintage', style: { overlayColor: '#8b6914', overlayOpacity: 0.15, opacity: 0.88 } },
  { id: 'bw', name: 'B&W', style: { tintColor: '#808080', opacity: 0.95 } },
  { id: 'polaroid', name: 'Polaroid', style: { overlayColor: '#f5e6d3', overlayOpacity: 0.1, opacity: 0.92 } },
  { id: 'cinema', name: 'Cinema', style: { overlayColor: '#1a237e', overlayOpacity: 0.1, opacity: 0.9 } },
  { id: 'fade', name: 'Fade', style: { overlayColor: '#e8e8e8', overlayOpacity: 0.18, opacity: 0.85 } },
];
