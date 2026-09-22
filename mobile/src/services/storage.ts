import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';
const IMAGE_DIR = 'vibecam-roll';
const OWNED_FILE = /\/vibecam-roll\/([a-zA-Z0-9_-]+\.(?:jpg|png|mp4|mov))$/;

export async function readBytes(uri: string): Promise<Uint8Array<ArrayBuffer>> {
  if (isWeb) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error('Unable to read photo');
    return new Uint8Array(await res.arrayBuffer());
  }
  const { File } = await import('expo-file-system');
  return new File(uri).bytes();
}

async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read photo'));
    reader.readAsDataURL(blob);
  });
}

export async function saveImageResponse(response: Response): Promise<string> {
  if (isWeb) return dataUrl(await response.blob());
  const { File, Paths } = await import('expo-file-system');
  const out = new File(Paths.cache, `vibecam_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  out.write(new Uint8Array(await response.arrayBuffer()));
  return out.uri;
}

/** Rebase our own files when iOS changes the application's sandbox path. */
export async function resolveRetainedImage(uri: string): Promise<string> {
  if (isWeb) return uri;
  const name = uri.match(OWNED_FILE)?.[1];
  if (!name) return uri;
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, IMAGE_DIR, name).uri;
}

/** Originals and developed images belong in documents, never in the purgeable cache. */
export async function retainImage(uri: string): Promise<string> {
  if (isWeb) {
    if (uri.startsWith('data:image/')) return uri;
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Unable to retain photo');
    return dataUrl(await response.blob());
  }
  const { Directory, File, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, IMAGE_DIR);
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(await resolveRetainedImage(uri));
  if (!source.exists) throw new Error('The original photo is no longer available');
  if (source.uri.startsWith(dir.uri.replace(/\/$/, '') + '/')) return source.uri;
  const extension = source.uri.match(/\.(jpg|png|mp4|mov)$/i)?.[1]?.toLowerCase() ?? 'jpg';
  const dest = new File(dir, `${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`);
  source.copy(dest);
  return dest.uri;
}

/** Delete only images owned by this app's film roll. Never touch Photos or imported files. */
export async function deleteRetainedImage(uri: string): Promise<void> {
  if (isWeb) return;
  const { Directory, File, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, IMAGE_DIR);
  const file = new File(await resolveRetainedImage(uri));
  if (file.uri.startsWith(dir.uri.replace(/\/$/, '') + '/') && file.exists) file.delete();
}

export async function fileExists(uri: string): Promise<boolean> {
  try {
    if (isWeb) return (await fetch(uri)).ok;
    const { File } = await import('expo-file-system');
    return new File(await resolveRetainedImage(uri)).exists;
  } catch { return false; }
}

// Store the browser roll, including images, beyond localStorage's small quota.
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vibecam', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = undefined; throw error; });
  return database;
}

export async function readJson(name: string): Promise<unknown | null> {
  if (isWeb) {
    const db = await openDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').get(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (value !== undefined) return value;
    try { return JSON.parse(globalThis.localStorage.getItem(name) ?? 'null'); }
    catch { return null; }
  }
  const { File, Paths } = await import('expo-file-system');
  let unreadable = false;
  for (const suffix of ['', '.bak']) {
    const file = new File(Paths.document, name + suffix);
    if (!file.exists) continue;
    try { return JSON.parse(await file.text()); } catch { unreadable = true; }
  }
  if (unreadable) throw new Error('Saved data could not be read.');
  return null;
}

/** Callers surface failures: a failed disk write is not a saved photo. */
export async function writeJson(name: string, value: unknown): Promise<void> {
  if (isWeb) {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(value, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Storage write aborted'));
    });
    return;
  }
  const { File, Paths } = await import('expo-file-system');
  const file = new File(Paths.document, name);
  const pending = new File(Paths.document, name + '.tmp');
  const backup = new File(Paths.document, name + '.bak');
  pending.write(JSON.stringify(value));
  if (file.exists) {
    if (backup.exists) backup.delete();
    file.copy(backup);
    file.delete();
  }
  try { pending.move(new File(Paths.document, name)); }
  catch (error) {
    if (backup.exists && !new File(Paths.document, name).exists) backup.copy(new File(Paths.document, name));
    throw error;
  }
}
