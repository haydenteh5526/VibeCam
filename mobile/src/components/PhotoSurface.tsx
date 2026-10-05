import React, { useState } from 'react';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { usePhotoSurface, type PhotoSurfaceProps } from '../look/usePhotoSurface';

export function PhotoSurface(props: PhotoSurfaceProps) {
  const [gl, setGL] = useState<ExpoWebGLRenderingContext | null>(null);
  usePhotoSurface(gl, props);
  return <GLView style={{ width: props.width, height: props.height }} msaaSamples={0} onContextCreate={setGL} />;
}
