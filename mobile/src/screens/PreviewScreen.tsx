import React, { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { VideoPreview } from '../components/VideoPreview';
import { DevelopingOverlay } from '../components/DevelopingOverlay';
import { FILTERS, type FilterId } from '../filters';
import type { SelectedFile } from '../types';
import type { GradeState } from '../../App';

type Props = {
  file: SelectedFile;
  captured: string | null;
  /** Ungraded frame — re-grading always starts from this so looks never stack. */
  original: string | null;
  backendReady: boolean;
  cloudEnabled: boolean;
  grade: GradeState;
  saved: boolean;
  busy: boolean;
  canDevelop: boolean;
  selectedCamera: string;
  error: string;
  notice: string;
  onVibe: (vibe: string) => void;
  onRegrade: (camera: FilterId | 'auto') => void;
  onClose: () => void;
  onSave: () => void;
  onShare: () => void;
  onUpload: () => void;
  onDelete: () => void;
};

export function PreviewScreen({
  file, captured, original, backendReady, cloudEnabled, grade, saved, busy, canDevelop, selectedCamera, error, notice, onVibe,
  onRegrade, onClose, onSave, onShare, onUpload, onDelete,
}: Props) {
  const isVid = file.mimeType.startsWith('video/');
  const [vibe, setVibe] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = selectedCamera;
  const displayUri = showOriginal ? original : captured;
  const canRegrade = !!original && !busy;
  const canVibe = !!original && backendReady && !busy && !!vibe.trim();
  const applyVibe = () => { if (canVibe) onVibe(vibe.trim()); };
  const pickCamera = (id: FilterId | 'auto') => { if (canRegrade && (id === 'original' || canDevelop)) onRegrade(id); };
  const statusLabel = grade.kind === 'grading' ? 'Developing...'
    : grade.kind === 'graded' ? grade.name : 'Original';

  return (
    <View style={s.bg}>
      <StatusBar style="light" />
      <View style={StyleSheet.absoluteFill}>
        {isVid && displayUri ? (
          <VideoPreview uri={displayUri} />
        ) : displayUri ? (
          <Image source={{ uri: displayUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : null}
      </View>

      {/* Darkroom overlay while the shot is being rendered */}
      {grade.kind === 'grading' && <DevelopingOverlay label="Developing" />}

      {/* Top bar */}
      <View style={s.top}>
        <Pressable accessibilityRole="button" onPress={onClose} disabled={busy} style={[s.pill, busy && s.dis]}><Text style={s.pillT}>Close</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} disabled={busy} style={[s.pillDanger, busy && s.dis]}><Text style={s.pillDangerT}>Delete</Text></Pressable>
      </View>

      {/* Status: which look is applied, or why none is */}
      {statusLabel && (
        <View style={s.badge}>
          {grade.kind === 'grading' && <ActivityIndicator size="small" color="#FFD60A" />}
          <Text style={s.badgeT}>{statusLabel}</Text>
        </View>
      )}

      {/* Saved-to-camera-roll confirmation */}
      {saved && !busy && <View style={s.savedTag}><Text style={s.savedTagT}>{Platform.OS === 'web' ? 'Download started' : 'Saved to Photos'}</Text></View>}

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
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {confirmDelete && <View style={s.confirm}>
          <Text style={s.notice}>Delete this {isVid ? 'clip' : 'photo'} and its original from Film Roll? Copies saved to Photos stay there.</Text>
          <View style={s.row}>
            <Pressable onPress={() => setConfirmDelete(false)} disabled={busy} style={s.act}><Text style={s.actT}>Keep</Text></Pressable>
            <Pressable onPress={onDelete} disabled={busy} style={s.pillDanger}><Text style={s.pillDangerT}>Delete from roll</Text></Pressable>
          </View>
        </View>}
        {/* Re-grade with any camera, without reshooting */}
        {(
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
              {cloudEnabled && <Pressable
                onPress={() => pickCamera('auto')}
                disabled={!canRegrade || !canDevelop}
                accessibilityRole="button"
                style={[s.chip, selected === 'auto' && s.chipOn, (!canRegrade || !canDevelop) && s.dis]}
              >
                <View style={[s.dot, { backgroundColor: '#22c55e' }]} />
                <Text style={[s.chipT, selected === 'auto' && s.chipTOn]}>Auto</Text>
              </Pressable>}
              {FILTERS.map(f => (
                <Pressable
                  key={f.id}
                  onPress={() => pickCamera(f.id)}
                  disabled={!canRegrade || (f.id !== 'original' && !canDevelop)}
                  accessibilityRole="button"
                  style={[s.chip, selected === f.id && s.chipOn, (!canRegrade || (f.id !== 'original' && !canDevelop)) && s.dis]}
                >
                  <View style={[s.dot, { backgroundColor: f.dot }]} />
                  <Text style={[s.chipT, selected === f.id && s.chipTOn]}>{f.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={s.hint}>
              {!original ? 'Original unavailable; this saved edit can still be exported.' : canDevelop ? isVid ? 'Tap a camera to style this video' : 'Tap a camera to re-develop this shot' : cloudEnabled ? 'Connect to change the look' : 'Camera looks are available in the iPhone app'}
            </Text>
          </>
        )}

        {/* Vibe input */}
        {cloudEnabled && !isVid && original && backendReady && <View style={s.vibeRow}>
          <TextInput
            style={s.vibeInput}
            editable={!busy}
            maxLength={300}
            accessibilityLabel="Describe a vibe"
            placeholder="Describe a vibe... (e.g. warm nostalgic sunset)"
            placeholderTextColor="#636366"
            value={vibe}
            onChangeText={setVibe}
            returnKeyType="go"
            onSubmitEditing={applyVibe}
          />
          <Pressable onPress={applyVibe} style={[s.vibeBtn, (!canVibe) && s.dis]} disabled={!canVibe}>
            <Text style={s.vibeBtnT}>Grade</Text>
          </Pressable>
        </View>}

        {/* Actions */}
        <View style={s.row}>
          <Pressable accessibilityRole="button" onPress={onSave} style={[s.act, (busy || saved) && s.dis]} disabled={busy || saved}>
            <Text style={s.actT}>{saved ? 'Saved ✓' : Platform.OS === 'web' ? 'Download' : 'Save'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onShare} style={[s.act, busy && s.dis]} disabled={busy}><Text style={s.actT}>Share</Text></Pressable>
          {cloudEnabled && <Pressable accessibilityRole="button" onPress={onUpload} style={[s.up, (!backendReady || busy) && s.dis]} disabled={!backendReady || busy}><Text style={s.upT}>Upload</Text></Pressable>}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  error: { color: '#ff9b9b', backgroundColor: '#291616', borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 17 },
  notice: { color: '#d1d1d6', fontSize: 12, lineHeight: 17 },
  confirm: { backgroundColor: '#1c1c1e', borderRadius: 10, padding: 12, gap: 10 },
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
