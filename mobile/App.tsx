import * as DocumentPicker from 'expo-document-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type HealthResponse = {
  status: 'ok';
  service: 'vibecam-backend';
  timestamp_utc: string;
};

type HealthState = 'loading' | 'ready' | 'error';
type UploadState = 'idle' | 'loading' | 'ready' | 'error';
type ChunkState = 'idle' | 'loading' | 'ready' | 'error';

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

type UploadStatusResponse = {
  status: 'initialized' | 'partial' | 'ingested';
  upload_id: string;
  file_name: string;
  mime_type: string;
  expected_size_bytes: number;
  bytes_received: number;
  remaining_bytes: number;
  expires_at_utc: string;
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

const DEFAULT_API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';

const resolveApiBaseUrl = (): string => {
  const envValue = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.EXPO_PUBLIC_API_BASE_URL;
  if (envValue && envValue.trim().length > 0) {
    return envValue.trim();
  }
  return DEFAULT_API_BASE_URL;
};

const API_BASE_URL = resolveApiBaseUrl();

const HEALTH_ENDPOINT = `${API_BASE_URL}/health`;
const UPLOAD_INIT_ENDPOINT = `${API_BASE_URL}/uploads/init`;
const FILE_UPLOAD_CHUNK_SIZE = 256 * 1024;

const uploadStatusEndpoint = (uploadId: string): string => `${API_BASE_URL}/uploads/${uploadId}`;
const uploadChunksEndpoint = (uploadId: string, offset: number): string =>
  `${API_BASE_URL}/uploads/${uploadId}/chunks?offset=${offset}`;

const resolveFileSizeBytes = async (file: SelectedFile): Promise<number> => {
  if (file.sizeBytes !== null) {
    return file.sizeBytes;
  }

  const uploadFile = new File(file.uri);
  const fileInfo = uploadFile.info();

  if (fileInfo.exists && typeof fileInfo.size === 'number' && fileInfo.size > 0) {
    return fileInfo.size;
  }

  const fallbackSizeBytes = new Uint8Array(await (await fetch(file.uri)).arrayBuffer()).length;
  if (fallbackSizeBytes <= 0) {
    throw new Error('Selected file has no readable bytes');
  }

  return fallbackSizeBytes;
};

export default function App() {
  const [healthState, setHealthState] = useState<HealthState>('loading');
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadData, setUploadData] = useState<UploadInitResponse | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [chunkState, setChunkState] = useState<ChunkState>('idle');
  const [chunkData, setChunkData] = useState<UploadChunkResponse | null>(null);
  const [chunkError, setChunkError] = useState('');
  const [uploadSession, setUploadSession] = useState<UploadStatusResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const resetUploadFlow = (): void => {
    setUploadState('idle');
    setUploadData(null);
    setUploadError('');
    setChunkState('idle');
    setChunkData(null);
    setChunkError('');
    setUploadSession(null);
  };

  const fetchHealth = async (): Promise<void> => {
    setHealthState('loading');
    setErrorMessage('');
    resetUploadFlow();

    try {
      const response = await fetch(HEALTH_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const payload = (await response.json()) as HealthResponse;
      setHealthData(payload);
      setHealthState('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      setErrorMessage(message);
      setHealthData(null);
      setHealthState('error');
    }
  };

  const fetchUploadStatus = async (uploadId: string): Promise<UploadStatusResponse> => {
    const response = await fetch(uploadStatusEndpoint(uploadId));
    if (!response.ok) {
      throw new Error(`Upload status failed with ${response.status}`);
    }

    return (await response.json()) as UploadStatusResponse;
  };

  const pickUploadFile = async (): Promise<void> => {
    resetUploadFlow();

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      setSelectedFile({
        uri: file.uri,
        name: file.name || 'selected-upload.bin',
        mimeType: (file.mimeType || 'application/octet-stream').toLowerCase(),
        sizeBytes: file.size ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file picker error';
      setUploadError(message);
      setUploadState('error');
    }
  };

  const initializeUpload = async (): Promise<void> => {
    if (healthState !== 'ready' || !selectedFile) {
      return;
    }

    setUploadState('loading');
    setUploadError('');
    setChunkState('idle');
    setChunkData(null);
    setChunkError('');
    setUploadSession(null);

    try {
      const resolvedSizeBytes = await resolveFileSizeBytes(selectedFile);

      setSelectedFile((previous) =>
        previous
          ? {
              ...previous,
              sizeBytes: resolvedSizeBytes,
            }
          : previous,
      );

      const response = await fetch(UPLOAD_INIT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_name: selectedFile.name,
          mime_type: selectedFile.mimeType,
          size_bytes: resolvedSizeBytes,
        }),
      });

      if (!response.ok) {
        throw new Error(`Upload init failed with ${response.status}`);
      }

      const payload = (await response.json()) as UploadInitResponse;
      const statusPayload = await fetchUploadStatus(payload.upload_id);

      setUploadData(payload);
      setUploadSession(statusPayload);
      setUploadState('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upload init error';
      setUploadError(message);
      setUploadData(null);
      setUploadState('error');
    }
  };

  const uploadFileInChunks = async (): Promise<void> => {
    if (!uploadData || !selectedFile) {
      return;
    }

    setChunkState('loading');
    setChunkError('');

    try {
      const uploadFile = new File(selectedFile.uri);
      const fileInfo = uploadFile.info();
      const totalSizeBytes = selectedFile.sizeBytes ?? fileInfo.size;

      if (!fileInfo.exists || !totalSizeBytes || totalSizeBytes <= 0) {
        throw new Error('Selected file has no readable bytes');
      }

      let latestPayload: UploadChunkResponse | null = null;

      const fileHandle = uploadFile.open();
      let offset = 0;

      try {
        while (offset < totalSizeBytes) {
          const remainingBytes = totalSizeBytes - offset;
          const chunkLength = Math.min(FILE_UPLOAD_CHUNK_SIZE, remainingBytes);
          const chunk = fileHandle.readBytes(chunkLength);

          if (chunk.length === 0) {
            throw new Error('Unable to read next file chunk');
          }

          const chunkResponse = await fetch(uploadChunksEndpoint(uploadData.upload_id, offset), {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
            },
            body: chunk,
          });

          if (!chunkResponse.ok) {
            throw new Error(`Chunk upload failed with ${chunkResponse.status}`);
          }

          latestPayload = (await chunkResponse.json()) as UploadChunkResponse;
          setChunkData(latestPayload);

          const expectedNextOffset = offset + chunk.length;
          if (latestPayload.next_offset !== expectedNextOffset) {
            throw new Error(
              `Backend acknowledged unexpected next offset ${latestPayload.next_offset}; expected ${expectedNextOffset}`,
            );
          }

          offset = latestPayload.next_offset;
        }
      } finally {
        fileHandle.close();
      }

      if (!latestPayload) {
        throw new Error('No chunk response received from backend');
      }

      const statusPayload = await fetchUploadStatus(uploadData.upload_id);

      setChunkData(latestPayload);
      setUploadSession(statusPayload);
      setChunkState('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown chunk upload error';
      setChunkError(message);
      setChunkData(null);
      setChunkState('error');
    }
  };

  useEffect(() => {
    void fetchHealth();
  }, []);

  const requestCapturePermissions = async (): Promise<void> => {
    setCameraError('');
    const cameraResult = await requestCameraPermission();
    if (!cameraResult.granted) {
      setCameraError('Camera permission is required to capture photos and video.');
    }
  };

  const requestMicrophoneAccess = async (): Promise<boolean> => {
    const micResult = await requestMicPermission();
    if (!micResult.granted) {
      setCameraError('Microphone permission is required to record video.');
      return false;
    }
    return true;
  };

  const takePhoto = async (): Promise<void> => {
    if (!cameraPermission?.granted) {
      setCameraError('Camera permission is required to take photos.');
      return;
    }

    if (!cameraRef.current || !cameraReady) {
      setCameraError('Camera is not ready yet.');
      return;
    }

    setCameraError('');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) {
        throw new Error('No photo file returned from the camera.');
      }

      const uploadFile = new File(photo.uri);
      const fileInfo = uploadFile.info();
      if (!fileInfo.exists) {
        throw new Error('Captured photo is not available.');
      }

      resetUploadFlow();
      setSelectedFile({
        uri: photo.uri,
        name: `photo-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: typeof fileInfo.size === 'number' ? fileInfo.size : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown camera error';
      setCameraError(message);
    }
  };

  const recordVideo = async (): Promise<void> => {
    if (!cameraPermission?.granted) {
      setCameraError('Camera permission is required to record video.');
      return;
    }

    if (!micPermission?.granted) {
      const hasMic = await requestMicrophoneAccess();
      if (!hasMic) {
        return;
      }
    }

    if (!cameraRef.current || !cameraReady) {
      setCameraError('Camera is not ready yet.');
      return;
    }

    setCameraError('');
    setIsRecording(true);

    try {
      const recording = await cameraRef.current.recordAsync({ maxDuration: 30 });
      if (!recording?.uri) {
        throw new Error('No video file returned from the camera.');
      }

      const uploadFile = new File(recording.uri);
      const fileInfo = uploadFile.info();
      if (!fileInfo.exists) {
        throw new Error('Recorded file is not available.');
      }

      resetUploadFlow();
      setSelectedFile({
        uri: recording.uri,
        name: `capture-${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        sizeBytes: typeof fileInfo.size === 'number' ? fileInfo.size : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown camera error';
      setCameraError(message);
    } finally {
      setIsRecording(false);
    }
  };

  const stopRecording = (): void => {
    cameraRef.current?.stopRecording();
  };

  const hasCameraPermission = Boolean(cameraPermission?.granted);
  const hasMicPermission = Boolean(micPermission?.granted);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>VibeCam</Text>
      <Text style={styles.subtitle}>Backend health and real file upload flow</Text>

      {healthState === 'loading' && (
        <View style={styles.card}>
          <ActivityIndicator size="large" color="#0f766e" />
          <Text style={styles.message}>Contacting API...</Text>
        </View>
      )}

      {healthState === 'ready' && healthData && (
        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{healthData.status}</Text>
          <Text style={styles.label}>Service</Text>
          <Text style={styles.value}>{healthData.service}</Text>
          <Text style={styles.label}>Timestamp</Text>
          <Text style={styles.timestamp}>{healthData.timestamp_utc}</Text>
        </View>
      )}

      {healthState === 'error' && (
        <View style={styles.cardError}>
          <Text style={styles.errorTitle}>Could not reach backend</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Camera</Text>
        {hasCameraPermission ? (
          <>
            <View style={styles.cameraPreview}>
              <CameraView
                ref={cameraRef}
                style={styles.cameraView}
                mode={captureMode === 'video' ? 'video' : 'picture'}
                videoQuality={captureMode === 'video' ? '720p' : undefined}
                onCameraReady={() => setCameraReady(true)}
                onMountError={(event) => {
                  setCameraError(event.message);
                }}
              />
            </View>
            <View style={styles.cameraToggle}>
              <Pressable
                disabled={isRecording}
                style={({ pressed }) => [
                  styles.cameraToggleButton,
                  captureMode === 'photo' && styles.cameraToggleButtonActive,
                  pressed && styles.cameraButtonPressed,
                  isRecording && styles.buttonDisabled,
                ]}
                onPress={() => {
                  setCaptureMode('photo');
                }}
              >
                <Text
                  style={
                    captureMode === 'photo'
                      ? styles.cameraToggleTextActive
                      : styles.cameraToggleText
                  }
                >
                  Photo
                </Text>
              </Pressable>
              <Pressable
                disabled={isRecording}
                style={({ pressed }) => [
                  styles.cameraToggleButton,
                  captureMode === 'video' && styles.cameraToggleButtonActive,
                  pressed && styles.cameraButtonPressed,
                  isRecording && styles.buttonDisabled,
                ]}
                onPress={() => {
                  setCaptureMode('video');
                }}
              >
                <Text
                  style={
                    captureMode === 'video'
                      ? styles.cameraToggleTextActive
                      : styles.cameraToggleText
                  }
                >
                  Video
                </Text>
              </Pressable>
            </View>
            <View style={styles.cameraControls}>
              {captureMode === 'photo' ? (
                <Pressable
                  disabled={!cameraReady}
                  style={({ pressed }) => [
                    styles.cameraButton,
                    pressed && styles.cameraButtonPressed,
                    !cameraReady && styles.buttonDisabled,
                  ]}
                  onPress={() => {
                    void takePhoto();
                  }}
                >
                  <Text style={styles.cameraButtonText}>Take Photo</Text>
                </Pressable>
              ) : (
                <>
                  {!hasMicPermission && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.cameraButton,
                        pressed && styles.cameraButtonPressed,
                      ]}
                      onPress={() => {
                        void requestMicrophoneAccess();
                      }}
                    >
                      <Text style={styles.cameraButtonText}>Grant Microphone</Text>
                    </Pressable>
                  )}
                  <Pressable
                    disabled={!cameraReady || (!hasMicPermission && !isRecording)}
                    style={({ pressed }) => [
                      isRecording ? styles.cameraStopButton : styles.cameraButton,
                      pressed && styles.cameraButtonPressed,
                      (!cameraReady || (!hasMicPermission && !isRecording)) &&
                        styles.buttonDisabled,
                    ]}
                    onPress={() => {
                      if (isRecording) {
                        stopRecording();
                      } else {
                        void recordVideo();
                      }
                    }}
                  >
                    <Text style={styles.cameraButtonText}>
                      {isRecording ? 'Stop Recording' : 'Record Video'}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.message}>Camera permission is required to capture photos and video.</Text>
            <Pressable
              style={({ pressed }) => [styles.cameraButton, pressed && styles.cameraButtonPressed]}
              onPress={() => {
                void requestCapturePermissions();
              }}
            >
              <Text style={styles.cameraButtonText}>Grant Camera Permission</Text>
            </Pressable>
          </>
        )}
        {cameraError.length > 0 && <Text style={styles.errorBody}>{cameraError}</Text>}
      </View>

      {selectedFile && (
        <View style={styles.card}>
          <Text style={styles.label}>Selected File</Text>
          <Text style={styles.value}>{selectedFile.name}</Text>
          <Text style={styles.label}>Mime Type</Text>
          <Text style={styles.timestamp}>{selectedFile.mimeType}</Text>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.timestamp}>
            {selectedFile.sizeBytes !== null ? `${selectedFile.sizeBytes} bytes` : 'Unknown'}
          </Text>
          {selectedFile.mimeType.startsWith('image/') && (
            <Image source={{ uri: selectedFile.uri }} style={styles.photoPreview} />
          )}
        </View>
      )}

      {uploadState === 'loading' && (
        <View style={styles.card}>
          <ActivityIndicator size="small" color="#1d4ed8" />
          <Text style={styles.message}>Initializing upload session...</Text>
        </View>
      )}

      {uploadState === 'ready' && uploadData && (
        <View style={styles.card}>
          <Text style={styles.label}>Upload Status</Text>
          <Text style={styles.value}>{uploadData.status}</Text>
          <Text style={styles.label}>Upload Id</Text>
          <Text style={styles.timestamp}>{uploadData.upload_id}</Text>
          <Text style={styles.label}>Expires At</Text>
          <Text style={styles.timestamp}>{uploadData.expires_at_utc}</Text>
          {uploadSession && (
            <>
              <Text style={styles.label}>Bytes</Text>
              <Text style={styles.timestamp}>
                {uploadSession.bytes_received} / {uploadSession.expected_size_bytes}
              </Text>
              {uploadSession.payload_hash && (
                <>
                  <Text style={styles.label}>Payload Hash</Text>
                  <Text style={styles.hashValue}>{uploadSession.payload_hash}</Text>
                </>
              )}
            </>
          )}
        </View>
      )}

      {uploadState === 'error' && (
        <View style={styles.cardError}>
          <Text style={styles.errorTitle}>Upload init failed</Text>
          <Text style={styles.errorBody}>{uploadError}</Text>
        </View>
      )}

      {chunkState === 'loading' && (
        <View style={styles.card}>
          <ActivityIndicator size="small" color="#b45309" />
          <Text style={styles.message}>Uploading file in chunks...</Text>
        </View>
      )}

      {chunkState === 'ready' && chunkData && (
        <View style={styles.card}>
          <Text style={styles.label}>Chunk Upload Status</Text>
          <Text style={styles.value}>{chunkData.status}</Text>
          <Text style={styles.label}>Bytes Received</Text>
          <Text style={styles.timestamp}>{chunkData.bytes_received}</Text>
          <Text style={styles.label}>Remaining</Text>
          <Text style={styles.timestamp}>{chunkData.remaining_bytes}</Text>
          {chunkData.payload_hash && (
            <>
              <Text style={styles.label}>Payload Hash</Text>
              <Text style={styles.hashValue}>{chunkData.payload_hash}</Text>
            </>
          )}
          {uploadSession && (
            <>
              <Text style={styles.label}>Session State</Text>
              <Text style={styles.timestamp}>{uploadSession.status}</Text>
            </>
          )}
        </View>
      )}

      {chunkState === 'error' && (
        <View style={styles.cardError}>
          <Text style={styles.errorTitle}>Chunk upload failed</Text>
          <Text style={styles.errorBody}>{chunkError}</Text>
        </View>
      )}

      <Pressable
        disabled={healthState !== 'ready' || uploadState === 'loading' || chunkState === 'loading'}
        style={({ pressed }) => [
          styles.pickButton,
          pressed && styles.pickButtonPressed,
          (healthState !== 'ready' || uploadState === 'loading' || chunkState === 'loading') &&
            styles.buttonDisabled,
        ]}
        onPress={() => {
          void pickUploadFile();
        }}
      >
        <Text style={styles.pickButtonText}>Select File</Text>
      </Pressable>

      <Pressable
        disabled={
          healthState !== 'ready' ||
          !selectedFile ||
          uploadState === 'loading' ||
          chunkState === 'loading'
        }
        style={({ pressed }) => [
          styles.initButton,
          pressed && styles.initButtonPressed,
          (healthState !== 'ready' ||
            !selectedFile ||
            uploadState === 'loading' ||
            chunkState === 'loading') &&
            styles.buttonDisabled,
        ]}
        onPress={() => {
          void initializeUpload();
        }}
      >
        <Text style={styles.initButtonText}>
          {uploadState === 'loading' ? 'Initializing...' : 'Initialize Upload'}
        </Text>
      </Pressable>

      <Pressable
        disabled={!uploadData || !selectedFile || chunkState === 'loading' || uploadState !== 'ready'}
        style={({ pressed }) => [
          styles.chunkButton,
          pressed && styles.chunkButtonPressed,
          (!uploadData || !selectedFile || chunkState === 'loading' || uploadState !== 'ready') &&
            styles.buttonDisabled,
        ]}
        onPress={() => {
          void uploadFileInChunks();
        }}
      >
        <Text style={styles.chunkButtonText}>
          {chunkState === 'loading' ? 'Uploading Chunks...' : 'Upload Selected File'}
        </Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
        onPress={() => {
          void fetchHealth();
        }}
      >
        <Text style={styles.retryButtonText}>Retry Health Check</Text>
      </Pressable>

      <Text style={styles.endpoint}>Health: {HEALTH_ENDPOINT}</Text>
      <Text style={styles.endpoint}>Upload Init: {UPLOAD_INIT_ENDPOINT}</Text>
      <Text style={styles.endpoint}>
        Upload Status:{' '}
        {uploadData ? uploadStatusEndpoint(uploadData.upload_id) : `${API_BASE_URL}/uploads/{upload_id}`}
      </Text>
      <Text style={styles.endpoint}>
        Upload Chunks:{' '}
        {uploadData
          ? uploadChunksEndpoint(uploadData.upload_id, 0)
          : `${API_BASE_URL}/uploads/{upload_id}/chunks?offset=0`}
      </Text>
      <Text style={styles.endpoint}>
        Upload Hash:{' '}
        {uploadData ? `${API_BASE_URL}/uploads/${uploadData.upload_id}/hash` : `${API_BASE_URL}/uploads/{upload_id}/hash`}
      </Text>
      <StatusBar style="dark" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4efe6',
  },
  contentContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 36,
    gap: 14,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1f2937',
    letterSpacing: 0.4,
  },
  subtitle: {
    fontSize: 14,
    color: '#4b5563',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    padding: 16,
    gap: 6,
    alignItems: 'center',
  },
  cardError: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff1f2',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fecdd3',
    padding: 16,
    gap: 8,
  },
  cameraPreview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  cameraView: {
    flex: 1,
  },
  cameraControls: {
    marginTop: 8,
    gap: 8,
    alignItems: 'center',
    width: '100%',
  },
  cameraToggle: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  cameraToggleButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  cameraToggleButtonActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  cameraToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: 0.2,
  },
  cameraToggleTextActive: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f9fafb',
    letterSpacing: 0.2,
  },
  message: {
    fontSize: 14,
    color: '#374151',
    marginTop: 6,
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: '#6b7280',
    marginTop: 2,
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  timestamp: {
    fontSize: 12,
    color: '#374151',
    textAlign: 'center',
  },
  hashValue: {
    fontSize: 11,
    color: '#374151',
    textAlign: 'center',
  },
  photoPreview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    marginTop: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9f1239',
  },
  errorBody: {
    fontSize: 13,
    color: '#881337',
  },
  retryButton: {
    backgroundColor: '#0f766e',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  cameraButton: {
    backgroundColor: '#0f766e',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  cameraStopButton: {
    backgroundColor: '#b91c1c',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  pickButton: {
    backgroundColor: '#065f46',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  initButton: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  chunkButton: {
    backgroundColor: '#b45309',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  retryButtonPressed: {
    opacity: 0.86,
  },
  cameraButtonPressed: {
    opacity: 0.86,
  },
  pickButtonPressed: {
    opacity: 0.86,
  },
  initButtonPressed: {
    opacity: 0.86,
  },
  chunkButtonPressed: {
    opacity: 0.86,
  },
  retryButtonText: {
    color: '#ecfeff',
    fontWeight: '700',
    fontSize: 14,
  },
  cameraButtonText: {
    color: '#ecfeff',
    fontWeight: '700',
    fontSize: 14,
  },
  initButtonText: {
    color: '#dbeafe',
    fontWeight: '700',
    fontSize: 14,
  },
  pickButtonText: {
    color: '#d1fae5',
    fontWeight: '700',
    fontSize: 14,
  },
  chunkButtonText: {
    color: '#ffedd5',
    fontWeight: '700',
    fontSize: 14,
  },
  endpoint: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
});
