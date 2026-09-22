import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { VIDEO_LUTS } from './videoLuts';

type RenderedVideo = { uri: string; thumbnailUri: string | null };
type VideoModule = { renderAsync: (uri: string, camera: string, cubeBase64: string) => Promise<{ uri: string; thumbnailUri: string }> };

const nativeVideo = Platform.OS === 'ios' ? requireOptionalNativeModule<VideoModule>('VibeCamVideo') : null;

export function hasVideoLooks(): boolean { return nativeVideo !== null; }

export async function developVideoOnDevice(uri: string, camera: string): Promise<RenderedVideo> {
  if (!nativeVideo) throw new Error('Video looks require the iPhone preview or release app.');
  const cube = camera === 'original' ? '' : VIDEO_LUTS[camera];
  if (cube === undefined) throw new Error('This camera look is unavailable for video.');
  const result = await nativeVideo.renderAsync(uri, camera, cube);
  if (!result?.uri) throw new Error('The styled video was not returned.');
  return { uri: result.uri, thumbnailUri: result.thumbnailUri || null };
}
