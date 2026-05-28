import { File } from 'expo-file-system';
import { API_BASE_URL, CHUNK_SIZE } from '../constants';
import { resolveFileSize } from '../utils';
import type { SelectedFile, UploadInitResponse, UploadChunkResponse } from '../types';

export async function gradePhoto(uri: string): Promise<{ gradedUri: string; presetId: string; presetName: string }> {
  const response = await fetch(`${API_BASE_URL}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await fetch(uri).then(r => r.blob()),
  });
  if (!response.ok) throw new Error(`Grading failed: ${response.status}`);
  const presetId = response.headers.get('X-Grade-Preset-Id') ?? 'unknown';
  const presetName = response.headers.get('X-Grade-Preset-Name') ?? 'Unknown';
  const blob = await response.blob();
  const gradedUri = URL.createObjectURL(blob);
  return { gradedUri, presetId, presetName };
}

export async function guideComposition(uri: string): Promise<{ instructions: string[]; compositionTip: string }> {
  const response = await fetch(`${API_BASE_URL}/guide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await fetch(uri).then(r => r.blob()),
  });
  if (!response.ok) throw new Error(`Guide failed: ${response.status}`);
  const data = await response.json();
  return { instructions: data.instructions ?? [], compositionTip: data.composition_tip ?? '' };
}

export async function uploadFile(
  file: SelectedFile,
  onProgress: (pct: number) => void,
): Promise<string | null> {
  const sz = await resolveFileSize(file);
  const ir = await fetch(`${API_BASE_URL}/uploads/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: file.name, mime_type: file.mimeType, size_bytes: sz }),
  });
  if (!ir.ok) throw new Error(`Init failed: ${ir.status}`);
  const { upload_id } = (await ir.json()) as UploadInitResponse;

  const fh = new File(file.uri).open();
  let off = 0;
  let last: UploadChunkResponse | null = null;
  try {
    while (off < sz) {
      const chunk = fh.readBytes(Math.min(CHUNK_SIZE, sz - off));
      if (chunk.length === 0) throw new Error('Read failed');
      const r = await fetch(`${API_BASE_URL}/uploads/${upload_id}/chunks?offset=${off}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
      });
      if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
      last = (await r.json()) as UploadChunkResponse;
      off = last.next_offset;
      onProgress(off / sz);
    }
  } finally {
    fh.close();
  }
  return last?.payload_hash ?? null;
}

export async function fetchGallery() {
  const r = await fetch(`${API_BASE_URL}/uploads?status=ingested`);
  if (!r.ok) return [];
  return r.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE_URL}/health`);
    return r.ok;
  } catch {
    return false;
  }
}
