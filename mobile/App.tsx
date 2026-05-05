import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
} from 'react-native-reanimated';

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadInitResponse = {
  status: 'accepted';
  upload_id: string;
  max_size_bytes: number;
  expires_at_utc: string;
};

type UploadChunkResponse = {
  status: 'partial' | 'ingested';
  upload_id: string;
  expected_size_bytes: number;
  bytes_received: number;
  remaining_bytes: number;
  next_offset: number;
  ingested_at_utc: string | null;
  payload_hash?: string | null;
};

type GalleryItem = {
  upload_id: string;
  file_name: string;
  mime_type: string;
  status: string;
  size_bytes: number;
  bytes_received: number;
  ingested_at_utc: string | null;
};

type SelectedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
};

type CaptureMode = 'photo' | 'video';
type AppScreen = 'camera' | 'preview' | 'uploading' | 'done' | 'gallery';

// ─── Config ──────────────────────────────────────────────────────────────────

const RED = '#E63946';

const DEFAULT_API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';

const resolveApiBaseUrl = (): string => {
  const envValue = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.EXPO_PUBLIC_API_BASE_URL;
  if (envValue && envValue.trim().length > 0) return envValue.trim();
  return DEFAULT_API_BASE_URL;
};

const API_BASE_URL = resolveApiBaseUrl();
const CHUNK_SIZE = 256 * 1024;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const resolveFileSizeBytes = async (file: SelectedFile): Promise<number> => {
  if (file.sizeBytes !== null) return file.sizeBytes;
  const f = new File(file.uri);
  const info = f.info();
  if (info.exists && typeof info.size === 'number' && info.size > 0) return info.size;
  const fallback = new Uint8Array(await (await fetch(file.uri)).arrayBuffer()).length;
  if (fallback <= 0) throw new Error('File has no readable bytes');
  return fallback;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};


// ─── Main ────────────────────────────────────────────────────────────────────

function VibeCam() {
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [screen, setScreen] = useState<AppScreen>('camera');
  const [backendReady, setBackendReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [cameraReady, setCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [payloadHash, setPayloadHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);

  const cameraRef = useRef<CameraView>(null);
  const shutterScale = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`).then((r) => { if (r.ok) setBackendReady(true); }).catch(() => {});
  }, []);

  // ─── Camera ──────────────────────────────────────────────────────────────

  const toggleFacing = useCallback(() => setFacing((f) => (f === 'back' ? 'front' : 'back')), []);
  const toggleFlash = useCallback(() => setFlash((f) => (f === 'off' ? 'on' : 'off')), []);

  const onPressIn = useCallback(() => {
    shutterScale.value = withSpring(0.85, { damping: 15, stiffness: 300 });
  }, [shutterScale]);
  const onPressOut = useCallback(() => {
    shutterScale.value = withSpring(1, { damping: 12, stiffness: 200 });
  }, [shutterScale]);

  const capture = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return;
    setError('');

    if (mode === 'photo') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
        if (!photo?.uri) throw new Error('Capture failed');
        const f = new File(photo.uri);
        const info = f.info();
        setSelectedFile({ uri: photo.uri, name: `photo-${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null });
        setScreen('preview');
      } catch (e) { setError(e instanceof Error ? e.message : 'Capture failed'); }
    } else {
      if (isRecording) {
        cameraRef.current.stopRecording();
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        if (!micPermission?.granted) {
          const r = await requestMicPermission();
          if (!r.granted) { setError('Microphone required'); return; }
        }
        setIsRecording(true);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        try {
          const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
          if (!video?.uri) throw new Error('Recording failed');
          const f = new File(video.uri);
          const info = f.info();
          setSelectedFile({ uri: video.uri, name: `video-${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null });
          setScreen('preview');
        } catch (e) { setError(e instanceof Error ? e.message : 'Recording failed'); }
        finally { setIsRecording(false); }
      }
    }
  }, [cameraReady, mode, isRecording, micPermission, requestMicPermission]);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
      if (result.canceled) return;
      const file = result.assets[0];
      setSelectedFile({ uri: file.uri, name: file.name || 'file.bin', mimeType: (file.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: file.size ?? null });
      setScreen('preview');
    } catch (e) { setError(e instanceof Error ? e.message : 'File selection failed'); }
  }, []);

  // ─── Upload ──────────────────────────────────────────────────────────────

  const uploadFile = useCallback(async () => {
    if (!selectedFile) return;
    setScreen('uploading'); setUploadProgress(0); setPayloadHash(null); setError('');
    try {
      const sizeBytes = await resolveFileSizeBytes(selectedFile);
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

  const reset = useCallback(() => { setSelectedFile(null); setUploadProgress(0); setPayloadHash(null); setError(''); setScreen('camera'); }, []);


  // ─── Render ──────────────────────────────────────────────────────────────

  if (!cameraPermission?.granted) {
    return (
      <View style={st.dark}><StatusBar style="light" />
        <View style={st.center}>
          <Text style={st.brandMark}>V</Text>
          <Text style={st.permTitle}>VibeCam</Text>
          <Text style={st.permBody}>Camera access is needed to capture moments.</Text>
          <Pressable style={st.pill} onPress={requestCameraPermission}><Text style={st.pillText}>Enable Camera</Text></Pressable>
        </View>
      </View>
    );
  }

  if (screen === 'gallery') {
    return (
      <View style={st.dark}><StatusBar style="light" />
        <View style={[st.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={reset}><Text style={st.back}>←</Text></Pressable>
          <Text style={st.headerTitle}>Uploads</Text>
          <View style={{ width: 32 }} />
        </View>
        {gallery.length === 0 ? (
          <View style={st.center}><Text style={st.muted}>No uploads yet</Text></View>
        ) : (
          <FlatList data={gallery} keyExtractor={(i) => i.upload_id} contentContainerStyle={{ paddingHorizontal: 24 }}
            renderItem={({ item }) => (
              <View style={st.gRow}>
                <View style={st.gIcon}><Text style={st.gIconT}>{item.mime_type.startsWith('image/') ? '◻' : '▶'}</Text></View>
                <View style={{ flex: 1 }}><Text style={st.gName} numberOfLines={1}>{item.file_name}</Text><Text style={st.muted}>{formatBytes(item.size_bytes)}</Text></View>
                <Text style={st.check}>✓</Text>
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
          <View style={st.row}>
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
          <View style={st.ring}><Text style={st.pct}>{Math.round(uploadProgress * 100)}%</Text></View>
          <Text style={st.label}>UPLOADING</Text>
          <View style={st.track}><View style={[st.fill, { width: `${uploadProgress * 100}%` }]} /></View>
        </View>
      </View>
    );
  }

  if (screen === 'preview' && selectedFile) {
    const isImg = selectedFile.mimeType.startsWith('image/');
    return (
      <View style={st.dark}><StatusBar style="light" />
        {isImg ? <Image source={{ uri: selectedFile.uri }} style={st.prevImg} /> : (
          <View style={st.center}><Text style={st.fName}>{selectedFile.name}</Text><Text style={st.muted}>{selectedFile.sizeBytes ? formatBytes(selectedFile.sizeBytes) : ''} · {selectedFile.mimeType}</Text></View>
        )}
        {error.length > 0 && <Text style={st.errFloat}>{error}</Text>}
        <View style={[st.prevBar, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable style={st.btnO} onPress={reset}><Text style={st.btnOT}>Retake</Text></Pressable>
          <Pressable style={[st.btnS, !backendReady && st.dis]} disabled={!backendReady} onPress={uploadFile}><Text style={st.btnST}>Upload</Text></Pressable>
        </View>
      </View>
    );
  }


  // Camera
  return (
    <View style={st.cam}><StatusBar style="light" />
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
      <View style={[st.topBar, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={toggleFlash} style={st.topBtn} hitSlop={12}>
          <View style={[st.flashDot, flash === 'on' && st.flashOn]} />
        </Pressable>
        <View style={[st.dot, backendReady ? st.dotG : st.dotR]} />
        <Pressable onPress={toggleFacing} style={st.topBtn} hitSlop={12}>
          <View style={st.flipDot} />
        </Pressable>
      </View>

      {error.length > 0 && <View style={st.toast}><Text style={st.toastT}>{error}</Text></View>}

      {/* Bottom */}
      <View style={[st.bot, { paddingBottom: insets.bottom + 20 }]}>
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />

        {/* Mode toggle */}
        <View style={st.modeRow}>
          <Pressable onPress={() => setMode('photo')} disabled={isRecording}>
            <Text style={[st.modeT, mode === 'photo' && st.modeA]}>PHOTO</Text>
          </Pressable>
          <Pressable onPress={() => setMode('video')} disabled={isRecording}>
            <Text style={[st.modeT, mode === 'video' && st.modeA]}>VIDEO</Text>
          </Pressable>
        </View>

        <View style={st.botRow}>
          <Pressable onPress={openGallery} style={st.sideBtn}><View style={st.thumbPh} /></Pressable>

          <Pressable onPress={capture} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!cameraReady}>
            <Animated.View style={[st.shOuter, shutterStyle]}>
              <View style={[st.shInner, mode === 'video' && isRecording && st.shRec]} />
            </Animated.View>
          </Pressable>

          <Pressable onPress={pickFile} style={st.sideBtn}><Text style={st.plus}>＋</Text></Pressable>
        </View>
      </View>
    </View>
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

  // Permission
  brandMark: { fontSize: 52, fontWeight: '200', color: '#fff', marginBottom: 4 },
  permTitle: { fontSize: 26, fontWeight: '300', color: '#fff', letterSpacing: 0.5, marginBottom: 12 },
  permBody: { fontSize: 15, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  pill: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 36, borderRadius: 999 },
  pillText: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },

  // Top bar
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24 },
  topBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  flashDot: { width: 4, height: 14, backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 2 },
  flashOn: { backgroundColor: '#fbbf24' },
  flipDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotG: { backgroundColor: '#34d399' },
  dotR: { backgroundColor: '#f87171' },

  // Bottom
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 20, overflow: 'hidden', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginBottom: 18 },
  modeT: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.3)' },
  modeA: { color: '#fff' },
  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36 },
  sideBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  thumbPh: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  plus: { fontSize: 20, color: 'rgba(255,255,255,0.7)' },
  shOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 3.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: RED },
  shRec: { borderRadius: 8, width: 30, height: 30, backgroundColor: RED },

  // Error
  toast: { position: 'absolute', top: 100, left: 24, right: 24, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 12, padding: 12 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  errFloat: { color: '#f87171', fontSize: 13, textAlign: 'center', position: 'absolute', bottom: 140, left: 24, right: 24 },

  // Preview
  prevImg: { flex: 1, resizeMode: 'contain' } as const,
  fName: { fontSize: 18, fontWeight: '500', color: '#fff', marginBottom: 8 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  prevBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingTop: 16 },

  // Upload
  ring: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  pct: { fontSize: 28, fontWeight: '200', color: '#fff' },
  label: { fontSize: 11, fontWeight: '500', letterSpacing: 2, color: 'rgba(255,255,255,0.3)', marginBottom: 24 },
  track: { width: '80%', height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },

  // Done
  doneCircle: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#34d399', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  doneCheck: { fontSize: 32, color: '#34d399' },
  doneTitle: { fontSize: 24, fontWeight: '300', color: '#fff', marginBottom: 8 },
  hash: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 32 },
  row: { flexDirection: 'row', gap: 12, width: '100%' },

  // Gallery
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8 },
  back: { fontSize: 24, color: '#fff' },
  headerTitle: { fontSize: 15, fontWeight: '600', color: '#fff', letterSpacing: 0.5 },
  gRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)' },
  gIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  gIconT: { fontSize: 16, color: 'rgba(255,255,255,0.4)' },
  gName: { fontSize: 14, fontWeight: '500', color: '#fff', marginBottom: 2 },
  check: { fontSize: 14, color: '#34d399' },

  // Buttons
  btnO: { flex: 1, paddingVertical: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' },
  btnOT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  btnS: { flex: 1, paddingVertical: 16, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center' },
  btnST: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  dis: { opacity: 0.3 },
});
