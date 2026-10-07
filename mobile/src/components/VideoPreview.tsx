import React, { useEffect } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
export function VideoPreview({ uri, paused = false }: { uri: string; paused?: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  useEffect(() => { if (paused) player.pause(); }, [paused, player]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
    return () => subscription.remove();
  }, [player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />;
}
