// Checks the committed build configuration. Pure: it imports nothing, reads no
// file and no environment variable. The test passes everything in.
//
// `extends` is resolved the way @expo/eas-json 24.9.0 (the version EAS CLI
// 24.11.0 depends on) resolves it: a profile's own keys replace its base's keys,
// while `env`, `ios` and `android` are merged key by key.

export type ConfigProblem = {
  /** Path from the repository root. */
  file: 'mobile/eas.json' | 'mobile/app.json' | '.github/workflows/mobile-checks.yml';
  /** The profile or key at fault, for example `build.preview.distribution`. */
  where: string;
  message: string;
};

export type ConfigInput = {
  /** JSON.parse of mobile/eas.json. */
  eas: unknown;
  /** JSON.parse of mobile/app.json. */
  app: unknown;
  /** Text of .github/workflows/mobile-checks.yml. */
  workflow: string;
};

type Obj = Record<string, unknown>;

const EAS = 'mobile/eas.json';
const APP = 'mobile/app.json';
const WORKFLOW = '.github/workflows/mobile-checks.yml';
const CLOUD_KEY = 'EXPO_PUBLIC_ENABLE_CLOUD_FEATURES';
const IMAGE_VERSION = /-xcode-(\d+(?:\.\d+)*)$/;
const WORKFLOW_VERSION = () => /^[ \t]*DEVELOPER_DIR:[ \t]*\/Applications\/Xcode_(\d+(?:\.\d+)*)\.app\//gm;

const IDENTITY_PATHS = [
  'expo.ios.bundleIdentifier',
  'expo.extra.eas.projectId',
  'expo.ios.infoPlist.NSCameraUsageDescription',
  'expo.ios.infoPlist.NSMicrophoneUsageDescription',
  'expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription',
  'expo.ios.infoPlist.NSPhotoLibraryUsageDescription',
];

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (obj: Obj, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const show = (value: unknown) => JSON.stringify(value) ?? String(value);

export function formatProblem(problem: ConfigProblem): string {
  return `${problem.file}: ${problem.where}: ${problem.message}`;
}

/** Same rule as mergeProfiles in @expo/eas-json: `update` wins, `env`, `ios` and `android` merge. */
function merge(base: Obj, update: Obj): Obj {
  const result: Obj = { ...base, ...update };
  if (isObj(base.env) && isObj(update.env)) result.env = { ...base.env, ...update.env };
  if (isObj(base.android) && isObj(update.android)) result.android = merge(base.android, update.android);
  if (isObj(base.ios) && isObj(update.ios)) result.ios = merge(base.ios, update.ios);
  return result;
}

type Resolved = { name: string; profile: Obj };

export function checkBuildConfig(input: ConfigInput): ConfigProblem[] {
  const eas = isObj(input?.eas) ? input.eas : {};
  const build: Obj = isObj(eas.build) ? eas.build : {};
  const workflow = typeof input?.workflow === 'string' ? input.workflow : '';
  const names = Object.keys(build);

  const structure: ConfigProblem[] = [];
  const cloud: ConfigProblem[] = [];
  const xcode: ConfigProblem[] = [];
  const preview: ConfigProblem[] = [];
  const identity: ConfigProblem[] = [];
  const add = (list: ConfigProblem[], file: ConfigProblem['file'], where: string, message: string) => list.push({ file, where, message });

  // Structure, and the resolved profiles that the other rules read.
  const resolved: Resolved[] = [];
  const isBase = (name: unknown): name is string => typeof name === 'string' && has(build, name) && isObj(build[name]);
  if (names.length === 0) add(structure, EAS, 'build', 'has no build profiles');
  for (const name of names) {
    const own = build[name];
    if (!isObj(own)) { add(structure, EAS, `build.${name}`, 'is not an object'); continue; }
    if (own.extends && !isBase(own.extends)) {
      add(structure, EAS, `build.${name}.extends`, `names ${show(own.extends)}, which is not a profile`);
      continue;
    }
    const chain: Obj[] = [own];
    const seen = new Set([name]);
    let current = own;
    let state: 'ok' | 'broken' | 'loop' = 'ok';
    while (current.extends) {
      const next = current.extends;
      // An ancestor with a bad `extends` reports itself; its dependants are skipped.
      if (!isBase(next)) { state = 'broken'; break; }
      if (seen.has(next)) { state = 'loop'; break; }
      seen.add(next);
      current = build[next] as Obj;
      chain.push(current);
    }
    if (state === 'loop') { add(structure, EAS, `build.${name}.extends`, 'forms a loop'); continue; }
    if (state === 'broken') continue;
    let profile: Obj = {};
    for (const link of chain.reverse()) {
      const { extends: _extends, ...rest } = link;
      profile = merge(profile, rest);
    }
    resolved.push({ name, profile });
  }

  // Cloud features stay off.
  for (const { name, profile } of resolved) {
    const where = `build.${name}.env.${CLOUD_KEY}`;
    const env = profile.env;
    if (!isObj(env) || !has(env, CLOUD_KEY)) add(cloud, EAS, where, 'is not set; it must be the string "false"');
    else if (env[CLOUD_KEY] !== 'false') add(cloud, EAS, where, `is ${show(env[CLOUD_KEY])}; it must be the string "false"`);
    for (const platform of ['ios', 'android']) {
      const section = profile[platform];
      const platformEnv = isObj(section) ? section.env : undefined;
      if (isObj(platformEnv) && has(platformEnv, CLOUD_KEY) && platformEnv[CLOUD_KEY] !== 'false') {
        add(cloud, EAS, `build.${name}.${platform}.env.${CLOUD_KEY}`, `is ${show(platformEnv[CLOUD_KEY])}; it must be the string "false"`);
      }
    }
  }

  // The Xcode version in the EAS image matches the one CI selects.
  const imageVersions: Array<{ name: string; version: string }> = [];
  for (const { name, profile } of resolved) {
    const where = `build.${name}.ios.image`;
    const image = isObj(profile.ios) ? profile.ios.image : undefined;
    if (image === undefined) { add(xcode, EAS, where, 'is not set; it must name the Xcode version CI uses'); continue; }
    const match = typeof image === 'string' ? IMAGE_VERSION.exec(image) : null;
    if (!match) { add(xcode, EAS, where, `is ${show(image)}, which does not name an Xcode version`); continue; }
    imageVersions.push({ name, version: match[1] });
  }
  const ciVersions = [...new Set([...workflow.matchAll(WORKFLOW_VERSION())].map(match => match[1]))];
  if (ciVersions.length === 0) add(xcode, WORKFLOW, 'DEVELOPER_DIR', 'selects no Xcode version');
  else if (ciVersions.length > 1) add(xcode, WORKFLOW, 'DEVELOPER_DIR', `selects more than one Xcode version: ${ciVersions.join(', ')}`);
  else {
    for (const { name, version } of imageVersions) {
      if (version !== ciVersions[0]) add(xcode, EAS, `build.${name}.ios.image`, `uses Xcode ${version}, but CI uses Xcode ${ciVersions[0]}`);
    }
  }

  // preview is an internal standalone profile.
  if (names.length > 0 && !has(build, 'preview')) add(preview, EAS, 'build.preview', 'is missing');
  const previewProfile = resolved.find(entry => entry.name === 'preview')?.profile;
  if (previewProfile) {
    if (previewProfile.distribution === undefined) add(preview, EAS, 'build.preview.distribution', 'is not set; it must be "internal"');
    else if (previewProfile.distribution !== 'internal') add(preview, EAS, 'build.preview.distribution', `is ${show(previewProfile.distribution)}; it must be "internal"`);
    if (previewProfile.developmentClient === true) add(preview, EAS, 'build.preview.developmentClient', 'is true; preview must be a standalone app');
    if (isObj(previewProfile.ios) && previewProfile.ios.simulator === true) add(preview, EAS, 'build.preview.ios.simulator', 'is true; preview must install on an iPhone');
  }

  // App identity and the four usage descriptions.
  for (const path of IDENTITY_PATHS) {
    let node: unknown = input?.app;
    for (const part of path.split('.')) node = isObj(node) ? node[part] : undefined;
    if (typeof node !== 'string' || node.trim() === '') add(identity, APP, path, 'is missing');
  }

  return [...structure, ...cloud, ...xcode, ...preview, ...identity];
}
