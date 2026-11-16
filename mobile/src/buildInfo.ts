import { Platform } from 'react-native';
import * as Application from 'expo-application';
import appConfig from '../app.json';
import { CLOUD_FEATURES_ENABLED } from './constants';
import { supportsLiveColour } from './components/LiveLookPreview';
import { hasVideoLooks } from './look/renderVideo';
import { installTypeFromRelease, systemLabel, type BuildInfo, type InstallType } from './buildReport';

/** Reads the build facts from the running app. Called each time the panel opens, never at startup. */
export async function readBuildInfo(): Promise<BuildInfo> {
  let install: InstallType | null = null;
  if (Platform.OS === 'ios') {
    try { install = installTypeFromRelease(await Application.getIosApplicationReleaseTypeAsync()); } catch { install = 'unknown'; }
  }
  return {
    version: Application.nativeApplicationVersion ?? appConfig.expo.version,
    build: Application.nativeBuildVersion,
    system: systemLabel(Platform.OS, Platform.OS === 'web' ? null : Platform.Version),
    install,
    developmentBundle: __DEV__,
    videoLooks: hasVideoLooks(),
    liveColour: supportsLiveColour,
    cloudFeatures: CLOUD_FEATURES_ENABLED,
  };
}
