import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { loadPreviewSource, type PreviewSource } from '../look/previewSource';
import type { RenderOptions } from '../look/renderFrame';
import type { PreviewStatus } from '../look/usePhotoSurface';
import { PhotoSurface } from './PhotoSurface';

export function PhotoLookPreview({ uri, width, height, options, onStatus, hidden }: {
  uri: string; width: number; height: number; options: RenderOptions;
  onStatus: (status: PreviewStatus) => void; hidden: boolean;
}) {
  const [loaded, setLoaded] = useState<{ uri: string; camera: string; source: PreviewSource }>();
  const camera = options.camera;
  useEffect(() => {
    let cancelled = false;
    onStatus('loading');
    void loadPreviewSource(uri, camera).then(source => {
      if (!cancelled) setLoaded({ uri, camera, source });
    }).catch(() => { if (!cancelled) onStatus('unavailable'); });
    return () => { cancelled = true; };
  }, [uri, camera, onStatus]);
  if (!loaded || loaded.uri !== uri || loaded.camera !== camera || !width || !height) return null;
  const scale = Math.min(width / loaded.source.width, height / loaded.source.height);
  return <View pointerEvents="none" style={[styles.surface, hidden && { opacity: 0 }]}>
    <PhotoSurface key={camera} source={loaded.source} width={loaded.source.width * scale} height={loaded.source.height * scale} options={options} onStatus={onStatus} />
  </View>;
}
const styles = StyleSheet.create({
  surface: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#080a07' },
});
