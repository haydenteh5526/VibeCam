import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  const [playing, setPlaying] = useState(true);
  useEffect(() => setPlaying(true), [uri]);
  return <View style={StyleSheet.absoluteFill}>
    <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
    <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause video' : 'Play video'}
      onPress={() => { if (playing) player.pause(); else player.play(); setPlaying(!playing); }} style={styles.control}>
      <Text style={styles.controlText}>{playing ? 'Ⅱ  Pause' : '▶  Play'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  control: { position: 'absolute', right: 16, top: 170, backgroundColor: 'rgba(28,28,30,0.85)', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  controlText: { color: '#FFD60A', fontSize: 11, fontWeight: '700' },
});
