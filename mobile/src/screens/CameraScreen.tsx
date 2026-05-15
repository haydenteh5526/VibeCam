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
  const shutterGlow = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);
  const lastTap = useRef(0);

  const flashMode: FlashMode = flashState === 'auto' ? 'auto' : flashState === 'on' ? 'on' : 'off';


  useEffect(() => { Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [fadeIn]);
  useEffect(() => { Animated.loop(Animated.sequence([Animated.timing(shutterGlow, { toValue: 0.5, duration: 1200, useNativeDriver: true }), Animated.timing(shutterGlow, { toValue: 0, duration: 1200, useNativeDriver: true })])).start(); }, [shutterGlow]);
  useEffect(() => { if (recording) { recRef.current = 0; setRecSec(0); const iv = setInterval(() => { recRef.current++; setRecSec(recRef.current); }, 1000); return () => clearInterval(iv); } }, [recording]);
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    LightSensor.isAvailableAsync().then(available => {
      if (available) { sub = LightSensor.addListener(({ illuminance }) => { setLowLight(illuminance < 10); }); LightSensor.setUpdateInterval(2000); }
    }).catch(() => {});
    return () => { sub?.remove(); };
  }, []);

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

      {/* Top bar — Bevel style: flash left, dots right, floating over viewfinder */}
      <View style={st.topBar}>
        <Pressable onPress={cycleFlash} style={st.topPill}>
          <View style={st.boltWrap}><View style={[st.boltTop, flashState !== 'off' && st.boltOn]} /><View style={[st.boltBot, flashState !== 'off' && st.boltOn]} /></View>
          {flashState === 'auto' && <Text style={st.trLabel}>A</Text>}
        </Pressable>
        {lowLight && <Pressable onPress={toggleNight} style={st.topPill}><View style={[st.moonShape, nightMode && st.moonOn]} /></Pressable>}
        <Pressable onPress={() => setShowSettings(s => !s)} style={st.topPill}>
          <View style={st.dots}><View style={st.d} /><View style={st.d} /><View style={st.d} /></View>
        </Pressable>
      </View>

      {/* Settings panel — slides in */}
      {showSettings && (
        <View style={st.setPanel}>
          <Pressable onPress={cycleFlash} style={st.setItem}><Text style={st.setL}>Flash</Text><Text style={[st.setV, flashState !== 'off' && st.setVOn]}>{flashState === 'auto' ? 'Auto' : flashState === 'on' ? 'On' : 'Off'}</Text></Pressable>
          <Pressable onPress={toggleNight} style={st.setItem}><Text style={st.setL}>Night</Text><Text style={[st.setV, nightMode && st.setVOn]}>{nightMode ? 'On' : 'Off'}</Text></Pressable>
          <Pressable onPress={cycleTimer} style={st.setItem}><Text style={st.setL}>Timer</Text><Text style={[st.setV, timer > 0 && st.setVOn]}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
          <Pressable onPress={cycleAspect} style={st.setItem}><Text style={st.setL}>Aspect</Text><Text style={st.setV}>{aspect}</Text></Pressable>
          <Pressable onPress={cycleFormat} style={st.setItem}><Text style={st.setL}>Format</Text><Text style={st.setV}>{format}</Text></Pressable>
          <Pressable onPress={toggleGrid} style={st.setItem}><Text style={st.setL}>Grid</Text><Text style={[st.setV, showGrid && st.setVOn]}>{showGrid ? 'On' : 'Off'}</Text></Pressable>
        </View>
      )}

      {/* Viewfinder */}
      <View style={st.vfWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onTapFocus}
          onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })} onTouchEnd={onPinchEnd}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flashMode} zoom={zoom}
            mode="picture" videoQuality="720p"
            onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />
          {currentFilter?.style.overlayColor && <View style={[st.overlay, { backgroundColor: currentFilter.style.overlayColor, opacity: currentFilter.style.overlayOpacity ?? 0.1 }]} pointerEvents="none" />}
          {showGrid && <View style={st.grid} pointerEvents="none"><View style={[st.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} /><View style={[st.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} /></View>}
          {faceDetected && <View style={st.guideOval} pointerEvents="none" />}
          {/* Yellow crosshair center */}
          <View style={st.crosshair} pointerEvents="none"><View style={st.crossH} /><View style={st.crossV} /></View>
          {showExposure && <View style={st.expArea} {...expPan.panHandlers}><View style={st.expTrack}><View style={[st.expDot, { bottom: `${((exposure + 2) / 4) * 100}%` }]} /></View></View>}
          {nightMode && <View style={st.nightBadge}><Text style={st.nightT}>Night</Text></View>}
          {countdown !== null && <View style={st.countBg}><Text style={st.countN}>{countdown}</Text></View>}
          {flashAnimActive && <Animated.View style={[st.flashOver, { opacity: flashOpacity }]} pointerEvents="none" />}
          {/* Zoom pills inside viewfinder bottom */}
          <View style={st.zoomRow}>
            {ZOOM_LABELS.map((label, i) => (
              <Pressable key={i} onPress={() => selectZoom(i)} style={[st.zoomPill, activeZoomIdx === i && st.zoomPillA]}>
                <Text style={[st.zoomPillT, activeZoomIdx === i && st.zoomPillTA]}>{label}×</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </View>

      {/* Pose suggestion (portrait mode only) */}
      {showPose && faceDetected && (
        <View style={st.poseCard}><View style={st.poseRow}><Text style={st.poseL}>Pose</Text><Pressable onPress={nextPose}><Text style={st.poseNext}>Next</Text></Pressable></View>
          <Text style={st.poseN}>{currentPose.name}</Text><Text style={st.poseI}>{currentPose.instruction}</Text></View>
      )}

      {/* Filter strip — Auto (AI grading) + manual presets with color dots */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterScroll} style={st.filterArea}>
        <Pressable onPress={() => { setActiveFilter('auto'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[st.fChip, activeFilter === 'auto' && st.fChipAuto]}><Text style={[st.fChipT, activeFilter === 'auto' && st.fChipTA]}>Auto</Text></Pressable>
        {FILTERS.filter(f => f.id !== 'original').map(f => (
          <Pressable key={f.id} onPress={() => { setActiveFilter(f.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[st.fChip, activeFilter === f.id && st.fChipA]}>
            <View style={[st.fDot, { backgroundColor: f.style.overlayColor || (f.id === 'bw' ? '#808080' : '#fff') }]} />
            <Text style={[st.fChipT, activeFilter === f.id && st.fChipTA]}>{f.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Shutter — with glow */}
      <View style={st.shutterArea}>
        <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
          <Animated.View style={[st.shutterGlow, { opacity: shutterGlow }]} />
          <Animated.View style={[st.shOuter, { transform: [{ scale: shutterAnim }] }]}><View style={st.shInner} /></Animated.View>
        </Pressable>
      </View>

      {/* Bottom row: thumb + mode pill + flip */}
      <View style={st.botRow}>
        <Pressable onPress={onGallery} style={st.thumb}>{lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbPh} />}</Pressable>
        <View style={st.modePill}>
          <Pressable onPress={() => { setFaceDetected(false); setShowPose(false); }} style={[st.modeOpt, !faceDetected && st.modeOptA]}><Text style={[st.modeOptT, !faceDetected && st.modeOptTA]}>PHOTO</Text></Pressable>
          <Pressable onPress={() => { setFaceDetected(true); setShowPose(true); setCurrentPose(getRandomPose('portrait')); }} style={[st.modeOpt, faceDetected && st.modeOptA]}><Text style={[st.modeOptT, faceDetected && st.modeOptTA]}>PORTRAIT</Text></Pressable>
        </View>
        <Pressable onPress={flip} style={st.flipBtn}><View style={st.flipCircle}><View style={st.flipArrow1} /><View style={st.flipArrow2} /></View></Pressable>
      </View>

      {err.length > 0 && <View style={st.toast}><Text style={st.toastT}>{err}</Text></View>}
    </Animated.View>
  );
}


const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0c0c0c' },
  // Top bar — floating over viewfinder
  topBar: { position: 'absolute', top: 52, left: 16, right: 16, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topPill: { height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(28,28,30,0.85)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 },
  boltWrap: { alignItems: 'center' },
  boltTop: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 2, borderBottomWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff' },
  boltBot: { width: 0, height: 0, borderLeftWidth: 2, borderRightWidth: 5, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff', marginTop: -2 },
  boltOn: { borderBottomColor: '#FFD60A', borderTopColor: '#FFD60A' },
  moonShape: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: '#fff', borderRightColor: 'transparent' },
  moonOn: { borderColor: '#FFD60A', borderRightColor: 'transparent' },
  trLabel: { color: '#FFD60A', fontSize: 8, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 3 }, d: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },

  // Settings panel
  setPanel: { position: 'absolute', top: 96, left: 16, right: 16, zIndex: 20, backgroundColor: 'rgba(28,28,30,0.95)', borderRadius: 14, padding: 6, flexDirection: 'row', flexWrap: 'wrap' },
  setItem: { width: '33%', paddingVertical: 10, alignItems: 'center' },
  setL: { color: '#636366', fontSize: 9, fontWeight: '500', marginBottom: 2 },
  setV: { color: '#fff', fontSize: 11, fontWeight: '600' },
  setVOn: { color: '#FFD60A' },

  // Viewfinder — Bevel rounded card
  vfWrap: { flex: 1, margin: 8, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  overlay: { ...StyleSheet.absoluteFillObject },
  grid: { ...StyleSheet.absoluteFillObject }, gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.2)' },
  guideOval: { position: 'absolute', top: '12%', alignSelf: 'center', width: W * 0.38, height: W * 0.52, borderRadius: W * 0.19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', borderStyle: 'dashed' },
  crosshair: { position: 'absolute', top: '50%', left: '50%', marginTop: -10, marginLeft: -10, width: 20, height: 20 },
  crossH: { position: 'absolute', top: 9, left: 0, right: 0, height: 1, backgroundColor: '#FFD60A' },
  crossV: { position: 'absolute', left: 9, top: 0, bottom: 0, width: 1, backgroundColor: '#FFD60A' },
  expArea: { position: 'absolute', right: 20, top: '30%', width: 30, height: 100 },
  expTrack: { flex: 1, alignItems: 'center' }, expDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD60A' },
  nightBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  nightT: { color: '#FFD60A', fontSize: 10, fontWeight: '700' },
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fff' },
  flashOver: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  zoomRow: { position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', backgroundColor: 'rgba(28,28,30,0.8)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 3, gap: 2 },
  zoomPill: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(28,28,30,0.8)', alignItems: 'center', justifyContent: 'center' },
  zoomPillA: { backgroundColor: 'rgba(60,60,62,0.9)' },
  zoomPillT: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700' },
  zoomPillTA: { color: '#FFD60A' },

  // Pose
  poseCard: { marginHorizontal: 16, marginTop: 8, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 10 },
  poseRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  poseL: { color: '#636366', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  poseNext: { color: '#636366', fontSize: 10 },
  poseN: { color: '#fff', fontSize: 13, fontWeight: '600' },
  poseI: { color: '#8e8e93', fontSize: 11, lineHeight: 15 },

  // Filter strip
  filterArea: { maxHeight: 34, marginTop: 6 },
  filterScroll: { paddingHorizontal: 12, gap: 5 },
  fChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  fChipA: { backgroundColor: '#2c2c2e', borderColor: 'rgba(255,255,255,0.08)' },
  fChipAuto: { backgroundColor: 'rgba(34,197,94,0.15)' },
  fDot: { width: 8, height: 8, borderRadius: 4 },
  fChipT: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  fChipTA: { color: '#fff' },

  // Shutter area
  shutterArea: { alignItems: 'center', paddingVertical: 10 },
  shutterGlow: { position: 'absolute', width: 82, height: 82, borderRadius: 41, backgroundColor: 'rgba(255,255,255,0.12)', top: -5, left: -5 },
  shOuter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  // Bottom row
  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingBottom: 36 },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  thumbImg: { width: '100%', height: '100%' }, thumbPh: { flex: 1, backgroundColor: '#1c1c1e' },
  modePill: { flexDirection: 'row', backgroundColor: '#1c1c1e', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 3 },
  modeOpt: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 14 },
  modeOptA: { backgroundColor: '#3a3a3c' },
  modeOptT: { color: '#636366', fontSize: 12, fontWeight: '600' },
  modeOptTA: { color: '#FFD60A' },
  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  flipCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  flipArrow1: { position: 'absolute', top: -1, right: 2, width: 0, height: 0, borderLeftWidth: 3, borderRightWidth: 3, borderBottomWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff' },
  flipArrow2: { position: 'absolute', bottom: -1, left: 2, width: 0, height: 0, borderLeftWidth: 3, borderRightWidth: 3, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff' },

  toast: { position: 'absolute', top: 110, left: 16, right: 16, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 12, textAlign: 'center' },
});
