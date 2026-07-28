import { File, Paths } from 'expo-file-system';
import { API_BASE_URL, CHUNK_SIZE, authHeaders } from '../constants';
import { resolveFileSize } from '../utils';
import type { SelectedFile, UploadInitResponse, UploadChunkResponse } from '../types';

// React Native can't use web Blob / URL.createObjectURL for binary I/O:
// <Image> cannot render `blob:` URIs on native, and createObjectURL is absent on
// Hermes. So read the captured file's bytes with expo-file-system, and persist the
// graded response to a real file:// URI that <Image> and Sharing can use.
async function readFileBytes(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  return await new File(uri).bytes();
}

async function saveImageResponse(response: Response): Promise<string> {
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const out = new File(Paths.cache, `vibecam_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`);
  out.create({ overwrite: true, intermediates: true });
  out.write(base64, { encoding: 'base64' });
  return out.uri;
}

export async function gradePhoto(
  uri: string,
  camera: string = 'auto',
  extraHeaders: Record<string, string> = {},
): Promise<{ gradedUri: string; presetId: string; presetName: string }> {
  const response = await fetch(`${API_BASE_URL}/grade`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Camera': camera,
      ...extraHeaders,
      ...authHeaders(),
    },
    body: await readFileBytes(uri),
  });
  if (!response.ok) throw new Error(`Grading failed: ${response.status}`);
  const presetId = response.headers.get('X-Grade-Preset-Id') ?? 'unknown';
  const presetName = response.headers.get('X-Grade-Preset-Name') ?? 'Unknown';
  const gradedUri = await saveImageResponse(response);
  return { gradedUri, presetId, presetName };
}


export async function gradeWithVibe(uri: string, vibe: string): Promise<{ gradedUri: string; styleName: string }> {
  const response = await fetch(`${API_BASE_URL}/grade/vibe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Vibe': vibe, ...authHeaders() },
    body: await readFileBytes(uri),
  });
  if (!response.ok) throw new Error(`Vibe grading failed: ${response.status}`);
  const styleName = response.headers.get('X-Grade-Preset-Name') ?? 'Custom';
  const gradedUri = await saveImageResponse(response);
  return { gradedUri, styleName };
}


export async function guideComposition(uri: string): Promise<{ instructions: string[]; compositionTip: string }> {
  const response = await fetch(`${API_BASE_URL}/guide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
    body: await readFileBytes(uri),
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
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
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
  const r = await fetch(`${API_BASE_URL}/uploads?status=ingested`, { headers: authHeaders() });
  if (!r.ok) return [];
  return r.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE_URL}/health`, { headers: authHeaders() });
    return r.ok;
  } catch {
    return false;
  }
}
