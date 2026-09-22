import type { Settings } from './settingsCore';

/** Cloud functionality is a development opt-in, never inferred from a stored setting. */
export const cloudFeaturesEnabled = (value: string | undefined) => value === 'true';

export function settingsForReleaseMode(settings: Settings, cloud: boolean): Settings {
  if (cloud) return settings;
  return {
    ...settings, defaultCamera: settings.defaultCamera === 'auto' ? 'g7x' : settings.defaultCamera,
    onDeviceLook: true, dateStamp: false, frame: 'none', lightLeak: 0, dust: 0,
  };
}
