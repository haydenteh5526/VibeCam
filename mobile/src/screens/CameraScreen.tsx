import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, type CameraType, type FlashMode, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { CameraPicker } from '../components/CameraPicker';
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
  onCameraChange, lastThumb, cloudEnabled, settings, appError, onDismissError }: Props) {
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
  const [ready, setReady] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [facing, setFacing] = useState<CameraType>('back');
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [mic, requestMic] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
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
  const busy = recording || capturing || countdown !== null;
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
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', state => {
      const active = state === 'active';
      setForeground(active);
      if (!active) {
        setReady(false); cancelTimer();
        if (lock.current) cam.current?.stopRecording();
      }
    });
    return () => {
      mounted.current = false; cancelTimer(); sub.remove();
      if (recordTimer.current) clearInterval(recordTimer.current);
      if (lock.current) cam.current?.stopRecording();
    };
  }, [cancelTimer]);
  const cameraReady = async () => {
    setReady(true);
    try {
      const options = lensOptions((await cam.current?.getAvailableLensesAsync()) ?? []);
      if (!mounted.current) return;
      setLenses(options);
      setLens(previous => previous ?? options.find(l => l.label === 'Wide')?.name);
    } catch { if (mounted.current) setLenses([]); }
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
    if (!cam.current || !ready || lock.current || !videoAvailable) return;
    lock.current = true; setRecording(true); setSeconds(0); setError(''); buzz();
    const started = Date.now();
    recordTimer.current = setInterval(() => setSeconds(Math.min(15, Math.floor((Date.now() - started) / 1000))), 200);
    try {
      const clip = await cam.current.recordAsync({ maxDuration: 15 });
      if (!clip?.uri) throw new Error('No clip was recorded. Please try again.');
      await onCaptureVideo(clip.uri, camera, Math.min(15000, Date.now() - started));
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Recording failed.'); }
    finally {
      if (recordTimer.current) clearInterval(recordTimer.current);
      recordTimer.current = null; lock.current = false;
      if (mounted.current) setRecording(false);
    }
  };
  const shutter = () => {
    if (countdownTimer.current) { cancelTimer(); return; }
    if (mode === 'video') { if (recording) cam.current?.stopRecording(); else void record(); return; }
    if (!ready || lock.current) return;
    if (!timer) { void capture(); return; }
    setCountdown(timer); let left = timer;
    countdownTimer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) { cancelTimer(); void capture(); }
      else { setCountdown(left); buzz(); }
    }, 1000);
  };
  const changeMode = async (next: 'photo' | 'video') => {
    if (busy || next === mode) return;
    if (next === 'video' && !videoAvailable) {
      setError('Video is available in the installed iPhone app. You can keep shooting photos here.'); return;
    }
    try {
      setError('');
      if (next === 'video' && !mic?.granted && mic?.canAskAgain !== false) await requestMic();
      if (!mounted.current) return;
      setReady(false); setMode(next); setFlashMode(next === 'video' ? 'off' : 'auto'); setInfo(false);
      if (camera === 'auto' && next === 'video') { setCamera('g7x'); onCameraChange('g7x'); }
      buzz();
    } catch { setError('Could not change camera mode. Please try again.'); }
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
      </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={mic?.granted ? 'Microphone enabled' : 'Enable microphone'} disabled={busy}
        onPress={() => { void (mic?.canAskAgain === false ? Linking.openSettings() : requestMic()).catch(() => setError('Enable microphone access in Settings.')); }} style={s.control}>
        <Icon name={mic?.granted ? 'mic-outline' : 'mic-off-outline'} size={18} /><Text style={s.controlText}>{mic?.granted ? 'SOUND' : 'SILENT'}</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Composition grid" accessibilityState={{ selected: grid }} onPress={() => { buzz(); setGrid(v => !v); }} style={s.control}>
        <Icon name="grid-outline" size={18} color={grid ? theme.accent : theme.muted} /><Text style={s.controlText}>GRID</Text>
      </Pressable>
      {compact && <IconButton icon="options-outline" label="Camera settings" onPress={onSettings} disabled={busy} />}
    </View>
    <View style={s.finderSpace} onLayout={e => setSpace(Math.max(1, e.nativeEvent.layout.height - 8))}>
      <View style={[s.finder, { width: vfWidth, height: vfWidth * aspect }]}
        onTouchMove={e => {
          const touches = e.nativeEvent.touches;
          if (touches.length < 2 || capturing) { pinch.current = null; return; }
          const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
          if (pinch.current !== null) setZoom(v => Math.min(1, Math.max(0, v + (distance - pinch.current!) * 0.003)));
          pinch.current = distance;
        }} onTouchEnd={() => { pinch.current = null; }}>
        {foreground && <CameraView key={facing + mode} ref={cam} style={StyleSheet.absoluteFill} facing={facing}
          mode={mode === 'photo' ? 'picture' : 'video'} flash={mode === 'photo' ? flashMode : 'off'}
          enableTorch={mode === 'video' && flashMode === 'on' && facing === 'back'} mute={!mic?.granted} zoom={zoom}
          selectedLens={lens} videoQuality="720p" autofocus="on" animateShutter={false}
          onCameraReady={() => { void cameraReady(); }} onMountError={e => setError(e.message)} />}
        {!ready && <View style={s.loading}><ActivityIndicator color={theme.accent} /><Text style={s.hudText}>Starting camera…</Text></View>}
        {grid && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[1, 2].map(i => <React.Fragment key={i}><View style={[s.gridV, { left: (i * 100 / 3 + '%') as '33%' }]} /><View style={[s.gridH, { top: (i * 100 / 3 + '%') as '33%' }]} /></React.Fragment>)}
        </View>}
        <View pointerEvents="none" style={s.hud}><Text style={s.hudText}>{recording ? '● REC  00:' + String(seconds).padStart(2, '0') : mode === 'photo' ? 'PHOTO  3:4' : 'VIDEO  9:16'}</Text><Text style={s.hudText}>{mode === 'video' ? '720p · 15s' : 'JPEG'}</Text></View>
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
    {error || appError ? <View style={s.error}><View style={{ flex: 1 }}><Notice text={error || appError || ''} error /></View><IconButton icon="close" label="Dismiss camera message" onPress={() => { setError(''); onDismissError(); }} /></View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={(compact ? 'Choose camera look, ' : 'About ') + look.name} accessibilityState={{ expanded: compact ? chooseLook : info }} disabled={busy}
      onPress={() => compact ? setChooseLook(true) : setInfo(v => !v)} style={s.lookSummary}>
      <Text style={s.lookName}>{camera === 'auto' ? 'Automatic look' : compact ? look.name + ' · ' + look.tagline : look.tagline}</Text><Icon name={compact ? 'chevron-down' : info ? 'chevron-up' : 'information-circle-outline'} size={16} color={theme.muted} />
    </Pressable>
    {info && !compact && <View style={s.info}><Text style={ui.body}>{look.description}</Text><Text style={s.infoBest}>{look.bestFor}</Text></View>}
    {!compact && <CameraPicker active={camera} showAuto={cloudEnabled && mode === 'photo'} showOriginal disabled={busy}
      onSelect={id => { setCamera(id); onCameraChange(id); buzz(); }} />}
    <Text style={s.caption}>Look applied after {mode === 'photo' ? 'capture' : 'recording'}</Text>
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
      <Pressable accessibilityRole="button" accessibilityLabel={countdown !== null ? 'Cancel timer' : mode === 'photo' ? 'Take photo' : recording ? 'Stop recording' : 'Record video'}
        disabled={!ready || capturing} onPress={shutter} style={({ pressed }) => [s.shutter, (!ready || capturing) && ui.disabled, pressed && { transform: [{ scale: 0.94 }] }]}>
        {capturing ? <ActivityIndicator color={theme.accent} /> : <View style={[s.shutterInner, mode === 'video' && { backgroundColor: '#ed7465' }, recording && s.stop]} />}
      </Pressable>
      <IconButton icon="camera-reverse-outline" label="Switch front and back cameras" disabled={busy} onPress={() => {
        buzz(); setReady(false); setLens(undefined); setLenses([]); setZoom(0); setFacing(v => v === 'back' ? 'front' : 'back');
      }} style={s.flip} />
    </View>
    {chooseLook && compact && <View style={s.lookModal} accessibilityViewIsModal>
      <View style={s.lookSheet}>
        <View style={ui.header}><Text style={[s.lookName, { fontSize: 20 }]}>Choose your camera</Text><IconButton icon="close" label="Close camera choices" onPress={() => setChooseLook(false)} /></View>
        <CameraPicker active={camera} showAuto={cloudEnabled && mode === 'photo'} showOriginal onSelect={id => { setCamera(id); onCameraChange(id); setChooseLook(false); buzz(); }} />
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
  caption: { color: theme.dim, fontSize: 10, textAlign: 'center', marginBottom: 2 },
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
