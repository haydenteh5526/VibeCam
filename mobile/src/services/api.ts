import { File } from 'expo-file-system';
import { API_BASE_URL, CHUNK_SIZE, CLOUD_FEATURES_ENABLED, authHeaders } from '../constants';
import { isWeb, readBytes, saveImageResponse } from './storage';
import { resolveFileSize } from '../utils';
import { createCloudRequest } from './request';
import type { SelectedFile, UploadInitResponse, UploadChunkResponse } from '../types';

const request = createCloudRequest(CLOUD_FEATURES_ENABLED);

// Binary I/O differs by platform: expo-file-system is native-only, while React Native
// can't render blob: URIs and a browser can't use file:. Both paths live in ./storage so
// the rest of this module stays platform-agnostic.
async function readFileBytes(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  return await readBytes(uri);
}

export async function gradePhoto(
  uri: string,
  camera: string = 'auto',
  extraHeaders: Record<string, string> = {},
): Promise<{ gradedUri: string; presetId: string; presetName: string }> {
  return request(`${API_BASE_URL}/grade`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Camera': camera,
      ...extraHeaders,
      ...authHeaders(),
    },
    body: await readFileBytes(uri),
  }, async response => {
    if (!response.ok) throw new Error(`Grading failed: ${response.status}`);
    const presetId = response.headers.get('X-Grade-Preset-Id') ?? 'unknown';
    const presetName = response.headers.get('X-Grade-Preset-Name') ?? 'Unknown';
    const gradedUri = await saveImageResponse(response);
    return { gradedUri, presetId, presetName };
  });
}

export async function gradeWithVibe(uri: string, vibe: string): Promise<{ gradedUri: string; styleName: string }> {
  return request(`${API_BASE_URL}/grade/vibe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Vibe': vibe, ...authHeaders() },
    body: await readFileBytes(uri),
  }, async response => {
    if (response.status === 503) throw new Error('AI grading is not available on this server. Your current photo is unchanged.');
    if (response.status === 401) throw new Error('The server connection needs a valid access key. Your current photo is unchanged.');
    if (!response.ok) throw new Error('AI grading could not finish. Your current photo is unchanged; please try again.');
    const styleName = response.headers.get('X-Grade-Preset-Name') ?? 'Custom';
    const gradedUri = await saveImageResponse(response);
    return { gradedUri, styleName };
  }, 60_000);
}


export async function guideComposition(uri: string): Promise<{ instructions: string[]; compositionTip: string }> {
  return request(`${API_BASE_URL}/guide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
    body: await readFileBytes(uri),
  }, async response => {
    if (!response.ok) throw new Error(`Guide failed: ${response.status}`);
    const data = await response.json();
    return { instructions: data.instructions ?? [], compositionTip: data.composition_tip ?? '' };
  }, 60_000);
}

export async function uploadFile(
  file: SelectedFile,
  onProgress: (pct: number) => void,
): Promise<string | null> {
  const sz = await resolveFileSize(file);
  if (!sz) throw new Error('This photo is empty or unavailable.');
  const { upload_id } = await request(`${API_BASE_URL}/uploads/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ file_name: file.name, mime_type: file.mimeType, size_bytes: sz }),
  }, async ir => {
    if (!ir.ok) throw new Error(`Init failed: ${ir.status}`);
    return await ir.json() as UploadInitResponse;
  });

  const bytes = isWeb ? await readBytes(file.uri) : null;
  const fh = isWeb ? null : new File(file.uri).open();
  let off = 0;
  let last: UploadChunkResponse | null = null;
  try {
    while (off < sz) {
      const chunk = bytes ? bytes.slice(off, Math.min(off + CHUNK_SIZE, sz)) : fh!.readBytes(Math.min(CHUNK_SIZE, sz - off));
      if (chunk.length === 0) throw new Error('Read failed');
      last = await request(`${API_BASE_URL}/uploads/${upload_id}/chunks?offset=${off}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
        body: chunk,
      }, async r => {
        if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
        return await r.json() as UploadChunkResponse;
      });
      if (last.next_offset !== off + chunk.length || last.next_offset > sz) throw new Error('Upload progress was not confirmed. Please retry.');
      off = last.next_offset;
      onProgress(off / sz);
    }
  } finally {
    fh?.close();
  }
  return last?.payload_hash ?? null;
}

export async function fetchGallery() {
  return request(`${API_BASE_URL}/uploads?status=ingested`, { headers: authHeaders() }, async r => {
    if (!r.ok) throw new Error('Could not load uploads. Please reconnect and try again.');
    return r.json();
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    return await request(`${API_BASE_URL}/health`, { headers: authHeaders() }, async r => r.ok, 5_000);
  } catch {
    return false;
  }
}
