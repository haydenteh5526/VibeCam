import { FILTERS, type FilterId } from './filters';
import { gradeHeaders, type Settings } from './settingsCore';

export type DevelopedPhoto = { uri: string; id: string; name: string; notice?: string };
type Engines = {
  local: (uri: string, camera: string, strength: number, seed: number) => Promise<string | null>;
  remote: (uri: string, camera: string, headers: Record<string, string>) => Promise<DevelopedPhoto>;
};

/** One fallback policy for capture and re-develop, including a server that goes offline mid-shot. */
export async function developPhoto(
  uri: string, camera: FilterId | 'auto', seed: number, takenAt: number,
  settings: Settings, backendReady: boolean, engines: Engines,
): Promise<DevelopedPhoto> {
  if (camera === 'original') return { uri, id: camera, name: 'Original' };
  const effects = settings.dateStamp || settings.frame !== 'none' || settings.lightLeak > 0 || settings.dust > 0;
  const localCamera = camera === 'auto' ? 'g7x' : camera;
  const local = async (): Promise<DevelopedPhoto | null> => {
    const output = await engines.local(uri, localCamera, settings.characterStrength, seed);
    if (!output) return null;
    return {
      uri: output, id: localCamera,
      name: FILTERS.find(f => f.id === localCamera)?.name ?? localCamera,
      notice: effects ? 'Camera look applied. Date, frame, light leak and dust effects need a connection; they were not applied.' : undefined,
    };
  };
  const remote = async () => engines.remote(uri, camera, gradeHeaders(settings, seed, takenAt));
  const routes = backendReady
    ? settings.onDeviceLook && !effects ? [local, remote] : [remote, local]
    : [local];
  for (const render of routes) {
    try { const result = await render(); if (result) return result; } catch { /* try the other engine */ }
  }
  throw new Error('Could not develop this photo. Your current image is unchanged. Try another camera or reconnect.');
}
