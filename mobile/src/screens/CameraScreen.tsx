import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { LightSensor } from 'expo-sensors';
import { CameraView, CameraType, FlashMode, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { FILTERS, type FilterId } from '../filters';
import { pickBestFilter } from '../autoFilter';
import { getRandomPose, type PoseSuggestion } from '../poses';
import type { CaptureMode, SelectedFile } from '../types';

const { width: W, height: H } = Dimensions.get('window');
type FlashState = 'auto' | 'on' | 'off';
type AspectState = '4:3' | '16:9' | '1:1';
type FormatState = 'HEIF' | 'JPEG' | 'RAW';
const ASPECT_H: Record<AspectState, number> = { '4:3': W * (4/3), '16:9': W * (16/9), '1:1': W };
const ZOOM_LEVELS = [0, 0.14, 0.35, 0.7] as const;
const ZOOM_LABELS = ['0.5', '1', '2', '5'] as const;

type Props = { onCapture: (file: SelectedFile, uri: string, filterId: FilterId) => void; onGallery: () => void; lastThumb: string | null };

export function CameraScreen({ onCapture, onGallery, lastThumb }: Props) {
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashState, setFlashState] = useState<FlashState>('auto');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [activeZoomIdx, setActiveZoomIdx] = useState(1);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [exposure, setExposure] = useState(0);
  const [showExposure, setShowExposure] = useState(false);
  const [aspect, setAspect] = useState<AspectState>('4:3');
  const [format, setFormat] = useState<FormatState>('HEIF');
  const [nightMode, setNightMode] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [flashAnimActive, setFlashAnimActive] = useState(false);
  const [lowLight, setLowLight] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterId | 'auto'>('auto');
  const [faceDetected, setFaceDetected] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseSuggestion>(getRandomPose('portrait'));
  const [showPose, setShowPose] = useState(false);
  const [err, setErr] = useState('');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);
  const lastTap = useRef(0);

  const flashMode: FlashMode = flashState === 'auto' ? 'auto' : flashState === 'on' ? 'on' : 'off';


  useEffect(() => { Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [fadeIn]);
  useEffect(() => { if (recording) { recRef.current = 0; setRecSec(0); const iv = setInterval(() => { recRef.current++; setRecSec(recRef.current); }, 1000); return () => clearInterval(iv); } }, [recording]);
  useEffect(() => { const sub = LightSensor.addListener(({ illuminance }) => { setLowLight(illuminance < 10); if (illuminance < 10) setNightMode(true); }); LightSensor.setUpdateInterval(2000); return () => sub.remove(); }, []);

  // Controls
  const cycleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlashState(f => f === 'auto' ? 'on' : f === 'on' ? 'off' : 'auto'); }, []);
  const flip = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setFacing(f => f === 'back' ? 'front' : 'back'); }, []);
  const cycleTimer = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, []);
  const cycleAspect = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAspect(a => a === '4:3' ? '16:9' : a === '16:9' ? '1:1' : '4:3'); }, []);
  const cycleFormat = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFormat(f => f === 'HEIF' ? 'JPEG' : f === 'JPEG' ? 'RAW' : 'HEIF'); }, []);
  const toggleNight = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNightMode(n => !n); }, []);
  const toggleGrid = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowGrid(g => !g); }, []);
  const toggleGuide = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFaceDetected(f => !f); setShowPose(p => !p); if (!showPose) setCurrentPose(getRandomPose('portrait')); }, [showPose]);
  const nextPose = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCurrentPose(getRandomPose('portrait')); }, []);

  const selectZoom = useCallback((idx: number) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveZoomIdx(idx); setZoom(ZOOM_LEVELS[idx]); }, []);

  // Pinch zoom
  const onPinch = useCallback((e: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = e.nativeEvent.touches; if (!t || t.length < 2) { lastDist.current = null; return; }
    const d = Math.sqrt((t[0].pageX - t[1].pageX) ** 2 + (t[0].pageY - t[1].pageY) ** 2);
    if (lastDist.current !== null) setZoom(z => Math.min(1, Math.max(0, z + (d - lastDist.current!) * 0.003)));
    lastDist.current = d;
  }, []);
  const onPinchEnd = useCallback(() => { lastDist.current = null; }, []);

  // Exposure pan
  const expPan = useRef(PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderMove: (_, g) => { setExposure(e => Math.min(2, Math.max(-2, e - g.dy * 0.008))); } })).current;

  // Tap focus
  const onTapFocus = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const now = Date.now(); if (now - lastTap.current < 300) { setZoom(0); setActiveZoomIdx(1); } lastTap.current = now;
    setShowExposure(true); setExposure(0);
    setTimeout(() => setShowExposure(false), 2500);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [shutterAnim]);
  const triggerFlash = useCallback(() => { setFlashAnimActive(true); flashOpacity.setValue(1); Animated.timing(flashOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => setFlashAnimActive(false)); }, [flashOpacity]);

  const doCapture = useCallback(async () => {
    if (!cam.current || !ready) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    triggerFlash();
    const p = await cam.current.takePictureAsync({ quality: 0.95 });
    if (!p?.uri) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') await MediaLibrary.saveToLibraryAsync(p.uri);
    const resolvedFilter: FilterId = activeFilter === 'auto' ? pickBestFilter({ brightness: lowLight ? 'low' : 'normal', hasPortrait: faceDetected }) : activeFilter;
    const fi = new File(p.uri).info();
    onCapture({ uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, p.uri, resolvedFilter);
  }, [ready, onCapture, triggerFlash, activeFilter, lowLight, faceDetected]);

  const captureWithTimer = useCallback(() => { if (timer === 0) { doCapture(); return; } setCountdown(timer); let t = timer; const iv = setInterval(() => { t--; if (t <= 0) { clearInterval(iv); setCountdown(null); doCapture(); } else setCountdown(t); }, 1000); }, [timer, doCapture]);

  const startRec = useCallback(async () => {
    if (!cam.current || !ready) return;
    if (!micPerm?.granted) { const r = await requestMic(); if (!r.granted) return; }
    setRecording(true); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try { const v = await cam.current.recordAsync({ maxDuration: 60 }); if (!v?.uri) throw new Error('Failed');
      const { status } = await MediaLibrary.requestPermissionsAsync(); if (status === 'granted') await MediaLibrary.saveToLibraryAsync(v.uri);
      const fi = new File(v.uri).info();
      onCapture({ uri: v.uri, name: `VID_${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, v.uri, 'original');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setRecording(false); }
  }, [ready, micPerm, requestMic, onCapture]);

  const stopRec = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cam.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { captureWithTimer(); }, [captureWithTimer]);

  const modePan = useRef(PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 25 && Math.abs(g.dy) < 20, onPanResponderRelease: (_, g) => { if (recording) return; if (g.dx < -40) setMode('video'); else if (g.dx > 40) setMode('photo'); } })).current;

  const vfH = Math.min(ASPECT_H[aspect], H - 260);
  const resolvedFilterId: FilterId = activeFilter === 'auto' ? pickBestFilter({ brightness: lowLight ? 'low' : 'normal', hasPortrait: faceDetected }) : activeFilter;
  const currentFilter = FILTERS.find(f => f.id === resolvedFilterId);


  return (
    <Animated.View style={[st.bg, { opacity: fadeIn }]}><StatusBar style="light" />

      {/* Top controls — absolute over viewfinder */}
      <View style={st.topRow}>
        <Pressable onPress={cycleFlash} style={st.topBtn}><View style={[st.flashBar, flashState !== 'off' && st.flashBarOn]} />{flashState === 'auto' && <Text style={st.flashA}>A</Text>}</Pressable>
        <Pressable onPress={toggleNight} style={st.topBtn}><View style={[st.moonDot, nightMode && st.moonOn]} /></Pressable>
        <Pressable onPress={cycleTimer} style={st.topBtn}><Text style={[st.topBtnT, timer > 0 && st.topBtnActive]}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
        <Pressable onPress={cycleAspect} style={st.topBtn}><Text style={st.topBtnT}>{aspect}</Text></Pressable>
        <Pressable onPress={cycleFormat} style={st.topBtn}><Text style={st.topBtnT}>{format}</Text></Pressable>
        <Pressable onPress={toggleGrid} style={st.topBtn}><View style={[st.gridIcon, showGrid && st.gridIconOn]} /></Pressable>
      </View>

      {/* Viewfinder — fills available space */}
      <View style={st.vfWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onTapFocus}
          onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })} onTouchEnd={onPinchEnd}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flashMode} zoom={zoom}
            mode="picture" videoQuality="720p"
            onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />
          {currentFilter?.style.overlayColor && <View style={[st.overlay, { backgroundColor: currentFilter.style.overlayColor, opacity: currentFilter.style.overlayOpacity ?? 0.1 }]} pointerEvents="none" />}
          {showGrid && <View style={st.grid} pointerEvents="none"><View style={[st.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} /><View style={[st.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} /></View>}
          {faceDetected && <View style={st.guideOval} pointerEvents="none" />}
          {showExposure && <View style={st.expArea} {...expPan.panHandlers}><View style={st.expTrack}><View style={[st.expDot, { bottom: `${((exposure + 2) / 4) * 100}%` }]} /></View></View>}
          {nightMode && <View style={st.nightBadge}><Text style={st.nightT}>Night</Text></View>}
          {countdown !== null && <View style={st.countBg}><Text style={st.countN}>{countdown}</Text></View>}
          {flashAnimActive && <Animated.View style={[st.flashOver, { opacity: flashOpacity }]} pointerEvents="none" />}
        </Pressable>
      </View>

      {/* Bottom section */}
      <View style={st.botSection}>
        {/* Zoom toggle */}
        <View style={st.zoomRow}>
          {ZOOM_LABELS.map((label, i) => (
            <Pressable key={i} onPress={() => selectZoom(i)} style={[st.zoomPill, activeZoomIdx === i && st.zoomPillA]}>
              <Text style={[st.zoomPillT, activeZoomIdx === i && st.zoomPillTA]}>{label}×</Text>
            </Pressable>
          ))}
        </View>

        {/* Pose suggestion (portrait mode only) */}
        {showPose && faceDetected && (
          <View style={st.poseCard}><View style={st.poseRow}><Text style={st.poseL}>Pose</Text><Pressable onPress={nextPose}><Text style={st.poseNext}>Next</Text></Pressable></View>
            <Text style={st.poseN}>{currentPose.name}</Text><Text style={st.poseI}>{currentPose.instruction}</Text></View>
        )}

        {/* Filter strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterScroll} style={st.filterArea}>
          <Pressable onPress={() => { setActiveFilter('auto'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[st.fChip, activeFilter === 'auto' && st.fChipAuto]}><Text style={[st.fChipT, activeFilter === 'auto' && st.fChipTA]}>Auto</Text></Pressable>
          {FILTERS.filter(f => f.id !== 'original').map(f => (
            <Pressable key={f.id} onPress={() => { setActiveFilter(f.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[st.fChip, activeFilter === f.id && st.fChipA]}><Text style={[st.fChipT, activeFilter === f.id && st.fChipTA]}>{f.name}</Text></Pressable>
          ))}
        </ScrollView>

        {/* Mode selector */}
        <View style={st.modeRow}>
          <Pressable onPress={() => { setFaceDetected(false); setShowPose(false); }}><Text style={[st.modeT, !faceDetected && st.modeTOn]}>PHOTO</Text></Pressable>
          <Pressable onPress={() => { setFaceDetected(true); setShowPose(true); setCurrentPose(getRandomPose('portrait')); }}><Text style={[st.modeT, faceDetected && st.modeTOn]}>PORTRAIT</Text></Pressable>
        </View>

        {/* Shutter row */}
        <View style={st.ctrlRow}>
          <Pressable onPress={onGallery} style={st.thumb}>{lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbPh} />}</Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
            <Animated.View style={[st.shOuter, { transform: [{ scale: shutterAnim }] }]}><View style={st.shInner} /></Animated.View>
          </Pressable>
          <Pressable onPress={flip} style={st.flipBtn}><View style={st.flipIcon} /><View style={st.flipArrow} /></Pressable>
        </View>
      </View>

      {err.length > 0 && <View style={st.toast}><Text style={st.toastT}>{err}</Text></View>}
    </Animated.View>
  );
}


const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  // Viewfinder fills space between top and bottom
  vfWrap: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject },
  grid: { ...StyleSheet.absoluteFillObject }, gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.2)' },
  guideOval: { position: 'absolute', top: '12%', alignSelf: 'center', width: W * 0.38, height: W * 0.52, borderRadius: W * 0.19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', borderStyle: 'dashed' },
  expArea: { position: 'absolute', right: 20, top: '30%', width: 30, height: 100 },
  expTrack: { flex: 1, alignItems: 'center' }, expDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD60A' },
  nightBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  nightT: { color: '#FFD60A', fontSize: 10, fontWeight: '700' },
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fff' },
  flashOver: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },

  // Top row — absolute, floats over viewfinder top
  topRow: { position: 'absolute', top: 50, left: 0, right: 0, zIndex: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  topBtn: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', minWidth: 32, height: 28, flexDirection: 'row', gap: 2 },
  topBtnT: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  topBtnActive: { color: '#FFD60A' },
  flashBar: { width: 3, height: 12, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.7)' },
  flashBarOn: { backgroundColor: '#FFD60A' },
  flashA: { color: '#FFD60A', fontSize: 9, fontWeight: '700' },
  moonDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', borderTopColor: 'transparent' },
  moonOn: { borderColor: '#FFD60A', borderTopColor: 'transparent' },
  gridIcon: { width: 12, height: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 1 },
  gridIconOn: { borderColor: '#FFD60A' },

  // Bottom section
  botSection: { backgroundColor: '#000', paddingBottom: 30, gap: 8 },

  // Zoom row
  zoomRow: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  zoomPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)' },
  zoomPillA: { backgroundColor: 'rgba(255,215,0,0.15)' },
  zoomPillT: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '700' },
  zoomPillTA: { color: '#FFD60A' },

  // Pose
  poseCard: { marginHorizontal: 16, backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#27272a', padding: 10 },
  poseRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  poseL: { color: '#52525b', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  poseNext: { color: '#a1a1aa', fontSize: 10 },
  poseN: { color: '#fafafa', fontSize: 13, fontWeight: '600' },
  poseI: { color: '#71717a', fontSize: 11, lineHeight: 15 },

  // Filter strip
  filterArea: { maxHeight: 36 },
  filterScroll: { paddingHorizontal: 12, gap: 5 },
  fChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  fChipA: { backgroundColor: 'rgba(255,255,255,0.15)' },
  fChipAuto: { backgroundColor: 'rgba(34,197,94,0.15)' },
  fChipT: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  fChipTA: { color: '#fafafa' },

  // Mode + controls
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  modeT: { fontSize: 12, fontWeight: '600', letterSpacing: 1, color: 'rgba(255,255,255,0.3)' },
  modeTOn: { color: '#FFD60A' },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 24, paddingTop: 8 },
  thumb: { width: 42, height: 42, borderRadius: 8, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)' },
  thumbImg: { width: '100%', height: '100%' }, thumbPh: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)' },
  shOuter: { width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
  flipBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  flipIcon: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  flipArrow: { position: 'absolute', top: 8, right: 10, width: 5, height: 5, borderTopWidth: 1.5, borderRightWidth: 1.5, borderColor: '#fff', transform: [{ rotate: '45deg' }] },
  toast: { position: 'absolute', top: 100, left: 16, right: 16, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 12, textAlign: 'center' },
});
