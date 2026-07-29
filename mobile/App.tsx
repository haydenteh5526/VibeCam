import React, { useCallback, useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useCameraPermissions } from 'expo-camera';

import { PermissionScreen, GalleryScreen, DoneScreen, UploadingScreen, PreviewScreen, CameraScreen, SettingsScreen, RollScreen } from './src/screens';
import { checkHealth, fetchGallery, uploadFile, gradePhoto } from './src/services/api';
import { DEFAULT_SETTINGS, gradeHeaders, loadSettings, saveSettings, type Settings } from './src/settings';
import { addEntry, loadRoll, pruneMissing, removeEntry, saveRoll, updateEntry, type RollEntry } from './src/rollStore';
import { developOnDevice, hasOnDeviceLook } from './src/look/renderStill';
import { FILTERS } from './src/filters';
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [roll, setRoll] = useState<RollEntry[]>([]);
  // One seed per captured frame, so re-developing reproduces the same leak/dust/grain.
  const [seed, setSeed] = useState(0);

  useEffect(() => { checkHealth().then(setBackend); }, []);
  useEffect(() => { loadSettings().then(setSettings); }, []);
  // Prune shots whose cached image iOS has since purged, so the roll has no dead tiles.
  useEffect(() => { loadRoll().then(pruneMissing).then(setRoll); }, []);

  /** Update the roll and persist it. */
  const commitRoll = useCallback((next: RollEntry[]) => {
    setRoll(next);
    void saveRoll(next);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const buzz = useCallback((style: Haptics.ImpactFeedbackStyle) => {
    if (settings.haptics) void Haptics.impactAsync(style);
  }, [settings.haptics]);

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

  /**
   * Develop a frame, preferring whichever path the situation calls for.
   *
   * On-device is instant and works offline but is an approximation; the backend applies
   * the adaptive reference match and the full character layer. On-device is used when the
   * user asks for it or when the backend isn't reachable, and it also serves as the
   * fallback if a backend request fails.
   */
  const develop = useCallback(async (
    uri: string,
    camera: FilterId | 'auto',
    shotSeed: number,
  ): Promise<{ uri: string; id: string; name: string } | null> => {
    const localFirst = settings.onDeviceLook || !backend;
    const localCamera = camera === 'auto' ? 'g7x' : camera;   // no scene analysis offline

    if (localFirst && hasOnDeviceLook(localCamera)) {
      try {
        const out = await developOnDevice({
          uri, camera: localCamera, characterStrength: settings.characterStrength, seed: shotSeed,
        });
        if (out) {
          const meta = FILTERS.find(f => f.id === localCamera);
          return { uri: out, id: localCamera, name: meta ? `${meta.name} · on device` : localCamera };
        }
      } catch {
        // Fall through to the backend, or to returning the untouched frame.
      }
    }

    if (!backend) return null;
    try {
      const r = await gradePhoto(uri, camera, gradeHeaders(settings, shotSeed));
      return { uri: r.gradedUri, id: r.presetId, name: r.presetName };
    } catch {
      return null;
    }
  }, [backend, settings]);

  // Photo captured -> apply the selected pocket-camera emulation, then save the
  // *graded* result to the camera roll (that's the photo the user actually wants).
  const onCapture = useCallback(async (f: SelectedFile, uri: string, camera: FilterId | 'auto') => {
    const shotSeed = Math.floor(Math.random() * 1_000_000);
    setSeed(shotSeed);
    setFile(f); setCaptured(uri); setOriginal(uri); setSaved(false);
    setLastThumb(uri);
    setScreen('preview');

    if (settings.saveOriginal) void saveToLibrary(uri);

    const canDevelop = backend || (settings.onDeviceLook || !backend);
    if (!canDevelop) {
      setGrade({ kind: 'none' });
      setSaved(settings.autoSave ? await saveToLibrary(uri) : false);
      return;
    }

    setGrade({ kind: 'grading' });
    const result = await develop(uri, camera, shotSeed);
    if (!result) {
      // Nothing worked — keep the original and say so rather than pretending.
      setGrade(backend || settings.onDeviceLook ? { kind: 'failed' } : { kind: 'none' });
      setSaved(settings.autoSave ? await saveToLibrary(uri) : false);
      return;
    }

    setCaptured(result.uri);
    setLastThumb(result.uri);
    setFile({ ...f, uri: result.uri });
    setGrade({ kind: 'graded', name: result.name });
    setSaved(settings.autoSave ? await saveToLibrary(result.uri) : false);
    commitRoll(addEntry(roll, {
      uri: result.uri,
      originalUri: uri,
      cameraId: result.id,
      cameraName: result.name,
      takenAt: Date.now(),
      seed: shotSeed,
    }));
  }, [backend, saveToLibrary, settings, roll, commitRoll, develop]);

  /** Re-grade the original frame with another camera, from the preview screen. */
  const onRegrade = useCallback(async (camera: FilterId | 'auto') => {
    if (!original) return;
    const previous = captured;
    setGrade({ kind: 'grading' }); setSaved(false);
    const result = await develop(original, camera, seed);
    if (!result) {
      setGrade({ kind: 'failed' });
      return;
    }
    setCaptured(result.uri);
    setLastThumb(result.uri);
    setFile(prev => (prev ? { ...prev, uri: result.uri } : prev));
    setGrade({ kind: 'graded', name: result.name });
    buzz(Haptics.ImpactFeedbackStyle.Light);
    // Replace the roll entry in place so re-developing doesn't create duplicates.
    commitRoll(previous
      ? updateEntry(roll, previous, { uri: result.uri, cameraId: result.id, cameraName: result.name })
      : addEntry(roll, {
          uri: result.uri, originalUri: original, cameraId: result.id,
          cameraName: result.name, takenAt: Date.now(), seed,
        }));
  }, [original, captured, seed, buzz, roll, commitRoll, develop]);

  /** Open a shot from the film roll, ready to re-develop. */
  const onOpenRollEntry = useCallback((entry: RollEntry) => {
    setCaptured(entry.uri);
    setOriginal(entry.originalUri ?? entry.uri);
    setSeed(entry.seed);
    setFile({ uri: entry.uri, name: `IMG_${entry.takenAt}.jpg`, mimeType: 'image/jpeg', sizeBytes: null });
    setGrade({ kind: 'graded', name: entry.cameraName });
    setSaved(false);
    setScreen('preview');
  }, []);

  /** Explicit save from the preview screen (also used to retry a failed auto-save). */
  const onSave = useCallback(async () => {
    if (!file) return;
    const ok = await saveToLibrary(file.uri);
    setSaved(ok);
    if (settings.haptics) {
      await Haptics.notificationAsync(
        ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      );
    }
  }, [file, saveToLibrary, settings.haptics]);

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
      if (settings.haptics) await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHash(h); setScreen('done');
    } catch {
      if (settings.haptics) await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScreen('preview');
    }
  }, [file, settings.haptics]);

  const onGallery = useCallback(async () => {
    try { const items = await fetchGallery(); setGallery(items); } catch { setGallery([]); }
    setScreen('gallery');
  }, []);

  /** Remove the current shot from the film roll and return to the camera. */
  const onDelete = useCallback(() => {
    if (captured) commitRoll(removeEntry(roll, captured));
    setCaptured(null); setOriginal(null); setFile(null);
    setGrade({ kind: 'none' }); setSaved(false); setScreen('camera');
  }, [captured, roll, commitRoll]);

  const reset = useCallback(() => {
    setCaptured(null); setOriginal(null); setFile(null); setProgress(0); setHash(null);
    setGrade({ kind: 'none' }); setSaved(false); setScreen('camera');
  }, []);

  if (!camPerm?.granted) return <PermissionScreen onAllow={requestCam} />;
  if (screen === 'settings') {
    return <SettingsScreen settings={settings} onChange={updateSettings} onClose={() => setScreen('camera')} />;
  }
  if (screen === 'roll') {
    return <RollScreen roll={roll} onOpen={onOpenRollEntry} onBack={() => setScreen('camera')} />;
  }
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
        onDelete={onDelete}
      />
    );
  }
  return (
    <CameraScreen
      onCapture={onCapture}
      onGallery={() => setScreen('roll')}
      onSettings={() => setScreen('settings')}
      lastThumb={lastThumb}
      backendReady={backend}
      settings={settings}
    />
  );
}
