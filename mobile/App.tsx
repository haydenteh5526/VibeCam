import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, FlatList, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Audio, Video, ResizeMode } from 'expo-av';
import { CameraView, CameraType, FlashMode, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';

type UploadInitResponse = { status: 'accepted'; upload_id: string; max_size_bytes: number; expires_at_utc: string };
type UploadChunkResponse = { status: 'partial' | 'ingested'; upload_id: string; expected_size_bytes: number; bytes_received: number; remaining_bytes: number; next_offset: number; ingested_at_utc: string | null; payload_hash?: string | null };
type GalleryItem = { upload_id: string; file_name: string; mime_type: string; status: string; size_bytes: number; bytes_received: number; ingested_at_utc: string | null };
type SelectedFile = { uri: string; name: string; mimeType: string; sizeBytes: number | null };
type CaptureMode = 'photo' | 'video';
type AppScreen = 'onboarding' | 'camera' | 'preview' | 'uploading' | 'done' | 'gallery' | 'settings';
type FilterType = 'none' | 'warm' | 'cool' | 'mono';

const { width: W } = Dimensions.get('window');
const RED = '#E63946';
const DEFAULT_API = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const API = (() => { const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE_URL; return v && v.trim().length > 0 ? v.trim() : DEFAULT_API; })();
const CHUNK = 256 * 1024;

const resolveSize = async (f: SelectedFile): Promise<number> => {
  if (f.sizeBytes !== null) return f.sizeBytes;
  const fi = new File(f.uri).info();
  if (fi.exists && typeof fi.size === 'number' && fi.size > 0) return fi.size;
  const fb = new Uint8Array(await (await fetch(f.uri)).arrayBuffer()).length;
  if (fb <= 0) throw new Error('Empty file'); return fb;
};
const fmt = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const FILTERS: { id: FilterType; label: string; style: object }[] = [
  { id: 'none', label: 'Original', style: {} },
  { id: 'warm', label: 'Warm', style: { tintColor: '#ff9f43', opacity: 0.88 } },
  { id: 'cool', label: 'Cool', style: { tintColor: '#74b9ff', opacity: 0.88 } },
  { id: 'mono', label: 'B&W', style: { tintColor: '#636e72', opacity: 0.9 } },
];


export default function App() {
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [screen, setScreen] = useState<AppScreen>('onboarding');
  const [backend, setBackend] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [timer, setTimer] = useState(0); // 0, 3, 10
  const [countdown, setCountdown] = useState<number | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [filter, setFilter] = useState<FilterType>('none');
  const [showFilters, setShowFilters] = useState(false);
  const [settingsQuality, setSettingsQuality] = useState<'720p' | '1080p'>('720p');
  const cam = useRef<CameraView>(null);
  const shutterAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const lastDist = useRef<number | null>(null);

  useEffect(() => { fetch(`${API}/health`).then(r => { if (r.ok) setBackend(true); }).catch(() => {}); }, []);

  // ─── Camera ──────────────────────────────────────────────────────────────
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

  const onPressIn = useCallback(() => { Animated.spring(shutterAnim, { toValue: 0.85, useNativeDriver: true }).start(); }, [shutterAnim]);
  const onPressOut = useCallback(() => { Animated.spring(shutterAnim, { toValue: 1, useNativeDriver: true }).start(); }, [shutterAnim]);

  const doCapture = useCallback(async () => {
    if (!cam.current || !ready) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const photo = await cam.current.takePictureAsync({ quality: 0.9 });
    if (!photo?.uri) return;
    const fi = new File(photo.uri).info();
    setCaptured(photo.uri); setLastThumb(photo.uri);
    setFile({ uri: photo.uri, name: `photo-${Date.now()}.jpg`, mimeType: 'image/jpeg', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null });
    setScreen('preview');
  }, [ready]);

  const captureWithTimer = useCallback(() => {
    if (timer === 0) { doCapture(); return; }
    setCountdown(timer);
    let t = timer;
    const iv = setInterval(() => { t--; if (t <= 0) { clearInterval(iv); setCountdown(null); doCapture(); } else setCountdown(t); }, 1000);
  }, [timer, doCapture]);

  const startRec = useCallback(async () => {
    if (!cam.current || !ready) return;
    if (!micPerm?.granted) { const r = await requestMic(); if (!r.granted) { setErr('Mic required'); return; } }
    setRecording(true); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const v = await cam.current.recordAsync({ maxDuration: 30 });
      if (!v?.uri) throw new Error('Rec failed');
      const fi = new File(v.uri).info();
      setCaptured(v.uri); setFile({ uri: v.uri, name: `video-${Date.now()}.mp4`, mimeType: 'video/mp4', sizeBytes: fi.exists && typeof fi.size === 'number' ? fi.size : null });
      setScreen('preview');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Rec failed'); }
    finally { setRecording(false); }
  }, [ready, micPerm, requestMic]);

  const stopRec = useCallback(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); cam.current?.stopRecording(); }, []);
  const onShutter = useCallback(() => { if (mode === 'photo') captureWithTimer(); else { if (recording) stopRec(); else startRec(); } }, [mode, recording, captureWithTimer, startRec, stopRec]);

  const pickFile = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: '*/*' });
    if (r.canceled) return; const f = r.assets[0]; const isImg = f.mimeType?.startsWith('image/');
    setCaptured(isImg ? f.uri : f.uri); if (isImg) setLastThumb(f.uri);
    setFile({ uri: f.uri, name: f.name || 'file.bin', mimeType: (f.mimeType || 'application/octet-stream').toLowerCase(), sizeBytes: f.size ?? null });
    setScreen('preview');
  }, []);

  // ─── Save / Share ────────────────────────────────────────────────────────
  const saveToRoll = useCallback(async () => {
    if (!file) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') { setErr('Storage permission required'); return; }
    await MediaLibrary.saveToLibraryAsync(file.uri);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [file]);

  const share = useCallback(async () => {
    if (!file) return;
    if (!(await Sharing.isAvailableAsync())) { setErr('Sharing not available'); return; }
    await Sharing.shareAsync(file.uri);
  }, [file]);

  // ─── Upload ──────────────────────────────────────────────────────────────
  const upload = useCallback(async () => {
    if (!file) return; setScreen('uploading'); setProgress(0); setHash(null); setErr('');
    try {
      const sz = await resolveSize(file);
      const ir = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: file.name, mime_type: file.mimeType, size_bytes: sz }) });
      if (!ir.ok) throw new Error(`Init ${ir.status}`);
      const id = ((await ir.json()) as UploadInitResponse).upload_id;
      const fh = new File(file.uri).open(); let off = 0; let last: UploadChunkResponse | null = null;
      try { while (off < sz) { const c = fh.readBytes(Math.min(CHUNK, sz - off)); if (c.length === 0) throw new Error('Read err'); const r = await fetch(`${API}/uploads/${id}/chunks?offset=${off}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: c }); if (!r.ok) throw new Error(`Up ${r.status}`); last = (await r.json()) as UploadChunkResponse; off = last.next_offset; setProgress(off / sz); } } finally { fh.close(); }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setHash(last?.payload_hash ?? null); setScreen('done');
    } catch (e) { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setErr(e instanceof Error ? e.message : 'Upload failed'); setScreen('preview'); }
  }, [file]);

  const openGallery = useCallback(async () => {
    try { const r = await fetch(`${API}/uploads?status=ingested`); if (r.ok) setGallery((await r.json()) as GalleryItem[]); } catch {} setScreen('gallery');
  }, []);

  const reset = useCallback(() => { setCaptured(null); setFile(null); setProgress(0); setHash(null); setErr(''); setFilter('none'); setShowFilters(false); setScreen('camera'); }, []);


  // ─── Onboarding ──────────────────────────────────────────────────────────
  if (screen === 'onboarding') return (
    <View style={st.splash}><StatusBar style="light" />
      <Text style={st.mark}>V</Text><Text style={st.markSub}>VIBECAM</Text>
      <Text style={st.onbBody}>Capture. Upload. Own your media.</Text>
      <Pressable style={st.pill} onPress={() => { requestCam(); setScreen('camera'); Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start(); }}><Text style={st.pillT}>Get Started</Text></Pressable>
    </View>
  );

  if (!camPerm?.granted) return (
    <View style={st.splash}><StatusBar style="light" /><Text style={st.mark}>V</Text>
      <Text style={st.onbBody}>Camera access is needed to capture.</Text>
      <Pressable style={st.pill} onPress={requestCam}><Text style={st.pillT}>Grant Camera Access</Text></Pressable>
    </View>
  );

  // ─── Settings ───────────────────────────────────────────────────────────
  if (screen === 'settings') return (
    <View style={st.dark}><StatusBar style="light" />
      <View style={st.nav}><Pressable onPress={reset}><Text style={st.navB}>←</Text></Pressable><Text style={st.navT}>Settings</Text><View style={{ width: 32 }} /></View>
      <View style={{ padding: 24, gap: 24 }}>
        <View><Text style={st.setLabel}>Video Quality</Text>
          <View style={st.setRow}>
            <Pressable style={[st.setOpt, settingsQuality === '720p' && st.setOptA]} onPress={() => setSettingsQuality('720p')}><Text style={[st.setOptT, settingsQuality === '720p' && st.setOptTA]}>720p</Text></Pressable>
            <Pressable style={[st.setOpt, settingsQuality === '1080p' && st.setOptA]} onPress={() => setSettingsQuality('1080p')}><Text style={[st.setOptT, settingsQuality === '1080p' && st.setOptTA]}>1080p</Text></Pressable>
          </View>
        </View>
        <View><Text style={st.setLabel}>Backend</Text><Text style={[st.muted, { marginTop: 4 }]}>{API}</Text><Text style={[st.muted, { color: backend ? '#34d399' : '#f87171' }]}>{backend ? 'Connected' : 'Unreachable'}</Text></View>
        <View><Text style={st.setLabel}>Version</Text><Text style={st.muted}>1.0.0</Text></View>
      </View>
    </View>
  );

  // ─── Gallery ────────────────────────────────────────────────────────────
  if (screen === 'gallery') return (
    <View style={st.dark}><StatusBar style="light" />
      <View style={st.nav}><Pressable onPress={reset}><Text style={st.navB}>←</Text></Pressable><Text style={st.navT}>Uploads</Text><View style={{ width: 32 }} /></View>
      {gallery.length === 0 ? <View style={st.center}><Text style={st.emptyI}>◻</Text><Text style={st.muted}>No uploads yet</Text></View> : (
        <FlatList data={gallery} numColumns={3} keyExtractor={i => i.upload_id} contentContainerStyle={{ padding: 2 }} renderItem={({ item }) => (
          <View style={st.gridItem}><View style={st.gridInner}><Text style={st.gridIcon}>{item.mime_type.startsWith('image/') ? '◻' : '▶'}</Text><Text style={st.gridName} numberOfLines={1}>{item.file_name}</Text></View></View>
        )} />
      )}
    </View>
  );

  // ─── Done ───────────────────────────────────────────────────────────────
  if (screen === 'done') return (
    <View style={st.dark}><StatusBar style="light" /><View style={st.center}>
      <View style={st.doneC}><Text style={st.doneK}>✓</Text></View><Text style={st.doneT}>Uploaded</Text>
      {hash && <Text style={st.hash}>{hash.slice(0, 16)}…</Text>}
      <View style={st.row}><Pressable style={st.btnO} onPress={openGallery}><Text style={st.btnOT}>View All</Text></Pressable><Pressable style={st.btnS} onPress={reset}><Text style={st.btnST}>New Capture</Text></Pressable></View>
    </View></View>
  );

  // ─── Uploading ──────────────────────────────────────────────────────────
  if (screen === 'uploading') return (
    <View style={st.dark}><StatusBar style="light" /><View style={st.center}>
      <View style={st.ring}><Text style={st.pct}>{Math.round(progress * 100)}%</Text></View>
      <Text style={st.upLbl}>UPLOADING</Text><View style={st.trk}><View style={[st.trkF, { width: `${progress * 100}%` }]} /></View>
    </View></View>
  );


  // ─── Preview ─────────────────────────────────────────────────────────────
  if (screen === 'preview' && file) {
    const isImg = file.mimeType.startsWith('image/');
    const isVid = file.mimeType.startsWith('video/');
    const fStyle = FILTERS.find(f => f.id === filter)?.style ?? {};
    return (
      <View style={st.dark}><StatusBar style="light" />
        {isImg && captured ? <Image source={{ uri: captured }} style={[StyleSheet.absoluteFill, fStyle]} resizeMode="cover" /> : isVid && captured ? (
          <Video source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode={ResizeMode.COVER} shouldPlay isLooping useNativeControls={false} />
        ) : <View style={st.center}><Text style={st.fName}>{file.name}</Text><Text style={st.muted}>{file.sizeBytes ? fmt(file.sizeBytes) : ''}</Text></View>}

        {err.length > 0 && <View style={st.errB}><Text style={st.errBT}>{err}</Text></View>}

        {/* Top actions */}
        <View style={st.prevTop}>
          <Pressable onPress={reset}><Text style={st.prevA}>✕</Text></Pressable>
          <Pressable onPress={() => setShowFilters(f => !f)}><Text style={[st.prevA, showFilters && { color: RED }]}>Filters</Text></Pressable>
        </View>

        {/* Filter strip */}
        {showFilters && isImg && (
          <View style={st.filterStrip}>
            {FILTERS.map(f => (
              <Pressable key={f.id} onPress={() => { setFilter(f.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[st.filterChip, filter === f.id && st.filterChipA]}>
                <Text style={[st.filterChipT, filter === f.id && { color: '#fff' }]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Bottom actions */}
        <View style={st.prevBot}>
          <View style={st.prevActions}>
            <Pressable onPress={saveToRoll} style={st.prevActBtn}><Text style={st.prevActIcon}>↓</Text><Text style={st.prevActLabel}>Save</Text></Pressable>
            <Pressable onPress={share} style={st.prevActBtn}><Text style={st.prevActIcon}>↗</Text><Text style={st.prevActLabel}>Share</Text></Pressable>
          </View>
          <Pressable style={[st.upBtn, !backend && st.dis]} disabled={!backend} onPress={upload}><Text style={st.upBtnT}>Upload to Cloud</Text></Pressable>
        </View>
      </View>
    );
  }


  // ─── Camera ──────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[st.cam, { opacity: fadeAnim }]}><StatusBar style="light" />
      <View style={st.camWrap} onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })} onTouchEnd={onPinchEnd}>
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom} mode={mode === 'video' ? 'video' : 'picture'} videoQuality={settingsQuality} onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />
      </View>

      {/* Countdown overlay */}
      {countdown !== null && <View style={st.countWrap}><Text style={st.countT}>{countdown}</Text></View>}

      {/* Zoom indicator */}
      {zoom > 0.01 && <View style={st.zoomBadge}><Text style={st.zoomT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}

      {/* Top bar */}
      <View style={st.topBar}>
        <Pressable onPress={toggleFlash} style={st.topBtn}><View style={[st.flashI, flash === 'on' && st.flashOn]} /></Pressable>
        <Pressable onPress={cycleTimer} style={st.topBtn}><Text style={st.timerT}>{timer > 0 ? `${timer}s` : '⏱'}</Text></Pressable>
        <View style={[st.dot, backend ? st.dotG : st.dotR]} />
        <Pressable onPress={flip} style={st.topBtn}><Text style={st.flipT}>⟲</Text></Pressable>
        <Pressable onPress={() => setScreen('settings')} style={st.topBtn}><Text style={st.flipT}>⚙</Text></Pressable>
      </View>

      {/* Recording badge */}
      {recording && <View style={st.rec}><View style={st.recDot} /><Text style={st.recT}>REC</Text></View>}
      {err.length > 0 && <View style={st.toast}><Text style={st.toastT}>{err}</Text></View>}

      {/* Bottom */}
      <View style={st.bot}>
        <View style={st.modeRow}>
          <Pressable onPress={() => !recording && setMode('photo')}><Text style={[st.modeT, mode === 'photo' && st.modeA]}>PHOTO</Text></Pressable>
          <Pressable onPress={() => !recording && setMode('video')}><Text style={[st.modeT, mode === 'video' && st.modeA]}>VIDEO</Text></Pressable>
        </View>
        <View style={st.botRow}>
          <Pressable onPress={openGallery} style={st.side}>{lastThumb ? <Image source={{ uri: lastThumb }} style={st.sideImg} /> : <View style={st.sideE} />}</Pressable>
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
            <Animated.View style={[st.shOut, { transform: [{ scale: shutterAnim }] }]}><View style={[st.shIn, mode === 'video' && recording && st.shRec]} /></Animated.View>
          </Pressable>
          <Pressable onPress={pickFile} style={st.side}><Text style={st.plus}>＋</Text></Pressable>
        </View>
      </View>
    </Animated.View>
  );
}


const st = StyleSheet.create({
  cam: { flex: 1, backgroundColor: '#000' }, camWrap: { ...StyleSheet.absoluteFillObject },
  dark: { flex: 1, backgroundColor: '#0a0a0a' }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  splash: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  mark: { fontSize: 56, fontWeight: '100', color: '#fff' }, markSub: { fontSize: 11, fontWeight: '600', letterSpacing: 4, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
  onbBody: { fontSize: 15, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 22, marginTop: 16, marginBottom: 36 },
  pill: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 36, borderRadius: 999 }, pillT: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  // Top
  topBar: { position: 'absolute', top: 54, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  topBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  flashI: { width: 4, height: 14, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 2 }, flashOn: { backgroundColor: '#fbbf24' },
  flipT: { fontSize: 16, color: '#fff' }, timerT: { fontSize: 12, color: '#fff', fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 }, dotG: { backgroundColor: '#34d399' }, dotR: { backgroundColor: '#f87171' },
  // Zoom
  zoomBadge: { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  zoomT: { color: '#fff', fontSize: 12, fontWeight: '600' },
  // Countdown
  countWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  countT: { fontSize: 72, fontWeight: '200', color: '#fff' },
  // Rec
  rec: { position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 6 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED }, recT: { fontSize: 11, fontWeight: '700', color: RED, letterSpacing: 1 },
  // Bottom
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 16, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,0.65)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginBottom: 14 },
  modeT: { fontSize: 11, fontWeight: '600', letterSpacing: 1.8, color: 'rgba(255,255,255,0.25)' }, modeA: { color: '#fff' },
  botRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  side: { width: 46, height: 46, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  sideImg: { width: 46, height: 46, borderRadius: 12 }, sideE: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  plus: { fontSize: 20, color: 'rgba(255,255,255,0.6)' },
  shOut: { width: 76, height: 76, borderRadius: 38, borderWidth: 3.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shIn: { width: 60, height: 60, borderRadius: 30, backgroundColor: RED }, shRec: { borderRadius: 8, width: 28, height: 28 },
  // Toast
  toast: { position: 'absolute', top: 110, left: 20, right: 20, backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: 14, padding: 12 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  // Preview
  prevTop: { position: 'absolute', top: 54, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  prevA: { color: '#fff', fontSize: 18, fontWeight: '500' },
  prevBot: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 40, gap: 14 },
  prevActions: { flexDirection: 'row', justifyContent: 'center', gap: 32 },
  prevActBtn: { alignItems: 'center', gap: 4 }, prevActIcon: { fontSize: 22, color: '#fff' }, prevActLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  upBtn: { backgroundColor: '#fff', paddingVertical: 16, borderRadius: 999, alignItems: 'center' }, upBtnT: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  errB: { position: 'absolute', bottom: 160, left: 20, right: 20, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: 12, padding: 10 }, errBT: { color: '#fff', fontSize: 13, textAlign: 'center' },
  fName: { fontSize: 18, fontWeight: '500', color: '#fff', marginBottom: 8 }, muted: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  // Filters
  filterStrip: { position: 'absolute', bottom: 180, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
  filterChipA: { backgroundColor: RED }, filterChipT: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  // Upload
  ring: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  pct: { fontSize: 30, fontWeight: '200', color: '#fff' }, upLbl: { fontSize: 11, fontWeight: '500', letterSpacing: 2.5, color: 'rgba(255,255,255,0.25)', marginBottom: 24 },
  trk: { width: '80%', height: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }, trkF: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  // Done
  doneC: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#34d399', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  doneK: { fontSize: 34, color: '#34d399' }, doneT: { fontSize: 24, fontWeight: '300', color: '#fff', marginBottom: 8 },
  hash: { fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 36 },
  row: { flexDirection: 'row', gap: 12, width: '100%' },
  // Nav
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  navB: { fontSize: 24, color: '#fff' }, navT: { fontSize: 15, fontWeight: '600', color: '#fff' },
  // Gallery grid
  emptyI: { fontSize: 32, color: 'rgba(255,255,255,0.1)', marginBottom: 12 },
  gridItem: { width: W / 3, aspectRatio: 1, padding: 1 },
  gridInner: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  gridIcon: { fontSize: 20, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }, gridName: { fontSize: 9, color: 'rgba(255,255,255,0.4)', paddingHorizontal: 4 },
  // Settings
  setLabel: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 8 },
  setRow: { flexDirection: 'row', gap: 8 },
  setOpt: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' },
  setOptA: { backgroundColor: '#fff' }, setOptT: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '500' }, setOptTA: { color: '#0a0a0a' },
  // Buttons
  btnO: { flex: 1, paddingVertical: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' }, btnOT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  btnS: { flex: 1, paddingVertical: 16, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center' }, btnST: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  dis: { opacity: 0.3 },
});
