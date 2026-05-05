import * as DocumentPicker from 'expo-document-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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

type SelectedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
};

type CaptureMode = 'photo' | 'video';
type AppScreen = 'camera' | 'preview' | 'uploading' | 'done';

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

  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const pulseAnim = useRef(new Animated.Value(1)).current;

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

  // ─── Camera Actions ──────────────────────────────────────────────────────

  const requestPermissions = async () => {
    const cam = await requestCameraPermission();
    if (cam.granted && captureMode === 'video') await requestMicPermission();
  };

  const takePhoto = async () => {
    if (!cameraRef.current || !cameraReady) return;
    setError('');
    try {
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

  const stopRecording = () => { cameraRef.current?.stopRecording(); };

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

      // Init
      const initRes = await fetch(`${API_BASE_URL}/uploads/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: selectedFile.name, mime_type: selectedFile.mimeType, size_bytes: sizeBytes }),
      });
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const initData = (await initRes.json()) as UploadInitResponse;

      // Chunk upload
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

      setPayloadHash(lastResponse?.payload_hash ?? null);
      setScreen('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setScreen('preview');
    }
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
      <View style={s.permissionScreen}>
        <StatusBar style="light" />
        <Text style={s.brandMark}>V</Text>
        <Text style={s.permissionTitle}>VibeCam</Text>
        <Text style={s.permissionBody}>Camera access is needed to capture moments.</Text>
        <Pressable style={s.permissionBtn} onPress={requestPermissions}>
          <Text style={s.permissionBtnText}>Enable Camera</Text>
        </Pressable>
        {healthState === 'error' && (
          <Text style={s.connectionError}>Backend unreachable</Text>
        )}
      </View>
    );
  }

  // Upload complete screen
  if (screen === 'done') {
    return (
      <View style={s.doneScreen}>
        <StatusBar style="light" />
        <View style={s.doneCheckCircle}>
          <Text style={s.doneCheck}>✓</Text>
        </View>
        <Text style={s.doneTitle}>Uploaded</Text>
        {payloadHash && (
          <Text style={s.doneHash}>{payloadHash.slice(0, 16)}…</Text>
        )}
        <Pressable style={s.doneBtn} onPress={reset}>
          <Text style={s.doneBtnText}>New Capture</Text>
        </Pressable>
      </View>
    );
  }

  // Uploading screen
  if (screen === 'uploading') {
    return (
      <View style={s.uploadingScreen}>
        <StatusBar style="light" />
        <View style={s.progressRing}>
          <Text style={s.progressText}>{Math.round(uploadProgress * 100)}%</Text>
        </View>
        <Text style={s.uploadingLabel}>Uploading</Text>
        <View style={s.progressBarTrack}>
          <View style={[s.progressBarFill, { width: `${uploadProgress * 100}%` }]} />
        </View>
      </View>
    );
  }

  // Preview screen
  if (screen === 'preview' && selectedFile) {
    const isImage = selectedFile.mimeType.startsWith('image/');
    return (
      <View style={s.previewScreen}>
        <StatusBar style="light" />
        {isImage ? (
          <Image source={{ uri: selectedFile.uri }} style={s.previewImage} />
        ) : (
          <View style={s.previewFilePlaceholder}>
            <Text style={s.previewFileName}>{selectedFile.name}</Text>
            <Text style={s.previewFileMeta}>
              {selectedFile.sizeBytes ? `${(selectedFile.sizeBytes / 1024).toFixed(0)} KB` : ''} · {selectedFile.mimeType}
            </Text>
          </View>
        )}
        {error.length > 0 && <Text style={s.errorText}>{error}</Text>}
        <View style={s.previewActions}>
          <Pressable style={s.secondaryBtn} onPress={reset}>
            <Text style={s.secondaryBtnText}>Retake</Text>
          </Pressable>
          <Pressable
            style={[s.primaryBtn, healthState !== 'ready' && s.btnDisabled]}
            disabled={healthState !== 'ready'}
            onPress={uploadFile}
          >
            <Text style={s.primaryBtnText}>Upload</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Camera screen (main)
  return (
    <View style={s.cameraScreen}>
      <StatusBar style="light" />
      <CameraView
        ref={cameraRef}
        style={s.cameraFull}
        mode={captureMode === 'video' ? 'video' : 'picture'}
        videoQuality="720p"
        onCameraReady={() => setCameraReady(true)}
        onMountError={(e) => setError(e.message)}
      />

      {/* Top bar */}
      <View style={s.topBar}>
        <View style={s.connectionDot}>
          <View style={[s.dot, healthState === 'ready' ? s.dotGreen : s.dotRed]} />
        </View>
        <Text style={s.brandText}>VIBECAM</Text>
        <Pressable onPress={pickFile} style={s.galleryBtn}>
          <Text style={s.galleryIcon}>⎙</Text>
        </Pressable>
      </View>

      {/* Error toast */}
      {error.length > 0 && (
        <View style={s.errorToast}>
          <Text style={s.errorToastText}>{error}</Text>
        </View>
      )}

      {/* Bottom controls */}
      <View style={s.bottomBar}>
        {/* Mode toggle */}
        <View style={s.modeToggle}>
          <Pressable
            onPress={() => setCaptureMode('photo')}
            disabled={isRecording}
          >
            <Text style={[s.modeText, captureMode === 'photo' && s.modeActive]}>PHOTO</Text>
          </Pressable>
          <Pressable
            onPress={() => setCaptureMode('video')}
            disabled={isRecording}
          >
            <Text style={[s.modeText, captureMode === 'video' && s.modeActive]}>VIDEO</Text>
          </Pressable>
        </View>

        {/* Shutter */}
        <Pressable
          onPress={captureMode === 'photo' ? takePhoto : (isRecording ? stopRecording : startRecording)}
          disabled={!cameraReady}
          style={s.shutterOuter}
        >
          <Animated.View
            style={[
              s.shutterInner,
              captureMode === 'video' && isRecording && s.shutterRecording,
              { transform: [{ scale: pulseAnim }] },
            ]}
          />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Camera
  cameraScreen: { flex: 1, backgroundColor: '#000' },
  cameraFull: { ...StyleSheet.absoluteFillObject },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 56, paddingHorizontal: 24, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  brandText: { fontSize: 13, fontWeight: '600', letterSpacing: 2.5, color: '#fff', opacity: 0.9 },
  connectionDot: { width: 32, alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen: { backgroundColor: '#34d399' },
  dotRed: { backgroundColor: '#f87171' },
  galleryBtn: { width: 32, alignItems: 'flex-end' },
  galleryIcon: { fontSize: 18, color: '#fff', opacity: 0.9 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 48, alignItems: 'center',
  },
  modeToggle: { flexDirection: 'row', gap: 24, marginBottom: 24 },
  modeText: { fontSize: 12, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)' },
  modeActive: { color: '#fff' },
  shutterOuter: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff',
  },
  shutterRecording: { backgroundColor: '#ef4444', borderRadius: 8, width: 32, height: 32 },
  errorToast: {
    position: 'absolute', top: 110, left: 24, right: 24,
    backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 12, padding: 12,
  },
  errorToastText: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },

  // Permission
  permissionScreen: {
    flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  brandMark: { fontSize: 48, fontWeight: '200', color: '#fff', marginBottom: 8 },
  permissionTitle: { fontSize: 28, fontWeight: '300', color: '#fff', marginBottom: 12 },
  permissionBody: { fontSize: 15, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  permissionBtn: {
    backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 999,
  },
  permissionBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  connectionError: { color: '#f87171', fontSize: 12, marginTop: 16 },

  // Preview
  previewScreen: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: '70%', resizeMode: 'contain' },
  previewFilePlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  previewFileName: { fontSize: 18, fontWeight: '500', color: '#fff', marginBottom: 8 },
  previewFileMeta: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  previewActions: {
    position: 'absolute', bottom: 48, left: 24, right: 24,
    flexDirection: 'row', gap: 12,
  },
  secondaryBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center',
  },
  secondaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  primaryBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 999,
    backgroundColor: '#fff', alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.3 },
  errorText: { color: '#f87171', fontSize: 13, marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },

  // Uploading
  uploadingScreen: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  progressRing: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  progressText: { fontSize: 28, fontWeight: '200', color: '#fff' },
  uploadingLabel: { fontSize: 13, fontWeight: '500', letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)', marginBottom: 24 },
  progressBarTrack: {
    width: '80%', height: 3, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },

  // Done
  doneScreen: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneCheckCircle: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, borderColor: '#34d399',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  doneCheck: { fontSize: 32, color: '#34d399' },
  doneTitle: { fontSize: 24, fontWeight: '300', color: '#fff', marginBottom: 8 },
  doneHash: { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 32 },
  doneBtn: {
    paddingVertical: 14, paddingHorizontal: 32, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
