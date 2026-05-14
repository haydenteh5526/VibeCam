import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { DeviceMotion, LightSensor } from 'expo-sensors';
import { CameraView, CameraType, FlashMode, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { FILTERS, type FilterId } from '../filters';
import type { CaptureMode, SelectedFile } from '../types';

const { width: W, height: H } = Dimensions.get('window');

type Props = { onCapture: (file: SelectedFile, uri: string, filterId: FilterId) => void; onGallery: () => void; lastThumb: string | null };

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
  const [activeFilter, setActiveFilter] = useState<FilterId>('original');
  const [showGrid, setShowGrid] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [flashAnimActive, setFlashAnimActive] = useState(false);
  const [lowLight, setLowLight] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [err, setErr] = useState('');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const shutterGlow = useRef(new Animated.Value(0)).current;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const settingsSlide = useRef(new Animated.Value(-80)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);
  const lastTap = useRef(0);


  useEffect(() => { Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [fadeIn]);
  useEffect(() => { Animated.loop(Animated.sequence([Animated.timing(shutterGlow, { toValue: 0.5, duration: 1200, useNativeDriver: true }), Animated.timing(shutterGlow, { toValue: 0, duration: 1200, useNativeDriver: true })])).start(); }, [shutterGlow]);
  useEffect(() => { if (recording) { recRef.current = 0; setRecSec(0); const iv = setInterval(() => { recRef.current++; setRecSec(recRef.current); }, 1000); return () => clearInterval(iv); } }, [recording]);
  useEffect(() => { const sub = LightSensor.addListener(({ illuminance }) => { setLowLight(illuminance < 10); }); LightSensor.setUpdateInterval(1000); return () => sub.remove(); }, []);

  const toggleSettings = useCallback(() => { const o = !showSettings; setShowSettings(o); Animated.spring(settingsSlide, { toValue: o ? 0 : -80, friction: 8, useNativeDriver: true }).start(); }, [showSettings, settingsSlide]);
  const flip = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFacing(f => f === 'back' ? 'front' : 'back'); }, []);
  const toggleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlash(f => f === 'off' ? 'on' : 'off'); }, []);
  const cycleTimer = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, []);
  const toggleGrid = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowGrid(g => !g); }, []);

  const onPinch = useCallback((e: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = e.nativeEvent.touches; if (!t || t.length < 2) { lastDist.current = null; return; }
    const d = Math.sqrt((t[0].pageX - t[1].pageX) ** 2 + (t[0].pageY - t[1].pageY) ** 2);
    if (lastDist.current !== null) setZoom(z => Math.min(1, Math.max(0, z + (d - lastDist.current!) * 0.003)));
    lastDist.current = d;
  }, []);
  const onPinchEnd = useCallback(() => { lastDist.current = null; }, []);

  const onTapFocus = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const now = Date.now(); if (now - lastTap.current < 300) { setZoom(0); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } lastTap.current = now;
    setFocusXY({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    focusAnim.setValue(1);
    Animated.timing(focusAnim, { toValue: 0, duration: 1200, useNativeDriver: true }).start(() => setFocusXY(null));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [focusAnim]);

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [shutterAnim]);
  const triggerFlash = useCallback(() => { setFlashAnimActive(true); flashOpacity.setValue(1); Animated.timing(flashOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setFlashAnimActive(false)); }, [flashOpacity]);

  // Capture + auto-save to Photos
  const doCapture = useCallback(async () => {
    if (!cam.current || !ready) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    triggerFlash();
    const p = await cam.current.takePictureAsync({ quality: 0.92 });
    if (!p?.uri) return;
    // Auto-save to camera roll
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') await MediaLibrary.saveToLibraryAsync(p.uri);
    const fi = new File(p.uri).info();
    onCapture({ uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, p.uri, activeFilter);
  }, [ready, onCapture, triggerFlash, activeFilter]);

  const captureWithTimer = useCallback(() => { if (timer === 0) { doCapture(); return; } setCountdown(timer); let t = timer; const iv = setInterval(() => { t--; if (t <= 0) { clearInterval(iv); setCountdown(null); doCapture(); } else setCountdown(t); }, 1000); }, [timer, doCapture]);

  const startRec = useCallback(async () => {
    if (!cam.current || !ready) return;
    if (!micPerm?.granted) { const r = await requestMic(); if (!r.granted) return; }
    setRecording(true); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try { const v = await cam.current.recordAsync({ maxDuration: 60 }); if (!v?.uri) throw new Error('Failed');
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') await MediaLibrary.saveToLibraryAsync(v.uri);
      const fi = new File(v.uri).info();
      onCapture({ uri: v.uri, name: `VID_${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, v.uri, activeFilter);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setRecording(false); }
  }, [ready, micPerm, requestMic, onCapture, activeFilter]);

  const stopRec = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cam.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { if (mode === 'photo') captureWithTimer(); else { if (recording) stopRec(); else startRec(); } }, [mode, recording, captureWithTimer, startRec, stopRec]);

  const modePan = useRef(PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dy) < 20, onPanResponderRelease: (_, g) => { if (recording) return; if (g.dx < -40) setMode('video'); else if (g.dx > 40) setMode('photo'); } })).current;

  const currentFilter = FILTERS.find(f => f.id === activeFilter)!;


  return (
    <Animated.View style={[st.bg, { opacity: fadeIn }]}><StatusBar style="light" />
      {/* Viewfinder */}
      <View style={st.vf} {...modePan.panHandlers}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onTapFocus}
          onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })}
          onTouchEnd={onPinchEnd}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom}
            mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p"
            onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />

          {/* Filter overlay */}
          {currentFilter.style.overlayColor && <View style={[st.filterOverlay, { backgroundColor: currentFilter.style.overlayColor, opacity: currentFilter.style.overlayOpacity ?? 0.1 }]} pointerEvents="none" />}

          {/* Grid */}
          {showGrid && <View style={st.grid} pointerEvents="none"><View style={[st.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} /><View style={[st.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} /></View>}

          {/* Focus */}
          {focusXY && <Animated.View style={[st.focus, { left: focusXY.x - 30, top: focusXY.y - 30, opacity: focusAnim, transform: [{ scale: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]} />}

          {/* Zoom */}
          {zoom > 0.01 && <View style={st.zBadge}><Text style={st.zT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}

          {/* Recording */}
          {recording && <View style={st.recBadge}><View style={st.recDot} /><Text style={st.recT}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}

          {/* Countdown */}
          {countdown !== null && <View style={st.countBg}><Text style={st.countN}>{countdown}</Text></View>}

          {/* Flash anim */}
          {flashAnimActive && <Animated.View style={[st.flashOver, { opacity: flashOpacity }]} pointerEvents="none" />}

          {/* Low light */}
          {lowLight && <View style={st.lowBadge}><Text style={st.lowT}>Low Light</Text></View>}

          {/* Active filter name */}
          {activeFilter !== 'original' && <View style={st.filterLabel}><Text style={st.filterLabelT}>{currentFilter.name}</Text></View>}
        </Pressable>
      </View>

      {/* Top bar */}
      <View style={st.topRow}>
        <Pressable onPress={toggleFlash} style={({ pressed }) => [st.topPill, pressed && st.pressed]}><View style={[st.flashDot, flash === 'on' && st.flashOn]} /></Pressable>
        {timer > 0 && <View style={st.timerBadge}><Text style={st.timerT}>{timer}s</Text></View>}
        <Pressable onPress={toggleSettings} style={({ pressed }) => [st.topPill, pressed && st.pressed]}><View style={st.dots}><View style={st.d} /><View style={st.d} /><View style={st.d} /></View></Pressable>
      </View>

      {/* Settings panel */}
      {showSettings && <Animated.View style={[st.setPanel, { transform: [{ translateY: settingsSlide }] }]}>
        <Pressable onPress={cycleTimer} style={st.setItem}><Text style={st.setL}>Timer</Text><Text style={st.setV}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
        <Pressable onPress={toggleGrid} style={st.setItem}><Text style={st.setL}>Grid</Text><Text style={[st.setV, showGrid && st.setVOn]}>{showGrid ? 'On' : 'Off'}</Text></Pressable>
        <Pressable onPress={flip} style={st.setItem}><Text style={st.setL}>Flip</Text><Text style={st.setV}>{facing === 'back' ? 'Rear' : 'Front'}</Text></Pressable>
      </Animated.View>}

      {/* Filter strip — PRIMARY FEATURE */}
      <View style={st.filterStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterScroll}>
          {FILTERS.map(f => (
            <Pressable key={f.id} onPress={() => { setActiveFilter(f.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[st.filterChip, activeFilter === f.id && st.filterChipA]}>
              <View style={[st.filterDot, { backgroundColor: f.style.overlayColor || (f.id === 'bw' ? '#808080' : '#fafafa') }]} />
              <Text style={[st.filterChipT, activeFilter === f.id && st.filterChipTA]}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Bottom controls */}
      <View style={st.bot}>
        <View style={st.modePill}>
          <Pressable onPress={() => !recording && setMode('photo')} style={[st.modeOpt, mode === 'photo' && st.modeOptA]}><Text style={[st.modeOptT, mode === 'photo' && st.modeOptTA]}>Photo</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')} style={[st.modeOpt, mode === 'video' && st.modeOptA]}><Text style={[st.modeOptT, mode === 'video' && st.modeOptTA]}>Video</Text></Pressable>
        </View>
        <View style={st.ctrlRow}>
          <Pressable onPress={onGallery} style={st.thumb}>{lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbPh} />}</Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
            <Animated.View style={[st.shutterGlow, { opacity: shutterGlow }]} />
            <Animated.View style={[st.shutter, { transform: [{ scale: shutterAnim }] }]}><View style={[st.shutterFill, recording && st.shutterRec]} /></Animated.View>
          </Pressable>
          <Pressable onPress={flip} style={({ pressed }) => [st.flipBtn, pressed && st.pressed]}><View style={st.flipIn} /></Pressable>
        </View>
      </View>

      {err.length > 0 && <View style={st.toast}><Text style={st.toastT}>{err}</Text></View>}
    </Animated.View>
  );
}


const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b' },
  vf: { flex: 1, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, overflow: 'hidden' },
  filterOverlay: { ...StyleSheet.absoluteFillObject },
  grid: { ...StyleSheet.absoluteFillObject }, gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.15)' },
  focus: { position: 'absolute', width: 60, height: 60, borderWidth: 1, borderColor: '#fafafa', borderRadius: 2 },
  zBadge: { position: 'absolute', bottom: 14, alignSelf: 'center', backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#27272a' },
  zT: { color: '#fafafa', fontSize: 11, fontWeight: '700' },
  recBadge: { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#27272a', gap: 6 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  recT: { color: '#ef4444', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.4)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fafafa' },
  flashOver: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  lowBadge: { position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#27272a' },
  lowT: { color: '#fbbf24', fontSize: 10, fontWeight: '600' },
  filterLabel: { position: 'absolute', bottom: 14, left: 14, backgroundColor: 'rgba(9,9,11,0.7)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#27272a' },
  filterLabelT: { color: '#fafafa', fontSize: 11, fontWeight: '600' },

  // Top
  topRow: { position: 'absolute', top: 54, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topPill: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(24,24,27,0.8)', borderWidth: 1, borderColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  flashDot: { width: 3, height: 12, borderRadius: 2, backgroundColor: '#71717a' }, flashOn: { backgroundColor: '#fbbf24' },
  dots: { flexDirection: 'row', gap: 3 }, d: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#a1a1aa' },
  timerBadge: { backgroundColor: 'rgba(24,24,27,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#27272a' },
  timerT: { color: '#fafafa', fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.7 },

  // Settings
  setPanel: { position: 'absolute', top: 96, left: 16, right: 16, backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', padding: 4, flexDirection: 'row' },
  setItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  setL: { color: '#71717a', fontSize: 10, fontWeight: '500', marginBottom: 2 },
  setV: { color: '#a1a1aa', fontSize: 12, fontWeight: '600' }, setVOn: { color: '#fafafa' },

  // Filter strip
  filterStrip: { paddingVertical: 10 },
  filterScroll: { paddingHorizontal: 12, gap: 6 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  filterChipA: { backgroundColor: '#27272a', borderColor: '#3f3f46' },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  filterChipT: { color: '#71717a', fontSize: 11, fontWeight: '600' },
  filterChipTA: { color: '#fafafa' },

  // Bottom
  bot: { paddingTop: 8, paddingBottom: 34, paddingHorizontal: 20, gap: 14 },
  modePill: { flexDirection: 'row', alignSelf: 'center', backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#27272a', padding: 3 },
  modeOpt: { paddingVertical: 7, paddingHorizontal: 20, borderRadius: 8 },
  modeOptA: { backgroundColor: '#27272a' },
  modeOptT: { color: '#71717a', fontSize: 12, fontWeight: '600' }, modeOptTA: { color: '#fafafa' },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thumb: { width: 46, height: 46, borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: '#27272a' },
  thumbImg: { width: '100%', height: '100%' }, thumbPh: { flex: 1, backgroundColor: '#18181b' },
  shutterGlow: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(250,250,250,0.12)', top: -4, left: -4 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fafafa', alignItems: 'center', justifyContent: 'center' },
  shutterFill: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fafafa' },
  shutterRec: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#ef4444' },
  flipBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  flipIn: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#a1a1aa' },
  toast: { position: 'absolute', top: 100, left: 16, right: 16, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 10, padding: 10 },
  toastT: { color: '#ef4444', fontSize: 13, textAlign: 'center', fontWeight: '500' },
});
