export type LivePreviewStatus = 'loading' | 'live' | 'unavailable';
export type LivePreviewProps = {
  camera: string;
  mirrored: boolean;
  onStatus: (status: LivePreviewStatus) => void;
};

/** Centre crop shared with the native aspect-fill viewfinder. */
export function previewCrop(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  if (![sourceWidth, sourceHeight, width, height].every(v => Number.isFinite(v) && v > 0)) return null;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const w = width / scale, h = height / scale;
  return { x: (sourceWidth - w) / 2, y: (sourceHeight - h) / 2, width: w, height: h };
}

export function previewCaption(camera: string, mode: 'photo' | 'video', original: boolean, status: LivePreviewStatus) {
  if (camera === 'original') return 'Original · no look applied';
  if (camera === 'auto') return 'Look chosen after capture';
  if (original) return 'Original preview · look still applied to your shot';
  if (status === 'live') return mode === 'photo' ? 'Live colour · texture added after capture' : 'Live colour';
  if (status === 'loading') return 'Starting live colour…';
  return `Look applied after ${mode === 'photo' ? 'capture' : 'recording'}`;
}
