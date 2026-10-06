import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, type CameraType, type FlashMode, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { CameraPicker } from '../components/CameraPicker';
import { LiveLookPreview, supportsLiveColour } from '../components/LiveLookPreview';
import { previewCaption, type LivePreviewStatus } from '../look/livePreview';
import { Icon, IconButton, Notice, theme, ui, useScreenInsets } from '../components/ui';
import { useLayoutHeight, useLayoutWidth } from '../components/DeviceFrame';
import { getLook, type FilterId } from '../filters';
import type { SelectedFile } from '../types';
import type { Settings } from '../settings';

type Props = {
  onCapture: (file: SelectedFile, uri: string, camera: FilterId | 'auto') => void | Promise<void>;
  onCaptureVideo: (uri: string, camera: FilterId | 'auto', durationMs: number) => void | Promise<void>;
  videoAvailable: boolean; onGallery: () => void; onSettings: () => void;
  onCameraChange: (camera: FilterId | 'auto') => void;
  onVideoSoundChange: (enabled: boolean) => void;
  lastThumb: string | null; backendReady: boolean; cloudEnabled: boolean; settings: Settings;
  appError?: string; onDismissError: () => void;
};
type Lens = { name: string; label: string; order: number };
function lensOptions(names: string[]): Lens[] {
  return names.flatMap(name => {
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    if (key.includes('dual') || key.includes('triple')) return [];
    if (key.includes('ultrawide')) return [{ name, label: 'Ultra', order: 0 }];
    if (key.includes('wideangle')) return [{ name, label: 'Wide', order: 1 }];
    if (key.includes('telephoto')) return [{ name, label: 'Tele', order: 2 }];
    return [];
  }).sort((a, b) => a.order - b.order);
}
export function CameraScreen({ onCapture, onCaptureVideo, videoAvailable, onGallery, onSettings,
  onCameraChange, onVideoSoundChange, lastThumb, cloudEnabled, settings, appError, onDismissError }: Props) {
  const insets = useScreenInsets();
  const width = useLayoutWidth();
  const compact = useLayoutHeight() < 760;
  const cam = useRef<CameraView>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pinch = useRef<number | null>(null);
  const flash = useRef(new Animated.Value(0)).current;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [facing, setFacing] = useState<CameraType>('back');
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [mic, requestMic, refreshMic] = useMicrophonePermissions();
  const micRequest = useRef(false);
  const [audioPending, setAudioPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSound, setRecordingSound] = useState(false);
  const recordingRef = useRef(false);
  const stopping = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [flashMode, setFlashMode] = useState<FlashMode>('auto');
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [grid, setGrid] = useState(settings.grid);
  const [camera, setCamera] = useState(settings.defaultCamera);
  const [zoom, setZoom] = useState(0);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [lens, setLens] = useState<string>();
  const [error, setError] = useState('');
  const [info, setInfo] = useState(false);
  const [chooseLook, setChooseLook] = useState(false);
  const [space, setSpace] = useState(360);
  const [previewStatus, setPreviewStatus] = useState<LivePreviewStatus>('loading');
  const [originalPreview, setOriginalPreview] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const busy = recording || capturing || countdown !== null || audioPending;
  // A permission refresh must not replace the camera halfway through a clip.
  const soundOn = recording ? recordingSound : settings.videoSound && mic?.granted === true;
  const cameraKey = `${cameraGeneration}:${facing}:${mode}:${mode === 'video' && soundOn ? 'sound' : 'silent'}`;
  const activeCameraKey = useRef(cameraKey);
  activeCameraKey.current = cameraKey;
  const ready = readyKey === cameraKey;
  const look = getLook(camera);
  const aspect = mode === 'photo' ? 4 / 3 : 16 / 9;
  const vfWidth = Math.max(1, Math.min(width - 28, space / aspect));
  const buzz = useCallback(() => {
    if (settings.haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [settings.haptics]);
  const cancelTimer = useCallback(() => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
    if (mounted.current) setCountdown(null);
  }, []);
  const stopRecording = useCallback(() => {
    if (!recordingRef.current || stopping.current) return;
    stopping.current = true;
    if (recordTimer.current) clearInterval(recordTimer.current);
    recordTimer.current = null;
    if (mounted.current) setFinishing(true);
    cam.current?.stopRecording();
  }, []);
  const chooseCamera = (id: FilterId | 'auto') => {
    if (id !== camera || originalPreview) setPreviewStatus('loading');
    setCamera(id); setOriginalPreview(false);
    onCameraChange(id); buzz();
  };
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => {
      const active = state === 'active';
      setForeground(active);
      if (!active) {
        setCameraGeneration(n => n + 1);
        setReadyKey(null); cancelTimer(); stopRecording();
      } else {
        // Permissions can change in iOS Settings while this screen is suspended.
        void refreshMic().catch(() => {});
      }
    });
    return () => {
      mounted.current = false; cancelTimer(); sub.remove();
      if (recordTimer.current) clearInterval(recordTimer.current);
      stopRecording();
    };
  }, [cancelTimer, refreshMic, stopRecording]);
  const cameraReady = async (key: string) => {
    if (!mounted.current || activeCameraKey.current !== key) return;
    const instance = cam.current;
    setReadyKey(key);
    try {
      const options = lensOptions((await instance?.getAvailableLensesAsync()) ?? []);
      if (!mounted.current || cam.current !== instance || activeCameraKey.current !== key) return;
      setLenses(options);
      setLens(previous => previous ?? options.find(l => l.label === 'Wide')?.name);
    } catch { if (mounted.current && cam.current === instance && activeCameraKey.current === key) setLenses([]); }
  };
  const capture = async () => {
    if (!cam.current || !ready || lock.current) return;
    lock.current = true; setCapturing(true); setError(''); buzz();
    flash.setValue(0.7);
    Animated.timing(flash, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    try {
      const photo = await cam.current.takePictureAsync({ quality: 0.98 });
      if (!photo?.uri) throw new Error('The photo was not captured. Please try again.');
      await onCapture({ uri: photo.uri, name: 'IMG_' + Date.now() + '.jpg', mimeType: 'image/jpeg', sizeBytes: null }, photo.uri, camera);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Capture failed. Please try again.'); }
    finally { lock.current = false; if (mounted.current) setCapturing(false); }
  };
  const record = async () => {
    if (!cam.current || !ready || !foreground || lock.current || micRequest.current || !videoAvailable) return;
    lock.current = true; setRecordingSound(soundOn); setRecording(true); setSeconds(0); setError(''); buzz();
    recordingRef.current = true; stopping.current = false; setFinishing(false);
    const started = Date.now();
    recordTimer.current = setInterval(() => setSeconds(Math.min(15, Math.floor((Date.now() - started) / 1000))), 200);
    try {
      const clip = await cam.current.recordAsync({ maxDuration: 15 });
      recordingRef.current = false;
      if (recordTimer.current) clearInterval(recordTimer.current);
      recordTimer.current = null;
      if (mounted.current) setFinishing(true);
      if (!clip?.uri) throw new Error('No clip was recorded. Please try again.');
      await onCaptureVideo(clip.uri, camera, Math.min(15000, Date.now() - started));
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Recording failed.'); }
    finally {
      if (recordTimer.current) clearInterval(recordTimer.current);
      recordTimer.current = null; lock.current = false; recordingRef.current = false; stopping.current = false;
      if (mounted.current) { setRecording(false); setFinishing(false); }
    }
  };
  const shutter = () => {
    if (countdownTimer.current) { cancelTimer(); return; }
    // Ignore another start tap until React has presented the Stop control.
    // record()'s synchronous lock prevents a second native recording request.
    if (mode === 'video') { if (recording) stopRecording(); else void record(); return; }
    if (!ready || lock.current) return;
    if (!timer) { void capture(); return; }
    setCountdown(timer); let left = timer;
    countdownTimer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) { cancelTimer(); void capture(); }
      else { setCountdown(left); buzz(); }
    }, 1000);
  };
  const toggleSound = async () => {
    if (busy || lock.current || micRequest.current || mode !== 'video') return;
    setError(''); buzz();
    if (soundOn || mic?.granted) { onVideoSoundChange(!soundOn); return; }
    micRequest.current = true; setAudioPending(true);
    try {
      if (mic?.canAskAgain === false) {
        // Remember this explicit request so granting access in Settings enables sound.
        onVideoSoundChange(true);
        await Linking.openSettings();
      } else {
        const result = await requestMic();
        if (!mounted.current) return;
        onVideoSoundChange(result.granted);
        if (!result.granted) setError('Microphone access is off. You can still record silent clips. Tap Sound to enable audio in Settings.');
      }
    } catch { if (mounted.current) setError('Could not enable the microphone. You can still record silently and try Sound again.'); }
    finally { micRequest.current = false; if (mounted.current) setAudioPending(false); }
  };
  const changeMode = (next: 'photo' | 'video') => {
    if (busy || lock.current || micRequest.current || next === mode) return;
    if (next === 'video' && !videoAvailable) {
      setError('Video is available in the installed iPhone app. You can keep shooting photos here.'); return;
    }
    setError('');
    setReadyKey(null); setMode(next); setFlashMode(next === 'video' ? 'off' : 'auto'); setInfo(false);
    if (camera === 'auto' && next === 'video') { setCamera('g7x'); onCameraChange('g7x'); }
    buzz();
  };
  return <View style={[ui.screen, { paddingTop: insets.top, paddingBottom: Math.max(8, insets.bottom) }]}>
    {!compact && <View style={s.header}>
      <View style={ui.row}><View style={s.brandDot} /><Text style={s.brand}>vibecam</Text></View>
      <View style={ui.row}><Text style={s.offline}>YOUR POCKET CAMERA</Text><IconButton icon="options-outline" label="Camera settings" onPress={onSettings} disabled={busy} /></View>
    </View>}
    <View style={[s.controls, compact && { paddingHorizontal: 4 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={'Flash ' + flashMode} disabled={busy || facing === 'front'}
        onPress={() => { buzz(); setFlashMode(v => mode === 'video' ? v === 'on' ? 'off' : 'on' : v === 'auto' ? 'on' : v === 'on' ? 'off' : 'auto'); }} style={[s.control, facing === 'front' && ui.disabled]}>
        <Icon name={flashMode === 'off' ? 'flash-off-outline' : 'flash-outline'} size={18} color={flashMode !== 'off' ? theme.accent : theme.muted} />
        <Text style={s.controlText}>{mode === 'video' ? 'LIGHT ' : ''}{flashMode.toUpperCase()}</Text>
      </Pressable>
      {mode === 'photo' ? <Pressable accessibilityRole="button" accessibilityLabel={'Timer ' + (timer ? timer + ' seconds' : 'off')} disabled={busy}
        onPress={() => { buzz(); setTimer(v => v === 0 ? 3 : v === 3 ? 10 : 0); }} style={s.control}>
        <Icon name="timer-outline" size={18} color={timer ? theme.accent : theme.muted} /><Text style={s.controlText}>{timer ? timer + 's' : 'OFF'}</Text>
      </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={soundOn ? 'Mute video sound' : mic?.canAskAgain === false && !mic.granted ? 'Open Settings to enable video sound' : 'Enable video sound'}
        accessibilityState={{ selected: soundOn, disabled: busy, busy: audioPending }} disabled={busy}
        onPress={() => { void toggleSound(); }} style={[s.control, busy && ui.disabled]}>
        {audioPending ? <ActivityIndicator size="small" color={theme.accent} /> : <Icon name={soundOn ? 'mic-outline' : 'mic-off-outline'} size={18} color={soundOn ? theme.accent : theme.muted} />}
        <Text style={[s.controlText, soundOn && { color: theme.accent }]}>SOUND {soundOn ? 'ON' : 'OFF'}</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Composition grid" accessibilityState={{ selected: grid }} onPress={() => { buzz(); setGrid(v => !v); }} style={s.control}>
        <Icon name="grid-outline" size={18} color={grid ? theme.accent : theme.muted} /><Text style={s.controlText}>GRID</Text>
      </Pressable>
      {compact && <IconButton icon="options-outline" label="Camera settings" onPress={onSettings} disabled={busy} />}
    </View>
    <View style={s.finderSpace} onLayout={e => setSpace(Math.max(1, e.nativeEvent.layout.height - 8))}>
      <View collapsable={false} style={[s.finder, { width: vfWidth, height: vfWidth * aspect }]}
        onTouchMove={e => {
          const touches = e.nativeEvent.touches;
          if (touches.length < 2 || capturing) { pinch.current = null; return; }
          const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
          if (pinch.current !== null) setZoom(v => Math.min(1, Math.max(0, v + (distance - pinch.current!) * 0.003)));
          pinch.current = distance;
        }} onTouchEnd={() => { pinch.current = null; }}>
        {foreground && <CameraView key={cameraKey} ref={cam} style={StyleSheet.absoluteFill} facing={facing}
          mode={mode === 'photo' ? 'picture' : 'video'} flash={mode === 'photo' ? flashMode : 'off'}
          enableTorch={mode === 'video' && flashMode === 'on' && facing === 'back'} mute={mode !== 'video' || !soundOn} zoom={zoom}
          selectedLens={lens} videoQuality="720p" autofocus="on" animateShutter={false}
          onCameraReady={() => { void cameraReady(cameraKey); }} onMountError={e => setError(e.message)} />}
        {foreground && ready && !originalPreview && camera !== 'auto' && camera !== 'original' && <LiveLookPreview
          key={cameraKey + (lens ?? '') + previewAttempt} camera={camera} mirrored={facing === 'front'} onStatus={setPreviewStatus} />}
        {!ready && <View style={s.loading}><ActivityIndicator color={theme.accent} /><Text style={s.hudText}>Starting camera…</Text></View>}
        {grid && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[1, 2].map(i => <React.Fragment key={i}><View style={[s.gridV, { left: (i * 100 / 3 + '%') as '33%' }]} /><View style={[s.gridH, { top: (i * 100 / 3 + '%') as '33%' }]} /></React.Fragment>)}
        </View>}
        <View pointerEvents="none" style={s.hud}><Text style={s.hudText}>{finishing ? 'FINISHING…' : recording ? '● REC  00:' + String(seconds).padStart(2, '0') : mode === 'photo' ? 'PHOTO  3:4' : 'VIDEO  9:16'}</Text><Text style={s.hudText}>{mode === 'video' ? (soundOn ? 'SOUND ON' : 'SILENT') : 'JPEG'}</Text></View>
        {countdown !== null && <View pointerEvents="none" style={s.countdown}><Text style={s.countdownText}>{countdown}</Text><Text style={s.hudText}>Tap shutter to cancel</Text></View>}
        {!recording && <View style={s.lensRow}>
          {lenses.length > 1 ? lenses.map(item => <Pressable key={item.name} disabled={busy} accessibilityRole="button"
            accessibilityLabel={item.label + ' lens'} accessibilityState={{ selected: lens === item.name }} onPress={() => { setLens(item.name); setZoom(0); buzz(); }}
            style={[s.lensButton, lens === item.name && s.lensActive]}><Text style={[s.lensText, lens === item.name && { color: theme.accent }]}>{item.label}</Text></Pressable>) : null}
          {zoom > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Reset digital zoom" onPress={() => setZoom(0)} style={s.lensButton}><Text style={s.lensText}>{Math.round(zoom * 100)}% +</Text></Pressable>}
        </View>}
        {recording && <View style={s.recordTrack}><View style={[s.recordFill, { width: (seconds / 15 * 100 + '%') as '100%' }]} /></View>}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />
      </View>
    </View>
    {mode === 'video' && <Text accessibilityLiveRegion="polite" style={s.soundHint}>{finishing ? 'Finishing your clip…' : recording ? 'Tap shutter to stop' : audioPending ? 'Waiting for microphone access…' : soundOn ? '720p · Up to 15s · Sound on' : '720p · Up to 15s · Silent — tap Sound for audio'}</Text>}
    {error || appError ? <View style={s.error}><View style={{ flex: 1 }}><Notice text={error || appError || ''} error /></View><IconButton icon="close" label="Dismiss camera message" onPress={() => { setError(''); onDismissError(); }} /></View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={(compact ? 'Choose camera look, ' : 'About ') + look.name} accessibilityState={{ expanded: compact ? chooseLook : info }} disabled={busy}
      onPress={() => compact ? setChooseLook(true) : setInfo(v => !v)} style={s.lookSummary}>
      <Text style={s.lookName}>{camera === 'auto' ? 'Automatic look' : compact ? look.name + ' · ' + look.tagline : look.tagline}</Text><Icon name={compact ? 'chevron-down' : info ? 'chevron-up' : 'information-circle-outline'} size={16} color={theme.muted} />
    </Pressable>
    {info && !compact && <View style={s.info}><Text style={ui.body}>{look.description}</Text><Text style={s.infoBest}>{look.bestFor}</Text></View>}
    {!compact && <CameraPicker active={camera} showAuto={cloudEnabled && mode === 'photo'} showOriginal disabled={busy}
      onSelect={chooseCamera} />}
    <View style={s.previewRow}>
      <Text style={s.caption}>{previewCaption(camera, mode, originalPreview, previewStatus)}</Text>
      {supportsLiveColour && camera !== 'original' && camera !== 'auto' && <Pressable accessibilityRole="button" disabled={busy}
        accessibilityLabel={originalPreview ? 'Show camera look' : previewStatus === 'unavailable' ? 'Retry live colour preview' : 'Show original preview'}
        accessibilityState={{ selected: !originalPreview && previewStatus === 'live', disabled: busy }}
        onPress={() => {
          if (!originalPreview && previewStatus === 'unavailable') { setPreviewStatus('loading'); setPreviewAttempt(v => v + 1); }
          else { setOriginalPreview(v => !v); setPreviewStatus('loading'); }
          buzz();
        }} style={[s.previewToggle, busy && ui.disabled]}>
        <Icon name={originalPreview ? 'eye-off-outline' : previewStatus === 'unavailable' ? 'refresh-outline' : 'eye-outline'} size={16} color={theme.accent} />
        <Text style={s.previewLabel}>{originalPreview ? 'ORIGINAL' : previewStatus === 'unavailable' ? 'RETRY' : 'LOOK'}</Text>
      </Pressable>}
    </View>
    <View style={s.modeRow}>
      {(['photo', 'video'] as const).map(value => <Pressable key={value} disabled={busy} accessibilityRole="button"
        accessibilityState={{ selected: mode === value, disabled: busy }} onPress={() => { void changeMode(value); }} style={s.modeButton}>
        <Text style={[s.modeText, mode === value && { color: theme.accent }]}>{value.toUpperCase()}</Text><View style={[s.modeDot, mode === value && { backgroundColor: theme.accent }]} />
      </Pressable>)}
    </View>
    <View style={s.shutterRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open Film Roll" disabled={busy} onPress={onGallery} style={s.roll}>
        {lastThumb ? <Image source={{ uri: lastThumb }} style={s.thumb} /> : <Icon name="images-outline" size={24} />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={finishing ? 'Finishing clip' : countdown !== null ? 'Cancel timer' : mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Record video'}
        disabled={!ready || capturing || audioPending || finishing} onPress={shutter} style={({ pressed }) => [s.shutter, (!ready || capturing || audioPending || finishing) && ui.disabled, pressed && { transform: [{ scale: 0.94 }] }]}>
        {capturing || finishing ? <ActivityIndicator color={theme.accent} /> : <View style={[s.shutterInner, mode === 'video' && { backgroundColor: '#ed7465' }, recording && s.stop]} />}
      </Pressable>
      <IconButton icon="camera-reverse-outline" label="Switch front and back cameras" disabled={busy} onPress={() => {
        buzz(); setReadyKey(null); setLens(undefined); setLenses([]); setZoom(0); setFacing(v => v === 'back' ? 'front' : 'back');
      }} style={s.flip} />
    </View>
    {chooseLook && compact && <View style={s.lookModal} accessibilityViewIsModal>
      <View style={s.lookSheet}>
        <View style={ui.header}><Text style={[s.lookName, { fontSize: 20 }]}>Choose your camera</Text><IconButton icon="close" label="Close camera choices" onPress={() => setChooseLook(false)} /></View>
        <CameraPicker active={camera} showAuto={cloudEnabled && mode === 'photo'} showOriginal onSelect={id => { chooseCamera(id); setChooseLook(false); }} />
        <View style={s.info}><Text style={ui.body}>{look.description}</Text></View>
      </View>
    </View>}
  </View>;
}
const s = StyleSheet.create({
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  brand: { color: theme.text, fontSize: 25, fontWeight: '700', letterSpacing: -1.2 },
  brandDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }, offline: { color: theme.dim, fontSize: 8, letterSpacing: 1.2 },
  controls: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 20 },
  control: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  controlText: { fontSize: 10, letterSpacing: 1, color: theme.muted, fontWeight: '600' },
  soundHint: { color: theme.muted, fontSize: 11, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 4 },
  finderSpace: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 100 },
  finder: { backgroundColor: '#20231d', borderRadius: 18, overflow: 'hidden' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hud: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  hudText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1, textShadowColor: '#000', textShadowRadius: 3 },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#ffffff50' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#ffffff50' },
  countdown: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000030', alignItems: 'center', justifyContent: 'center' },
  countdownText: { color: '#fff', fontSize: 70, fontWeight: '300' },
  lensRow: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 4 },
  lensButton: { minHeight: 44, minWidth: 45, paddingHorizontal: 10, borderRadius: 22, backgroundColor: '#171a15b0', alignItems: 'center', justifyContent: 'center' },
  lensActive: { backgroundColor: '#161912e8', borderWidth: 1, borderColor: '#efb76488' },
  lensText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  recordTrack: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: '#00000050' },
  recordFill: { height: 4, backgroundColor: '#ed7465' },
  lookSummary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18 },
  lookName: { fontSize: 12, color: theme.text, fontWeight: '500' },
  info: { paddingHorizontal: 22, paddingBottom: 8 }, infoBest: { color: theme.accent, fontSize: 11, marginTop: 3 },
  previewRow: { minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  caption: { color: theme.muted, fontSize: 10, flexShrink: 1 },
  previewToggle: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  previewLabel: { color: theme.accent, fontSize: 9, fontWeight: '600', letterSpacing: 0.7 },
  modeRow: { flexDirection: 'row', alignSelf: 'center', gap: 18 },
  modeButton: { minWidth: 65, minHeight: 44, justifyContent: 'center', alignItems: 'center', gap: 5 },
  modeText: { color: theme.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: '700' }, modeDot: { width: 4, height: 4, borderRadius: 2 },
  shutterRow: { height: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 28 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: theme.text, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: theme.text }, stop: { width: 28, height: 28, borderRadius: 7 },
  roll: { width: 48, height: 48, borderRadius: 13, overflow: 'hidden', backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.line },
  thumb: { width: '100%', height: '100%' }, flip: { width: 48, height: 48 },
  error: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 6 },
  lookModal: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000a0', justifyContent: 'flex-end' },
  lookSheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, gap: 12 },
});
