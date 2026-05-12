import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import { CameraView, CameraType, FlashMode, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import type { CaptureMode, SelectedFile } from '../types';

type Props = {
  onCapture: (file: SelectedFile, uri: string) => void;
  onGallery: () => void;
  lastThumb: string | null;
};

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
  const [recSec, setRecSec] = useState(0);
  const [err, setErr] = useState('');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);

  useEffect(() => { if (recording) { recRef.current = 0; setRecSec(0); const iv = setInterval(() => { recRef.current++; setRecSec(recRef.current); }, 1000); return () => clearInterval(iv); } }, [recording]);

  const flip = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFacing(f => f === 'back' ? 'front' : 'back'); }, []);
  const toggleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlash(f => f === 'off' ? 'on' : 'off'); }, []);
  const cycleTimer = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, []);

  const onPinch = useCallback((e: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const t = e.nativeEvent.touches; if (!t || t.length < 2) { lastDist.current = null; return; }
    const d = Math.sqrt((t[0].pageX - t[1].pageX) ** 2 + (t[0].pageY - t[1].pageY) ** 2);
    if (lastDist.current !== null) setZoom(z => Math.min(1, Math.max(0, z + (d - lastDist.current!) * 0.003)));
    lastDist.current = d;
  }, []);
  const onPinchEnd = useCallback(() => { lastDist.current = null; }, []);

  const onTapFocus = useCallback((e: { nativeEvent: { locationX: number; locationY: number } }) => {
    setFocusXY({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    focusAnim.setValue(1);
    Animated.timing(focusAnim, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => setFocusXY(null));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [focusAnim]);

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.88, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start(); }, [shutterAnim]);

  const doCapture = useCallback(async () => {
    if (!cam.current || !ready) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const p = await cam.current.takePictureAsync({ quality: 0.92 });
    if (!p?.uri) return;
    const fi = new File(p.uri).info();
    onCapture({ uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null }, p.uri);
  }, [ready, onCapture]);

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

  return (
    <View style={s.bg}><StatusBar style="light" />
      <Pressable style={s.vf} onPress={onTapFocus}
        onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })}
        onTouchEnd={onPinchEnd}>
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom}
          mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p"
          onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />
        {focusXY && <Animated.View style={[s.focus, { left: focusXY.x - 32, top: focusXY.y - 32, opacity: focusAnim, transform: [{ scale: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]} />}
        {zoom > 0.01 && <View style={s.zBadge}><Text style={s.zT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}
        {recording && <View style={s.recPill}><View style={s.recDot} /><Text style={s.recT}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}
        {countdown !== null && <View style={s.countBg}><Text style={s.countN}>{countdown}</Text></View>}
      </Pressable>

      <View style={s.topBar}>
        <Pressable onPress={toggleFlash} style={s.topI}><View style={[s.flashDot, flash === 'on' && s.flashOn]} /></Pressable>
        <Pressable onPress={cycleTimer} style={s.topI}><Text style={[s.topTxt, timer > 0 && s.topTxtOn]}>{timer > 0 ? `${timer}s` : 'Off'}</Text></Pressable>
        <Pressable onPress={flip} style={s.topI}><View style={s.flipC}><View style={s.flipA} /></View></Pressable>
      </View>

      <View style={s.bot}>
        <View style={s.modes}>
          <Pressable onPress={() => !recording && setMode('photo')}><Text style={[s.modeT, mode === 'photo' && s.modeTOn]}>PHOTO</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')}><Text style={[s.modeT, mode === 'video' && s.modeTOn]}>VIDEO</Text></Pressable>
        </View>
        <View style={s.row}>
          <Pressable onPress={lastThumb ? onGallery : pickFile} style={s.thumb}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={s.thumbImg} /> : <View style={s.thumbPh} />}
          </Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
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
  vf: { flex: 1 },
  focus: { position: 'absolute', width: 64, height: 64, borderWidth: 1, borderColor: '#FFD60A', borderRadius: 1 },
  zBadge: { position: 'absolute', bottom: 20, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  zT: { color: '#FFD60A', fontSize: 12, fontWeight: '700' },
  recPill: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 6 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  recT: { color: '#FF3B30', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fff' },
  topBar: { position: 'absolute', top: 52, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 28, alignItems: 'center' },
  topI: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  flashDot: { width: 5, height: 16, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  flashOn: { backgroundColor: '#FFD60A' },
  topTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  topTxtOn: { color: '#FFD60A' },
  flipC: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  flipA: { width: 6, height: 6, borderTopWidth: 1.5, borderRightWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '45deg' }] },
  bot: { backgroundColor: '#000', paddingTop: 10, paddingBottom: 34 },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 18 },
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
