import React, { useEffect, useMemo } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createVideoPlaybackGuard } from '../videoPlayback';
export function VideoPreview({ uri, paused = false }: { uri: string; paused?: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.play(); });
  const playback = useMemo(() => createVideoPlaybackGuard(player), [player]);
  useEffect(() => {
    playback.setActive(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    const subscription = AppState.addEventListener('change', state => playback.setActive(state === 'active'));
    return () => subscription.remove();
  }, [playback]);
  useEffect(() => { playback.setOverlay(paused); }, [paused, playback]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />;
}
