import { useEffect, useRef } from 'react';
import { normalizeRecipe } from '../photoRecipe';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { createPhotoRenderer, type PhotoRenderer, type RenderOptions } from './renderFrame';
import type { PreviewSource } from './previewSource';

export type PreviewStatus = 'loading' | 'ready' | 'unavailable';
export type PhotoSurfaceProps = {
  source: PreviewSource; width: number; height: number; options: RenderOptions;
  onStatus: (status: PreviewStatus) => void;
};

/** Each context belongs to one mounted surface. Release its GPU resources on exit. */
export function usePhotoSurface(gl: ExpoWebGLRenderingContext | null, { source, width, height, options, onStatus }: PhotoSurfaceProps) {
  const renderer = useRef<PhotoRenderer | null>(null);
  useEffect(() => {
    if (!gl) return;
    try { renderer.current = createPhotoRenderer(gl, source.photo, source.lut, source.width, source.height); }
    catch { onStatus('unavailable'); }
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, [gl, source, onStatus]);
  const { camera, seed, characterStrength, takenAt, recipe } = options;
  const { amount, exposure, warmth, character, dateStamp } = normalizeRecipe(recipe ?? { character: characterStrength });
  useEffect(() => {
    if (!gl || !renderer.current) return;
    const frame = requestAnimationFrame(() => {
      try {
        renderer.current?.draw(gl.drawingBufferWidth, gl.drawingBufferHeight, {
          camera, seed, characterStrength, takenAt,
          recipe: { amount, exposure, warmth, character, dateStamp },
        });
        gl.endFrameEXP?.();
        onStatus('ready');
      } catch { onStatus('unavailable'); }
    });
    return () => cancelAnimationFrame(frame);
    // Scalar recipe values keep save/favourite metadata updates from redrawing.
  }, [gl, source, width, height, camera, seed, characterStrength, takenAt, amount, exposure, warmth, character, dateStamp, onStatus]);
}
