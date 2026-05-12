import React from 'react';
import { StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} />;
}
