import React, { useCallback, useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useCameraPermissions } from 'expo-camera';

import { PermissionScreen, GalleryScreen, DoneScreen, UploadingScreen, PreviewScreen, CameraScreen } from './src/screens';
import { checkHealth, fetchGallery, uploadFile, gradePhoto } from './src/services/api';
import type { AppScreen, GalleryItem, SelectedFile } from './src/types';
import type { FilterId } from './src/filters';

/** Outcome of the capture-time grade, so the UI can be honest about what happened. */
export type GradeState =
  | { kind: 'none' }                                  // no grade attempted (backend down)
  | { kind: 'grading' }
  | { kind: 'graded'; name: string }
  | { kind: 'failed' };                               // attempted, but the photo is ungraded

export default function App() {
  const [camPerm, requestCam] = useCameraPermissions();
  const [screen, setScreen] = useState<AppScreen>('camera');
  const [backend, setBackend] = useState(false);
  // `captured` is what's on screen; `original` is the ungraded frame kept so the
  // preview can re-grade with a different camera without stacking looks.
  const [captured, setCaptured] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [hash, setHash] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [grade, setGrade] = useState<GradeState>({ kind: 'none' });
  const [saved, setSaved] = useState(false);

  useEffect(() => { checkHealth().then(setBackend); }, []);

  /** Write a finished image to the device photo library. Returns true on success. */
  const saveToLibrary = useCallback(async (uri: string): Promise<boolean> => {
    try {
      const perm = await MediaLibrary.getPermissionsAsync();
      const granted = perm.granted || (await MediaLibrary.requestPermissionsAsync()).granted;
      if (!granted) return false;
      await MediaLibrary.saveToLibraryAsync(uri);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Photo captured -> apply the selected pocket-camera emulation, then save the
  // *graded* result to the camera roll (that's the photo the user actually wants).
  const onCapture = useCallback(async (f: SelectedFile, uri: string, camera: FilterId | 'auto') => {
    setFile(f); setCaptured(uri); setOriginal(uri); setSaved(false);
    setLastThumb(uri);
    setScreen('preview');

    if (!backend) {
      // No backend: the untouched capture is all we have, so keep it.
      setGrade({ kind: 'none' });
      setSaved(await saveToLibrary(uri));
      return;
    }

    setGrade({ kind: 'grading' });
    try {
      const { gradedUri, presetName } = await gradePhoto(uri, camera);
      setCaptured(gradedUri);
      setLastThumb(gradedUri);
      setFile({ ...f, uri: gradedUri });
      setGrade({ kind: 'graded', name: presetName });
      setSaved(await saveToLibrary(gradedUri));
    } catch {
      // Grading failed — keep the original and say so rather than pretending.
      setGrade({ kind: 'failed' });
      setSaved(await saveToLibrary(uri));
    }
  }, [backend, saveToLibrary]);

  /** Re-grade the original frame with another camera, from the preview screen. */
  const onRegrade = useCallback(async (camera: FilterId | 'auto') => {
    if (!original) return;
    setGrade({ kind: 'grading' }); setSaved(false);
    try {
      const { gradedUri, presetName } = await gradePhoto(original, camera);
      setCaptured(gradedUri);
      setLastThumb(gradedUri);
      setFile(prev => (prev ? { ...prev, uri: gradedUri } : prev));
      setGrade({ kind: 'graded', name: presetName });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setGrade({ kind: 'failed' });
    }
  }, [original]);

  /** Explicit save from the preview screen (also used to retry a failed auto-save). */
  const onSave = useCallback(async () => {
    if (!file) return;
    const ok = await saveToLibrary(file.uri);
    setSaved(ok);
    await Haptics.notificationAsync(
      ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
    );
  }, [file, saveToLibrary]);

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
    setCaptured(null); setOriginal(null); setFile(null); setProgress(0); setHash(null);
    setGrade({ kind: 'none' }); setSaved(false); setScreen('camera');
  }, []);

  if (!camPerm?.granted) return <PermissionScreen onAllow={requestCam} />;
  if (screen === 'gallery') return <GalleryScreen gallery={gallery} onBack={reset} />;
  if (screen === 'done') return <DoneScreen hash={hash} onGallery={onGallery} onNew={reset} />;
  if (screen === 'uploading') return <UploadingScreen progress={progress} />;
  if (screen === 'preview' && file) {
    return (
      <PreviewScreen
        file={file}
        captured={captured}
        original={original}
        backendReady={backend}
        grade={grade}
        saved={saved}
        onRegrade={onRegrade}
        onClose={reset}
        onSave={onSave}
        onShare={onShare}
        onUpload={onUpload}
        onDelete={reset}
      />
    );
  }
  return <CameraScreen onCapture={onCapture} onGallery={onGallery} lastThumb={lastThumb} backendReady={backend} />;
}
