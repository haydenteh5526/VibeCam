import { Asset } from 'expo-asset';
import { LUT_MODULES } from './lutAssets';
import type { PreviewSource } from './previewSource';

const decode = (uri: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not open this photo'));
  image.src = uri;
});

export async function loadPreviewSource(uri: string, camera: string): Promise<PreviewSource> {
  const module = LUT_MODULES[camera];
  if (module === undefined) throw new Error('This camera has no preview');
  const [photo, lut] = await Promise.all([decode(uri), decode(Asset.fromModule(module).uri)]);
  return { photo, lut, width: photo.naturalWidth, height: photo.naturalHeight };
}
