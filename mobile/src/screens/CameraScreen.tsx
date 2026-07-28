import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LightSensor } from 'expo-sensors';
import { CameraView, CameraType, FlashMode } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { FILTERS, type FilterId } from '../filters';
import { getRandomPose, type PoseSuggestion } from '../poses';
import { guideComposition } from '../services/api';
import type { Settings } from '../settings';
import type { SelectedFile } from '../types';

const { width: W } = Dimensions.get('window');
type FlashState = 'auto' | 'on' | 'off';

// iOS reports physical lenses by AVFoundation device type. Mapping them to the
// familiar magnification labels lets the UI behave like the stock Camera app:
// tapping 1x selects the wide-angle lens outright instead of digitally zooming.
const LENS_LABELS: { match: string; label: string; order: number }[] = [
  { match: 'ultrawide', label: '0.5', order: 0 },
  { match: 'wideangle', label: '1', order: 1 },
  { match: 'telephoto', label: '2.5', order: 2 },
];

/** Default lens = the 1x wide-angle camera, matching expo-camera's own default. */
const WIDE_LENS_HINT = 'wideangle';

type LensOption = { name: string; label: string };

function describeLenses(names: string[]): LensOption[] {
  const out: LensOption[] = [];
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    // Skip virtual/composite devices (dual, triple) — they re-introduce the
    // ambiguous zoom behaviour we're trying to avoid by picking a physical lens.
    if (key.includes('dual') || key.includes('triple')) continue;
    const hit = LENS_LABELS.find(l => key.includes(l.match));
    if (hit) out.push({ name, label: hit.label });
  }
  out.sort((a, b) => Number(a.label) - Number(b.label));
  return out;
}

type Props = {
  onCapture: (file: SelectedFile, uri: string, camera: FilterId | 'auto') => void;
  onGallery: () => void;
  onSettings: () => void;
  lastThumb: string | null;
  backendReady: boolean;
  settings: Settings;
};

export function CameraScreen({ onCapture, onGallery, onSettings, lastThumb, backendReady, settings }: Props) {
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashState, setFlashState] = useState<FlashState>('auto');
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(settings.grid);
  const [showSettings, setShowSettings] = useState(false);
  const [flashAnimActive, setFlashAnimActive] = useState(false);
  const [lowLight, setLowLight] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterId | 'auto'>(settings.defaultCamera);
  const [showGuide, setShowGuide] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseSuggestion>(getRandomPose('portrait'));
  const [aiGuide, setAiGuide] = useState<{ instructions: string[]; tip: string } | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [lenses, setLenses] = useState<LensOption[]>([]);
  const [lens, setLens] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const shutterGlow = useRef(new Animated.Value(0)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);

  const flashMode: FlashMode = flashState === 'auto' ? 'auto' : flashState === 'on' ? 'on' : 'off';

  /** Haptic feedback that respects the user's setting. */
  const buzz = useCallback(async (style: Haptics.ImpactFeedbackStyle) => {
    if (settings.haptics) await Haptics.impactAsync(style);
  }, [settings.haptics]);

  useEffect(() => { Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start(); }, [fadeIn]);
  useEffect(() => { Animated.loop(Animated.sequence([Animated.timing(shutterGlow, { toValue: 0.5, duration: 1200, useNativeDriver: true }), Animated.timing(shutterGlow, { toValue: 0, duration: 1200, useNativeDriver: true })])).start(); }, [shutterGlow]);

  // Ambient light sensor: a genuine reading, used only as an advisory hint.
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    LightSensor.isAvailableAsync().then(available => {
      if (available) { sub = LightSensor.addListener(({ illuminance }) => { setLowLight(illuminance < 10); }); LightSensor.setUpdateInterval(2000); }
    }).catch(() => {});
    return () => { sub?.remove(); };
  }, []);

  const onCameraReady = useCallback(async () => {
    setReady(true);
    // Discover physical lenses so 1x means "the wide-angle lens", not a zoom guess.
    try {
      const names = (await cam.current?.getAvailableLensesAsync()) ?? [];
      const opts = describeLenses(names);
      setLenses(opts);
      setLens(prev => prev ?? opts.find(o => o.name.toLowerCase().includes(WIDE_LENS_HINT))?.name);
    } catch {
      setLenses([]);   // Android / web: fall back to plain zoom behaviour
    }
  }, []);

  const selectLens = useCallback((name: string) => {
    buzz(Haptics.ImpactFeedbackStyle.Light);
    setLens(name);
    setZoom(0);   // switching lens resets digital zoom, as the stock app does
  }, [buzz]);

  // Controls (each one maps to a real camera capability)
  const cycleFlash = useCallback(() => { buzz(Haptics.ImpactFeedbackStyle.Light); setFlashState(f => f === 'auto' ? 'on' : f === 'on' ? 'off' : 'auto'); }, [buzz]);
  const flip = useCallback(() => { buzz(Haptics.ImpactFeedbackStyle.Medium); setFacing(f => f === 'back' ? 'front' : 'back'); }, [buzz]);
  const cycleTimer = useCallback(() => { buzz(Haptics.ImpactFeedbackStyle.Light); setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, [buzz]);
  const toggleGrid = useCallback(() => { buzz(Haptics.ImpactFeedbackStyle.Light); setShowGrid(g => !g); }, [buzz]);
  const toggleGuide = useCallback(() => {
    buzz(Haptics.ImpactFeedbackStyle.Light);
    setShowGuide(g => {
      if (!g) { setCurrentPose(getRandomPose('portrait')); setAiGuide(null); }
      return !g;
    });
  }, [buzz]);
  const nextPose = useCallback(() => { buzz(Haptics.ImpactFeedbackStyle.Light); setCurrentPose(getRandomPose('portrait')); }, [buzz]);

  const requestAiGuide = useCallback(async () => {
    if (!cam.current || !ready || !backendReady) return;
    setGuideLoading(true);
    try {
      const snap = await cam.current.takePictureAsync({ quality: 0.4 });
      if (!snap?.uri) return;
      const result = await guideComposition(snap.uri);
      setAiGuide({ instructions: result.instructions, tip: result.compositionTip });
    } catch {
      setErr('Guide unavailable');
      setTimeout(() => setErr(''), 2500);
    } finally { setGuideLoading(false); }
  }, [ready, backendReady]);

  // Pinch to zoom. expo-camera's zoom is a 0..1 position across whatever range the
  // lens supports, so the readout is shown as a percentage rather than a fake "2x".
  const onPinch = useCallback((e: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = e.nativeEvent.touches; if (!t || t.length < 2) { lastDist.current = null; return; }
    const d = Math.sqrt((t[0].pageX - t[1].pageX) ** 2 + (t[0].pageY - t[1].pageY) ** 2);
    if (lastDist.current !== null) setZoom(z => Math.min(1, Math.max(0, z + (d - lastDist.current!) * 0.003)));
    lastDist.current = d;
  }, []);
  const onPinchEnd = useCallback(() => { lastDist.current = null; }, []);
  const resetZoom = useCallback(() => { if (zoom !== 0) { buzz(Haptics.ImpactFeedbackStyle.Light); setZoom(0); } }, [zoom, buzz]);

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [shutterAnim]);
  const triggerFlash = useCallback(() => { setFlashAnimActive(true); flashOpacity.setValue(1); Animated.timing(flashOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => setFlashAnimActive(false)); }, [flashOpacity]);

  const doCapture = useCallback(async () => {
    if (!cam.current || !ready || capturing) return;
    setCapturing(true);
    try {
      await buzz(Haptics.ImpactFeedbackStyle.Medium);
      triggerFlash();
      const p = await cam.current.takePictureAsync({ quality: 0.95 });
      if (!p?.uri) return;
      const fi = new File(p.uri).info();
      // The graded result is what gets saved to the camera roll (see App.onCapture),
      // so nothing is written to the library here.
      onCapture(
        { uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null },
        p.uri,
        activeFilter,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Capture failed');
      setTimeout(() => setErr(''), 2500);
    } finally {
      setCapturing(false);
    }
  }, [ready, capturing, onCapture, triggerFlash, activeFilter, buzz]);

  const onShutter = useCallback(() => {
    if (timer === 0) { doCapture(); return; }
    setCountdown(timer);
    let t = timer;
    const iv = setInterval(() => {
      t--;
      if (t <= 0) { clearInterval(iv); setCountdown(null); doCapture(); } else setCountdown(t);
    }, 1000);
  }, [timer, doCapture]);

  const selectedName = activeFilter === 'auto'
    ? 'Auto · backend picks the camera for this scene'
    : (FILTERS.find(f => f.id === activeFilter)?.tagline ?? '');
  // Live preview wash for the chosen camera. 'auto' stays neutral because the
  // decision is made server-side from the full-resolution pixels.
  const previewFilter = activeFilter === 'auto' ? undefined : FILTERS.find(f => f.id === activeFilter);

  // Surfaced on the capture screen so armed effects aren't a surprise after the shot.
  const activeEffects: string[] = [];
  if (settings.dateStamp) activeEffects.push('DATE');
  if (settings.frame !== 'none') activeEffects.push(settings.frame.toUpperCase() + ' FRAME');
  if (settings.lightLeak > 0) activeEffects.push('LEAK');
  if (settings.dust > 0) activeEffects.push('DUST');
  if (settings.characterStrength === 0) activeEffects.push('COLOUR ONLY');
  else if (settings.characterStrength >= 1.25) activeEffects.push('HEAVY CHARACTER');

  return (
    <Animated.View style={[st.bg, { opacity: fadeIn }]}><StatusBar style="light" />

      {/* Top bar */}
      <View style={st.topBar}>
        <Pressable onPress={cycleFlash} style={st.topPill}>
          <View style={st.boltWrap}><View style={[st.boltTop, flashState !== 'off' && st.boltOn]} /><View style={[st.boltBot, flashState !== 'off' && st.boltOn]} /></View>
          {flashState === 'auto' && <Text style={st.trLabel}>A</Text>}
        </Pressable>
        {!backendReady && (
          <View style={st.offlinePill}><Text style={st.offlineT}>Offline · no camera look</Text></View>
        )}
        <Pressable onPress={() => setShowSettings(s => !s)} style={st.topPill}>
          <View style={st.dots}><View style={st.d} /><View style={st.d} /><View style={st.d} /></View>
        </Pressable>
      </View>

      {/* Quick panel — only controls that actually do something */}
      {showSettings && (
        <View style={st.setPanel}>
          <Pressable onPress={cycleFlash} style={st.setItem}><Text style={st.setL}>Flash</Text><Text style={[st.setV, flashState !== 'off' && st.setVOn]}>{flashState === 'auto' ? 'Auto' : flashState === 'on' ? 'On' : 'Off'}</Text></Pressable>
          <Pressable onPress={cycleTimer} style={st.setItem}><Text style={st.setL}>Timer</Text><Text style={[st.setV, timer > 0 && st.setVOn]}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
          <Pressable onPress={toggleGrid} style={st.setItem}><Text style={st.setL}>Grid</Text><Text style={[st.setV, showGrid && st.setVOn]}>{showGrid ? 'On' : 'Off'}</Text></Pressable>
          <Pressable
            onPress={() => { setShowSettings(false); onSettings(); }}
            style={[st.setItem, st.setItemWide]}
          >
            <Text style={st.setL}>More</Text><Text style={st.setVOn}>All settings ›</Text>
          </Pressable>
        </View>
      )}

      {/* Viewfinder — fixed 4:3 box so the preview frames exactly what gets captured.
          A flex-filled box letterboxes or crops the sensor's 4:3 output, which is why
          the framing looked wrong compared to the stock Camera app. */}
      <View style={st.vfOuter}>
        <View style={st.vfWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={resetZoom}
            onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })} onTouchEnd={onPinchEnd}>
            <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flashMode} zoom={zoom}
              mode="picture"
              autofocus="on"
              animateShutter={false}
              selectedLens={lens}
              onCameraReady={onCameraReady} onMountError={e => setErr(e.message)} />
            {previewFilter?.style.overlayColor && <View style={[st.overlay, { backgroundColor: previewFilter.style.overlayColor, opacity: previewFilter.style.overlayOpacity ?? 0.1 }]} pointerEvents="none" />}
            {showGrid && <View style={st.grid} pointerEvents="none"><View style={[st.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} /><View style={[st.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} /><View style={[st.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} /></View>}
            {showGuide && <View style={st.guideOval} pointerEvents="none" />}
            {lowLight && <View style={st.hintBadge} pointerEvents="none"><Text style={st.hintT}>Low light — hold steady</Text></View>}
            {zoom > 0 && <View style={st.zoomBadge} pointerEvents="none"><Text style={st.zoomT}>{`ZOOM +${Math.round(zoom * 100)}%  ·  tap to reset`}</Text></View>}
            {countdown !== null && <View style={st.countBg}><Text style={st.countN}>{countdown}</Text></View>}
            {flashAnimActive && <Animated.View style={[st.flashOver, { opacity: flashOpacity }]} pointerEvents="none" />}
          </Pressable>
        </View>

        {/* Lens switcher — real optical lenses, like the stock Camera app */}
        {lenses.length > 1 && (
          <View style={st.lensRow}>
            {lenses.map(opt => {
              const active = lens === opt.name && zoom === 0;
              return (
                <Pressable key={opt.name} onPress={() => selectLens(opt.name)} style={[st.lensPill, active && st.lensPillOn]}>
                  <Text style={[st.lensT, active && st.lensTOn]}>{active ? `${opt.label}×` : opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Pose / composition guide */}
      {showGuide && (
        <View style={st.poseCard}>
          {aiGuide ? (
            <>
              {aiGuide.instructions.map((instr, i) => <Text key={i} style={st.poseN}>{instr}</Text>)}
              {aiGuide.tip ? <Text style={st.poseI}>{aiGuide.tip}</Text> : null}
              <Pressable onPress={requestAiGuide} disabled={!backendReady || guideLoading} style={[st.guideBtn, (!backendReady || guideLoading) && st.disabled]}>
                <Text style={st.guideBtnT}>{guideLoading ? 'Analyzing…' : 'Refresh'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={st.poseRow}><Text style={st.poseL}>Pose</Text><Pressable onPress={nextPose}><Text style={st.poseNext}>Next</Text></Pressable></View>
              <Text style={st.poseN}>{currentPose.name}</Text>
              <Text style={st.poseI}>{currentPose.instruction}</Text>
              <Pressable onPress={requestAiGuide} disabled={!backendReady || guideLoading} style={[st.guideBtn, (!backendReady || guideLoading) && st.disabled]}>
                <Text style={st.guideBtnT}>{guideLoading ? 'Analyzing…' : backendReady ? 'AI Guide Me' : 'AI Guide (offline)'}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* Camera strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterScroll} style={st.filterArea}>
        <Pressable onPress={() => { setActiveFilter('auto'); buzz(Haptics.ImpactFeedbackStyle.Light); }} style={[st.fChip, activeFilter === 'auto' && st.fChipAuto]}>
          <View style={[st.fDot, { backgroundColor: '#22c55e' }]} />
          <Text style={[st.fChipT, activeFilter === 'auto' && st.fChipTA]}>Auto</Text>
        </Pressable>
        {FILTERS.filter(f => f.id !== 'original').map(f => (
          <Pressable key={f.id} onPress={() => { setActiveFilter(f.id); buzz(Haptics.ImpactFeedbackStyle.Light); }} style={[st.fChip, activeFilter === f.id && st.fChipA]}>
            <View style={[st.fDot, { backgroundColor: f.dot }]} />
            <Text style={[st.fChipT, activeFilter === f.id && st.fChipTA]}>{f.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={st.camTag} numberOfLines={1}>{selectedName}</Text>

      {/* Which effects are armed — otherwise settings are invisible until after the shot */}
      {activeEffects.length > 0 && (
        <View style={st.fxRow}>
          {activeEffects.map(tag => (
            <View key={tag} style={st.fxTag}><Text style={st.fxTagT}>{tag}</Text></View>
          ))}
        </View>
      )}

      {/* Shutter */}
      <View style={st.shutterArea}>
        <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready || capturing}>
          <Animated.View style={[st.shutterGlow, { opacity: shutterGlow }]} />
          <Animated.View style={[st.shOuter, { transform: [{ scale: shutterAnim }] }]}><View style={st.shInner} /></Animated.View>
        </Pressable>
      </View>

      {/* Bottom row: gallery thumb + guide toggle + flip */}
      <View style={st.botRow}>
        <Pressable onPress={onGallery} style={st.thumb}>{lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbPh} />}</Pressable>
        <Pressable onPress={toggleGuide} style={[st.guideToggle, showGuide && st.guideToggleOn]}>
          <Text style={[st.guideToggleT, showGuide && st.guideToggleTOn]}>GUIDE</Text>
        </Pressable>
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
  trLabel: { color: '#FFD60A', fontSize: 8, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 3 }, d: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  offlinePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(60,20,20,0.9)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)' },
  offlineT: { color: '#ff8a8a', fontSize: 10, fontWeight: '600' },

  // Settings panel
  setPanel: { position: 'absolute', top: 96, left: 16, right: 16, zIndex: 20, backgroundColor: 'rgba(28,28,30,0.95)', borderRadius: 14, padding: 6, flexDirection: 'row', flexWrap: 'wrap' },
  setItem: { width: '33%', paddingVertical: 10, alignItems: 'center' },
  setL: { color: '#636366', fontSize: 9, fontWeight: '500', marginBottom: 2 },
  setV: { color: '#fff', fontSize: 11, fontWeight: '600' },
  setVOn: { color: '#FFD60A', fontSize: 11, fontWeight: '600' },
  setItemWide: { width: '100%', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 10 },
  fxRow: { flexDirection: 'row', alignSelf: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 16 },
  fxTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(255,214,10,0.14)', borderWidth: 1, borderColor: 'rgba(255,214,10,0.3)' },
  fxTagT: { color: '#FFD60A', fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },

  // Viewfinder — fixed 4:3 (portrait 3:4) so preview == captured frame
  vfOuter: { flex: 1, justifyContent: 'center' },
  vfWrap: { width: W - 16, height: (W - 16) * (4 / 3), alignSelf: 'center', borderRadius: 20, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  overlay: { ...StyleSheet.absoluteFillObject },
  grid: { ...StyleSheet.absoluteFillObject }, gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.2)' },
  guideOval: { position: 'absolute', top: '12%', alignSelf: 'center', width: W * 0.38, height: W * 0.52, borderRadius: W * 0.19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', borderStyle: 'dashed' },
  lensRow: { flexDirection: 'row', alignSelf: 'center', marginTop: 10, backgroundColor: 'rgba(28,28,30,0.8)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 3, gap: 2 },
  lensPill: { minWidth: 36, height: 36, paddingHorizontal: 8, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lensPillOn: { backgroundColor: 'rgba(60,60,62,0.95)' },
  lensT: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700' },
  lensTOn: { color: '#FFD60A', fontSize: 12 },
  hintBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  hintT: { color: '#FFD60A', fontSize: 10, fontWeight: '600' },
  zoomBadge: { position: 'absolute', bottom: 14, alignSelf: 'center', backgroundColor: 'rgba(28,28,30,0.8)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  zoomT: { color: '#FFD60A', fontSize: 10, fontWeight: '700' },
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fff' },
  flashOver: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },

  // Pose / guide card
  poseCard: { marginHorizontal: 16, marginTop: 8, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 10 },
  poseRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  poseL: { color: '#636366', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  poseNext: { color: '#636366', fontSize: 10 },
  poseN: { color: '#fff', fontSize: 13, fontWeight: '600' },
  poseI: { color: '#8e8e93', fontSize: 11, lineHeight: 15 },
  guideBtn: { marginTop: 8, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  guideBtnT: { color: '#FFD60A', fontSize: 11, fontWeight: '600' },
  disabled: { opacity: 0.4 },

  // Filter strip
  filterArea: { maxHeight: 34, marginTop: 6 },
  filterScroll: { paddingHorizontal: 12, gap: 5 },
  fChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  fChipA: { backgroundColor: '#2c2c2e', borderColor: 'rgba(255,255,255,0.08)' },
  fChipAuto: { backgroundColor: 'rgba(34,197,94,0.15)' },
  fDot: { width: 8, height: 8, borderRadius: 4 },
  fChipT: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  fChipTA: { color: '#fff' },
  camTag: { color: '#8e8e93', fontSize: 10, textAlign: 'center', marginTop: 4, paddingHorizontal: 16 },

  // Shutter area
  shutterArea: { alignItems: 'center', paddingVertical: 10 },
  shutterGlow: { position: 'absolute', width: 82, height: 82, borderRadius: 41, backgroundColor: 'rgba(255,255,255,0.12)', top: -5, left: -5 },
  shOuter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  // Bottom row
  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingBottom: 36 },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  thumbImg: { width: '100%', height: '100%' }, thumbPh: { flex: 1, backgroundColor: '#1c1c1e' },
  guideToggle: { paddingVertical: 9, paddingHorizontal: 20, borderRadius: 16, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  guideToggleOn: { backgroundColor: '#3a3a3c', borderColor: '#FFD60A' },
  guideToggleT: { color: '#636366', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  guideToggleTOn: { color: '#FFD60A' },
  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  flipCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  flipArrow1: { position: 'absolute', top: -1, right: 2, width: 0, height: 0, borderLeftWidth: 3, borderRightWidth: 3, borderBottomWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff' },
  flipArrow2: { position: 'absolute', bottom: -1, left: 2, width: 0, height: 0, borderLeftWidth: 3, borderRightWidth: 3, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff' },

  toast: { position: 'absolute', top: 110, left: 16, right: 16, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 12, textAlign: 'center' },
});
