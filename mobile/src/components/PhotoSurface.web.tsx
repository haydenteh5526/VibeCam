import React, { useEffect, useRef, useState } from 'react';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { usePhotoSurface, type PhotoSurfaceProps } from '../look/usePhotoSurface';

export function PhotoSurface(props: PhotoSurfaceProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gl, setGL] = useState<ExpoWebGLRenderingContext | null>(null);
  usePhotoSurface(gl, props);
  const { onStatus } = props;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('webgl', { premultipliedAlpha: false });
    if (!context) { onStatus('unavailable'); return; }
    const lost = (event: Event) => { event.preventDefault(); onStatus('unavailable'); };
    element?.addEventListener('webglcontextlost', lost);
    setGL(context as ExpoWebGLRenderingContext);
    return () => {
      element?.removeEventListener('webglcontextlost', lost);
      // Strict Mode may replay the effect on the same mounted canvas. Only lose
      // its context once the element has actually left the document.
      setTimeout(() => { if (!element?.isConnected) context.getExtension('WEBGL_lose_context')?.loseContext(); }, 0);
    };
  }, [onStatus]);
  // Enough pixels for an on-screen preview; full-resolution export uses its own target.
  const scale = Math.min(window.devicePixelRatio || 1, 2, 1280 / Math.max(props.width, props.height));
  return <canvas ref={canvas} aria-hidden width={Math.max(1, Math.round(props.width * scale))}
    height={Math.max(1, Math.round(props.height * scale))} style={{ display: 'block', width: props.width, height: props.height }} />;
}
