import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  type CameraDevice,
} from 'react-native-vision-camera';

import { FILTERS, type FilterId } from '../filters';
import { CameraPicker } from '../components/CameraPicker';
import { getRandomPose, type PoseSuggestion } from '../poses';
import type { Settings } from '../settings';
import type { SelectedFile } from '../types';

const { width: W } = Dimensions.get('window');
type FlashState = 'auto' | 'on' | 'off';

/**
 * Capture screen built on react-native-vision-camera.
 *
 * Why this exists alongside the expo-camera screen: expo-camera exposes only zoom,
 * flash, autofocus on/off and lens selection. VisionCamera adds exposure compensation,
 * true zoom *factors*, tap-to-focus and explicit format selection.
 *
 * Still not available, and deliberately not faked: raw ISO, shutter speed and white
 * balance. VisionCamera 4 has no props for them (verified against its type definitions),
 * so offering those dials would mean building a custom native module around
 * AVCaptureDevice.setExposureModeCustom.
 */

type Props = {
  onCapture: (file: SelectedFile, uri: string, camera: FilterId | 'auto') => void;
  onGallery: () => void;
  onSettings: () => void;
  lastThumb: string | null;
  backendReady: boolean;
  settings: Settings;
};

/** Exposure stops offered in the UI, mapped into the device's supported range. */
const EV_STEPS = [-2, -1, 0, 1, 2] as const;

type LensOption = { label: string; zoom: number };

/**
 * Build lens buttons from the device's real zoom factors.
 *
 * Unlike expo-camera's 0–1 zoom scale, VisionCamera works in factors, so these labels
 * are truthful rather than approximations: 1x really is the wide lens.
 */
function lensOptions(device: CameraDevice | undefined): LensOption[] {
  if (!device) return [];
  const { minZoom, maxZoom, neutralZoom } = device;
  const out: LensOption[] = [];
  // Ultra-wide exists when the device can zoom below the neutral (wide) position.
  if (minZoom < neutralZoom - 0.01) {
    out.push({ label: `${(minZoom / neutralZoom).toFixed(1).replace(/\.0$/, '')}×`, zoom: minZoom });
  }
  out.push({ label: '1×', zoom: neutralZoom });
  for (const factor of [2, 3, 5]) {
    const z = neutralZoom * factor;
    if (z <= maxZoom) out.push({ label: `${factor}×`, zoom: z });
  }
  return out;
}

export function ManualCameraScreen({
  onCapture, onGallery, onSettings, lastThumb, backendReady, settings,
}: Props) {
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(facing);
  // Prefer the highest-resolution photo format available.
  const format = useCameraFormat(device, [{ photoResolution: 'max' }]);

  const [flashState, setFlashState] = useState<FlashState>('auto');
  const [zoom, setZoom] = useState<number | null>(null);
  const [ev, setEv] = useState(0);
  const [showGrid, setShowGrid] = useState(settings.grid);
  const [showPanel, setShowPanel] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseSuggestion>(getRandomPose('portrait'));
  const [activeFilter, setActiveFilter] = useState<FilterId | 'auto'>(settings.defaultCamera);
  const [capturing, setCapturing] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState('');

  const cam = useRef<Camera>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  const lenses = useMemo(() => lensOptions(device), [device]);

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeIn]);

  // Start at the wide lens rather than whatever the device defaults to, which on
  // multi-camera iPhones is the ultra-wide.
  useEffect(() => {
    if (device && zoom === null) setZoom(device.neutralZoom);
  }, [device, zoom]);

  const buzz = useCallback(async (style: Haptics.ImpactFeedbackStyle) => {
    if (settings.haptics) await Haptics.impactAsync(style);
  }, [settings.haptics]);

  /** Map a UI stop onto the device's supported exposure range. */
  const exposureValue = useMemo(() => {
    if (!device) return 0;
    if (ev === 0) return 0;
    const span = ev > 0 ? device.maxExposure : Math.abs(device.minExposure);
    return (ev / 2) * span;
  }, [device, ev]);

  const cycleFlash = useCallback(() => {
    buzz(Haptics.ImpactFeedbackStyle.Light);
    setFlashState(f => (f === 'auto' ? 'on' : f === 'on' ? 'off' : 'auto'));
  }, [buzz]);

  const flip = useCallback(() => {
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    setFacing(f => (f === 'back' ? 'front' : 'back'));
    setZoom(null);   // re-seed for the new device's neutral zoom
  }, [buzz]);

  const selectLens = useCallback((z: number) => {
    buzz(Haptics.ImpactFeedbackStyle.Light);
    setZoom(z);
  }, [buzz]);

  /** Tap to focus at a point, with a brief on-screen indicator. */
  const onTapFocus = useCallback(async (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!device?.supportsFocus || !cam.current) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    setFocusPoint({ x, y });
    buzz(Haptics.ImpactFeedbackStyle.Light);
    try {
      await cam.current.focus({ x, y });
    } catch {
      // Focus can fail if the session is reconfiguring; not worth surfacing.
    } finally {
      setTimeout(() => setFocusPoint(null), 900);
    }
  }, [device, buzz]);

  const doCapture = useCallback(async () => {
    if (!cam.current || capturing) return;
    setCapturing(true);
    try {
      await buzz(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cam.current.takePhoto({
        flash: device?.hasFlash ? flashState : 'off',
        enableShutterSound: false,
        enableAutoRedEyeReduction: false,
      });
      // VisionCamera returns a bare filesystem path, not a file:// URI.
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      const info = new File(uri).info();
      onCapture(
        {
          uri,
          name: `IMG_${Date.now()}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null,
        },
        uri,
        activeFilter,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Capture failed');
      setTimeout(() => setErr(''), 2500);
    } finally {
      setCapturing(false);
    }
  }, [capturing, buzz, device, flashState, onCapture, activeFilter]);

  const selectedName = activeFilter === 'auto'
    ? 'Auto · backend picks the camera for this scene'
    : (FILTERS.find(f => f.id === activeFilter)?.tagline ?? '');

  if (!device) {
    return (
      <View style={[st.bg, st.centre]}>
        <StatusBar style="light" />
        <Text style={st.msg}>No camera available</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[st.bg, { opacity: fadeIn }]}>
      <StatusBar style="light" />

      <View style={st.topBar}>
        <Pressable onPress={cycleFlash} style={st.topPill}>
          <Text style={st.topT}>{flashState === 'auto' ? 'FLASH A' : flashState === 'on' ? 'FLASH ON' : 'FLASH OFF'}</Text>
        </Pressable>
        {!backendReady && !settings.onDeviceLook && (
          <View style={st.offlinePill}><Text style={st.offlineT}>Offline</Text></View>
        )}
        <Pressable onPress={() => setShowPanel(p => !p)} style={st.topPill}>
          <Text style={st.topT}>•••</Text>
        </Pressable>
      </View>

      {showPanel && (
        <View style={st.panel}>
          <Pressable onPress={() => { buzz(Haptics.ImpactFeedbackStyle.Light); setShowGrid(g => !g); }} style={st.panelItem}>
            <Text style={st.panelL}>Grid</Text>
            <Text style={[st.panelV, showGrid && st.panelVOn]}>{showGrid ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => { buzz(Haptics.ImpactFeedbackStyle.Light); setShowGuide(g => !g); setCurrentPose(getRandomPose('portrait')); }} style={st.panelItem}>
            <Text style={st.panelL}>Guide</Text>
            <Text style={[st.panelV, showGuide && st.panelVOn]}>{showGuide ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => { setShowPanel(false); onSettings(); }} style={st.panelItem}>
            <Text style={st.panelL}>More</Text>
            <Text style={st.panelVOn}>Settings ›</Text>
          </Pressable>
        </View>
      )}

      {/* Viewfinder — fixed 4:3 so the preview frames what gets captured */}
      <View style={st.vfOuter}>
        <View style={st.vfWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onTapFocus}>
            <Camera
              ref={cam}
              style={StyleSheet.absoluteFill}
              device={device}
              format={format}
              isActive
              photo
              resizeMode="cover"
              zoom={zoom ?? device.neutralZoom}
              exposure={exposureValue}
              enableZoomGesture
              onError={e => setErr(e.message)}
            />
            {showGrid && (
              <View style={st.grid} pointerEvents="none">
                <View style={[st.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} />
                <View style={[st.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} />
                <View style={[st.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} />
                <View style={[st.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} />
              </View>
            )}
            {showGuide && <View style={st.guideOval} pointerEvents="none" />}
            {focusPoint && (
              <View style={[st.focusBox, { left: focusPoint.x - 34, top: focusPoint.y - 34 }]} pointerEvents="none" />
            )}
            {ev !== 0 && (
              <View style={st.evBadge} pointerEvents="none">
                <Text style={st.evBadgeT}>{ev > 0 ? `+${ev}` : ev} EV</Text>
              </View>
            )}
          </Pressable>
        </View>

        {lenses.length > 1 && (
          <View style={st.lensRow}>
            {lenses.map(l => {
              const on = Math.abs((zoom ?? device.neutralZoom) - l.zoom) < 0.01;
              return (
                <Pressable key={l.label} onPress={() => selectLens(l.zoom)} style={[st.lensPill, on && st.lensPillOn]}>
                  <Text style={[st.lensT, on && st.lensTOn]}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Exposure compensation — a real control, unlike the old placebo slider */}
        <View style={st.evRow}>
          <Text style={st.evLabel}>EV</Text>
          {EV_STEPS.map(step => (
            <Pressable
              key={step}
              onPress={() => { buzz(Haptics.ImpactFeedbackStyle.Light); setEv(step); }}
              style={[st.evPill, ev === step && st.evPillOn]}
            >
              <Text style={[st.evT, ev === step && st.evTOn]}>{step > 0 ? `+${step}` : step}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {showGuide && (
        <View style={st.poseCard}>
          <Text style={st.poseN}>{currentPose.name}</Text>
          <Text style={st.poseI}>{currentPose.instruction}</Text>
        </View>
      )}

      <CameraPicker active={activeFilter} onSelect={id => { setActiveFilter(id); buzz(Haptics.ImpactFeedbackStyle.Light); }} />
      <Text style={st.camTag} numberOfLines={1}>{selectedName}</Text>

      <View style={st.shutterArea}>
        <Pressable
          onPress={doCapture}
          onPressIn={() => Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start()}
          onPressOut={() => Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start()}
          disabled={capturing}
        >
          <Animated.View style={[st.shOuter, { transform: [{ scale: shutterAnim }] }]}>
            <View style={st.shInner} />
          </Animated.View>
        </Pressable>
      </View>

      <View style={st.botRow}>
        <Pressable onPress={onGallery} style={st.thumb}>
          {lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbPh} />}
        </Pressable>
        <Text style={st.hintT}>Tap to focus</Text>
        <Pressable onPress={flip} style={st.flipBtn}><Text style={st.flipT}>⟲</Text></Pressable>
      </View>

      {err.length > 0 && <View style={st.toast}><Text style={st.toastT}>{err}</Text></View>}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0c0c0c' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  msg: { color: '#8e8e93', fontSize: 14 },

  topBar: { position: 'absolute', top: 52, left: 16, right: 16, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topPill: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(28,28,30,0.85)', alignItems: 'center', justifyContent: 'center' },
  topT: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  offlinePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(60,20,20,0.9)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)' },
  offlineT: { color: '#ff8a8a', fontSize: 10, fontWeight: '600' },

  panel: { position: 'absolute', top: 94, left: 16, right: 16, zIndex: 20, backgroundColor: 'rgba(28,28,30,0.95)', borderRadius: 14, padding: 6, flexDirection: 'row' },
  panelItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  panelL: { color: '#636366', fontSize: 9, fontWeight: '500', marginBottom: 2 },
  panelV: { color: '#fff', fontSize: 11, fontWeight: '600' },
  panelVOn: { color: '#FFD60A', fontSize: 11, fontWeight: '600' },

  vfOuter: { flex: 1, justifyContent: 'center' },
  vfWrap: { width: W - 16, height: (W - 16) * (4 / 3), alignSelf: 'center', borderRadius: 20, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  grid: { ...StyleSheet.absoluteFillObject },
  gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.2)' },
  guideOval: { position: 'absolute', top: '12%', alignSelf: 'center', width: W * 0.38, height: W * 0.52, borderRadius: W * 0.19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', borderStyle: 'dashed' },
  focusBox: { position: 'absolute', width: 68, height: 68, borderRadius: 6, borderWidth: 1.5, borderColor: '#FFD60A' },
  evBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  evBadgeT: { color: '#FFD60A', fontSize: 10, fontWeight: '700' },

  lensRow: { flexDirection: 'row', alignSelf: 'center', marginTop: 10, backgroundColor: 'rgba(28,28,30,0.8)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 3, gap: 2 },
  lensPill: { minWidth: 38, height: 34, paddingHorizontal: 8, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  lensPillOn: { backgroundColor: 'rgba(60,60,62,0.95)' },
  lensT: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700' },
  lensTOn: { color: '#FFD60A', fontSize: 12 },

  evRow: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', marginTop: 8, gap: 4 },
  evLabel: { color: '#636366', fontSize: 9, fontWeight: '700', marginRight: 4 },
  evPill: { minWidth: 32, paddingVertical: 5, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(28,28,30,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  evPillOn: { borderColor: '#FFD60A', backgroundColor: 'rgba(60,60,62,0.9)' },
  evT: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700' },
  evTOn: { color: '#FFD60A' },

  poseCard: { marginHorizontal: 16, marginTop: 8, backgroundColor: '#1c1c1e', borderRadius: 12, padding: 10 },
  poseN: { color: '#fff', fontSize: 13, fontWeight: '600' },
  poseI: { color: '#8e8e93', fontSize: 11, lineHeight: 15 },

  camTag: { color: '#8e8e93', fontSize: 10, textAlign: 'center', marginTop: 4, paddingHorizontal: 16 },
  shutterArea: { alignItems: 'center', paddingVertical: 10 },
  shOuter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingBottom: 36 },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbPh: { flex: 1, backgroundColor: '#1c1c1e' },
  hintT: { color: '#636366', fontSize: 10 },
  flipBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  flipT: { color: '#fff', fontSize: 18 },

  toast: { position: 'absolute', top: 110, left: 16, right: 16, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 12, textAlign: 'center' },
});
