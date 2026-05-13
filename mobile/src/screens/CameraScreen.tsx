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
  const [recSec, setRecSec] = useState(0);
  const [flashAnim, setFlashAnim] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [showLevel, setShowLevel] = useState(false);
  const [lowLight, setLowLight] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [err, setErr] = useState('');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);
  const lastTap = useRef(0);
  const burstRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Recording timer
  useEffect(() => { if (recording) { recRef.current = 0; setRecSec(0); const iv = setInterval(() => { recRef.current++; setRecSec(recRef.current); }, 1000); return () => clearInterval(iv); } }, [recording]);

  // Device motion for level indicator
  useEffect(() => {
    if (!showLevel) return;
    const sub = DeviceMotion.addListener(({ rotation }) => { if (rotation) setTilt(rotation.gamma * (180 / Math.PI)); });
    DeviceMotion.setUpdateInterval(100);
    return () => sub.remove();
  }, [showLevel]);

  // Check storage on mount
  useEffect(() => {
    FileSystem.getFreeDiskStorageAsync().then(free => { if (free < 100 * 1024 * 1024) setStorageWarning(true); }).catch(() => {});
  }, []);

  // Low-light detection
  useEffect(() => {
    const sub = LightSensor.addListener(({ illuminance }) => { setLowLight(illuminance < 10); });
    LightSensor.setUpdateInterval(1000);
    return () => sub.remove();
  }, []);

  // ─── Controls ────────────────────────────────────────────────────────────
  const flip = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFacing(f => f === 'back' ? 'front' : 'back'); }, []);
  const toggleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlash(f => f === 'off' ? 'on' : 'off'); }, []);
  const cycleTimer = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, []);
  const cycleAspect = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAspect(a => ASPECT_RATIOS[(ASPECT_RATIOS.indexOf(a) + 1) % 3]); }, []);
  const toggleGrid = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowGrid(g => !g); }, []);
  const toggleLevel = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowLevel(l => !l); }, []);

  // Pinch zoom
  const onPinch = useCallback((e: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = e.nativeEvent.touches; if (!t || t.length < 2) { lastDist.current = null; return; }
    const d = Math.sqrt((t[0].pageX - t[1].pageX) ** 2 + (t[0].pageY - t[1].pageY) ** 2);
    if (lastDist.current !== null) setZoom(z => Math.min(1, Math.max(0, z + (d - lastDist.current!) * 0.003)));
    lastDist.current = d;
  }, []);
  const onPinchEnd = useCallback(() => { lastDist.current = null; }, []);

  // Double-tap to reset zoom
  const onDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) { setZoom(0); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
    lastTap.current = now;
  }, []);

  // Tap to focus + exposure slider
  const onTapFocus = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    onDoubleTap();
    setFocusXY({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    setShowExposure(true); setExposure(0);
    focusAnim.setValue(1);
    Animated.timing(focusAnim, { toValue: 0, duration: 1500, useNativeDriver: true }).start(() => { setFocusXY(null); setShowExposure(false); });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [focusAnim, onDoubleTap]);

  // Exposure pan responder
  const exposurePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => showExposure,
    onMoveShouldSetPanResponder: () => showExposure,
    onPanResponderMove: (_, g) => { setExposure(e => Math.min(2, Math.max(-2, e - g.dy * 0.01))); },
  })).current;

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [shutterAnim]);

  // Flash animation
  const triggerFlash = useCallback(() => {
    setFlashAnim(true);
    flashOpacity.setValue(1);
    Animated.timing(flashOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setFlashAnim(false));
  }, [flashOpacity]);

  // Capture
  const doCapture = useCallback(async () => {
    if (!cam.current || !ready) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    triggerFlash();
    const p = await cam.current.takePictureAsync({ quality: 0.92 });
    if (!p?.uri) return;
    const fi = new File(p.uri).info();
    onCapture({ uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, p.uri);
  }, [ready, onCapture, triggerFlash]);

  // Burst mode (long press)
  const startBurst = useCallback(() => {
    if (mode !== 'photo' || !cam.current || !ready) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    burstRef.current = setInterval(async () => {
      if (!cam.current) return;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const p = await cam.current.takePictureAsync({ quality: 0.8 });
      if (p?.uri) { /* burst photos saved silently */ }
    }, 300);
  }, [mode, ready]);

  const stopBurst = useCallback(() => {
    if (burstRef.current) { clearInterval(burstRef.current); burstRef.current = null; }
  }, []);

  const captureWithTimer = useCallback(() => {
    if (timer === 0) { doCapture(); return; }
    setCountdown(timer); let t = timer;
    const iv = setInterval(() => { t--; if (t <= 0) { clearInterval(iv); setCountdown(null); doCapture(); } else setCountdown(t); }, 1000);
  }, [timer, doCapture]);

  const startRec = useCallback(async () => {
    if (!cam.current || !ready) return;
    if (!micPerm?.granted) { const r = await requestMic(); if (!r.granted) return; }
    setRecording(true); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const v = await cam.current.recordAsync({ maxDuration: 60 });
      if (!v?.uri) throw new Error('Failed');
      const fi = new File(v.uri).info();
      onCapture({ uri: v.uri, name: `VID_${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, v.uri);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setRecording(false); }
  }, [ready, micPerm, requestMic, onCapture]);

  const stopRec = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cam.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { if (mode === 'photo') captureWithTimer(); else { if (recording) stopRec(); else startRec(); } }, [mode, recording, captureWithTimer, startRec, stopRec]);

  const pickFile = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
    if (r.canceled) return; const f = r.assets[0];
    onCapture({ uri: f.uri, name: f.name || 'file', mimeType: (f.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: f.size ?? null }, f.uri);
  }, [onCapture]);

  // Mode swipe
  const modePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dy) < 20,
    onPanResponderRelease: (_, g) => {
      if (recording) return;
      if (g.dx < -40) setMode('video');
      else if (g.dx > 40) setMode('photo');
    },
  })).current;


  const vfHeight = W * ASPECT_VALUES[aspect];

  return (
    <View style={s.bg}><StatusBar style="light" />
      {/* Viewfinder */}
      <View style={[s.vfWrap, { height: Math.min(vfHeight, H - 200) }]} {...modePan.panHandlers}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onTapFocus}
          onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })}
          onTouchEnd={onPinchEnd} onLongPress={startBurst} onPressOut={stopBurst}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom}
            mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p"
            onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />

          {/* Grid overlay */}
          {showGrid && <View style={s.grid} pointerEvents="none">
            <View style={[s.gridLine, { left: '33.3%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View style={[s.gridLine, { left: '66.6%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
            <View style={[s.gridLine, { top: '33.3%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            <View style={[s.gridLine, { top: '66.6%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
          </View>}

          {/* Level indicator */}
          {showLevel && <View style={[s.level, { transform: [{ rotate: `${tilt}deg` }] }, Math.abs(tilt) < 1 && s.levelOk]} pointerEvents="none" />}

          {/* Focus square + exposure */}
          {focusXY && <Animated.View style={[s.focus, { left: focusXY.x - 32, top: focusXY.y - 32, opacity: focusAnim }]} />}
          {showExposure && focusXY && <View style={[s.expSlider, { left: focusXY.x + 40, top: focusXY.y - 50 }]} {...exposurePan.panHandlers}>
            <View style={s.expTrack}><View style={[s.expThumb, { bottom: `${((exposure + 2) / 4) * 100}%` }]} /><Text style={s.expIcon}>☀</Text></View>
          </View>}

          {/* Zoom badge */}
          {zoom > 0.01 && <View style={s.zBadge}><Text style={s.zT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}

          {/* Recording indicator */}
          {recording && <View style={s.recPill}><View style={s.recDot} /><Text style={s.recT}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}

          {/* Countdown */}
          {countdown !== null && <View style={s.countBg}><Text style={s.countN}>{countdown}</Text></View>}

          {/* Flash animation */}
          {flashAnim && <Animated.View style={[s.flashOverlay, { opacity: flashOpacity }]} pointerEvents="none" />}

          {/* Low light */}
          {lowLight && <View style={s.lowLight}><Text style={s.lowLightT}>Low Light</Text></View>}
        </Pressable>
      </View>

      {/* Storage warning */}
      {storageWarning && <View style={s.storageWarn}><Text style={s.storageT}>Low storage space</Text></View>}

      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable onPress={toggleFlash} style={s.topI}><View style={[s.flashDot, flash === 'on' && s.flashOn]} /></Pressable>
        <Pressable onPress={cycleTimer} style={s.topI}><Text style={[s.topTxt, timer > 0 && s.topTxtOn]}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
        <Pressable onPress={cycleAspect} style={s.topI}><Text style={s.topTxt}>{aspect}</Text></Pressable>
        <Pressable onPress={toggleGrid} style={s.topI}><Text style={[s.topTxt, showGrid && s.topTxtOn]}>Grid</Text></Pressable>
        <Pressable onPress={toggleLevel} style={s.topI}><Text style={[s.topTxt, showLevel && s.topTxtOn]}>Level</Text></Pressable>
        <Pressable onPress={flip} style={s.topI}><View style={s.flipC}><View style={s.flipA} /></View></Pressable>
      </View>

      {/* Zoom slider */}
      <View style={s.zoomSlider}>
        <Pressable onPress={() => setZoom(0)}><Text style={[s.zoomDot, zoom < 0.01 && s.zoomDotA]}>1×</Text></Pressable>
        <Pressable onPress={() => setZoom(0.3)}><Text style={[s.zoomDot, zoom > 0.2 && zoom < 0.5 && s.zoomDotA]}>3×</Text></Pressable>
        <Pressable onPress={() => setZoom(0.7)}><Text style={[s.zoomDot, zoom > 0.5 && s.zoomDotA]}>5×</Text></Pressable>
      </View>

      {/* Bottom */}
      <View style={s.bot}>
        <View style={s.modes}>
          <Pressable onPress={() => !recording && setMode('photo')}><Text style={[s.modeT, mode === 'photo' && s.modeTOn]}>PHOTO</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')}><Text style={[s.modeT, mode === 'video' && s.modeTOn]}>VIDEO</Text></Pressable>
        </View>
        <View style={s.row}>
          <Pressable onPress={lastThumb ? onGallery : pickFile} style={s.thumb}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={s.thumbImg} /> : <View style={s.thumbPh} />}
          </Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} onLongPress={startBurst} disabled={!ready}>
            <Animated.View style={[s.shOut, { transform: [{ scale: shutterAnim }] }, recording && s.shOutRec]}>
              <View style={[s.shIn, recording && s.shInRec]} />
            </Animated.View>
          </Pressable>
          <Pressable onPress={flip} style={s.flipBtn}><View style={s.flipBtnIn} /></Pressable>
        </View>
      </View>
      {err.length > 0 && <View style={s.toast}><Text style={s.toastT}>{err}</Text></View>}
    </View>
  );
}


const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  vfWrap: { width: W, overflow: 'hidden', alignSelf: 'center' },
  // Grid
  grid: { ...StyleSheet.absoluteFillObject },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.2)' },
  // Level
  level: { position: 'absolute', top: '50%', left: '20%', right: '20%', height: 2, backgroundColor: '#fff', opacity: 0.5 },
  levelOk: { backgroundColor: '#30D158', opacity: 0.8 },
  // Focus
  focus: { position: 'absolute', width: 64, height: 64, borderWidth: 1, borderColor: '#FFD60A' },
  // Exposure
  expSlider: { position: 'absolute', width: 30, height: 100 },
  expTrack: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  expThumb: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFD60A' },
  expIcon: { fontSize: 16, color: '#FFD60A' },
  // Zoom badge
  zBadge: { position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  zT: { color: '#FFD60A', fontSize: 12, fontWeight: '700' },
  // Rec
  recPill: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 6 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  recT: { color: '#FF3B30', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Countdown
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fff' },
  // Flash overlay
  flashOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  // Low light
  lowLight: { position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  lowLightT: { color: '#FFD60A', fontSize: 10, fontWeight: '600' },
  // Storage
  storageWarn: { position: 'absolute', top: 44, alignSelf: 'center', backgroundColor: 'rgba(255,59,48,0.9)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  storageT: { color: '#fff', fontSize: 11, fontWeight: '600' },
  // Top bar
  topBar: { position: 'absolute', top: 52, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 16, alignItems: 'center' },
  topI: { paddingHorizontal: 6, paddingVertical: 4 },
  flashDot: { width: 4, height: 14, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.5)' },
  flashOn: { backgroundColor: '#FFD60A' },
  topTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600' },
  topTxtOn: { color: '#FFD60A' },
  flipC: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  flipA: { width: 5, height: 5, borderTopWidth: 1.5, borderRightWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', transform: [{ rotate: '45deg' }] },
  // Zoom slider
  zoomSlider: { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 8 },
  zoomDot: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4 },
  zoomDotA: { color: '#FFD60A' },
  // Bottom
  bot: { paddingTop: 8, paddingBottom: 34, backgroundColor: '#000' },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 14 },
  modeT: { fontSize: 12, fontWeight: '600', letterSpacing: 1, color: 'rgba(255,255,255,0.35)' },
  modeTOn: { color: '#FFD60A' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 24 },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbPh: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  shOut: { width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shOutRec: { borderColor: 'rgba(255,255,255,0.3)' },
  shIn: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
  shInRec: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#FF3B30' },
  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  flipBtnIn: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  toast: { position: 'absolute', top: 100, left: 16, right: 16, backgroundColor: 'rgba(255,59,48,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
