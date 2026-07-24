import React, { useCallback, useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useCameraPermissions } from 'expo-camera';

import { PermissionScreen, GalleryScreen, DoneScreen, UploadingScreen, PreviewScreen, CameraScreen } from './src/screens';
import { checkHealth, fetchGallery, uploadFile, gradePhoto } from './src/services/api';
import type { AppScreen, GalleryItem, SelectedFile } from './src/types';
import type { FilterId } from './src/filters';

export default function App() {
  const [camPerm, requestCam] = useCameraPermissions();
  const [screen, setScreen] = useState<AppScreen>('camera');
  const [backend, setBackend] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [hash, setHash] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [grading, setGrading] = useState(false);
  const [gradeName, setGradeName] = useState<string | null>(null);

  useEffect(() => { checkHealth().then(setBackend); }, []);

  // Photo captured + auto-saved → apply the selected pocket-camera emulation
  const onCapture = useCallback(async (f: SelectedFile, uri: string, camera: FilterId | 'auto') => {
    setFile(f); setCaptured(uri); setGradeName(null);
    const isImage = f.mimeType.startsWith('image/');
    if (isImage) setLastThumb(uri);

    // Backend renders the chosen camera's color science (photos only).
    if (backend && isImage) {
      setGrading(true);
      try {
        const { gradedUri, presetName } = await gradePhoto(uri, camera);
        setCaptured(gradedUri);
        setLastThumb(gradedUri);
        setFile({ ...f, uri: gradedUri });
        setGradeName(presetName);
      } catch {
        // Grading failed — keep the original photo
        setGradeName(null);
      } finally {
        setGrading(false);
      }
    }
    setScreen('preview');
  }, [backend]);

  const onShare = useCallback(async () => {
    if (!file || !(await Sharing.isAvailableAsync())) return;
    await Sharing.shareAsync(file.uri);
  }, [file]);

  // Optional cloud upload (secondary feature)
  const onUpload = useCallback(async () => {
    if (!file) return;
    setScreen('uploading'); setProgress(0); setHash(null);
    try {
      const h = await uploadFile(file, setProgress);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHash(h); setScreen('done');
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScreen('preview');
    }
  }, [file]);

  const onGallery = useCallback(async () => {
    try { const items = await fetchGallery(); setGallery(items); } catch { setGallery([]); }
    setScreen('gallery');
  }, []);

  const reset = useCallback(() => {
    setCaptured(null); setFile(null); setProgress(0); setHash(null); setGradeName(null); setScreen('camera');
  }, []);

  if (!camPerm?.granted) return <PermissionScreen onAllow={requestCam} />;
  if (screen === 'gallery') return <GalleryScreen gallery={gallery} onBack={reset} />;
  if (screen === 'done') return <DoneScreen hash={hash} onGallery={onGallery} onNew={reset} />;
  if (screen === 'uploading') return <UploadingScreen progress={progress} />;
  if (screen === 'preview' && file) return <PreviewScreen file={file} captured={captured} backendReady={backend} presetName={gradeName} onClose={reset} onSave={reset} onShare={onShare} onUpload={onUpload} onDelete={reset} />;
  return <CameraScreen onCapture={onCapture} onGallery={onGallery} lastThumb={lastThumb} />;
}
