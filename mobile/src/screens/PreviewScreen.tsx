import React, { useEffect, useRef } from 'react';
import { Animated, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { VideoPreview } from '../components/VideoPreview';
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
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => { Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start(); }, [fade]);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 15 && Math.abs(g.dx) < 30,
    onPanResponderMove: (_, g) => { translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.5) { Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(onClose); }
      else { Animated.spring(translateY, { toValue: 0, friction: 7, useNativeDriver: true }).start(); }
    },
  })).current;

  return (
    <Animated.View style={[s.bg, { opacity: fade, transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <StatusBar style="light" />
      {isVid && captured ? <VideoPreview uri={captured} /> : captured ? <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}

      {/* Top bar */}
      <View style={s.top}>
        <Pressable onPress={onClose} style={({ pressed }) => [s.pill, pressed && s.pressed]}><Text style={s.pillT}>✕ Close</Text></Pressable>
        <Pressable onPress={onDelete} style={({ pressed }) => [s.pillDanger, pressed && s.pressed]}><Text style={s.pillDangerT}>Delete</Text></Pressable>
      </View>

      {/* Bottom actions */}
      <View style={s.bot}>
        <View style={s.actions}>
          <Pressable onPress={onSave} style={({ pressed }) => [s.actBtn, pressed && s.pressed]}><Text style={s.actT}>↓ Save</Text></Pressable>
          <Pressable onPress={onShare} style={({ pressed }) => [s.actBtn, pressed && s.pressed]}><Text style={s.actT}>↗ Share</Text></Pressable>
        </View>
        <Pressable onPress={onUpload} style={({ pressed }) => [s.uploadBtn, pressed && s.pressed, !backendReady && s.dis]} disabled={!backendReady}>
          <Text style={s.uploadT}>Upload to Cloud</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b' },
  top: { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(24,24,27,0.85)', borderWidth: 1, borderColor: '#27272a' },
  pillT: { color: '#a1a1aa', fontSize: 13, fontWeight: '500' },
  pillDanger: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  pillDangerT: { color: '#ef4444', fontSize: 13, fontWeight: '500' },
  pressed: { opacity: 0.7 },
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 40, gap: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  actBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', alignItems: 'center' },
  actT: { color: '#fafafa', fontSize: 13, fontWeight: '500' },
  uploadBtn: { paddingVertical: 13, borderRadius: 8, backgroundColor: '#fafafa', alignItems: 'center' },
  uploadT: { color: '#09090b', fontSize: 14, fontWeight: '600' },
  dis: { opacity: 0.35 },
});
