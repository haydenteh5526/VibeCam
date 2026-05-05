import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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

const { width: W } = Dimensions.get('window');
const DEFAULT_API = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const API = (() => { const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE_URL; return v && v.trim().length > 0 ? v.trim() : DEFAULT_API; })();
const CHUNK = 256 * 1024;

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
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);
  const recTimer = useRef(0);
  const [recSec, setRecSec] = useState(0);

  useEffect(() => { fetch(`${API}/health`).then(r => { if (r.ok) setBackend(true); }).catch(() => {}); }, []);

  // Recording timer
  useEffect(() => {
    if (recording) { recTimer.current = 0; setRecSec(0); const iv = setInterval(() => { recTimer.current++; setRecSec(recTimer.current); }, 1000); return () => clearInterval(iv); }
  }, [recording]);

  // ─── Controls ────────────────────────────────────────────────────────────
  const flip = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFacing(f => f === 'back' ? 'front' : 'back'); }, []);
  const toggleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlash(f => f === 'off' ? 'on' : 'off'); }, []);
  const cycleTimer = useCallback(() => { setTimer(t => t === 0 ? 3 : t === 3 ? 10 : 0); }, []);

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
    Animated.timing(focusAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start(() => setFocusXY(null));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [focusAnim]);

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.9, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, useNativeDriver: true }).start(); }, [shutterAnim]);

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
      setCaptured(v.uri); setLastThumb(null);
      setFile({ uri: v.uri, name: `VID_${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null });
      setScreen('preview');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Rec failed'); }
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


  // ─── Permission ──────────────────────────────────────────────────────────
  if (!camPerm?.granted) return (
    <View style={st.black}><StatusBar style="light" />
      <View style={st.center}><Text style={st.permT}>Allow VibeCam to access your camera</Text>
        <Pressable style={st.permBtn} onPress={requestCam}><Text style={st.permBtnT}>Allow Camera Access</Text></Pressable>
      </View>
    </View>
  );

  // ─── Gallery ────────────────────────────────────────────────────────────
  if (screen === 'gallery') return (
    <View style={st.black}><StatusBar style="light" />
      <View style={st.gNav}><Pressable onPress={reset}><Text style={st.gNavBack}>‹ Back</Text></Pressable></View>
      {gallery.length === 0 ? <View style={st.center}><Text style={st.muted}>No uploads</Text></View> : (
        <FlatList data={gallery} numColumns={3} keyExtractor={i => i.upload_id} contentContainerStyle={{ padding: 1 }} renderItem={({ item }) => (
          <View style={st.gridCell}><View style={st.gridInner}><Text style={st.gridT}>{item.mime_type.startsWith('video/') ? '▶' : ''}</Text></View></View>
        )} />
      )}
    </View>
  );

  // ─── Done ───────────────────────────────────────────────────────────────
  if (screen === 'done') return (
    <View style={st.black}><StatusBar style="light" /><View style={st.center}>
      <Text style={st.doneIcon}>✓</Text><Text style={st.doneT}>Uploaded</Text>
      {hash && <Text style={st.hash}>{hash.slice(0, 20)}…</Text>}
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 32 }}>
        <Pressable style={st.doneBtn} onPress={openGallery}><Text style={st.doneBtnT}>All Uploads</Text></Pressable>
        <Pressable style={[st.doneBtn, { backgroundColor: '#fff' }]} onPress={reset}><Text style={[st.doneBtnT, { color: '#000' }]}>Done</Text></Pressable>
      </View>
    </View></View>
  );

  // ─── Uploading ──────────────────────────────────────────────────────────
  if (screen === 'uploading') return (
    <View style={st.black}><StatusBar style="light" /><View style={st.center}>
      <Text style={st.upPct}>{Math.round(progress * 100)}%</Text>
      <View style={st.upTrack}><View style={[st.upFill, { width: `${progress * 100}%` }]} /></View>
      <Text style={st.upLabel}>Uploading…</Text>
    </View></View>
  );

  // ─── Preview ────────────────────────────────────────────────────────────
  if (screen === 'preview' && file) {
    const isVid = file.mimeType.startsWith('video/');
    return (
      <View style={st.black}><StatusBar style="light" />
        {isVid && captured ? <VideoPreview uri={captured} /> : captured ? <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {/* Top */}
        <View style={st.prevTopBar}>
          <Pressable onPress={reset}><Text style={st.prevTopBtn}>✕</Text></Pressable>
        </View>
        {/* Bottom */}
        <View style={st.prevBotBar}>
          <Pressable onPress={saveToRoll} style={st.prevAction}><Text style={st.prevActionT}>Save</Text></Pressable>
          <Pressable onPress={share} style={st.prevAction}><Text style={st.prevActionT}>Share</Text></Pressable>
          <Pressable onPress={upload} style={[st.prevAction, st.prevUpload, !backend && st.dis]} disabled={!backend}><Text style={st.prevUploadT}>Upload</Text></Pressable>
        </View>
      </View>
    );
  }


  // ─── Camera (iOS style) ──────────────────────────────────────────────────
  return (
    <View style={st.black}><StatusBar style="light" />
      <Pressable style={st.viewfinder} onPress={onTapFocus} onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })} onTouchEnd={onPinchEnd}>
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom} mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p" onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />
        {/* Focus square */}
        {focusXY && <Animated.View style={[st.focusBox, { left: focusXY.x - 36, top: focusXY.y - 36, opacity: focusAnim }]} />}
      </Pressable>

      {/* Countdown */}
      {countdown !== null && <View style={st.countOver}><Text style={st.countNum}>{countdown}</Text></View>}

      {/* Zoom */}
      {zoom > 0.01 && <View style={st.zoomPill}><Text style={st.zoomPillT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}

      {/* Top controls - minimal like iOS */}
      <View style={st.topRow}>
        <Pressable onPress={toggleFlash}><Text style={st.topIcon}>{flash === 'on' ? '⚡' : '⚡\u0338'}</Text></Pressable>
        {timer > 0 && <Text style={st.topTimer}>{timer}s</Text>}
        <Pressable onPress={cycleTimer}><Text style={st.topIcon}>⏱</Text></Pressable>
      </View>

      {/* Recording time */}
      {recording && <View style={st.recBar}><View style={st.recDot} /><Text style={st.recTime}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}

      {/* Bottom - iOS camera style */}
      <View style={st.botArea}>
        {/* Mode strip */}
        <View style={st.modeStrip}>
          <Pressable onPress={() => !recording && setMode('photo')}><Text style={[st.modeLabel, mode === 'photo' && st.modeLabelA]}>PHOTO</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')}><Text style={[st.modeLabel, mode === 'video' && st.modeLabelA]}>VIDEO</Text></Pressable>
        </View>

        {/* Controls row */}
        <View style={st.ctrlRow}>
          {/* Gallery thumb */}
          <Pressable onPress={openGallery} style={st.thumbBtn}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbEmpty} />}
          </Pressable>

          {/* Shutter */}
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
            <Animated.View style={[st.shutter, { transform: [{ scale: shutterAnim }] }]}>
              {mode === 'video' && recording ? <View style={st.shutterStop} /> : <View style={st.shutterFill} />}
            </Animated.View>
          </Pressable>

          {/* Flip */}
          <Pressable onPress={flip} style={st.flipBtn}><Text style={st.flipIcon}>⟲</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Video Preview Component ─────────────────────────────────────────────────

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} />;
}


// ─── Styles (iOS Camera aesthetic) ───────────────────────────────────────────

const st = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  muted: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },

  // Permission
  permT: { fontSize: 17, color: '#fff', textAlign: 'center', marginBottom: 24 },
  permBtn: { backgroundColor: '#0a84ff', paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10 },
  permBtnT: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Viewfinder
  viewfinder: { flex: 1, marginBottom: 160 },
  focusBox: { position: 'absolute', width: 72, height: 72, borderWidth: 1, borderColor: '#ffd60a', borderRadius: 2 },

  // Countdown
  countOver: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  countNum: { fontSize: 80, fontWeight: '200', color: '#fff' },

  // Zoom
  zoomPill: { position: 'absolute', top: 90, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  zoomPillT: { color: '#ffd60a', fontSize: 13, fontWeight: '600' },

  // Top row
  topRow: { position: 'absolute', top: 54, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24 },
  topIcon: { fontSize: 18, color: '#fff' },
  topTimer: { fontSize: 14, color: '#ffd60a', fontWeight: '600' },

  // Recording
  recBar: { position: 'absolute', top: 54, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff3b30' },
  recTime: { fontSize: 15, fontWeight: '500', color: '#ff3b30', fontVariant: ['tabular-nums'] },

  // Bottom area
  botArea: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 160, backgroundColor: '#000', paddingTop: 12 },
  modeStrip: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginBottom: 20 },
  modeLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' },
  modeLabelA: { color: '#ffd60a' },

  // Controls row
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 40 },
  thumbBtn: { width: 42, height: 42, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbEmpty: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  flipBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  flipIcon: { fontSize: 20, color: '#fff' },

  // Shutter - iOS style (white circle, no ring)
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterFill: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  shutterStop: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#ff3b30' },

  // Toast
  toast: { position: 'absolute', top: 100, left: 20, right: 20, backgroundColor: 'rgba(255,59,48,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center' },

  // Preview
  prevTopBar: { position: 'absolute', top: 54, left: 20, right: 20, flexDirection: 'row', justifyContent: 'flex-start' },
  prevTopBtn: { fontSize: 22, color: '#fff', fontWeight: '300' },
  prevBotBar: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  prevAction: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
  prevActionT: { color: '#fff', fontSize: 14, fontWeight: '500' },
  prevUpload: { backgroundColor: '#0a84ff' },
  prevUploadT: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Upload
  upPct: { fontSize: 48, fontWeight: '200', color: '#fff', marginBottom: 16 },
  upTrack: { width: '70%', height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' },
  upFill: { height: '100%', backgroundColor: '#0a84ff', borderRadius: 2 },
  upLabel: { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 12 },

  // Done
  doneIcon: { fontSize: 48, color: '#30d158', marginBottom: 12 },
  doneT: { fontSize: 22, fontWeight: '400', color: '#fff', marginBottom: 4 },
  hash: { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  doneBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)' },
  doneBtnT: { color: '#fff', fontSize: 15, fontWeight: '500' },

  // Gallery
  gNav: { paddingTop: 54, paddingHorizontal: 16, paddingBottom: 8 },
  gNavBack: { fontSize: 17, color: '#0a84ff' },
  gridCell: { width: W / 3, aspectRatio: 1, padding: 0.5 },
  gridInner: { flex: 1, backgroundColor: '#1c1c1e', alignItems: 'center', justifyContent: 'center' },
  gridT: { fontSize: 18, color: 'rgba(255,255,255,0.4)' },

  dis: { opacity: 0.4 },
});
