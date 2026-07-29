import { Platform } from 'react-native';

/**
 * Platform-aware file and key-value helpers.
 *
 * `expo-file-system` is explicitly unsupported on web — it logs a warning and returns
 * nothing — so anything that reads bytes or persists JSON needs a browser path. Without
 * this, running the app on a laptop (`npm run web`) renders the UI but breaks capture,
 * grading and settings persistence.
 *
 * Web is a development convenience: it uses blob URLs and localStorage. Native keeps
 * using expo-file-system, which survives cache eviction and app restarts.
 */
export const isWeb = Platform.OS === 'web';

/** Read an image URI as bytes, for POSTing to the grading API. */
export async function readBytes(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  if (isWeb) {
    // blob:, data: and http: URIs are all fetchable in a browser.
    const res = await fetch(uri);
    return new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  }
  const { File } = await import('expo-file-system');
  return await new File(uri).bytes();
}

/** Persist a graded image response and return a URI the UI can display. */
export async function saveImageResponse(response: Response): Promise<string> {
  const blob = await response.blob();

  if (isWeb) {
    // A blob URL renders fine in a browser <img>; on native it would not.
    return URL.createObjectURL(blob);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;

  const { File, Paths } = await import('expo-file-system');
  const out = new File(Paths.cache, `vibecam_${Date.now()}_${Math.floor(Math.random() * 1e6)}.jpg`);
  out.create({ overwrite: true, intermediates: true });
  out.write(base64, { encoding: 'base64' });
  return out.uri;
}

/** Whether a stored image still exists. Web blob URLs can't be probed, so assume yes. */
export async function fileExists(uri: string): Promise<boolean> {
  if (isWeb) return true;
  try {
    const { File } = await import('expo-file-system');
    return new File(uri).exists;
  } catch {
    return false;
  }
}

// ─── JSON persistence ───────────────────────────────────────────────────────────

/** Read a JSON document by logical name, or null when absent/unreadable. */
export async function readJson(name: string): Promise<unknown | null> {
  try {
    if (isWeb) {
      const raw = globalThis.localStorage?.getItem(name);
      return raw ? JSON.parse(raw) : null;
    }
    const { File, Paths } = await import('expo-file-system');
    const f = new File(Paths.document, name);
    if (!f.exists) return null;
    return JSON.parse(await f.text());
  } catch {
    return null;   // corrupt or unreadable: callers fall back to defaults
  }
}

/** Write a JSON document. Failures are non-fatal — state just won't persist. */
export async function writeJson(name: string, value: unknown): Promise<void> {
  try {
    const text = JSON.stringify(value);
    if (isWeb) {
      globalThis.localStorage?.setItem(name, text);
      return;
    }
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const f = new File(Paths.document, name);
    if (!f.exists) f.create({ overwrite: true, intermediates: true });
    f.write(text);
  } catch {
    // Non-fatal.
  }
}
