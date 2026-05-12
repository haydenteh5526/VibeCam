import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
};

export function PreviewScreen({ file, captured, backendReady, onClose, onSave, onShare, onUpload }: Props) {
  const isVid = file.mimeType.startsWith('video/');
  return (
    <View style={s.bg}><StatusBar style="light" />
      {isVid && captured ? <VideoPreview uri={captured} /> : captured ? <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
      <View style={s.top}><Pressable onPress={onClose} style={s.close}><Text style={s.closeT}>✕</Text></Pressable></View>
      <View style={s.bot}>
        <View style={s.row}>
          <Pressable onPress={onSave} style={s.act}><Text style={s.actT}>Save</Text></Pressable>
          <Pressable onPress={onShare} style={s.act}><Text style={s.actT}>Share</Text></Pressable>
          <Pressable onPress={onUpload} style={[s.up, !backendReady && s.dis]} disabled={!backendReady}><Text style={s.upT}>Upload</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 52, left: 16 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  closeT: { color: '#fff', fontSize: 15, fontWeight: '300' },
  bot: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  act: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)' },
  actT: { color: '#fff', fontSize: 14, fontWeight: '500' },
  up: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 20, backgroundColor: '#fff' },
  upT: { color: '#000', fontSize: 14, fontWeight: '600' },
  dis: { opacity: 0.35 },
});
