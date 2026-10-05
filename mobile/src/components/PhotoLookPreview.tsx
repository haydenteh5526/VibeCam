import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { preparePreviewPhoto, loadPreviewLut, type PreviewPhoto } from '../look/previewSource';
import type { RenderOptions, TextureSource } from '../look/renderFrame';
import type { PreviewStatus } from '../look/usePhotoSurface';
import { PhotoSurface } from './PhotoSurface';

export function PhotoLookPreview({ uri, width, height, options, onStatus, hidden }: {
  uri: string; width: number; height: number; options: RenderOptions;
  onStatus: (status: PreviewStatus) => void; hidden: boolean;
}) {
  const [loaded, setLoaded] = useState<{ uri: string; photo: PreviewPhoto }>();
  const [lut, setLut] = useState<{ camera: string; texture: TextureSource }>();
  const camera = options.camera;
  useEffect(() => {
    let cancelled = false;
    let photo: PreviewPhoto | undefined;
    onStatus('loading');
    void preparePreviewPhoto(uri).then(result => {
      if (cancelled) { result.dispose(); return; }
      photo = result; setLoaded({ uri, photo });
    }).catch(() => { if (!cancelled) onStatus('unavailable'); });
    return () => { cancelled = true; photo?.dispose(); };
  }, [uri, onStatus]);
  useEffect(() => {
    let cancelled = false;
    onStatus('loading');
    void loadPreviewLut(camera).then(texture => {
      if (!cancelled) setLut({ camera, texture });
    }).catch(() => { if (!cancelled) onStatus('unavailable'); });
    return () => { cancelled = true; };
  }, [camera, onStatus]);
  const source = useMemo(() => loaded?.uri === uri && lut?.camera === camera
    ? { ...loaded.photo, lut: lut.texture } : null, [loaded, lut, uri, camera]);
  if (!source || !width || !height) return null;
  const scale = Math.min(width / source.width, height / source.height);
  return <View pointerEvents="none" style={[styles.surface, hidden && { opacity: 0 }]}>
    <PhotoSurface key={camera} source={source} width={source.width * scale} height={source.height * scale} options={options} onStatus={onStatus} />
  </View>;
}
const styles = StyleSheet.create({
  surface: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#080a07' },
});
