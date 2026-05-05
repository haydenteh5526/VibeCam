import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { CameraView, CameraType, FlashMode, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';

type UploadInitResponse = { status: 'accepted'; upload_id: string; max_size_bytes: number; expires_at_utc: string };
type UploadChunkResponse = { status: 'partial' | 'ingested'; upload_id: string; expected_size_bytes: number; bytes_received: number; remaining_bytes: number; next_offset: number; ingested_at_utc: string | null; payload_hash?: string | null };
type GalleryItem = { upload_id: string; file_name: string; mime_type: string; status: string; size_bytes: number; bytes_received: number; ingested_at_utc: string | null };
type SelectedFile = { uri: string; name: string; mimeType: string; sizeBytes: number | null };
type CaptureMode = 'photo' | 'video';
type AppScreen = 'loading' | 'camera' | 'preview' | 'uploading' | 'done' | 'gallery';

const RED = '#E63946';
const DEFAULT_API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const resolveApiBaseUrl = (): string => {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE_URL;
  return v && v.trim().length > 0 ? v.trim() : DEFAULT_API_BASE_URL;
};
const API_BASE_URL = resolveApiBaseUrl();
const CHUNK_SIZE = 256 * 1024;

const resolveSize = async (file: SelectedFile): Promise<number> => {
  if (file.sizeBytes !== null) return file.sizeBytes;
  const f = new File(file.uri); const info = f.info();
  if (info.exists && typeof info.size === 'number' && info.size > 0) return info.size;
  const fb = new Uint8Array(await (await fetch(file.uri)).arrayBuffer()).length;
  if (fb <= 0) throw new Error('File has no readable bytes');
  return fb;
};

const fmtBytes = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};


export default function App() {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [screen, setScreen] = useState<AppScreen>('loading');
  const [backendReady, setBackendReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [cameraReady, setCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [payloadHash, setPayloadHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [vibeApplied, setVibeApplied] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`).then((r) => { if (r.ok) setBackendReady(true); }).catch(() => {});
    setTimeout(() => { setScreen('camera'); Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start(); }, 1000);
  }, [fadeAnim]);

  const toggleFacing = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFacing((f) => (f === 'back' ? 'front' : 'back')); }, []);
  const toggleFlash = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlash((f) => (f === 'off' ? 'on' : 'off')); }, []);

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.85, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, useNativeDriver: true }).start(); }, [shutterAnim]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) throw new Error('Capture failed');
      const f = new File(photo.uri); const info = f.info();
      setCapturedImage(photo.uri); setLastThumb(photo.uri);
      setSelectedFile({ uri: photo.uri, name: `photo-${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null });
      setScreen('preview');
    } catch (e) { setError(e instanceof Error ? e.message : 'Capture failed'); }
  }, [cameraReady]);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return;
    if (!micPerm?.granted) { const r = await requestMicPerm(); if (!r.granted) { setError('Microphone required'); return; } }
    setIsRecording(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (!video?.uri) throw new Error('Recording failed');
      const f = new File(video.uri); const info = f.info();
      setCapturedImage(null);
      setSelectedFile({ uri: video.uri, name: `video-${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null });
      setScreen('preview');
    } catch (e) { setError(e instanceof Error ? e.message : 'Recording failed'); }
    finally { setIsRecording(false); }
  }, [cameraReady, micPerm, requestMicPerm]);

  const stopRecording = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cameraRef.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { if (mode === 'photo') takePhoto(); else { if (isRecording) stopRecording(); else startRecording(); } }, [mode, isRecording, takePhoto, startRecording, stopRecording]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
      if (result.canceled) return;
      const file = result.assets[0]; const isImg = file.mimeType?.startsWith('image/');
      setCapturedImage(isImg ? file.uri : null); if (isImg) setLastThumb(file.uri);
      setSelectedFile({ uri: file.uri, name: file.name || 'file.bin', mimeType: (file.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: file.size ?? null });
      setScreen('preview');
    } catch (e) { setError(e instanceof Error ? e.message : 'File selection failed'); }
  }, []);

  const applyVibe = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setVibeApplied((v) => !v); }, []);

  const uploadFile = useCallback(async () => {
    if (!selectedFile) return;
    setScreen('uploading'); setUploadProgress(0); setPayloadHash(null); setError('');
    try {
      const sizeBytes = await resolveSize(selectedFile);
      const initRes = await fetch(`${API_BASE_URL}/uploads/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: selectedFile.name, mime_type: selectedFile.mimeType, size_bytes: sizeBytes }) });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const initData = (await initRes.json()) as UploadInitResponse;
      const fileObj = new File(selectedFile.uri); const fh = fileObj.open();
      let offset = 0; let last: UploadChunkResponse | null = null;
      try {
        while (offset < sizeBytes) {
          const chunk = fh.readBytes(Math.min(CHUNK_SIZE, sizeBytes - offset));
          if (chunk.length === 0) throw new Error('Read failed');
          const res = await fetch(`${API_BASE_URL}/uploads/${initData.upload_id}/chunks?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          last = (await res.json()) as UploadChunkResponse; offset = last.next_offset; setUploadProgress(offset / sizeBytes);
        }
      } finally { fh.close(); }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setPayloadHash(last?.payload_hash ?? null); setScreen('done');
    } catch (e) { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setError(e instanceof Error ? e.message : 'Upload failed'); setScreen('preview'); }
  }, [selectedFile]);

  const openGallery = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/uploads?status=ingested`); if (r.ok) setGallery((await r.json()) as GalleryItem[]); } catch {}
    setScreen('gallery');
  }, []);

  const reset = useCallback(() => { setCapturedImage(null); setSelectedFile(null); setUploadProgress(0); setPayloadHash(null); setError(''); setVibeApplied(false); setScreen('camera'); }, []);


  if (screen === 'loading') return <View style={s.splash}><StatusBar style="light" /><Text style={s.mark}>V</Text><Text style={s.markSub}>VIBECAM</Text><ActivityIndicator color="rgba(255,255,255,0.3)" style={{ marginTop: 32 }} /></View>;

  if (!camPerm?.granted) return <View style={s.splash}><StatusBar style="light" /><Text style={s.mark}>V</Text><Text style={s.permBody}>Camera access is needed{'\n'}to capture moments.</Text><Pressable style={s.pill} onPress={requestCamPerm}><Text style={s.pillT}>Grant Camera Access</Text></Pressable></View>;

  if (screen === 'gallery') return (
    <View style={s.dark}><StatusBar style="light" />
      <View style={s.nav}><Pressable onPress={reset}><Text style={s.navBack}>←</Text></Pressable><Text style={s.navTitle}>Uploads</Text><View style={{ width: 32 }} /></View>
      {gallery.length === 0 ? <View style={s.center}><Text style={s.muted}>No uploads yet</Text></View> : (
        <FlatList data={gallery} keyExtractor={(i) => i.upload_id} contentContainerStyle={{ paddingHorizontal: 20 }} renderItem={({ item }) => (
          <View style={s.gRow}><View style={s.gIcon}><Text style={s.gIconT}>{item.mime_type.startsWith('image/') ? '◻' : '▶'}</Text></View><View style={{ flex: 1 }}><Text style={s.gName} numberOfLines={1}>{item.file_name}</Text><Text style={s.gMeta}>{fmtBytes(item.size_bytes)}</Text></View><Text style={s.gCheck}>✓</Text></View>
        )} />
      )}
    </View>
  );

  if (screen === 'done') return (
    <View style={s.dark}><StatusBar style="light" /><View style={s.center}>
      <View style={s.doneC}><Text style={s.doneK}>✓</Text></View><Text style={s.doneT}>Uploaded</Text>
      {payloadHash && <Text style={s.hash}>{payloadHash.slice(0, 16)}…</Text>}
      <View style={s.row}><Pressable style={s.btnO} onPress={openGallery}><Text style={s.btnOT}>View All</Text></Pressable><Pressable style={s.btnS} onPress={reset}><Text style={s.btnST}>New Capture</Text></Pressable></View>
    </View></View>
  );

  if (screen === 'uploading') return (
    <View style={s.dark}><StatusBar style="light" /><View style={s.center}>
      <View style={s.ring}><Text style={s.pct}>{Math.round(uploadProgress * 100)}%</Text></View>
      <Text style={s.upLabel}>UPLOADING</Text>
      <View style={s.track}><View style={[s.fill, { width: `${uploadProgress * 100}%` }]} /></View>
    </View></View>
  );

  if (screen === 'preview' && selectedFile) {
    const isImg = selectedFile.mimeType.startsWith('image/');
    return (
      <View style={s.dark}><StatusBar style="light" />
        {isImg && capturedImage ? <Image source={{ uri: capturedImage }} style={[StyleSheet.absoluteFill, vibeApplied && s.vibe]} resizeMode="cover" /> : isImg ? <Image source={{ uri: selectedFile.uri }} style={[s.prevImg, vibeApplied && s.vibe]} /> : <View style={s.center}><Text style={s.fName}>{selectedFile.name}</Text><Text style={s.muted}>{selectedFile.sizeBytes ? fmtBytes(selectedFile.sizeBytes) : ''}</Text></View>}
        {error.length > 0 && <View style={s.errB}><Text style={s.errBT}>{error}</Text></View>}
        <View style={s.prevTop}><Pressable onPress={reset}><Text style={s.prevA}>Retake</Text></Pressable><Pressable onPress={applyVibe}><Text style={[s.prevA, vibeApplied && { color: RED }]}>Apply Vibe</Text></Pressable></View>
        <View style={s.prevBot}><Pressable style={[s.upBtn, !backendReady && s.dis]} disabled={!backendReady} onPress={uploadFile}><Text style={s.upBtnT}>Upload</Text></Pressable></View>
      </View>
    );
  }

  return (
    <Animated.View style={[s.cam, { opacity: fadeAnim }]}><StatusBar style="light" />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} flash={flash} mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p" onCameraReady={() => setCameraReady(true)} onMountError={(e) => setError(e.message)} />
      <View style={s.top}><Pressable onPress={toggleFlash} style={s.topBtn}><View style={[s.flashI, flash === 'on' && s.flashOn]} /></Pressable><View style={[s.dot, backendReady ? s.dotG : s.dotR]} /><Pressable onPress={toggleFacing} style={s.topBtn}><Text style={s.flipT}>⟲</Text></Pressable></View>
      {isRecording && <View style={s.rec}><View style={s.recDot} /><Text style={s.recT}>REC</Text></View>}
      {error.length > 0 && <View style={s.toast}><Text style={s.toastT}>{error}</Text></View>}
      <View style={s.bot}>
        <View style={s.modeRow}><Pressable onPress={() => !isRecording && setMode('photo')}><Text style={[s.modeT, mode === 'photo' && s.modeA]}>PHOTO</Text></Pressable><Pressable onPress={() => !isRecording && setMode('video')}><Text style={[s.modeT, mode === 'video' && s.modeA]}>VIDEO</Text></Pressable></View>
        <View style={s.botRow}>
          <Pressable onPress={openGallery} style={s.side}>{lastThumb ? <Image source={{ uri: lastThumb }} style={s.sideImg} /> : <View style={s.sideEmpty} />}</Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!cameraReady}><Animated.View style={[s.shOut, { transform: [{ scale: shutterAnim }] }]}><View style={[s.shIn, mode === 'video' && isRecording && s.shRec]} /></Animated.View></Pressable>
          <Pressable onPress={pickFile} style={s.side}><Text style={s.plus}>＋</Text></Pressable>
        </View>
      </View>
    </Animated.View>
  );
}


const s = StyleSheet.create({
  cam: { flex: 1, backgroundColor: '#000' },
  dark: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  splash: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  mark: { fontSize: 56, fontWeight: '100', color: '#fff' },
  markSub: { fontSize: 11, fontWeight: '600', letterSpacing: 4, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
  permBody: { fontSize: 15, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 22, marginTop: 16, marginBottom: 36 },
  pill: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 36, borderRadius: 999 },
  pillT: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  top: { position: 'absolute', top: 56, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  topBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  flashI: { width: 4, height: 14, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 2 },
  flashOn: { backgroundColor: '#fbbf24' },
  flipT: { fontSize: 18, color: '#fff' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotG: { backgroundColor: '#34d399' },
  dotR: { backgroundColor: '#f87171' },
  rec: { position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  recT: { fontSize: 11, fontWeight: '700', color: RED, letterSpacing: 1 },
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 18, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,0.6)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginBottom: 16 },
  modeT: { fontSize: 11, fontWeight: '600', letterSpacing: 1.8, color: 'rgba(255,255,255,0.25)' },
  modeA: { color: '#fff' },
  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  side: { width: 46, height: 46, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  sideImg: { width: 46, height: 46, borderRadius: 12 },
  sideEmpty: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  plus: { fontSize: 20, color: 'rgba(255,255,255,0.6)' },
  shOut: { width: 76, height: 76, borderRadius: 38, borderWidth: 3.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shIn: { width: 60, height: 60, borderRadius: 30, backgroundColor: RED },
  shRec: { borderRadius: 8, width: 28, height: 28 },
  toast: { position: 'absolute', top: 110, left: 20, right: 20, backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: 14, padding: 12 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  prevImg: { flex: 1, resizeMode: 'contain' } as const,
  vibe: { opacity: 0.85 },
  prevTop: { position: 'absolute', top: 56, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  prevA: { color: '#fff', fontSize: 16, fontWeight: '500' },
  prevBot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  upBtn: { backgroundColor: '#fff', paddingVertical: 16, borderRadius: 999, alignItems: 'center' },
  upBtnT: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  errB: { position: 'absolute', bottom: 120, left: 20, right: 20, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 12, padding: 10 },
  errBT: { color: '#fff', fontSize: 13, textAlign: 'center' },
  fName: { fontSize: 18, fontWeight: '500', color: '#fff', marginBottom: 8 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  ring: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  pct: { fontSize: 30, fontWeight: '200', color: '#fff' },
  upLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 2.5, color: 'rgba(255,255,255,0.25)', marginBottom: 24 },
  track: { width: '80%', height: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  doneC: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#34d399', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  doneK: { fontSize: 34, color: '#34d399' },
  doneT: { fontSize: 24, fontWeight: '300', color: '#fff', marginBottom: 8 },
  hash: { fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 36 },
  row: { flexDirection: 'row', gap: 12, width: '100%' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  navBack: { fontSize: 24, color: '#fff' },
  navTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  gRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
  gIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  gIconT: { fontSize: 16, color: 'rgba(255,255,255,0.35)' },
  gName: { fontSize: 14, fontWeight: '500', color: '#fff', marginBottom: 2 },
  gMeta: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  gCheck: { fontSize: 14, color: '#34d399' },
  btnO: { flex: 1, paddingVertical: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  btnOT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  btnS: { flex: 1, paddingVertical: 16, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center' },
  btnST: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  dis: { opacity: 0.3 },
});
