import React, { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { VideoPreview } from '../components/VideoPreview';
import { DevelopingOverlay } from '../components/DevelopingOverlay';
import { gradeWithVibe } from '../services/api';
import { FILTERS, type FilterId } from '../filters';
import type { SelectedFile } from '../types';
import type { GradeState } from '../../App';

type Props = {
  file: SelectedFile;
  captured: string | null;
  /** Ungraded frame — re-grading always starts from this so looks never stack. */
  original: string | null;
  backendReady: boolean;
  grade: GradeState;
  saved: boolean;
  onRegrade: (camera: FilterId | 'auto') => void;
  onClose: () => void;
  onSave: () => void;
  onShare: () => void;
  onUpload: () => void;
  onDelete: () => void;
};

export function PreviewScreen({
  file, captured, original, backendReady, grade, saved,
  onRegrade, onClose, onSave, onShare, onUpload, onDelete,
}: Props) {
  const isVid = file.mimeType.startsWith('video/');
  const translateY = useRef(new Animated.Value(0)).current;
  const [vibe, setVibe] = useState('');
  const [vibeLoading, setVibeLoading] = useState(false);
  const [vibeResult, setVibeResult] = useState<string | null>(null);
  const [vibeUri, setVibeUri] = useState<string | null>(null);
  const [selected, setSelected] = useState<FilterId | 'auto' | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const busy = grade.kind === 'grading' || vibeLoading;
  // A vibe grade overrides the camera look; press-and-hold shows the untouched frame.
  const displayUri = showOriginal ? original : (vibeUri ?? captured);

  const applyVibe = async () => {
    if (!vibe.trim() || !original) return;
    setVibeLoading(true);
    try {
      const result = await gradeWithVibe(original, vibe.trim());
      setVibeUri(result.gradedUri);
      setVibeResult(result.styleName);
    } catch { /* keep the current image */ }
    finally { setVibeLoading(false); }
  };

  const pickCamera = (id: FilterId | 'auto') => {
    if (busy || !backendReady) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(id);
    setVibeUri(null); setVibeResult(null);   // camera look replaces any vibe grade
    onRegrade(id);
  };

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 15 && Math.abs(g.dx) < 30,
    onPanResponderMove: (_, g) => { translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.5) { Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(onClose); }
      else { Animated.spring(translateY, { toValue: 0, friction: 7, useNativeDriver: true }).start(); }
    },
  })).current;

  const statusLabel = (() => {
    if (grade.kind === 'grading') return 'Developing…';
    if (vibeResult) return vibeResult;
    if (grade.kind === 'graded') return `\uD83D\uDCF7  ${grade.name}`;
    if (grade.kind === 'failed') return 'Ungraded — grading failed';
    if (!backendReady) return 'Ungraded — backend offline';
    return null;
  })();
  const statusWarn = grade.kind === 'failed' || (!backendReady && grade.kind === 'none');

  return (
    <Animated.View style={[s.bg, { transform: [{ translateY }] }]}>
      <StatusBar style="light" />
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        {isVid && displayUri ? (
          <VideoPreview uri={displayUri} />
        ) : displayUri ? (
          <Image source={{ uri: displayUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : null}
      </View>

      {/* Darkroom overlay while the shot is being rendered */}
      {busy && <DevelopingOverlay label={vibeLoading ? 'Grading' : 'Developing'} />}

      {/* Top bar */}
      <View style={s.top}>
        <Pressable onPress={onClose} style={s.pill}><Text style={s.pillT}>Close</Text></Pressable>
        <Pressable onPress={onDelete} style={s.pillDanger}><Text style={s.pillDangerT}>Delete</Text></Pressable>
      </View>

      {/* Status: which look is applied, or why none is */}
      {statusLabel && (
        <View style={[s.badge, statusWarn && s.badgeWarn]}>
          {grade.kind === 'grading' && <ActivityIndicator size="small" color="#FFD60A" />}
          <Text style={[s.badgeT, statusWarn && s.badgeTWarn]}>{statusLabel}</Text>
        </View>
      )}

      {/* Saved-to-camera-roll confirmation */}
      {saved && !busy && <View style={s.savedTag}><Text style={s.savedTagT}>Saved to Photos</Text></View>}

      {/* Hold to compare against the untouched frame */}
      {!isVid && original && captured !== original && (
        <Pressable
          style={s.cmp}
          onPressIn={() => setShowOriginal(true)}
          onPressOut={() => setShowOriginal(false)}
        >
          <Text style={s.cmpT}>{showOriginal ? 'Original' : 'Hold to compare'}</Text>
        </Pressable>
      )}

      {/* Bottom */}
      <View style={s.bot}>
        {/* Re-grade with any camera, without reshooting */}
        {!isVid && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
              <Pressable
                onPress={() => pickCamera('auto')}
                style={[s.chip, selected === 'auto' && s.chipOn, !backendReady && s.dis]}
              >
                <View style={[s.dot, { backgroundColor: '#22c55e' }]} />
                <Text style={[s.chipT, selected === 'auto' && s.chipTOn]}>Auto</Text>
              </Pressable>
              {FILTERS.filter(f => f.id !== 'original').map(f => (
                <Pressable
                  key={f.id}
                  onPress={() => pickCamera(f.id)}
                  style={[s.chip, selected === f.id && s.chipOn, !backendReady && s.dis]}
                >
                  <View style={[s.dot, { backgroundColor: f.dot }]} />
                  <Text style={[s.chipT, selected === f.id && s.chipTOn]}>{f.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={s.hint}>
              {backendReady ? 'Tap a camera to re-develop this shot' : 'Connect the backend to change the look'}
            </Text>
          </>
        )}

        {/* Vibe input */}
        <View style={s.vibeRow}>
          <TextInput
            style={s.vibeInput}
            placeholder="Describe a vibe... (e.g. warm nostalgic sunset)"
            placeholderTextColor="#636366"
            value={vibe}
            onChangeText={setVibe}
            returnKeyType="go"
            onSubmitEditing={applyVibe}
          />
          <Pressable onPress={applyVibe} style={[s.vibeBtn, (!vibe.trim() || busy) && s.dis]} disabled={!vibe.trim() || busy}>
            {vibeLoading ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.vibeBtnT}>Grade</Text>}
          </Pressable>
        </View>

        {/* Actions */}
        <View style={s.row}>
          <Pressable onPress={onSave} style={[s.act, busy && s.dis]} disabled={busy}>
            <Text style={s.actT}>{saved ? 'Saved ✓' : 'Save'}</Text>
          </Pressable>
          <Pressable onPress={onShare} style={[s.act, busy && s.dis]} disabled={busy}><Text style={s.actT}>Share</Text></Pressable>
          <Pressable onPress={onUpload} style={[s.up, (!backendReady || busy) && s.dis]} disabled={!backendReady || busy}><Text style={s.upT}>Upload</Text></Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0c0c0c' },
  top: { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(28,28,30,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  pillT: { color: '#fff', fontSize: 13, fontWeight: '500' },
  pillDanger: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  pillDangerT: { color: '#ef4444', fontSize: 13, fontWeight: '500' },

  badge: { position: 'absolute', top: 100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(28,28,30,0.9)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  badgeWarn: { borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(40,20,20,0.9)' },
  badgeT: { color: '#fff', fontSize: 12, fontWeight: '600' },
  badgeTWarn: { color: '#ff8a8a' },
  savedTag: { position: 'absolute', top: 134, alignSelf: 'center', backgroundColor: 'rgba(28,28,30,0.75)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  savedTagT: { color: '#22c55e', fontSize: 11, fontWeight: '600' },
  cmp: { position: 'absolute', right: 16, top: 170, backgroundColor: 'rgba(28,28,30,0.8)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  cmpT: { color: '#FFD60A', fontSize: 11, fontWeight: '600' },

  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 40, gap: 10 },
  strip: { gap: 8, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(28,28,30,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  chipOn: { borderColor: '#FFD60A', backgroundColor: 'rgba(60,60,62,0.9)' },
  chipT: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
  chipTOn: { color: '#FFD60A' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  hint: { color: '#636366', fontSize: 10, textAlign: 'center' },

  vibeRow: { flexDirection: 'row', gap: 8 },
  vibeInput: { flex: 1, height: 40, backgroundColor: '#1c1c1e', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, color: '#fff', fontSize: 13 },
  vibeBtn: { height: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#FFD60A', alignItems: 'center', justifyContent: 'center' },
  vibeBtnT: { color: '#000', fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8 },
  act: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center' },
  actT: { color: '#fff', fontSize: 13, fontWeight: '500' },
  up: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center' },
  upT: { color: '#000', fontSize: 13, fontWeight: '600' },
  dis: { opacity: 0.35 },
});
