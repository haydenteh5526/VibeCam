import { Asset } from 'expo-asset';
import { GLView } from 'expo-gl';
import { Image, Platform } from 'react-native';

import { renderToFramebuffer } from './renderFrame';
import type { PhotoRecipe } from '../photoRecipe';
import { LUT_MODULES } from './lutAssets';

/**
 * On-device look rendering.
 *
 * Develops a captured still entirely on the GPU: LUT colour transform plus the character
 * effects a single pass can do. This is what makes capture instant and available offline
 * — no backend round-trip, no cold start.
 *
 * Deliberate limits, so expectations are clear:
 *  - The LUT carries each camera's *static* colour signature. The backend's adaptive
 *    reference match cannot be baked into a fixed table (see backend/lut.py), so a
 *    server render remains slightly different when reachable.
 *  - Halation, chromatic aberration, corner softness and unsharp masking need extra blur
 *    passes and stay server-side.
 */

/** Points per axis in the baked LUTs — must match backend lut.DEFAULT_SIZE. */
export { LUT_SIZE } from './renderFrame';

export function hasOnDeviceLook(camera: string): boolean {
  return Object.hasOwn(LUT_MODULES, camera);
}

export type DevelopOptions = {
  uri: string;
  camera: string;
  characterStrength: number;
  seed: number;
  recipe?: PhotoRecipe;
  takenAt?: number;
};

/**
 * Develop a still on-device. Returns a new file URI, or null when the camera has no
 * bundled LUT (caller should fall back to the backend or the untouched frame).
 */
export async function developOnDevice(opts: DevelopOptions): Promise<string | null> {
  const module = LUT_MODULES[opts.camera];
  if (module === undefined) return null;
  if (Platform.OS === 'web') {
    const { developWeb } = await import('./renderWeb');
    return developWeb(opts, Asset.fromModule(module).uri);
  }

  const [photo, lutAsset] = await Promise.all([
    Asset.fromURI(opts.uri).downloadAsync(),
    Asset.fromModule(module).downloadAsync(),
  ]);

  // Asset.fromURI does not populate dimensions for native file URIs.
  const { width, height } = await Image.getSize(opts.uri);
  if (!width || !height) throw new Error('could not determine image size');

  const gl = await GLView.createContextAsync();
  try {
    const target = await renderToFramebuffer(gl, photo, lutAsset, width, height, opts);

    const snapshot = await GLView.takeSnapshotAsync(gl, {
      framebuffer: target,
      rect: { x: 0, y: 0, width, height },
      format: 'jpeg',
      compress: 0.95,
      flip: false,
    });

    if (typeof snapshot.uri !== 'string') throw new Error('No photo was rendered');
    // The roll repository copies this temporary snapshot into durable storage.
    return snapshot.uri;
  } finally {
    await GLView.destroyContextAsync(gl);
  }
}
