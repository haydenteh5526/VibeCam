import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { CameraView, CameraType, FlashMode, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

type HealthState = 'loading' | 'ready' | 'error';

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
  const uploadFile = new File(file.uri);
  const fileInfo = uploadFile.info();
  if (fileInfo.exists && typeof fileInfo.size === 'number' && fileInfo.size > 0) return fileInfo.size;
  const fallback = new Uint8Array(await (await fetch(file.uri)).arrayBuffer()).length;
  if (fallback <= 0) throw new Error('Selected file has no readable bytes');
  return fallback;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};


// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('camera');
  const [healthState, setHealthState] = useState<HealthState>('loading');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [payloadHash, setPayloadHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [zoom, setZoom] = useState(0);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);

  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const lastPinchDistance = useRef<number | null>(null);

  // Health check on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((r) => { if (r.ok) setHealthState('ready'); else setHealthState('error'); })
      .catch(() => setHealthState('error'));
  }, []);

  // Recording pulse animation
  useEffect(() => {
    if (!isRecording) { pulseAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulseAnim]);

  // ─── Camera Controls ─────────────────────────────────────────────────────

  const toggleFacing = () => setFacing((f) => (f === 'back' ? 'front' : 'back'));
  const toggleFlash = () => setFlash((f) => (f === 'off' ? 'on' : 'off'));

  const handlePinch = useCallback((event: { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } }) => {
    const touches = event.nativeEvent.touches;
    if (!touches || touches.length < 2) { lastPinchDistance.current = null; return; }
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (lastPinchDistance.current !== null) {
      const diff = distance - lastPinchDistance.current;
      setZoom((z) => Math.min(1, Math.max(0, z + diff * 0.002)));
    }
    lastPinchDistance.current = distance;
  }, []);

  const handlePinchEnd = useCallback(() => { lastPinchDistance.current = null; }, []);

  const requestPermissions = async () => {
    const cam = await requestCameraPermission();
    if (cam.granted && captureMode === 'video') await requestMicPermission();
  };

  const takePhoto = async () => {
    if (!cameraRef.current || !cameraReady) return;
    setError('');
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) throw new Error('Capture failed');
      const uploadFile = new File(photo.uri);
      const info = uploadFile.info();
      setSelectedFile({
        uri: photo.uri,
        name: `photo-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null,
      });
      setScreen('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed');
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current || !cameraReady) return;
    if (!micPermission?.granted) {
      const mic = await requestMicPermission();
      if (!mic.granted) { setError('Microphone access required'); return; }
    }
    setError('');
    setIsRecording(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (!video?.uri) throw new Error('Recording failed');
      const uploadFile = new File(video.uri);
      const info = uploadFile.info();
      setSelectedFile({
        uri: video.uri,
        name: `video-${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        sizeBytes: info.exists && typeof info.size === 'number' ? info.size : null,
      });
      setScreen('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recording failed');
    } finally {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    cameraRef.current?.stopRecording();
  };

  const pickFile = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
      if (result.canceled) return;
      const file = result.assets[0];
      setSelectedFile({
        uri: file.uri,
        name: file.name || 'file.bin',
        mimeType: (file.mimeType || 'application/octet-stream').toLowerCase(),
        sizeBytes: file.size ?? null,
      });
      setScreen('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File selection failed');
    }
  };


  // ─── Upload ──────────────────────────────────────────────────────────────

  const uploadFile = async () => {
    if (!selectedFile) return;
    setScreen('uploading');
    setUploadProgress(0);
    setPayloadHash(null);
    setError('');

    try {
      const sizeBytes = await resolveFileSizeBytes(selectedFile);

      const initRes = await fetch(`${API_BASE_URL}/uploads/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: selectedFile.name, mime_type: selectedFile.mimeType, size_bytes: sizeBytes }),
      });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const initData = (await initRes.json()) as UploadInitResponse;

      const uploadFile2 = new File(selectedFile.uri);
      const fileHandle = uploadFile2.open();
      let offset = 0;
      let lastResponse: UploadChunkResponse | null = null;

      try {
        while (offset < sizeBytes) {
          const chunkLen = Math.min(CHUNK_SIZE, sizeBytes - offset);
          const chunk = fileHandle.readBytes(chunkLen);
          if (chunk.length === 0) throw new Error('Read failed');

          const chunkRes = await fetch(
            `${API_BASE_URL}/uploads/${initData.upload_id}/chunks?offset=${offset}`,
            { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk },
          );
          if (!chunkRes.ok) throw new Error(`Upload failed: ${chunkRes.status}`);
          lastResponse = (await chunkRes.json()) as UploadChunkResponse;
          offset = lastResponse.next_offset;
          setUploadProgress(offset / sizeBytes);
        }
      } finally {
        fileHandle.close();
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPayloadHash(lastResponse?.payload_hash ?? null);
      setScreen('done');
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof Error ? e.message : 'Upload failed');
      setScreen('preview');
    }
  };

  // ─── Gallery ────────────────────────────────────────────────────────────

  const fetchGallery = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/uploads?status=ingested`);
      if (!res.ok) return;
      const data = (await res.json()) as GalleryItem[];
      setGallery(data);
    } catch { /* silent */ }
  };

  const openGallery = async () => {
    await fetchGallery();
    setScreen('gallery');
  };

  const reset = () => {
    setSelectedFile(null);
    setUploadProgress(0);
    setPayloadHash(null);
    setError('');
    setScreen('camera');
  };


  // ─── Render ──────────────────────────────────────────────────────────────

  const hasCameraPermission = cameraPermission?.granted;

  // Permission screen
  if (!hasCameraPermission && screen === 'camera') {
    return (
      <View style={st.permScreen}>
        <StatusBar style="light" />
        <Text style={st.brandMark}>V</Text>
        <Text style={st.permTitle}>VibeCam</Text>
        <Text style={st.permBody}>Camera access is needed to capture moments.</Text>
        <Pressable style={st.permBtn} onPress={requestPermissions}>
          <Text style={st.permBtnText}>Enable Camera</Text>
        </Pressable>
        {healthState === 'error' && <Text style={st.connError}>Backend unreachable</Text>}
      </View>
    );
  }

  // Gallery screen
  if (screen === 'gallery') {
    return (
      <View style={st.galleryScreen}>
        <StatusBar style="light" />
        <View style={st.galleryHeader}>
          <Pressable onPress={reset}><Text style={st.backBtn}>←</Text></Pressable>
          <Text style={st.galleryTitle}>Uploads</Text>
          <View style={{ width: 32 }} />
        </View>
        {gallery.length === 0 ? (
          <View style={st.galleryEmpty}>
            <Text style={st.galleryEmptyText}>No uploads yet</Text>
          </View>
        ) : (
          <FlatList
            data={gallery}
            keyExtractor={(item) => item.upload_id}
            contentContainerStyle={st.galleryList}
            renderItem={({ item }) => (
              <View style={st.galleryItem}>
                <View style={st.galleryItemIcon}>
                  <Text style={st.galleryItemIconText}>
                    {item.mime_type.startsWith('image/') ? '◻' : '▶'}
                  </Text>
                </View>
                <View style={st.galleryItemInfo}>
                  <Text style={st.galleryItemName} numberOfLines={1}>{item.file_name}</Text>
                  <Text style={st.galleryItemMeta}>{formatBytes(item.size_bytes)} · {item.mime_type.split('/')[1]}</Text>
                </View>
                <Text style={st.galleryItemStatus}>✓</Text>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  // Done screen
  if (screen === 'done') {
    return (
      <View style={st.doneScreen}>
        <StatusBar style="light" />
        <View style={st.doneCircle}><Text style={st.doneCheck}>✓</Text></View>
        <Text style={st.doneTitle}>Uploaded</Text>
        {payloadHash && <Text style={st.doneHash}>{payloadHash.slice(0, 16)}…</Text>}
        <View style={st.doneActions}>
          <Pressable style={st.secondaryBtn} onPress={openGallery}>
            <Text style={st.secondaryBtnText}>View All</Text>
          </Pressable>
          <Pressable style={st.primaryBtn} onPress={reset}>
            <Text style={st.primaryBtnText}>New Capture</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Uploading screen
  if (screen === 'uploading') {
    return (
      <View style={st.uploadScreen}>
        <StatusBar style="light" />
        <View style={st.progressRing}>
          <Text style={st.progressText}>{Math.round(uploadProgress * 100)}%</Text>
        </View>
        <Text style={st.uploadLabel}>UPLOADING</Text>
        <View style={st.progressTrack}>
          <View style={[st.progressFill, { width: `${uploadProgress * 100}%` }]} />
        </View>
      </View>
    );
  }

  // Preview screen
  if (screen === 'preview' && selectedFile) {
    const isImage = selectedFile.mimeType.startsWith('image/');
    return (
      <View style={st.previewScreen}>
        <StatusBar style="light" />
        {isImage ? (
          <Image source={{ uri: selectedFile.uri }} style={st.previewImage} />
        ) : (
          <View style={st.previewPlaceholder}>
            <Text style={st.previewFileName}>{selectedFile.name}</Text>
            <Text style={st.previewMeta}>
              {selectedFile.sizeBytes ? formatBytes(selectedFile.sizeBytes) : ''} · {selectedFile.mimeType}
            </Text>
          </View>
        )}
        {error.length > 0 && <Text style={st.errorText}>{error}</Text>}
        <View style={st.previewActions}>
          <Pressable style={st.secondaryBtn} onPress={reset}>
            <Text style={st.secondaryBtnText}>Retake</Text>
          </Pressable>
          <Pressable
            style={[st.primaryBtn, healthState !== 'ready' && st.disabled]}
            disabled={healthState !== 'ready'}
            onPress={uploadFile}
          >
            <Text style={st.primaryBtnText}>Upload</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Camera screen (main)
  return (
    <View style={st.cameraScreen}>
      <StatusBar style="light" />
      <View
        style={st.cameraWrap}
        onTouchMove={(e) => handlePinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })}
        onTouchEnd={handlePinchEnd}
      >
        <CameraView
          ref={cameraRef}
          style={st.cameraFull}
          facing={facing}
          flash={flash}
          zoom={zoom}
          mode={captureMode === 'video' ? 'video' : 'picture'}
          videoQuality="720p"
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => setError(e.message)}
        />
      </View>

      {/* Top bar */}
      <View style={st.topBar}>
        <Pressable onPress={toggleFlash} style={st.topBtn}>
          <Text style={st.topIcon}>{flash === 'on' ? '⚡' : '⚡\u0338'}</Text>
        </Pressable>
        <Text style={st.brand}>VIBECAM</Text>
        <Pressable onPress={toggleFacing} style={st.topBtn}>
          <Text style={st.topIcon}>⟲</Text>
        </Pressable>
      </View>

      {/* Connection + zoom indicator */}
      {zoom > 0 && (
        <View style={st.zoomBadge}>
          <Text style={st.zoomText}>{(1 + zoom * 7).toFixed(1)}×</Text>
        </View>
      )}

      {/* Error toast */}
      {error.length > 0 && (
        <View style={st.errorToast}><Text style={st.errorToastText}>{error}</Text></View>
      )}

      {/* Bottom controls */}
      <View style={st.bottomBar}>
        <View style={st.modeRow}>
          <Pressable onPress={() => setCaptureMode('photo')} disabled={isRecording}>
            <Text style={[st.modeText, captureMode === 'photo' && st.modeActive]}>PHOTO</Text>
          </Pressable>
          <Pressable onPress={() => setCaptureMode('video')} disabled={isRecording}>
            <Text style={[st.modeText, captureMode === 'video' && st.modeActive]}>VIDEO</Text>
          </Pressable>
        </View>

        <View style={st.shutterRow}>
          <Pressable onPress={openGallery} style={st.sideBtn}>
            <Text style={st.sideBtnIcon}>▦</Text>
          </Pressable>

          <Pressable
            onPress={captureMode === 'photo' ? takePhoto : (isRecording ? stopRecording : startRecording)}
            disabled={!cameraReady}
            style={st.shutterOuter}
          >
            <Animated.View
              style={[
                st.shutterInner,
                captureMode === 'video' && isRecording && st.shutterRec,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
          </Pressable>

          <Pressable onPress={pickFile} style={st.sideBtn}>
            <Text style={st.sideBtnIcon}>＋</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}


// ─── Styles ──────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  // Camera
  cameraScreen: { flex: 1, backgroundColor: '#000' },
  cameraWrap: { ...StyleSheet.absoluteFillObject },
  cameraFull: { flex: 1 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 56, paddingHorizontal: 24, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topIcon: { fontSize: 20, color: '#fff' },
  brand: { fontSize: 12, fontWeight: '600', letterSpacing: 2.5, color: '#fff', opacity: 0.85 },
  zoomBadge: {
    position: 'absolute', top: 110, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  zoomText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 44, alignItems: 'center' },
  modeRow: { flexDirection: 'row', gap: 28, marginBottom: 20 },
  modeText: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.35)' },
  modeActive: { color: '#fff' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', gap: 32 },
  sideBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  sideBtnIcon: { fontSize: 18, color: '#fff' },
  shutterOuter: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  shutterRec: { backgroundColor: '#ef4444', borderRadius: 8, width: 30, height: 30 },
  errorToast: {
    position: 'absolute', top: 110, left: 24, right: 24,
    backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 12, padding: 12,
  },
  errorToastText: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },

  // Permission
  permScreen: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 32 },
  brandMark: { fontSize: 48, fontWeight: '200', color: '#fff', marginBottom: 8 },
  permTitle: { fontSize: 28, fontWeight: '300', color: '#fff', marginBottom: 12 },
  permBody: { fontSize: 15, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  permBtn: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 999 },
  permBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  connError: { color: '#f87171', fontSize: 12, marginTop: 16 },

  // Preview
  previewScreen: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: '70%', resizeMode: 'contain' },
  previewPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  previewFileName: { fontSize: 18, fontWeight: '500', color: '#fff', marginBottom: 8 },
  previewMeta: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  previewActions: {
    position: 'absolute', bottom: 48, left: 24, right: 24,
    flexDirection: 'row', gap: 12,
  },
  errorText: { color: '#f87171', fontSize: 13, marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },

  // Uploading
  uploadScreen: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  progressRing: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  progressText: { fontSize: 28, fontWeight: '200', color: '#fff' },
  uploadLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 2, color: 'rgba(255,255,255,0.35)', marginBottom: 24 },
  progressTrack: { width: '80%', height: 3, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },

  // Done
  doneScreen: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneCircle: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: '#34d399',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  doneCheck: { fontSize: 32, color: '#34d399' },
  doneTitle: { fontSize: 24, fontWeight: '300', color: '#fff', marginBottom: 8 },
  doneHash: { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 32 },
  doneActions: { flexDirection: 'row', gap: 12, width: '100%', paddingHorizontal: 24 },

  // Gallery
  galleryScreen: { flex: 1, backgroundColor: '#0a0a0a' },
  galleryHeader: {
    paddingTop: 56, paddingHorizontal: 24, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { fontSize: 24, color: '#fff' },
  galleryTitle: { fontSize: 16, fontWeight: '600', color: '#fff', letterSpacing: 0.5 },
  galleryList: { paddingHorizontal: 24, paddingTop: 8 },
  galleryEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  galleryEmptyText: { fontSize: 14, color: 'rgba(255,255,255,0.3)' },
  galleryItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  galleryItemIcon: {
    width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  galleryItemIconText: { fontSize: 16, color: 'rgba(255,255,255,0.5)' },
  galleryItemInfo: { flex: 1 },
  galleryItemName: { fontSize: 14, fontWeight: '500', color: '#fff', marginBottom: 2 },
  galleryItemMeta: { fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  galleryItemStatus: { fontSize: 14, color: '#34d399' },

  // Shared buttons
  secondaryBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center',
  },
  secondaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  primaryBtn: { flex: 1, paddingVertical: 16, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center' },
  primaryBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.3 },
});
