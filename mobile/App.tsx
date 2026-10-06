import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useCameraPermissions } from 'expo-camera';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { PermissionScreen, GalleryScreen, DoneScreen, UploadingScreen, PreviewScreen, CameraScreen, SettingsScreen, RollScreen } from './src/screens';
import { checkHealth, fetchGallery, uploadFile, gradePhoto, gradeWithVibe } from './src/services/api';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './src/settings';
import { rollStore, type RollEntry } from './src/rollStore';
import { developOnDevice, hasOnDeviceLook } from './src/look/renderStill';
import { developVideoOnDevice, hasVideoLooks } from './src/look/renderVideo';
import { developPhoto, type DevelopedPhoto } from './src/developPhoto';
import { DeviceFrame } from './src/components/DeviceFrame';
import type { AppScreen, GalleryItem, SelectedFile } from './src/types';
import { FILTERS, type FilterId } from './src/filters';
import { CLOUD_FEATURES_ENABLED } from './src/constants';
import { settingsForReleaseMode } from './src/releaseMode';
import { DEFAULT_RECIPE, normalizeRecipe, type PhotoRecipe } from './src/photoRecipe';

export type GradeState = { kind: 'none' } | { kind: 'grading' } | { kind: 'graded'; name: string };

const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const fileFor = (entry: RollEntry): SelectedFile => {
  if (entry.mediaType === 'video') {
    const mov = /\.mov$/i.test(entry.uri);
    return { uri: entry.uri, name: `VID_${entry.takenAt}.${mov ? 'mov' : 'mp4'}`,
      mimeType: mov ? 'video/quicktime' : 'video/mp4', sizeBytes: null };
  }
  const png = entry.uri.startsWith('data:image/png') || /\.png$/i.test(entry.uri);
  return { uri: entry.uri, name: `IMG_${entry.takenAt}.${png ? 'png' : 'jpg'}`, mimeType: png ? 'image/png' : 'image/jpeg', sizeBytes: null };
};

export default function App() {
  const [camPerm, requestCam, refreshCam] = useCameraPermissions();
  const [screen, setScreen] = useState<AppScreen>('camera');
  const [loaded, setLoaded] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [backend, setBackend] = useState(false);
  // Every preview, export and upload derives from this one committed photo.
  const [photo, setPhoto] = useState<RollEntry | null>(null);
  const [roll, setRoll] = useState<RollEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const [previewOrigin, setPreviewOrigin] = useState<'camera' | 'roll'>('camera');
  const [settingsOrigin, setSettingsOrigin] = useState<'camera' | 'roll'>('camera');
  const [working, setWorking] = useState(false);
  const [developing, setDeveloping] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState(0);
  const [hash, setHash] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  // A ref closes the gap before React renders disabled controls after a rapid double tap.
  const locked = useRef(false);
  const settingsWrites = useRef<Promise<void>>(Promise.resolve());
  const effectiveSettings = settingsForReleaseMode(settings, CLOUD_FEATURES_ENABLED);

  const initialize = useCallback(async () => {
    setStartupError('');
    try {
      const [storedSettings, storedRoll] = await Promise.all([loadSettings(), rollStore.load()]);
      settingsRef.current = storedSettings;
      setSettings(storedSettings); setRoll(storedRoll); setLoaded(true);
    } catch { setStartupError('Could not open your film roll. Free some storage and retry.'); }
  }, []);
  useEffect(() => { void initialize(); }, [initialize]);

  useEffect(() => {
    if (!CLOUD_FEATURES_ENABLED) return;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (checking || AppState.currentState === 'background') return;
      checking = true;
      const ready = await checkHealth();
      checking = false;
      if (!stopped) setBackend(ready);
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void check();
    });
    return () => { stopped = true; clearInterval(timer); subscription.remove(); };
  }, [refreshCam]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshCam();
    });
    return () => subscription.remove();
  }, [refreshCam]);

  const reset = useCallback(() => {
    if (locked.current) return;
    setPhoto(null); setSaved(false); setError(''); setNotice(''); setScreen('camera');
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked.current) return true;
      if (screen === 'camera' || screen === 'preview') return false;
      reset(); return true;
    });
    return () => subscription.remove();
  }, [screen, reset]);

  const feedback = useCallback(() => {
    if (settings.haptics && Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [settings.haptics]);
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return false;
    locked.current = true; setWorking(true); setError(''); setNotice('');
    try { await action(); return true; }
    catch (e) { setError(message(e)); return false; }
    finally { locked.current = false; setWorking(false); setDeveloping(false); }
  };
  const commitPhoto = async (entry: RollEntry, previousUri?: string) => {
    const committed = await rollStore.put(entry, previousUri);
    setRoll(committed.roll); setPhoto(committed.entry);
    return committed.entry;
  };
  const saveToLibrary = async (uri: string, mediaType: 'photo' | 'video' = 'photo') => {
    if (Platform.OS === 'web') {
      const link = document.createElement('a');
      const extension = mediaType === 'video' ? /\.mov$/i.test(uri) ? 'mov' : 'mp4' : uri.startsWith('data:image/png') ? 'png' : 'jpg';
      const response = await fetch(uri);
      if (!response.ok) throw new Error('Could not read this item for download. Please try again.');
      const url = URL.createObjectURL(await response.blob());
      link.href = url; link.download = `VibeCam_${Date.now()}.${extension}`;
      document.body.appendChild(link); link.click(); link.remove();
      // Let the browser finish reading the object URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    const current = await MediaLibrary.getPermissionsAsync(true, [mediaType]);
    const permission = current.granted || (current.canAskAgain && (await MediaLibrary.requestPermissionsAsync(true, [mediaType])).granted);
    if (!permission) throw new Error('Photos access is off. Enable “Add Photos” for VibeCam in Settings, then tap Save again. Your item is kept in Film Roll.');
    await MediaLibrary.saveToLibraryAsync(uri);
  };
  const develop = async (entry: RollEntry, camera: FilterId | 'auto', editedRecipe?: PhotoRecipe): Promise<DevelopedPhoto> => {
    const recipe = normalizeRecipe(editedRecipe ?? entry.recipe ?? { character: effectiveSettings.characterStrength, dateStamp: effectiveSettings.dateStamp });
    const id = camera === 'auto' ? 'g7x' : camera;
    if (!CLOUD_FEATURES_ENABLED || editedRecipe) {
      const uri = id === 'original' ? entry.originalUri : await developOnDevice({ uri: entry.originalUri!, camera: id, characterStrength: recipe.character, seed: entry.seed, recipe, takenAt: entry.takenAt });
      if (!uri) throw new Error('This camera look could not be developed. Your original is safe in Film Roll.');
      return { uri, id, name: FILTERS.find(f => f.id === id)?.name ?? id };
    }
    return developPhoto(
    entry.originalUri!, camera, entry.seed, entry.takenAt, effectiveSettings, CLOUD_FEATURES_ENABLED && backend, {
      local: (uri, id, characterStrength, seed) => developOnDevice({ uri, camera: id, characterStrength, seed, recipe, takenAt: entry.takenAt }),
      remote: async (uri, id, headers) => {
        const result = await gradePhoto(uri, id, headers);
        return { uri: result.gradedUri, id: result.presetId, name: result.presetName };
      },
    },
    );
  };
  const applyResult = async (entry: RollEntry, result: DevelopedPhoto, recipe = entry.recipe) => {
    const next = await commitPhoto({ ...entry, uri: result.uri, cameraId: result.id, cameraName: result.name, recipe, savedToLibrary: false }, entry.uri);
    setSaved(false); setNotice(result.notice ?? '');
    return next;
  };
  const saveEntry = async (entry: RollEntry) => {
    await saveToLibrary(entry.uri, entry.mediaType);
    setSaved(true);
    try { await commitPhoto({ ...entry, savedToLibrary: true }, entry.uri); }
    catch { throw new Error('Saved to Photos, but Film Roll could not remember the save. Free some storage before saving again.'); }
  };
  const capturePhoto = async (uri: string, camera: FilterId | 'auto', origin: 'camera' | 'roll' = 'camera') => {
    let entry: RollEntry = { uri, originalUri: uri, cameraId: 'original', cameraName: 'Original', takenAt: Date.now(), seed: Math.floor(Math.random() * 1_000_000),
      recipe: { ...DEFAULT_RECIPE, character: effectiveSettings.characterStrength, dateStamp: effectiveSettings.dateStamp } };
    setPreviewOrigin(origin);
    setPhoto(entry); setSaved(false); setScreen('preview'); setDeveloping(true);
    // Retain the original before either renderer can fail or the app can leave preview.
    try { entry = await commitPhoto(entry); }
    catch { throw new Error('Could not keep this photo in Film Roll. Free some storage, or tap Save to keep it in Photos before closing.'); }
    try { entry = await applyResult(entry, await develop(entry, camera)); }
    catch (e) { setError(message(e)); }
    setDeveloping(false);
    if (settings.saveOriginal && (!settings.autoSave || entry.originalUri !== entry.uri)) await saveToLibrary(entry.originalUri!);
    if (settings.autoSave) await saveEntry(entry);
  };
  const onCapture = async (_file: SelectedFile, uri: string, camera: FilterId | 'auto') => { await run(() => capturePhoto(uri, camera)); };
  const captureVideo = async (uri: string, camera: FilterId | 'auto', durationMs: number) => {
    if (!hasVideoLooks()) throw new Error('Video looks require the iPhone preview or release app.');
    let entry: RollEntry = { uri, originalUri: uri, cameraId: 'original', cameraName: 'Original',
      takenAt: Date.now(), seed: 0, mediaType: 'video', thumbnailUri: null, durationMs };
    setPreviewOrigin('camera');
    setPhoto(entry); setSaved(false); setScreen('preview'); setDeveloping(true);
    try { entry = await commitPhoto(entry); }
    catch { throw new Error('Could not keep this video in Film Roll. Free some storage and try again.'); }
    const selected = camera === 'auto' ? 'g7x' : camera;
    try {
      const result = await developVideoOnDevice(entry.originalUri!, selected);
      const filter = FILTERS.find(item => item.id === selected);
      entry = await commitPhoto({ ...entry, uri: result.uri, thumbnailUri: result.thumbnailUri,
        cameraId: selected, cameraName: filter?.name ?? 'Original' }, entry.uri);
    } catch (e) {
      setError(message(e));
      // A failed render never discards the recorded original.
      try {
        const original = await developVideoOnDevice(entry.originalUri!, 'original');
        entry = await commitPhoto({ ...entry, thumbnailUri: original.thumbnailUri }, entry.uri);
      } catch { /* The playable original remains in Film Roll. */ }
    }
    setDeveloping(false);
    if (settings.saveOriginal && (!settings.autoSave || entry.originalUri !== entry.uri)) await saveToLibrary(entry.originalUri!, 'video');
    if (settings.autoSave) await saveEntry(entry);
  };
  const onCaptureVideo = async (uri: string, camera: FilterId | 'auto', durationMs: number) => { await run(() => captureVideo(uri, camera, durationMs)); };
  const onImport = () => run(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
    if (!result.canceled) await capturePhoto(result.assets[0].uri, effectiveSettings.defaultCamera, screen === 'roll' ? 'roll' : 'camera');
  });
  const onRegrade = (camera: FilterId | 'auto', recipe?: PhotoRecipe) => run(async () => {
    if (!photo?.originalUri) return;
    setDeveloping(true);
    if (photo.mediaType === 'video') {
      const selected = camera === 'auto' ? 'g7x' : camera;
      const result = await developVideoOnDevice(photo.originalUri, selected);
      const filter = FILTERS.find(item => item.id === selected);
      await commitPhoto({ ...photo, uri: result.uri, thumbnailUri: result.thumbnailUri,
        cameraId: selected, cameraName: filter?.name ?? 'Original', savedToLibrary: false }, photo.uri);
      setSaved(false); feedback(); return;
    }
    const nextRecipe = normalizeRecipe(recipe ?? photo.recipe);
    await applyResult(photo, await develop(photo, camera, nextRecipe), nextRecipe); feedback();
  });
  const onVibe = (vibe: string) => run(async () => {
    if (!photo?.originalUri || !backend || !vibe.trim()) return;
    setDeveloping(true);
    const result = await gradeWithVibe(photo.originalUri, vibe.trim());
    await applyResult(photo, { uri: result.gradedUri, id: 'ai', name: result.styleName }); feedback();
  });
  const onSave = () => run(async () => {
    if (!photo || (saved && Platform.OS !== 'web')) return;
    await saveEntry(photo); feedback();
  });
  const onShare = () => run(async () => {
    if (!photo) return;
    if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable here. Use Save to download your photo.');
    const file = fileFor(photo);
    await Sharing.shareAsync(photo.uri, { mimeType: file.mimeType,
      UTI: file.mimeType === 'video/mp4' ? 'public.mpeg-4' : file.mimeType === 'video/quicktime' ? 'com.apple.quicktime-movie' : file.mimeType === 'image/png' ? 'public.png' : 'public.jpeg' });
  });
  const onDelete = () => run(async () => {
    if (!photo) return;
    setRoll(await rollStore.remove(photo.uri)); setPhoto(null); setSaved(false); setScreen(previewOrigin);
  });
  const onFavorite = () => run(async () => {
    if (!photo) return;
    await commitPhoto({ ...photo, favorite: !photo.favorite }, photo.uri);
    feedback();
  });
  const onDeleteMany = (uris: string[]) => run(async () => { setRoll(await rollStore.removeMany(uris)); });
  const onUpload = () => run(async () => {
    if (!photo) return;
    setScreen('uploading'); setProgress(0); setHash(null);
    try {
      const result = await uploadFile(fileFor(photo), setProgress);
      setHash(result); setScreen('done'); feedback();
    } catch (e) { setScreen('preview'); throw e; }
  });
  const onGallery = () => run(async () => {
    setGallery(await fetchGallery()); setScreen('gallery');
  });
  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    settingsWrites.current = settingsWrites.current.then(() => saveSettings(next)).catch(() => {
      setError('Could not save settings. Free some storage and try again.');
    });
  };
  const onOpenRollEntry = (entry: RollEntry) => {
    setPreviewOrigin('roll'); setPhoto(entry); setSaved(entry.savedToLibrary === true); setError(''); setNotice(''); setScreen('preview');
  };
  const openSettings = (origin: 'camera' | 'roll') => { setSettingsOrigin(origin); setError(''); setScreen('settings'); };
  const closePreview = () => { if (!locked.current) { setPhoto(null); setError(''); setNotice(''); setScreen(previewOrigin); } };

  const renderScreen = () => {
    if (!loaded) return <View style={{ flex: 1, backgroundColor: '#0c0c0c', justifyContent: 'center', alignItems: 'center', padding: 28 }}>
      {startupError ? <><Text style={{ color: '#fff', textAlign: 'center' }}>{startupError}</Text><Pressable onPress={initialize} style={{ padding: 20 }}><Text style={{ color: '#FFD60A' }}>Retry</Text></Pressable></> : <ActivityIndicator color="#FFD60A" />}
    </View>;
    if (screen === 'settings') return <SettingsScreen settings={effectiveSettings} onChange={updateSettings} onClose={() => setScreen(settingsOrigin)} error={error} cloudEnabled={CLOUD_FEATURES_ENABLED} rollCount={roll.length} />;
    if (screen === 'roll') return <RollScreen roll={roll} onOpen={onOpenRollEntry} onBack={reset} onImport={onImport} onSettings={() => openSettings('roll')} busy={working} error={error} onDeleteMany={onDeleteMany} />;
    if (screen === 'gallery') return <GalleryScreen gallery={gallery} onBack={reset} />;
    if (screen === 'done') return <DoneScreen hash={hash} onGallery={onGallery} onNew={reset} busy={working} error={error} />;
    if (screen === 'uploading') return <UploadingScreen progress={progress} />;
    if (screen === 'preview' && photo) return <PreviewScreen
      file={fileFor(photo)}
      captured={photo.uri} original={photo.originalUri} selectedCamera={photo.cameraId} cameraName={photo.cameraName}
      backendReady={backend} canDevelop={photo.mediaType === 'video' ? hasVideoLooks() : backend || hasOnDeviceLook('g7x')} busy={working}
      cloudEnabled={CLOUD_FEATURES_ENABLED && photo.mediaType !== 'video'}
      grade={developing ? { kind: 'grading' } : photo.cameraId === 'original' ? { kind: 'none' } : { kind: 'graded', name: photo.cameraName }}
      saved={saved} error={error} notice={notice} onVibe={onVibe}
      recipe={photo.recipe} favorite={photo.favorite === true} takenAt={photo.takenAt} seed={photo.seed} closeLabel={previewOrigin === 'roll' ? 'Film Roll' : 'Camera'} onFavorite={onFavorite}
      onRegrade={onRegrade} onClose={closePreview} onSave={onSave} onShare={onShare} onUpload={onUpload} onDelete={onDelete}
    />;
    if (!camPerm?.granted) return <PermissionScreen
      canAskAgain={camPerm?.canAskAgain ?? true}
      onAllow={() => { void (camPerm?.canAskAgain === false && Platform.OS !== 'web' ? Linking.openSettings() : requestCam()).catch(() => {}); }}
      onRoll={() => setScreen('roll')}
      onImport={onImport} busy={working} error={error}
    />;
    return <CameraScreen onCapture={onCapture} onCaptureVideo={onCaptureVideo} videoAvailable={hasVideoLooks()}
      appError={error} onDismissError={() => setError('')}
      onGallery={() => setScreen('roll')} onSettings={() => openSettings('camera')} onCameraChange={defaultCamera => updateSettings({ defaultCamera })}
      onVideoSoundChange={videoSound => updateSettings({ videoSound })}
      lastThumb={roll[0]?.mediaType === 'video' ? roll[0].thumbnailUri ?? null : roll[0]?.uri ?? null}
      backendReady={backend} settings={effectiveSettings} cloudEnabled={CLOUD_FEATURES_ENABLED} />;
  };
  return <SafeAreaProvider><StatusBar style="light" /><DeviceFrame>{renderScreen()}</DeviceFrame></SafeAreaProvider>;
}
