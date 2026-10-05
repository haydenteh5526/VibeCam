export const PREVIEW_MAX_EDGE = 1280;

/** Bound the uploaded texture, not just its view. Never upscale small originals. */
export function previewDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Invalid photo dimensions');
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
