export type InstallType = 'simulator' | 'enterprise' | 'development' | 'adHoc' | 'appStore' | 'unknown';

export type BuildInfo = {
  version: string | null;
  build: string | null;
  /** Already formatted with systemLabel. */
  system: string;
  /** null when the platform is not iOS. */
  install: InstallType | null;
  developmentBundle: boolean;
  videoLooks: boolean;
  liveColour: boolean;
  cloudFeatures: boolean;
};

const RELEASE_TYPES: Record<number, InstallType> = { 1: 'simulator', 2: 'enterprise', 3: 'development', 4: 'adHoc', 5: 'appStore' };
const INSTALL_LABELS: Record<InstallType, string> = {
  adHoc: 'Ad hoc', appStore: 'App Store or TestFlight', development: 'Development signing', enterprise: 'Enterprise', simulator: 'Simulator', unknown: 'Unknown',
};

/** Collapses every run of whitespace, including line breaks, to one space and trims the ends. */
function clean(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';
}

/** Maps the numeric ApplicationReleaseType of expo-application. Anything unrecognised is 'unknown'. */
export function installTypeFromRelease(value: unknown): InstallType {
  return typeof value === 'number' && Object.prototype.hasOwnProperty.call(RELEASE_TYPES, value) ? RELEASE_TYPES[value] : 'unknown';
}

export function systemLabel(os: string, version: string | number | null | undefined): string {
  const name = os === 'ios' ? 'iOS' : os === 'android' ? 'Android' : os === 'web' ? 'Web' : null;
  if (!name) return 'Unknown';
  const number = os === 'web' ? '' : clean(version);
  return number ? `${name} ${number}` : name;
}

export function formatBuildReport(info: BuildInfo): string[] {
  const version = clean(info.version);
  const build = clean(info.build);
  const install = info.install === null ? 'Not an iPhone app' : INSTALL_LABELS[info.install] ?? INSTALL_LABELS.unknown;
  return [
    'VibeCam build report',
    version ? `Version ${version}${build ? ` · Build ${build}` : ''}` : 'Version unknown',
    `Install: ${install}${info.developmentBundle ? ' · development bundle' : ''}`,
    `System: ${clean(info.system) || 'Unknown'}`,
    info.videoLooks ? 'Video looks: available' : 'Video looks: not in this build',
    info.liveColour ? 'Live colour: available' : 'Live colour: not available',
    info.cloudFeatures ? 'Cloud features: on (development)' : 'Cloud features: off',
  ];
}
