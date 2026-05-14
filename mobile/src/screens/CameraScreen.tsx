import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { DeviceMotion, LightSensor } from 'expo-sensors';
import { CameraView, CameraType, FlashMode, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import type { CaptureMode, SelectedFile } from '../types';

const { width: W, height: H } = Dimensions.get('window');
const ASPECT_RATIOS = ['4:3', '16:9', '1:1'] as const;
type AspectRatio = typeof ASPECT_RATIOS[number];
const ASPECT_VALUES: Record<AspectRatio, number> = { '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1 };

type Props = { onCapture: (file: SelectedFile, uri: string) => void; onGallery: () => void; lastThumb: string | null };

export function CameraScreen({ onCapture, onGallery, lastThumb }: Props) {
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [focusXY, setFocusXY] = useState<{ x: number; y: number } | null>(null);
  const [exposure, setExposure] = useState(0);
  const [showExposure, setShowExposure] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>('4:3');
  const [showGrid, setShowGrid] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [flashAnimActive, setFlashAnimActive] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [showLevel, setShowLevel] = useState(false);
  const [lowLight, setLowLight] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [err, setErr] = useState('');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const shutterGlow = useRef(new Animated.Value(0)).current;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const settingsSlide = useRef(new Animated.Value(-100)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);
  const lastTap = useRef(0);
  const burstRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Mount animation
  useEffect(() => { Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [fadeIn]);

  // Shutter glow pulse
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(shutterGlow, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
      Animated.timing(shutterGlow, { toValue: 0, duration: 1200, useNativeDriver: true }),
    ])).start();
  }, [shutterGlow]);

  useEffect(() => { if (recording) { recRef.current = 0; setRecSec(0); const iv = setInterval(() => { recRef.current++; setRecSec(recRef.current); }, 1000); return () => clearInterval(iv); } }, [recording]);
  useEffect(() => { if (!showLevel) return; const sub = DeviceMotion.addListener(({ rotation }) => { if (rotation) setTilt(rotation.gamma * (180 / Math.PI)); }); DeviceMotion.setUpdateInterval(100); return () => sub.remove(); }, [showLevel]);
  useEffect(() => { const sub = LightSensor.addListener(({ illuminance }) => { setLowLight(illuminance < 10); }); LightSensor.setUpdateInterval(1000); return () => sub.remove(); }, []);
  useEffect(() => { FileSystem.getFreeDiskStorageAsync().then(free => { if (free < 100 * 1024 * 1024) setStorageWarning(true); }).catch(() => {}); }, []);

  // Settings panel animation
  const toggleSettings = useCallback(() => {
    const opening = !showSettings;
    setShowSettings(opening);
    Animated.spring(settingsSlide, { toValue: opening ? 0 : -100, friction: 8, useNativeDriver: true }).start();
  }, [showSettings, settingsSlide]);

  const flip = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFacing(f => f === 'back' ? 'front' : 'back'); }, []);
  const toggleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlash(f => f === 'off' ? 'on' : 'off'); }, []);
  const cycleTimer = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, []);
  const cycleAspect = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAspect(a => ASPECT_RATIOS[(ASPECT_RATIOS.indexOf(a) + 1) % 3]); }, []);
  const toggleGrid = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowGrid(g => !g); }, []);
  const toggleLevel = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowLevel(l => !l); }, []);

  const onPinch = useCallback((e: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = e.nativeEvent.touches; if (!t || t.length < 2) { lastDist.current = null; return; }
    const d = Math.sqrt((t[0].pageX - t[1].pageX) ** 2 + (t[0].pageY - t[1].pageY) ** 2);
    if (lastDist.current !== null) setZoom(z => Math.min(1, Math.max(0, z + (d - lastDist.current!) * 0.003)));
    lastDist.current = d;
  }, []);
  const onPinchEnd = useCallback(() => { lastDist.current = null; }, []);

  const onDoubleTap = useCallback(() => { const now = Date.now(); if (now - lastTap.current < 300) { setZoom(0); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } lastTap.current = now; }, []);

  const onTapFocus = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    onDoubleTap();
    setFocusXY({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    setShowExposure(true); setExposure(0);
    focusAnim.setValue(1);
    Animated.timing(focusAnim, { toValue: 0, duration: 1500, useNativeDriver: true }).start(() => { setFocusXY(null); setShowExposure(false); });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [focusAnim, onDoubleTap]);

  const exposurePan = useRef(PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderMove: (_, g) => { setExposure(e => Math.min(2, Math.max(-2, e - g.dy * 0.01))); } })).current;

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [shutterAnim]);

  const triggerFlash = useCallback(() => { setFlashAnimActive(true); flashOpacity.setValue(1); Animated.timing(flashOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setFlashAnimActive(false)); }, [flashOpacity]);

  const doCapture = useCallback(async () => {
    if (!cam.current || !ready) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    triggerFlash();
    const p = await cam.current.takePictureAsync({ quality: 0.92 });
    if (!p?.uri) return;
    const fi = new File(p.uri).info();
    onCapture({ uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, p.uri);
  }, [ready, onCapture, triggerFlash]);

  const startBurst = useCallback(() => { if (mode !== 'photo' || !cam.current || !ready) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); burstRef.current = setInterval(async () => { if (!cam.current) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await cam.current.takePictureAsync({ quality: 0.8 }); }, 300); }, [mode, ready]);
  const stopBurst = useCallback(() => { if (burstRef.current) { clearInterval(burstRef.current); burstRef.current = null; } }, []);

  const captureWithTimer = useCallback(() => { if (timer === 0) { doCapture(); return; } setCountdown(timer); let t = timer; const iv = setInterval(() => { t--; if (t <= 0) { clearInterval(iv); setCountdown(null); doCapture(); } else setCountdown(t); }, 1000); }, [timer, doCapture]);

  const startRec = useCallback(async () => {
    if (!cam.current || !ready) return;
    if (!micPerm?.granted) { const r = await requestMic(); if (!r.granted) return; }
    setRecording(true); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try { const v = await cam.current.recordAsync({ maxDuration: 60 }); if (!v?.uri) throw new Error('Failed'); const fi = new File(v.uri).info(); onCapture({ uri: v.uri, name: `VID_${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, v.uri); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setRecording(false); }
  }, [ready, micPerm, requestMic, onCapture]);

  const stopRec = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cam.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { if (mode === 'photo') captureWithTimer(); else { if (recording) stopRec(); else startRec(); } }, [mode, recording, captureWithTimer, startRec, stopRec]);

  const pickFile = useCallback(async () => { const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' }); if (r.canceled) return; const f = r.assets[0]; onCapture({ uri: f.uri, name: f.name || 'file', mimeType: (f.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: f.size ?? null }, f.uri); }, [onCapture]);

  const modePan = useRef(PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dy) < 20, onPanResponderRelease: (_, g) => { if (recording) return; if (g.dx < -40) setMode('video'); else if (g.dx > 40) setMode('photo'); } })).current;


  const vfH = Math.min(W * ASPECT_VALUES[aspect], H - 220);

  return (
    <Animated.View style={[c.bg, { opacity: fadeIn }]}><StatusBar style="light" />
      {/* Viewfinder */}
      <View style={[c.vf, { height: vfH }]} {...modePan.panHandlers}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onTapFocus}
          onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })}
          onTouchEnd={onPinchEnd} onLongPress={startBurst} onPressOut={stopBurst}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom}
            mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p"
            onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />

          {showGrid && <View style={c.grid} pointerEvents="none"><View style={[c.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} /><View style={[c.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} /><View style={[c.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} /><View style={[c.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} /></View>}
          {showLevel && <View style={[c.level, { transform: [{ rotate: `${tilt}deg` }] }, Math.abs(tilt) < 1 && c.levelOk]} pointerEvents="none" />}
          {focusXY && <Animated.View style={[c.focus, { left: focusXY.x - 30, top: focusXY.y - 30, opacity: focusAnim, transform: [{ scale: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]} />}
          {showExposure && focusXY && <View style={[c.exp, { left: focusXY.x + 38, top: focusXY.y - 44 }]} {...exposurePan.panHandlers}><View style={c.expTrack}><View style={[c.expDot, { bottom: `${((exposure + 2) / 4) * 100}%` }]} /></View></View>}
          {zoom > 0.01 && <View style={c.zBadge}><Text style={c.zT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}
          {recording && <View style={c.recBadge}><View style={c.recDot} /><Text style={c.recT}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}
          {countdown !== null && <View style={c.countBg}><Text style={c.countN}>{countdown}</Text></View>}
          {flashAnimActive && <Animated.View style={[c.flashOver, { opacity: flashOpacity }]} pointerEvents="none" />}
          {lowLight && <View style={c.lowBadge}><Text style={c.lowT}>Low Light</Text></View>}
        </Pressable>
      </View>

      {storageWarning && <View style={c.storBadge}><Text style={c.storT}>Low storage</Text></View>}

      {/* Top — minimal: flash + settings */}
      <View style={c.topRow}>
        <Pressable onPress={toggleFlash} style={({ pressed }) => [c.topPill, pressed && c.pressed]}>
          <View style={[c.flashDot, flash === 'on' && c.flashOn]} />
        </Pressable>
        {timer > 0 && <View style={c.timerBadge}><Text style={c.timerT}>{timer}s</Text></View>}
        <Pressable onPress={toggleSettings} style={({ pressed }) => [c.topPill, pressed && c.pressed]}>
          <View style={c.gearDots}><View style={c.gd} /><View style={c.gd} /><View style={c.gd} /></View>
        </Pressable>
      </View>

      {/* Settings panel (slides in) */}
      {showSettings && <Animated.View style={[c.settingsPanel, { transform: [{ translateY: settingsSlide }] }]}>
        <Pressable onPress={cycleAspect} style={c.setItem}><Text style={c.setLabel}>Aspect</Text><Text style={c.setVal}>{aspect}</Text></Pressable>
        <Pressable onPress={cycleTimer} style={c.setItem}><Text style={c.setLabel}>Timer</Text><Text style={c.setVal}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
        <Pressable onPress={toggleGrid} style={c.setItem}><Text style={c.setLabel}>Grid</Text><Text style={[c.setVal, showGrid && c.setValOn]}>{ showGrid ? 'On' : 'Off'}</Text></Pressable>
        <Pressable onPress={toggleLevel} style={c.setItem}><Text style={c.setLabel}>Level</Text><Text style={[c.setVal, showLevel && c.setValOn]}>{showLevel ? 'On' : 'Off'}</Text></Pressable>
      </Animated.View>}

      {/* Zoom capsule */}
      <View style={c.zoomCapsule}>
        {[0, 0.3, 0.7].map((v, i) => (
          <Pressable key={i} onPress={() => setZoom(v)} style={[c.zoomDot, Math.abs(zoom - v) < 0.15 && c.zoomDotA]}>
            <Text style={[c.zoomDotT, Math.abs(zoom - v) < 0.15 && c.zoomDotTA]}>{['1×', '3×', '5×'][i]}</Text>
          </Pressable>
        ))}
      </View>

      {/* Bottom — frosted glass feel */}
      <View style={c.bot}>
        {/* Mode pill selector */}
        <View style={c.modePill}>
          <Pressable onPress={() => !recording && setMode('photo')} style={[c.modeOpt, mode === 'photo' && c.modeOptA]}><Text style={[c.modeOptT, mode === 'photo' && c.modeOptTA]}>Photo</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')} style={[c.modeOpt, mode === 'video' && c.modeOptA]}><Text style={[c.modeOptT, mode === 'video' && c.modeOptTA]}>Video</Text></Pressable>
        </View>

        {/* Controls row */}
        <View style={c.ctrlRow}>
          <Pressable onPress={lastThumb ? onGallery : pickFile} style={c.thumb}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={c.thumbImg} /> : <View style={c.thumbPh} />}
          </Pressable>

          {/* Shutter with glow */}
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} onLongPress={startBurst} disabled={!ready}>
            <Animated.View style={[c.shutterGlow, { opacity: shutterGlow }]} />
            <Animated.View style={[c.shutter, { transform: [{ scale: shutterAnim }] }]}>
              <View style={[c.shutterFill, recording && c.shutterRec]} />
            </Animated.View>
          </Pressable>

          <Pressable onPress={flip} style={({ pressed }) => [c.flipBtn, pressed && c.pressed]}>
            <View style={c.flipInner} />
          </Pressable>
        </View>
      </View>

      {err.length > 0 && <View style={c.toast}><Text style={c.toastT}>{err}</Text></View>}
    </Animated.View>
  );
}


const c = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b' },
  vf: { width: W, overflow: 'hidden', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  // Grid
  grid: { ...StyleSheet.absoluteFillObject },
  gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.15)' },
  // Level
  level: { position: 'absolute', top: '50%', left: '22%', right: '22%', height: 1.5, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 1 },
  levelOk: { backgroundColor: '#22c55e' },
  // Focus
  focus: { position: 'absolute', width: 60, height: 60, borderWidth: 1, borderColor: '#fafafa', borderRadius: 2 },
  // Exposure
  exp: { position: 'absolute', width: 28, height: 88 },
  expTrack: { flex: 1, alignItems: 'center' },
  expDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#fafafa' },
  // Zoom
  zBadge: { position: 'absolute', bottom: 14, alignSelf: 'center', backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#27272a' },
  zT: { color: '#fafafa', fontSize: 11, fontWeight: '700' },
  // Rec
  recBadge: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#27272a', gap: 6 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  recT: { color: '#ef4444', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Countdown
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.4)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fafafa' },
  // Flash
  flashOver: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  // Low light
  lowBadge: { position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#27272a' },
  lowT: { color: '#fbbf24', fontSize: 10, fontWeight: '600' },
  // Storage
  storBadge: { position: 'absolute', top: 48, alignSelf: 'center', backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  storT: { color: '#ef4444', fontSize: 11, fontWeight: '600' },

  // Top row
  topRow: { position: 'absolute', top: 54, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topPill: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(24,24,27,0.8)', borderWidth: 1, borderColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  flashDot: { width: 3, height: 12, borderRadius: 2, backgroundColor: '#71717a' },
  flashOn: { backgroundColor: '#fbbf24' },
  gearDots: { flexDirection: 'row', gap: 3 },
  gd: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#a1a1aa' },
  timerBadge: { backgroundColor: 'rgba(24,24,27,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#27272a' },
  timerT: { color: '#fafafa', fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.7 },

  // Settings panel
  settingsPanel: { position: 'absolute', top: 96, left: 16, right: 16, backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', padding: 4, flexDirection: 'row', flexWrap: 'wrap' },
  setItem: { width: '50%', paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  setLabel: { color: '#a1a1aa', fontSize: 12, fontWeight: '500' },
  setVal: { color: '#52525b', fontSize: 12, fontWeight: '600' },
  setValOn: { color: '#fafafa' },

  // Zoom capsule
  zoomCapsule: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 10, gap: 4 },
  zoomDot: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  zoomDotA: { backgroundColor: '#27272a', borderColor: '#3f3f46' },
  zoomDotT: { color: '#71717a', fontSize: 11, fontWeight: '600' },
  zoomDotTA: { color: '#fafafa' },

  // Bottom
  bot: { paddingTop: 12, paddingBottom: 36, paddingHorizontal: 20, gap: 16 },
  modePill: { flexDirection: 'row', alignSelf: 'center', backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#27272a', padding: 3 },
  modeOpt: { paddingVertical: 7, paddingHorizontal: 20, borderRadius: 8 },
  modeOptA: { backgroundColor: '#27272a' },
  modeOptT: { color: '#71717a', fontSize: 12, fontWeight: '600' },
  modeOptTA: { color: '#fafafa' },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Thumb
  thumb: { width: 46, height: 46, borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: '#27272a' },
  thumbImg: { width: '100%', height: '100%' },
  thumbPh: { flex: 1, backgroundColor: '#18181b' },

  // Shutter
  shutterGlow: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(250,250,250,0.15)', top: -4, left: -4 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fafafa', alignItems: 'center', justifyContent: 'center' },
  shutterFill: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fafafa' },
  shutterRec: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#ef4444' },

  // Flip
  flipBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  flipInner: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#a1a1aa' },

  // Toast
  toast: { position: 'absolute', top: 100, left: 16, right: 16, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 10, padding: 10 },
  toastT: { color: '#ef4444', fontSize: 13, textAlign: 'center', fontWeight: '500' },
});
