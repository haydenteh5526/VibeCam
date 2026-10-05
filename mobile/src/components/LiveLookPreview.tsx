import React, { useEffect } from 'react';
import { Platform, StyleSheet, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { VIDEO_LUTS } from '../look/videoLuts';
import type { LivePreviewProps, LivePreviewStatus } from '../look/livePreview';

type NativeProps = ViewProps & {
  cubeBase64: string;
  onStatus: (event: { nativeEvent: { status: LivePreviewStatus } }) => void;
};
// Old development builds and Expo Go keep their working raw camera preview.
const nativePreviewModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<{ hasLiveColourPreview?: boolean }>('VibeCamVideo') : null;
const ColourView = nativePreviewModule?.hasLiveColourPreview
  ? requireNativeViewManager<NativeProps>('VibeCamVideo') : null;

export function LiveLookPreview({ camera, onStatus }: LivePreviewProps) {
  const cube = VIDEO_LUTS[camera];
  useEffect(() => { onStatus(ColourView && cube ? 'loading' : 'unavailable'); }, [cube, onStatus]);
  if (!ColourView || !cube) return null;
  return <ColourView pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={StyleSheet.absoluteFill} cubeBase64={cube} onStatus={e => onStatus(e.nativeEvent.status)} />;
}
