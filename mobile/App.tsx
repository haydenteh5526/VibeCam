import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { BlurView } from 'expo-blur';
import { CameraView, CameraType, FlashMode, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadInitResponse = { status: 'accepted'; upload_id: string; max_size_bytes: number; expires_at_utc: string };
type UploadChunkResponse = { status: 'partial' | 'ingested'; upload_id: string; expected_size_bytes: number; bytes_received: number; remaining_bytes: number; next_offset: number; ingested_at_utc: string | null; payload_hash?: string | null };
type GalleryItem = { upload_id: string; file_name: string; mime_type: string; status: string; size_bytes: number; bytes_received: number; ingested_at_utc: string | null };
type SelectedFile = { uri: string; name: string; mimeType: string; sizeBytes: number | null };
type CaptureMode = 'photo' | 'video';
type AppScreen = 'loading' | 'camera' | 'preview' | 'uploading' | 'done' | 'gallery';

// ─── Config ──────────────────────────────────────────────────────────────────

const RED = '#E63946';
const DEFAULT_API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const resolveApiBaseUrl = (): string => {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE_URL;
  return v && v.trim().length > 0 ? v.trim() : DEFAULT_API_BASE_URL;
};
const API_BASE_URL = resolveApiBaseUrl();
const CHUNK_SIZE = 256 * 1024;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const resolveSize = async (file: SelectedFile): Promise<number> => {
  if (file.sizeBytes !== null) return file.sizeBytes;
  const f = new File(file.uri);
  const info = f.info();
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


// ─── Main ────────────────────────────────────────────────────────────────────

function VibeCam() {
  const insets = useSafeAreaInsets();
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

  // Animations
  const shutterScale = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));
  const recPulse = useSharedValue(1);
  const recStyle = useAnimatedStyle(() => ({ opacity: recPulse.value }));
  const fadeIn = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeIn.value }));

  // Init
  useEffect(() => {
    fetch(`${API_BASE_URL}/health`).then((r) => { if (r.ok) setBackendReady(true); }).catch(() => {});
    const t = setTimeout(() => { setScreen('camera'); fadeIn.value = withTiming(1, { duration: 600 }); }, 1200);
    return () => clearTimeout(t);
  }, [fadeIn]);

  // Recording pulse
  useEffect(() => {
    if (isRecording) {
      recPulse.value = withRepeat(withSequence(
        withTiming(0.3, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      ), -1, false);
    } else { recPulse.value = withTiming(1, { duration: 200 }); }
  }, [isRecording, recPulse]);

  // ─── Camera Controls ─────────────────────────────────────────────────────

  const toggleFacing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  }, []);

  const toggleFlash = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlash((f) => (f === 'off' ? 'on' : 'off'));
  }, []);

  const onPressIn = useCallback(() => { shutterScale.value = withSpring(0.85, { damping: 15, stiffness: 300 }); }, [shutterScale]);
  const onPressOut = useCallback(() => { shutterScale.value = withSpring(1, { damping: 12, stiffness: 200 }); }, [shutterScale]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) throw new Error('Capture failed');
      const f = new File(photo.uri);
      const info = f.info();
      setCapturedImage(photo.uri);
      setLastThumb(photo.uri);
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
      const f = new File(video.uri);
      const info = f.info();
      setCapturedImage(null);
      setLastThumb(null);
      setSelectedFile({ uri: video.uri, name: `video-${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null });
      setScreen('preview');
    } catch (e) { setError(e instanceof Error ? e.message : 'Recording failed'); }
    finally { setIsRecording(false); }
  }, [cameraReady, micPerm, requestMicPerm]);

  const stopRecording = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    cameraRef.current?.stopRecording();
  }, []);

  const onShutter = useCallback(() => {
    if (mode === 'photo') takePhoto();
    else { if (isRecording) stopRecording(); else startRecording(); }
  }, [mode, isRecording, takePhoto, startRecording, stopRecording]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
      if (result.canceled) return;
      const file = result.assets[0];
      const isImg = file.mimeType?.startsWith('image/');
      setCapturedImage(isImg ? file.uri : null);
      if (isImg) setLastThumb(file.uri);
      setSelectedFile({ uri: file.uri, name: file.name || 'file.bin', mimeType: (file.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: file.size ?? null });
      setScreen('preview');
    } catch (e) { setError(e instanceof Error ? e.message : 'File selection failed'); }
  }, []);

  const applyVibe = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setVibeApplied((v) => !v); }, []);

  // ─── Upload ──────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async () => {
    if (!selectedFile) return;
    setScreen('uploading'); setUploadProgress(0); setPayloadHash(null); setError('');
    try {
      const sizeBytes = await resolveSize(selectedFile);
      const initRes = await fetch(`${API_BASE_URL}/uploads/init`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: selectedFile.name, mime_type: selectedFile.mimeType, size_bytes: sizeBytes }),
      });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const initData = (await initRes.json()) as UploadInitResponse;
      const fileObj = new File(selectedFile.uri);
      const fh = fileObj.open();
      let offset = 0; let last: UploadChunkResponse | null = null;
      try {
        while (offset < sizeBytes) {
          const chunk = fh.readBytes(Math.min(CHUNK_SIZE, sizeBytes - offset));
          if (chunk.length === 0) throw new Error('Read failed');
          const res = await fetch(`${API_BASE_URL}/uploads/${initData.upload_id}/chunks?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          last = (await res.json()) as UploadChunkResponse;
          offset = last.next_offset;
          setUploadProgress(offset / sizeBytes);
        }
      } finally { fh.close(); }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPayloadHash(last?.payload_hash ?? null);
      setScreen('done');
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof Error ? e.message : 'Upload failed');
      setScreen('preview');
    }
  }, [selectedFile]);

  const openGallery = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/uploads?status=ingested`); if (r.ok) setGallery((await r.json()) as GalleryItem[]); } catch {}
    setScreen('gallery');
  }, []);

  const reset = useCallback(() => {
    setCapturedImage(null); setSelectedFile(null); setUploadProgress(0); setPayloadHash(null); setError(''); setVibeApplied(false); setScreen('camera');
  }, []);


  // ─── Render ──────────────────────────────────────────────────────────────

  if (screen === 'loading') {
    return (
      <View style={st.splash}><StatusBar style="light" />
        <Text style={st.splashMark}>V</Text>
        <Text style={st.splashName}>VIBECAM</Text>
        <ActivityIndicator color="rgba(255,255,255,0.3)" style={{ marginTop: 32 }} />
      </View>
    );
  }

  if (!camPerm?.granted) {
    return (
      <View style={st.splash}><StatusBar style="light" />
        <Text style={st.splashMark}>V</Text>
        <Text style={st.permBody}>Camera access is needed{'\n'}to capture moments.</Text>
        <Pressable style={st.pill} onPress={requestCamPerm}><Text style={st.pillT}>Grant Camera Access</Text></Pressable>
      </View>
    );
  }

  if (screen === 'gallery') {
    return (
      <View style={st.dark}><StatusBar style="light" />
        <View style={[st.navBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={reset} hitSlop={12}><Text style={st.navBack}>←</Text></Pressable>
          <Text style={st.navTitle}>Uploads</Text>
          <View style={{ width: 32 }} />
        </View>
        {gallery.length === 0 ? (
          <View style={st.center}><Text style={st.emptyIcon}>◻</Text><Text style={st.muted}>No uploads yet</Text></View>
        ) : (
          <FlatList data={gallery} keyExtractor={(i) => i.upload_id} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
            renderItem={({ item }) => (
              <View style={st.gRow}>
                <View style={st.gThumb}><Text style={st.gThumbT}>{item.mime_type.startsWith('image/') ? '◻' : '▶'}</Text></View>
                <View style={{ flex: 1 }}><Text style={st.gName} numberOfLines={1}>{item.file_name}</Text><Text style={st.gMeta}>{fmtBytes(item.size_bytes)}</Text></View>
                <Text style={st.gCheck}>✓</Text>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  if (screen === 'done') {
    return (
      <View style={st.dark}><StatusBar style="light" />
        <View style={st.center}>
          <View style={st.doneCircle}><Text style={st.doneCheck}>✓</Text></View>
          <Text style={st.doneTitle}>Uploaded</Text>
          {payloadHash && <Text style={st.hash}>{payloadHash.slice(0, 16)}…</Text>}
          <View style={st.actionRow}>
            <Pressable style={st.btnO} onPress={openGallery}><Text style={st.btnOT}>View All</Text></Pressable>
            <Pressable style={st.btnS} onPress={reset}><Text style={st.btnST}>New Capture</Text></Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (screen === 'uploading') {
    return (
      <View style={st.dark}><StatusBar style="light" />
        <View style={st.center}>
          <View style={st.ring}><Text style={st.ringPct}>{Math.round(uploadProgress * 100)}%</Text></View>
          <Text style={st.uploadLabel}>UPLOADING</Text>
          <View style={st.trackOuter}><View style={[st.trackFill, { width: `${uploadProgress * 100}%` }]} /></View>
        </View>
      </View>
    );
  }

  if (screen === 'preview' && selectedFile) {
    const isImg = selectedFile.mimeType.startsWith('image/');
    return (
      <View style={st.dark}><StatusBar style="light" />
        {isImg && capturedImage ? (
          <Image source={{ uri: capturedImage }} style={[StyleSheet.absoluteFill, vibeApplied && st.vibeFilter]} resizeMode="cover" />
        ) : isImg ? (
          <Image source={{ uri: selectedFile.uri }} style={[st.prevImg, vibeApplied && st.vibeFilter]} />
        ) : (
          <View style={st.center}><Text style={st.fileName}>{selectedFile.name}</Text><Text style={st.muted}>{selectedFile.sizeBytes ? fmtBytes(selectedFile.sizeBytes) : ''} · {selectedFile.mimeType}</Text></View>
        )}
        {error.length > 0 && <View style={st.errBanner}><Text style={st.errBannerT}>{error}</Text></View>}
        <View style={[st.prevTop, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={reset} hitSlop={12}><Text style={st.prevAct}>Retake</Text></Pressable>
          <Pressable onPress={applyVibe} hitSlop={12}><Text style={[st.prevAct, vibeApplied && st.vibeActive]}>Apply Vibe</Text></Pressable>
        </View>
        <View style={[st.prevBot, { paddingBottom: insets.bottom + 16 }]}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable style={[st.uploadBtn, !backendReady && st.dis]} disabled={!backendReady} onPress={uploadFile}>
            <Text style={st.uploadBtnT}>Upload</Text>
          </Pressable>
        </View>
      </View>
    );
  }


  // Camera
  return (
    <Animated.View style={[st.cam, fadeStyle]}><StatusBar style="light" />
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        mode={mode === 'video' ? 'video' : 'picture'}
        videoQuality="720p"
        onCameraReady={() => setCameraReady(true)}
        onMountError={(e) => setError(e.message)}
      />

      {/* Top */}
      <View style={[st.topBar, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={toggleFlash} style={st.topBtn} hitSlop={12}>
          <View style={[st.flashIcon, flash === 'on' && st.flashOn]} />
        </Pressable>
        <View style={[st.connDot, backendReady ? st.dotG : st.dotR]} />
        <Pressable onPress={toggleFacing} style={st.topBtn} hitSlop={12}>
          <Text style={st.flipText}>⟲</Text>
        </Pressable>
      </View>

      {isRecording && (
        <Animated.View style={[st.recBadge, recStyle, { top: insets.top + 56 }]}>
          <View style={st.recDot} /><Text style={st.recText}>REC</Text>
        </Animated.View>
      )}

      {error.length > 0 && <View style={st.toast}><Text style={st.toastT}>{error}</Text></View>}

      {/* Bottom */}
      <View style={[st.bot, { paddingBottom: insets.bottom + 16 }]}>
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={st.modeRow}>
          <Pressable onPress={() => { if (!isRecording) setMode('photo'); }} hitSlop={8}>
            <Text style={[st.modeT, mode === 'photo' && st.modeA]}>PHOTO</Text>
          </Pressable>
          <Pressable onPress={() => { if (!isRecording) setMode('video'); }} hitSlop={8}>
            <Text style={[st.modeT, mode === 'video' && st.modeA]}>VIDEO</Text>
          </Pressable>
        </View>
        <View style={st.botRow}>
          <Pressable onPress={openGallery} style={st.thumbWrap}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={st.thumbImg} /> : <View style={st.thumbEmpty} />}
          </Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!cameraReady}>
            <Animated.View style={[st.shOuter, shutterStyle]}>
              <View style={[st.shInner, mode === 'video' && isRecording && st.shRec]} />
            </Animated.View>
          </Pressable>
          <Pressable onPress={pickFile} style={st.thumbWrap}><Text style={st.plusIcon}>＋</Text></Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

export default function App() {
  return <SafeAreaProvider><VibeCam /></SafeAreaProvider>;
}


// ─── Styles ──────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  cam: { flex: 1, backgroundColor: '#000' },
  dark: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  // Splash
  splash: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 32 },
  splashMark: { fontSize: 56, fontWeight: '100', color: '#fff', letterSpacing: -2 },
  splashName: { fontSize: 11, fontWeight: '600', letterSpacing: 4, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
  permBody: { fontSize: 15, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 22, marginTop: 16, marginBottom: 36 },
  pill: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 36, borderRadius: 999 },
  pillT: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },

  // Top
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  topBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  flashIcon: { width: 4, height: 14, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 2 },
  flashOn: { backgroundColor: '#fbbf24' },
  flipText: { fontSize: 18, color: '#fff' },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  dotG: { backgroundColor: '#34d399' },
  dotR: { backgroundColor: '#f87171' },

  // Recording
  recBadge: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  recText: { fontSize: 11, fontWeight: '700', color: RED, letterSpacing: 1 },

  // Bottom
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 18, overflow: 'hidden', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginBottom: 16 },
  modeT: { fontSize: 11, fontWeight: '600', letterSpacing: 1.8, color: 'rgba(255,255,255,0.25)' },
  modeA: { color: '#fff' },
  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  thumbWrap: { width: 46, height: 46, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: 46, height: 46, borderRadius: 12 },
  thumbEmpty: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  plusIcon: { fontSize: 20, color: 'rgba(255,255,255,0.6)' },
  shOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 3.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: RED },
  shRec: { borderRadius: 8, width: 28, height: 28 },

  // Error
  toast: { position: 'absolute', top: 110, left: 20, right: 20, backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: 14, padding: 12 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },

  // Preview
  prevImg: { flex: 1, resizeMode: 'contain' } as const,
  vibeFilter: { opacity: 0.85 },
  vibeActive: { color: RED },
  prevTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  prevAct: { color: '#fff', fontSize: 16, fontWeight: '500' },
  prevBot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 16, overflow: 'hidden', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  uploadBtn: { backgroundColor: '#fff', paddingVertical: 16, borderRadius: 999, alignItems: 'center' },
  uploadBtnT: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  errBanner: { position: 'absolute', bottom: 120, left: 20, right: 20, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 12, padding: 10 },
  errBannerT: { color: '#fff', fontSize: 13, textAlign: 'center' },
  fileName: { fontSize: 18, fontWeight: '500', color: '#fff', marginBottom: 8 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },

  // Upload
  ring: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  ringPct: { fontSize: 30, fontWeight: '200', color: '#fff' },
  uploadLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 2.5, color: 'rgba(255,255,255,0.25)', marginBottom: 24 },
  trackOuter: { width: '80%', height: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },

  // Done
  doneCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#34d399', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  doneCheck: { fontSize: 34, color: '#34d399' },
  doneTitle: { fontSize: 24, fontWeight: '300', color: '#fff', marginBottom: 8 },
  hash: { fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 36 },
  actionRow: { flexDirection: 'row', gap: 12, width: '100%' },

  // Gallery
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  navBack: { fontSize: 24, color: '#fff' },
  navTitle: { fontSize: 15, fontWeight: '600', color: '#fff', letterSpacing: 0.5 },
  emptyIcon: { fontSize: 32, color: 'rgba(255,255,255,0.1)', marginBottom: 12 },
  gRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
  gThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  gThumbT: { fontSize: 16, color: 'rgba(255,255,255,0.35)' },
  gName: { fontSize: 14, fontWeight: '500', color: '#fff', marginBottom: 2 },
  gMeta: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  gCheck: { fontSize: 14, color: '#34d399' },

  // Buttons
  btnO: { flex: 1, paddingVertical: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  btnOT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  btnS: { flex: 1, paddingVertical: 16, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center' },
  btnST: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  dis: { opacity: 0.3 },
});
