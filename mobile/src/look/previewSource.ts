import { Asset } from 'expo-asset';
import { Image } from 'react-native';
import { LUT_MODULES } from './lutAssets';
import type { TextureSource } from './renderFrame';

export type PreviewSource = { photo: TextureSource; lut: TextureSource; width: number; height: number };

export async function loadPreviewSource(uri: string, camera: string): Promise<PreviewSource> {
  const module = LUT_MODULES[camera];
  if (module === undefined) throw new Error('This camera has no preview');
  const [photo, lut, dimensions] = await Promise.all([
    Asset.fromURI(uri).downloadAsync(), Asset.fromModule(module).downloadAsync(), Image.getSize(uri),
  ]);
  return { photo, lut, ...dimensions };
}
