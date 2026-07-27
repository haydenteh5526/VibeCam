import { Platform } from 'react-native';

const DEFAULT_API = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';

export const API_BASE_URL = (() => {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE_URL;
  return v && v.trim().length > 0 ? v.trim() : DEFAULT_API;
})();

export const CHUNK_SIZE = 256 * 1024;
export const ACCENT = '#FFD60A';

// Shared secret for a deployed backend. Must match VIBECAM_API_KEY on the server.
// Empty for local dev, where the backend leaves the gate open.
export const API_KEY = (() => {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : '';
})();

/** Auth header for backend calls; omitted entirely when no key is configured. */
export function authHeaders(): Record<string, string> {
  return API_KEY ? { 'X-API-Key': API_KEY } : {};
}
