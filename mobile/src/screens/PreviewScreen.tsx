import React, { useRef } from 'react';
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

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 15 && Math.abs(g.dx) < 30,
    onPanResponderMove: (_, g) => { translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 100 || g.vy > 0.5) { Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(onClose); }
      else { Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(); }
    },
  })).current;

  return (
    <Animated.View style={[s.bg, { transform: [{ translateY }] }]} {...panResponder.panHandlers}>
      <StatusBar style="light" />
      {isVid && captured ? <VideoPreview uri={captured} /> : captured ? <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
      <View style={s.top}>
        <Pressable onPress={onClose} style={s.close}><Text style={s.closeT}>✕</Text></Pressable>
        <Pressable onPress={onDelete} style={s.del}><Text style={s.delT}>Delete</Text></Pressable>
      </View>
      <View style={s.bot}>
        <View style={s.row}>
          <Pressable onPress={onSave} style={s.act}><Text style={s.actT}>Save</Text></Pressable>
          <Pressable onPress={onShare} style={s.act}><Text style={s.actT}>Share</Text></Pressable>
          <Pressable onPress={onUpload} style={[s.up, !backendReady && s.dis]} disabled={!backendReady}><Text style={s.upT}>Upload</Text></Pressable>
        </View>
      </View>
      <View style={s.hint}><Text style={s.hintT}>Swipe down to dismiss</Text></View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  closeT: { color: '#fff', fontSize: 15, fontWeight: '300' },
  del: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,59,48,0.8)' },
  delT: { color: '#fff', fontSize: 12, fontWeight: '600' },
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  act: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
  actT: { color: '#fff', fontSize: 14, fontWeight: '500' },
  up: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 20, backgroundColor: '#fff' },
  upT: { color: '#000', fontSize: 14, fontWeight: '600' },
  dis: { opacity: 0.35 },
  hint: { position: 'absolute', bottom: 100, alignSelf: 'center' },
  hintT: { color: 'rgba(255,255,255,0.25)', fontSize: 11 },
});
