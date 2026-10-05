import React, { useEffect, useRef } from 'react';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { createPhotoRenderer, type PhotoRenderer } from '../look/renderFrame';
import { loadPreviewLut } from '../look/previewSource';
import { previewCrop, type LivePreviewProps } from '../look/livePreview';

export const supportsLiveColour = true;

export function LiveLookPreview({ camera, mirrored, onStatus }: LivePreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    // CameraView's web implementation renders one video inside this finder.
    // Stay scoped to our own parent; never open a second camera stream.
    const video = element.parentElement?.querySelector('video');
    const gl = element.getContext('webgl', { premultipliedAlpha: false, alpha: false });
    if (!video || !gl) { onStatus('unavailable'); return; }
    const frame = document.createElement('canvas');
    const ctx = frame.getContext('2d');
    if (!ctx) { onStatus('unavailable'); return; }
    let renderer: PhotoRenderer | undefined;
    let cancelled = false, failed = false, raf = 0, lastDraw = 0, lastVideoTime = -1;
    let lastProgress = performance.now();
    let live = false;
    element.style.opacity = '0';
    onStatus('loading');
    const unavailable = () => {
      if (cancelled || failed) return;
      failed = true; live = false;
      element.style.opacity = '0';
      cancelAnimationFrame(raf);
      renderer?.dispose(); renderer = undefined;
      onStatus('unavailable');
    };
    const lost = (event: Event) => { event.preventDefault(); unavailable(); };
    const loadingTimeout = setTimeout(() => { if (!live) unavailable(); }, 4000);
    const visibility = () => {
      element.style.opacity = '0'; live = false;
      lastVideoTime = -1; lastProgress = performance.now();
      if (!failed && !cancelled) onStatus('loading');
    };
    element.addEventListener('webglcontextlost', lost);
    document.addEventListener('visibilitychange', visibility);
    void loadPreviewLut(camera).then(lut => {
      if (cancelled || failed) return;
      const draw = (now: number) => {
        if (cancelled || failed) return;
        raf = requestAnimationFrame(draw);
        if (document.hidden) return;
        if (now - lastProgress > 1500) { unavailable(); return; }
        if (now - lastDraw < 1000 / 24 || video.readyState < 2 || !video.videoWidth) return;
        if (lastVideoTime === video.currentTime) return;
        lastVideoTime = video.currentTime; lastProgress = now; lastDraw = now;
        const bounds = element.getBoundingClientRect();
        const scale = Math.min(window.devicePixelRatio || 1, 2, 1280 / Math.max(1, bounds.width, bounds.height));
        const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale));
        const crop = previewCrop(video.videoWidth, video.videoHeight, width, height);
        if (!crop) return;
        try {
          if (frame.width !== width || frame.height !== height) {
            frame.width = element.width = width; frame.height = element.height = height;
          }
          ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
          if (!renderer) renderer = createPhotoRenderer(gl as ExpoWebGLRenderingContext, frame, lut, width, height);
          else renderer.updatePhoto(frame);
          renderer.draw(width, height, { camera, characterStrength: 0, seed: 0 });
          element.style.opacity = '1';
          if (!live) { live = true; clearTimeout(loadingTimeout); onStatus('live'); }
        } catch { unavailable(); }
      };
      lastProgress = performance.now();
      raf = requestAnimationFrame(draw);
    }).catch(unavailable);
    return () => {
      cancelled = true; cancelAnimationFrame(raf);
      clearTimeout(loadingTimeout);
      element.style.opacity = '0';
      element.removeEventListener('webglcontextlost', lost);
      document.removeEventListener('visibilitychange', visibility);
      renderer?.dispose(); frame.width = frame.height = 0;
      setTimeout(() => { if (!element.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext(); }, 0);
    };
  }, [camera, onStatus]);
  return <canvas ref={canvas} aria-hidden data-live-colour style={{ position: 'absolute', inset: 0,
    width: '100%', height: '100%', pointerEvents: 'none', opacity: 0, transform: mirrored ? 'scaleX(-1)' : undefined }} />;
}
