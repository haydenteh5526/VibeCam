import { File } from 'expo-file-system';
import type { SelectedFile } from './types';

export const resolveFileSize = async (f: SelectedFile): Promise<number> => {
  if (f.sizeBytes !== null) return f.sizeBytes;
  const fi = new File(f.uri).info();
  if (fi.exists && typeof fi.size === 'number' && fi.size > 0) return fi.size;
  return new Uint8Array(await (await fetch(f.uri)).arrayBuffer()).length;
};

export const formatBytes = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
};
