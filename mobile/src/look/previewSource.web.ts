import { Asset } from 'expo-asset';
import { LUT_MODULES } from './lutAssets';
import type { PreviewPhoto } from './previewSource';
import type { TextureSource } from './renderFrame';
import { previewDimensions } from './previewDimensions';

const decode = (uri: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not open this photo'));
  image.src = uri;
});

export async function loadPreviewLut(camera: string): Promise<TextureSource> {
  const module = LUT_MODULES[camera];
  if (module === undefined) throw new Error('This camera has no preview');
  return decode(Asset.fromModule(module).uri);
}

export async function preparePreviewPhoto(uri: string): Promise<PreviewPhoto> {
  const image = await decode(uri);
  const originalSize = { width: image.naturalWidth, height: image.naturalHeight };
  const size = previewDimensions(originalSize.width, originalSize.height);
  const photo = document.createElement('canvas');
  photo.width = size.width; photo.height = size.height;
  const context = photo.getContext('2d');
  if (!context) throw new Error('Could not prepare photo preview');
  context.drawImage(image, 0, 0, size.width, size.height);
  return { photo, ...size, originalSize, dispose() { photo.width = 0; photo.height = 0; } };
}
