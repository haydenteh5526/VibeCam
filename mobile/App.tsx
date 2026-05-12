import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CameraView, CameraType, FlashMode, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';

type UploadInitResponse = { status: 'accepted'; upload_id: string; max_size_bytes: number; expires_at_utc: string };
type UploadChunkResponse = { status: 'partial' | 'ingested'; upload_id: string; expected_size_bytes: number; bytes_received: number; remaining_bytes: number; next_offset: number; ingested_at_utc: string | null; payload_hash?: string | null };
type GalleryItem = { upload_id: string; file_name: string; mime_type: string; status: string; size_bytes: number; bytes_received: number; ingested_at_utc: string | null };
type SelectedFile = { uri: string; name: string; mimeType: string; sizeBytes: number | null };
type CaptureMode = 'photo' | 'video';
type AppScreen = 'camera' | 'preview' | 'uploading' | 'done' | 'gallery';

const { width: W, height: H } = Dimensions.get('window');
const DEFAULT_API = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const API = (() => { const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE_URL; return v && v.trim().length > 0 ? v.trim() : DEFAULT_API; })();
const CHUNK = 256 * 1024;
const ACCENT = '#F5A623'; // Bevel warm gold

const resolveSize = async (f: SelectedFile): Promise<number> => {
  if (f.sizeBytes !== null) return f.sizeBytes;
  const fi = new File(f.uri).info();
  if (fi.exists && typeof fi.size === 'number' && fi.size > 0) return fi.size;
  return new Uint8Array(await (await fetch(f.uri)).arrayBuffer()).length;
};
const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;


export default function App() {
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [screen, setScreen] = useState<AppScreen>('camera');
  const [backend, setBackend] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [focusXY, setFocusXY] = useState<{ x: number; y: number } | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [recSec, setRecSec] = useState(0);
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);
  const recRef = useRef(0);

  useEffect(() => { fetch(`${API}/health`).then(r => { if (r.ok) setBackend(true); }).catch(() => {}); }, []);
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
    const { locationX: x, locationY: y } = e.nativeEvent;
    setFocusXY({ x, y }); focusAnim.setValue(1);
    Animated.timing(focusAnim, { toValue: 0, duration: 700, useNativeDriver: true }).start(() => setFocusXY(null));
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
    setCaptured(p.uri); setLastThumb(p.uri);
    setFile({ uri: p.uri, name: `IMG_${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null });
    setScreen('preview');
  }, [ready]);

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
      setCaptured(v.uri); setFile({ uri: v.uri, name: `VID_${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null });
      setScreen('preview');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setRecording(false); }
  }, [ready, micPerm, requestMic]);

  const stopRec = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cam.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { if (mode === 'photo') captureWithTimer(); else { if (recording) stopRec(); else startRec(); } }, [mode, recording, captureWithTimer, startRec, stopRec]);

  const pickFile = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
    if (r.canceled) return; const f = r.assets[0];
    setCaptured(f.uri); if (f.mimeType?.startsWith('image/')) setLastThumb(f.uri);
    setFile({ uri: f.uri, name: f.name || 'file', mimeType: (f.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: f.size ?? null });
    setScreen('preview');
  }, []);

  const saveToRoll = useCallback(async () => { if (!file) return; const { status } = await MediaLibrary.requestPermissionsAsync(); if (status === 'granted') { await MediaLibrary.saveToLibraryAsync(file.uri); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } }, [file]);
  const share = useCallback(async () => { if (!file || !(await Sharing.isAvailableAsync())) return; await Sharing.shareAsync(file.uri); }, [file]);

  const upload = useCallback(async () => {
    if (!file) return; setScreen('uploading'); setProgress(0); setHash(null); setErr('');
    try {
      const sz = await resolveSize(file);
      const ir = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: file.name, mime_type: file.mimeType, size_bytes: sz }) });
      if (!ir.ok) throw new Error(`${ir.status}`);
      const id = ((await ir.json()) as UploadInitResponse).upload_id;
      const fh = new File(file.uri).open(); let off = 0; let last: UploadChunkResponse | null = null;
      try { while (off < sz) { const c = fh.readBytes(Math.min(CHUNK, sz - off)); const r = await fetch(`${API}/uploads/${id}/chunks?offset=${off}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: c }); if (!r.ok) throw new Error(`${r.status}`); last = (await r.json()) as UploadChunkResponse; off = last.next_offset; setProgress(off / sz); } } finally { fh.close(); }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setHash(last?.payload_hash ?? null); setScreen('done');
    } catch (e) { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setErr(e instanceof Error ? e.message : 'Failed'); setScreen('preview'); }
  }, [file]);

  const openGallery = useCallback(async () => { try { const r = await fetch(`${API}/uploads?status=ingested`); if (r.ok) setGallery((await r.json()) as GalleryItem[]); } catch {} setScreen('gallery'); }, []);
  const reset = useCallback(() => { setCaptured(null); setFile(null); setProgress(0); setHash(null); setErr(''); setScreen('camera'); }, []);


  // Permission
  if (!camPerm?.granted) return (
    <View style={s.bg}><StatusBar style="light" /><View style={s.center}>
      <View style={s.permIcon}><Text style={{ fontSize: 32 }}>📷</Text></View>
      <Text style={s.permTitle}>Camera Access</Text>
      <Text style={s.permSub}>VibeCam needs your camera to capture photos and videos.</Text>
      <Pressable style={s.permBtn} onPress={requestCam}><Text style={s.permBtnT}>Continue</Text></Pressable>
    </View></View>
  );

  // Gallery
  if (screen === 'gallery') return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.gHeader}><Pressable onPress={reset} style={s.gBack}><Text style={s.gBackT}>←</Text></Pressable><Text style={s.gTitle}>Library</Text><View style={{ width: 40 }} /></View>
      {gallery.length === 0 ? <View style={s.center}><Text style={s.empty}>Your uploads will appear here</Text></View> : (
        <FlatList data={gallery} numColumns={3} keyExtractor={i => i.upload_id} contentContainerStyle={{ padding: 2 }} renderItem={({ item }) => (
          <View style={s.gCell}><View style={s.gCellIn}>{item.mime_type.startsWith('video/') && <View style={s.gVidBadge}><Text style={s.gVidT}>▶</Text></View>}</View></View>
        )} />
      )}
    </View>
  );

  // Done
  if (screen === 'done') return (
    <View style={s.bg}><StatusBar style="light" /><View style={s.center}>
      <View style={s.doneRing}><Text style={s.doneIcon}>✓</Text></View>
      <Text style={s.doneTitle}>Uploaded</Text>
      <Text style={s.doneSub}>Your file is safely stored</Text>
      {hash && <Text style={s.doneHash}>{hash.slice(0, 16)}</Text>}
      <View style={s.doneRow}>
        <Pressable style={s.doneBtnO} onPress={openGallery}><Text style={s.doneBtnOT}>Library</Text></Pressable>
        <Pressable style={s.doneBtnS} onPress={reset}><Text style={s.doneBtnST}>New</Text></Pressable>
      </View>
    </View></View>
  );

  // Uploading
  if (screen === 'uploading') return (
    <View style={s.bg}><StatusBar style="light" /><View style={s.center}>
      <View style={s.upRing}><Text style={s.upPct}>{Math.round(progress * 100)}</Text><Text style={s.upPctSign}>%</Text></View>
      <View style={s.upBar}><View style={[s.upFill, { width: `${progress * 100}%` }]} /></View>
    </View></View>
  );

  // Preview
  if (screen === 'preview' && file) {
    const isVid = file.mimeType.startsWith('video/');
    return (
      <View style={s.bg}><StatusBar style="light" />
        <View style={s.prevMedia}>
          {isVid && captured ? <VidPreview uri={captured} /> : captured ? <Image source={{ uri: captured }} style={s.prevImg} resizeMode="cover" /> : <View style={s.center}><Text style={s.prevName}>{file.name}</Text><Text style={s.muted}>{file.sizeBytes ? fmt(file.sizeBytes) : ''}</Text></View>}
        </View>
        {/* Actions */}
        <View style={s.prevActions}>
          <Pressable onPress={reset} style={s.prevPill}><Text style={s.prevPillT}>✕</Text></Pressable>
          <View style={s.prevRow}>
            <Pressable onPress={saveToRoll} style={s.prevAct}><Text style={s.prevActI}>↓</Text></Pressable>
            <Pressable onPress={share} style={s.prevAct}><Text style={s.prevActI}>↗</Text></Pressable>
            <Pressable onPress={upload} style={[s.prevActUp, !backend && s.dis]} disabled={!backend}><Text style={s.prevActUpT}>Upload</Text></Pressable>
          </View>
        </View>
      </View>
    );
  }


  // Camera - Bevel style
  return (
    <View style={s.bg}><StatusBar style="light" />
      {/* Viewfinder with rounded corners */}
      <Pressable style={s.vf} onPress={onTapFocus} onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })} onTouchEnd={onPinchEnd}>
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom} mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p" onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />
        {focusXY && <Animated.View style={[s.focus, { left: focusXY.x - 30, top: focusXY.y - 30, opacity: focusAnim }]} />}
        {/* Zoom pill */}
        {zoom > 0.01 && <View style={s.zPill}><Text style={s.zPillT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}
        {/* Rec indicator */}
        {recording && <View style={s.recBadge}><View style={s.recDot} /><Text style={s.recTime}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}
        {/* Countdown */}
        {countdown !== null && <View style={s.countOver}><Text style={s.countNum}>{countdown}</Text></View>}
      </Pressable>

      {/* Top floating pills */}
      <View style={s.topFloat}>
        <Pressable onPress={toggleFlash} style={[s.tPill, flash === 'on' && s.tPillActive]}><Text style={[s.tPillT, flash === 'on' && s.tPillTActive]}>Flash</Text></Pressable>
        <Pressable onPress={cycleTimer} style={[s.tPill, timer > 0 && s.tPillActive]}><Text style={[s.tPillT, timer > 0 && s.tPillTActive]}>{timer > 0 ? `${timer}s` : 'Timer'}</Text></Pressable>
      </View>

      {/* Bottom control sheet */}
      <View style={s.sheet}>
        {/* Mode selector */}
        <View style={s.modeBar}>
          <Pressable onPress={() => !recording && setMode('photo')} style={[s.modePill, mode === 'photo' && s.modePillA]}><Text style={[s.modePillT, mode === 'photo' && s.modePillTA]}>Photo</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')} style={[s.modePill, mode === 'video' && s.modePillA]}><Text style={[s.modePillT, mode === 'video' && s.modePillTA]}>Video</Text></Pressable>
        </View>

        {/* Controls */}
        <View style={s.ctrlRow}>
          {/* Gallery */}
          <Pressable onPress={openGallery} style={s.thumbWrap}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={s.thumbImg} /> : <View style={s.thumbPh} />}
          </Pressable>

          {/* Shutter */}
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
            <Animated.View style={[s.shOuter, { transform: [{ scale: shutterAnim }] }, mode === 'video' && recording && s.shOuterRec]}>
              <View style={[s.shInner, mode === 'video' && recording && s.shInnerRec]} />
            </Animated.View>
          </Pressable>

          {/* Flip */}
          <Pressable onPress={flip} style={s.flipWrap}><Text style={s.flipI}>⟲</Text></Pressable>
        </View>

        {/* File picker hint */}
        <Pressable onPress={pickFile} style={s.importBtn}><Text style={s.importT}>Import File</Text></Pressable>
      </View>

      {err.length > 0 && <View style={s.toast}><Text style={s.toastT}>{err}</Text></View>}
    </View>
  );
}

function VidPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} />;
}


const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0C0C0C' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  muted: { fontSize: 13, color: 'rgba(255,255,255,0.35)' },

  // Permission
  permIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  permTitle: { fontSize: 22, fontWeight: '600', color: '#fff', marginBottom: 8 },
  permSub: { fontSize: 15, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 21, marginBottom: 32 },
  permBtn: { backgroundColor: ACCENT, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14 },
  permBtnT: { color: '#000', fontSize: 16, fontWeight: '700' },

  // Viewfinder
  vf: { flex: 1, margin: 8, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  focus: { position: 'absolute', width: 60, height: 60, borderWidth: 1.5, borderColor: ACCENT, borderRadius: 4 },
  zPill: { position: 'absolute', bottom: 16, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  zPillT: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  recBadge: { position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  recTime: { color: '#FF3B30', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countOver: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  countNum: { fontSize: 72, fontWeight: '200', color: '#fff' },

  // Top floating
  topFloat: { position: 'absolute', top: 56, right: 20, flexDirection: 'row', gap: 8 },
  tPill: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  tPillActive: { backgroundColor: ACCENT },
  tPillT: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  tPillTActive: { color: '#000' },

  // Bottom sheet
  sheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 16 },
  modeBar: { flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 3 },
  modePill: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 10 },
  modePillA: { backgroundColor: 'rgba(255,255,255,0.12)' },
  modePillT: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  modePillTA: { color: '#fff' },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thumbWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbPh: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)' },
  shOuter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shOuterRec: { borderColor: '#FF3B30' },
  shInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  shInnerRec: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#FF3B30' },
  flipWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  flipI: { fontSize: 20, color: '#fff' },
  importBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  importT: { fontSize: 13, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },

  // Toast
  toast: { position: 'absolute', top: 60, left: 16, right: 16, backgroundColor: 'rgba(255,59,48,0.92)', borderRadius: 14, padding: 12 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },

  // Preview
  prevMedia: { flex: 1, margin: 8, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  prevImg: { width: '100%', height: '100%' },
  prevName: { fontSize: 17, fontWeight: '500', color: '#fff', marginBottom: 6 },
  prevActions: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 16 },
  prevPill: { position: 'absolute', top: 56, left: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  prevPillT: { color: '#fff', fontSize: 16 },
  prevRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  prevAct: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  prevActI: { fontSize: 20, color: '#fff' },
  prevActUp: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, backgroundColor: ACCENT },
  prevActUpT: { color: '#000', fontSize: 15, fontWeight: '700' },

  // Upload
  upRing: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 24, flexDirection: 'row' },
  upPct: { fontSize: 40, fontWeight: '200', color: '#fff' },
  upPctSign: { fontSize: 18, fontWeight: '300', color: 'rgba(255,255,255,0.4)', marginTop: 8 },
  upBar: { width: '65%', height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  upFill: { height: '100%', backgroundColor: ACCENT, borderRadius: 2 },

  // Done
  doneRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: '#30d158', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  doneIcon: { fontSize: 30, color: '#30d158' },
  doneTitle: { fontSize: 22, fontWeight: '600', color: '#fff', marginBottom: 4 },
  doneSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 8 },
  doneHash: { fontSize: 12, color: 'rgba(255,255,255,0.2)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 28 },
  doneRow: { flexDirection: 'row', gap: 12 },
  doneBtnO: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  doneBtnOT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  doneBtnS: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: '#fff' },
  doneBtnST: { color: '#000', fontSize: 15, fontWeight: '600' },

  // Gallery
  gHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12 },
  gBack: { width: 40 }, gBackT: { fontSize: 22, color: '#fff' },
  gTitle: { fontSize: 17, fontWeight: '600', color: '#fff' },
  gCell: { width: (W - 8) / 3, aspectRatio: 1, padding: 2 },
  gCellIn: { flex: 1, backgroundColor: '#1c1c1e', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  gVidBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  gVidT: { color: '#fff', fontSize: 12 },
  empty: { fontSize: 15, color: 'rgba(255,255,255,0.3)' },

  dis: { opacity: 0.35 },
});
