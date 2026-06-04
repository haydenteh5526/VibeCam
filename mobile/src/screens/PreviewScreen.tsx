import React, { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { VideoPreview } from '../components/VideoPreview';
import { gradeWithVibe } from '../services/api';
import type { SelectedFile } from '../types';

type Props = {
  file: SelectedFile;
  captured: string | null;
  backendReady: boolean;
  onClose: () => void;
  onSave: () => void;
  onShare: () => void;
  onUpload: () => void;
  onDelete: () => void;
};

export function PreviewScreen({ file, captured, backendReady, onClose, onSave, onShare, onUpload, onDelete }: Props) {
  const isVid = file.mimeType.startsWith('video/');
  const translateY = useRef(new Animated.Value(0)).current;
  const [vibe, setVibe] = useState('');
  const [vibeLoading, setVibeLoading] = useState(false);
  const [vibeResult, setVibeResult] = useState<string | null>(null);
  const [displayUri, setDisplayUri] = useState(captured);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 15 && Math.abs(g.dx) < 30,
    onPanResponderMove: (_, g) => { translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.5) { Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(onClose); }
      else { Animated.spring(translateY, { toValue: 0, friction: 7, useNativeDriver: true }).start(); }
    },
  })).current;

  const applyVibe = async () => {
    if (!vibe.trim() || !captured) return;
    setVibeLoading(true);
    try {
      const result = await gradeWithVibe(captured, vibe.trim());
      setDisplayUri(result.gradedUri);
      setVibeResult(result.styleName);
    } catch { /* fallback: keep original */ }
    finally { setVibeLoading(false); }
  };

  return (
    <Animated.View style={[s.bg, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <StatusBar style="light" />
      {isVid && displayUri ? <VideoPreview uri={displayUri} /> : displayUri ? <Image source={{ uri: displayUri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}

      {/* Top bar */}
      <View style={s.top}>
        <Pressable onPress={onClose} style={s.pill}><Text style={s.pillT}>Close</Text></Pressable>
        <Pressable onPress={onDelete} style={s.pillDanger}><Text style={s.pillDangerT}>Delete</Text></Pressable>
      </View>

      {/* Vibe result badge */}
      {vibeResult && <View style={s.vibeBadge}><Text style={s.vibeBadgeT}>{vibeResult}</Text></View>}

      {/* Bottom */}
      <View style={s.bot}>
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
          <Pressable onPress={applyVibe} style={[s.vibeBtn, (!vibe.trim() || vibeLoading) && s.dis]} disabled={!vibe.trim() || vibeLoading}>
            {vibeLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.vibeBtnT}>Grade</Text>}
          </Pressable>
        </View>

        {/* Actions */}
        <View style={s.row}>
          <Pressable onPress={onSave} style={s.act}><Text style={s.actT}>Save</Text></Pressable>
          <Pressable onPress={onShare} style={s.act}><Text style={s.actT}>Share</Text></Pressable>
          <Pressable onPress={onUpload} style={[s.up, !backendReady && s.dis]} disabled={!backendReady}><Text style={s.upT}>Upload</Text></Pressable>
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
  vibeBadge: { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: 'rgba(28,28,30,0.9)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  vibeBadgeT: { color: '#FFD60A', fontSize: 12, fontWeight: '600' },
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 40, gap: 12 },
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
