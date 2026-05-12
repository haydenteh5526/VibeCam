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


  if (!camPerm?.granted) return (
    <View style={c.bg}><StatusBar style="light" /><View style={c.mid}>
      <Text style={c.permH}>Allow Camera</Text>
      <Text style={c.permP}>VibeCam needs camera access to take photos and record video.</Text>
      <Pressable style={c.permBtn} onPress={requestCam}><Text style={c.permBtnT}>Allow</Text></Pressable>
    </View></View>
  );

  if (screen === 'gallery') return (
    <View style={c.bg}><StatusBar style="light" />
      <View style={c.navRow}><Pressable onPress={reset}><Text style={c.navL}>‹</Text></Pressable><Text style={c.navT}>Uploads</Text><View style={{ width: 28 }} /></View>
      {gallery.length === 0 ? <View style={c.mid}><Text style={c.dim}>Nothing here yet</Text></View> : (
        <FlatList data={gallery} numColumns={3} keyExtractor={i => i.upload_id} contentContainerStyle={{ padding: 1 }} renderItem={({ item }) => (
          <View style={c.gCell}><View style={c.gInner}>{item.mime_type.startsWith('video/') && <Text style={c.gVid}>▶</Text>}</View></View>
        )} />
      )}
    </View>
  );

  if (screen === 'done') return (
    <View style={c.bg}><StatusBar style="light" /><View style={c.mid}>
      <View style={c.okCircle}><Text style={c.okMark}>✓</Text></View>
      <Text style={c.okTitle}>Done</Text>
      {hash && <Text style={c.okHash}>{hash.slice(0, 16)}</Text>}
      <View style={c.okRow}>
        <Pressable style={c.okBtn} onPress={openGallery}><Text style={c.okBtnT}>Uploads</Text></Pressable>
        <Pressable style={c.okBtnW} onPress={reset}><Text style={c.okBtnWT}>New</Text></Pressable>
      </View>
    </View></View>
  );

  if (screen === 'uploading') return (
    <View style={c.bg}><StatusBar style="light" /><View style={c.mid}>
      <Text style={c.upNum}>{Math.round(progress * 100)}%</Text>
      <View style={c.upBar}><View style={[c.upFill, { width: `${progress * 100}%` }]} /></View>
    </View></View>
  );

  if (screen === 'preview' && file) {
    const isVid = file.mimeType.startsWith('video/');
    return (
      <View style={c.bg}><StatusBar style="light" />
        {isVid && captured ? <VidPrev uri={captured} /> : captured ? <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        <View style={c.pTop}><Pressable onPress={reset} style={c.pClose}><Text style={c.pCloseT}>✕</Text></Pressable></View>
        <View style={c.pBot}>
          <View style={c.pRow}>
            <Pressable onPress={saveToRoll} style={c.pAct}><Text style={c.pActT}>Save</Text></Pressable>
            <Pressable onPress={share} style={c.pAct}><Text style={c.pActT}>Share</Text></Pressable>
            <Pressable onPress={upload} style={[c.pUp, !backend && c.dis]} disabled={!backend}><Text style={c.pUpT}>Upload</Text></Pressable>
          </View>
        </View>
      </View>
    );
  }


  // ─── Camera ──────────────────────────────────────────────────────────────
  return (
    <View style={c.bg}><StatusBar style="light" />
      {/* Viewfinder — full width, takes all space above bottom bar */}
      <Pressable style={c.vf} onPress={onTapFocus}
        onTouchMove={e => onPinch(e as unknown as { nativeEvent: { touches: Array<{ pageX: number; pageY: number }> } })}
        onTouchEnd={onPinchEnd}>
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} zoom={zoom}
          mode={mode === 'video' ? 'video' : 'picture'} videoQuality="720p"
          onCameraReady={() => setReady(true)} onMountError={e => setErr(e.message)} />

        {/* Focus indicator */}
        {focusXY && <Animated.View style={[c.focus, { left: focusXY.x - 32, top: focusXY.y - 32, opacity: focusAnim, transform: [{ scale: focusAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]} />}

        {/* Zoom indicator */}
        {zoom > 0.01 && <View style={c.zBadge}><Text style={c.zT}>{(1 + zoom * 7).toFixed(1)}×</Text></View>}

        {/* Recording indicator */}
        {recording && <View style={c.recPill}><View style={c.recDot} /><Text style={c.recT}>{String(Math.floor(recSec / 60)).padStart(2, '0')}:{String(recSec % 60).padStart(2, '0')}</Text></View>}

        {/* Countdown */}
        {countdown !== null && <View style={c.countBg}><Text style={c.countN}>{countdown}</Text></View>}
      </Pressable>

      {/* Top bar — inside safe area, over viewfinder */}
      <View style={c.topBar}>
        <Pressable onPress={toggleFlash} style={c.topI}>
          <View style={[c.flashDot, flash === 'on' && c.flashOn]} />
        </Pressable>
        <Pressable onPress={cycleTimer} style={c.topI}>
          <Text style={[c.topTxt, timer > 0 && c.topTxtOn]}>{timer > 0 ? `${timer}s` : 'Off'}</Text>
        </Pressable>
        <Pressable onPress={flip} style={c.topI}>
          <View style={c.flipCircle}><View style={c.flipArrow} /></View>
        </Pressable>
      </View>

      {/* Bottom bar */}
      <View style={c.bot}>
        {/* Mode selector */}
        <View style={c.modes}>
          <Pressable onPress={() => !recording && setMode('photo')}>
            <Text style={[c.modeT, mode === 'photo' && c.modeTOn]}>PHOTO</Text>
          </Pressable>
          <Pressable onPress={() => !recording && setMode('video')}>
            <Text style={[c.modeT, mode === 'video' && c.modeTOn]}>VIDEO</Text>
          </Pressable>
        </View>

        {/* Shutter row */}
        <View style={c.shutterRow}>
          {/* Thumbnail */}
          <Pressable onPress={lastThumb ? openGallery : pickFile} style={c.thumb}>
            {lastThumb ? <Image source={{ uri: lastThumb }} style={c.thumbImg} /> : <View style={c.thumbPh} />}
          </Pressable>

          {/* Shutter button */}
          <Pressable onPress={onShutter} onPressIn={onPressIn} onPressOut={onPressOut} disabled={!ready}>
            <Animated.View style={[c.shOuter, { transform: [{ scale: shutterAnim }] }, recording && c.shOuterRec]}>
              <View style={[c.shInner, recording && c.shInnerRec]} />
            </Animated.View>
          </Pressable>

          {/* Flip button */}
          <Pressable onPress={flip} style={c.botFlip}>
            <View style={c.botFlipInner} />
          </Pressable>
        </View>
      </View>

      {err.length > 0 && <View style={c.toast}><Text style={c.toastT}>{err}</Text></View>}
    </View>
  );
}

function VidPrev({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} />;
}


const c = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  mid: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  dim: { color: 'rgba(255,255,255,0.35)', fontSize: 15 },

  // Permission
  permH: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 10 },
  permP: { color: 'rgba(255,255,255,0.55)', fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  permBtn: { backgroundColor: '#fff', paddingVertical: 13, paddingHorizontal: 36, borderRadius: 24 },
  permBtnT: { color: '#000', fontSize: 16, fontWeight: '600' },

  // Viewfinder
  vf: { flex: 1 },
  focus: { position: 'absolute', width: 64, height: 64, borderWidth: 1, borderColor: '#FFD60A', borderRadius: 1 },
  zBadge: { position: 'absolute', bottom: 20, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  zT: { color: '#FFD60A', fontSize: 12, fontWeight: '700' },
  recPill: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 6 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  recT: { color: '#FF3B30', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', alignItems: 'center' },
  countN: { fontSize: 72, fontWeight: '100', color: '#fff' },

  // Top bar
  topBar: { position: 'absolute', top: 52, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 28, alignItems: 'center' },
  topI: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  flashDot: { width: 5, height: 16, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  flashOn: { backgroundColor: '#FFD60A' },
  topTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  topTxtOn: { color: '#FFD60A' },
  flipCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  flipArrow: { width: 6, height: 6, borderTopWidth: 1.5, borderRightWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '45deg' }] },

  // Bottom
  bot: { backgroundColor: '#000', paddingTop: 10, paddingBottom: 34 },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 18 },
  modeT: { fontSize: 12, fontWeight: '600', letterSpacing: 1, color: 'rgba(255,255,255,0.35)' },
  modeTOn: { color: '#FFD60A' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 24 },

  // Thumbnail
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbPh: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)' },

  // Shutter
  shOuter: { width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shOuterRec: { borderColor: 'rgba(255,255,255,0.3)' },
  shInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },
  shInnerRec: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#FF3B30' },

  // Bottom flip
  botFlip: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  botFlipInner: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },

  // Toast
  toast: { position: 'absolute', top: 100, left: 16, right: 16, backgroundColor: 'rgba(255,59,48,0.9)', borderRadius: 10, padding: 10 },
  toastT: { color: '#fff', fontSize: 13, textAlign: 'center' },

  // Preview
  pTop: { position: 'absolute', top: 52, left: 16 },
  pClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  pCloseT: { color: '#fff', fontSize: 15, fontWeight: '300' },
  pBot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  pRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  pAct: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
  pActT: { color: '#fff', fontSize: 14, fontWeight: '500' },
  pUp: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 20, backgroundColor: '#fff' },
  pUpT: { color: '#000', fontSize: 14, fontWeight: '600' },

  // Upload
  upNum: { fontSize: 44, fontWeight: '200', color: '#fff', marginBottom: 16 },
  upBar: { width: '60%', height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  upFill: { height: '100%', backgroundColor: '#fff' },

  // Done
  okCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#30D158', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  okMark: { fontSize: 28, color: '#30D158' },
  okTitle: { fontSize: 20, fontWeight: '500', color: '#fff', marginBottom: 6 },
  okHash: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 28 },
  okRow: { flexDirection: 'row', gap: 12 },
  okBtn: { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  okBtnT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  okBtnW: { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#fff' },
  okBtnWT: { color: '#000', fontSize: 15, fontWeight: '600' },

  // Gallery
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 8 },
  navL: { fontSize: 28, color: '#fff', fontWeight: '300' },
  navT: { fontSize: 17, fontWeight: '600', color: '#fff' },
  gCell: { width: W / 3, aspectRatio: 1, padding: 0.5 },
  gInner: { flex: 1, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  gVid: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },

  dis: { opacity: 0.35 },
});
