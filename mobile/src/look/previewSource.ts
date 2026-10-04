import { Asset } from 'expo-asset';
import { Image } from 'react-native';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LUT_MODULES } from './lutAssets';
import type { TextureSource } from './renderFrame';
import { previewDimensions } from './previewDimensions';

export type PreviewPhoto = {
  photo: TextureSource; width: number; height: number; originalSize: { width: number; height: number }; dispose: () => void;
};
export type PreviewSource = PreviewPhoto & { lut: TextureSource };

export async function loadPreviewLut(camera: string): Promise<TextureSource> {
  const module = LUT_MODULES[camera];
  if (module === undefined) throw new Error('This camera has no preview');
  return Asset.fromModule(module).downloadAsync();
}

let preparation: Promise<unknown> = Promise.resolve();
export function preparePreviewPhoto(uri: string): Promise<PreviewPhoto> {
  // Closing/reopening during decode must not queue several full-resolution
  // native decodes concurrently. Cancelled callers dispose the returned thumbnail.
  const result = preparation.then(() => resizePreviewPhoto(uri));
  preparation = result.then(() => undefined, () => undefined);
  return result;
}

async function resizePreviewPhoto(uri: string): Promise<PreviewPhoto> {
  const originalSize = await Image.getSize(uri);
  const size = previewDimensions(originalSize.width, originalSize.height);
  const context = ImageManipulator.manipulate(uri);
  try {
    const image = await context.resize(size).renderAsync();
    try {
      const result = await image.saveAsync({ format: SaveFormat.PNG });
      return {
        photo: { localUri: result.uri }, width: result.width, height: result.height, originalSize,
        dispose() {
          // This URI was just created by the manipulator; never delete the source.
          try { const file = new File(result.uri); if (file.exists) file.delete(); } catch { /* Purgeable cache. */ }
        },
      };
    } finally { image.release(); }
  } finally { context.release(); }
}
