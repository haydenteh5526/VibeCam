import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { checkBuildConfig, formatProblem, type ConfigInput } from '../../tools/config-guard';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const COMMITTED: ConfigInput & { eas: any; app: any } = {
  eas: JSON.parse(read('../../eas.json')),
  app: JSON.parse(read('../../app.json')),
  workflow: read('../../../.github/workflows/mobile-checks.yml'),
};

const KEY = 'EXPO_PUBLIC_ENABLE_CLOUD_FEATURES';
const EAS = 'mobile/eas.json';
const APP = 'mobile/app.json';
const WORKFLOW = '.github/workflows/mobile-checks.yml';
const PROFILES = ['base', 'development', 'preview', 'production'];

const lines = (input: ConfigInput) => checkBuildConfig(input).map(formatProblem);
const copy = () => structuredClone(COMMITTED) as typeof COMMITTED;
const cloudNotSet = (p: string) => `${EAS}: build.${p}.env.${KEY}: is not set; it must be the string "false"`;
const cloudIs = (p: string, v: string, platform = '') => `${EAS}: build.${p}.${platform}env.${KEY}: is ${v}; it must be the string "false"`;
const imageMismatch = (p: string, a: string, b: string) => `${EAS}: build.${p}.ios.image: uses Xcode ${a}, but CI uses Xcode ${b}`;

const IDENTITY_PATHS = [
  'expo.ios.bundleIdentifier',
  'expo.extra.eas.projectId',
  'expo.ios.infoPlist.NSCameraUsageDescription',
  'expo.ios.infoPlist.NSMicrophoneUsageDescription',
  'expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription',
  'expo.ios.infoPlist.NSPhotoLibraryUsageDescription',
];

function parent(root: any, path: string): [any, string] {
  const parts = path.split('.');
  let node = root;
  for (const part of parts.slice(0, -1)) node = node[part];
  return [node, parts[parts.length - 1]];
}

/** One deliberately broken clone per entry. Each is a fresh structuredClone of the committed files. */
function brokenCopies(): Record<string, ConfigInput> {
  const out: Record<string, ConfigInput> = {};
  const make = (name: string, change: (c: typeof COMMITTED) => void) => { const c = copy(); change(c); out[name] = c; };
  make('production cloud on', c => { c.eas.build.production.env = { [KEY]: 'true' }; });
  make('base cloud missing', c => { delete c.eas.build.base.env[KEY]; });
  make('ios cloud on', c => { c.eas.build.preview.ios = { env: { [KEY]: 'true' } }; });
  make('android cloud on', c => { c.eas.build.preview.android = { env: { [KEY]: 'true' } }; });
  make('missing base', c => { c.eas.build.preview.extends = 'nope'; });
  make('loop', c => { c.eas.build.base.extends = 'preview'; });
  make('image differs', c => { c.eas.build.base.ios.image = 'macos-sequoia-15.6-xcode-26.1'; });
  make('image latest', c => { c.eas.build.base.ios.image = 'latest'; });
  make('ci differs', c => { c.workflow = c.workflow.replace('Xcode_26.2.app', 'Xcode_26.3.app'); });
  make('ci none', c => { c.workflow = c.workflow.replace('DEVELOPER_DIR:', '# DEVELOPER_DIR:'); });
  make('ci two', c => { c.workflow += '\n      DEVELOPER_DIR: /Applications/Xcode_26.1.app/Contents/Developer\n'; });
  make('preview store', c => { c.eas.build.preview.distribution = 'store'; });
  make('preview dev client', c => { c.eas.build.preview.developmentClient = true; });
  make('preview simulator', c => { c.eas.build.preview.ios = { simulator: true }; });
  make('preview missing', c => { delete c.eas.build.preview; });
  for (const path of IDENTITY_PATHS) make('identity ' + path, c => { const [node, key] = parent(c.app, path); delete node[key]; });
  make('no profiles', c => { c.eas = { build: {} }; });

  // The rest of the inputs asserted in tests 2 to 8 and 10.
  [[false, 'false'], ['False', 'False'], ['0', '0'], ['', 'empty']].forEach(([value, label]) =>
    make('preview cloud ' + label, c => { c.eas.build.preview.env = { [KEY]: value }; }));
  make('adhoc profile', c => { c.eas.build.adhoc = { distribution: 'internal' }; });
  make('chain through mid', c => { c.eas.build.mid = { extends: 'base', env: { [KEY]: 'true' } }; c.eas.build.preview.extends = 'mid'; });
  make('production image 26.3', c => { c.eas.build.production.ios = { image: 'macos-sequoia-15.6-xcode-26.3' }; });
  make('base ios deleted', c => { delete c.eas.build.base.ios; });
  make('ci line removed', c => { c.workflow = c.workflow.replace(/^.*DEVELOPER_DIR:.*\r?\n/m, ''); });
  make('preview distribution deleted', c => { delete c.eas.build.preview.distribution; });
  make('base development client', c => { c.eas.build.base.developmentClient = true; });
  make('preview ios development client', c => { c.eas.build.preview.ios = { developmentClient: true }; });
  make('preview ios distribution', c => { c.eas.build.preview.ios = { distribution: 'store' }; });
  make('base ios development client', c => { c.eas.build.base.ios.developmentClient = true; });
  make('preview development client string', c => { c.eas.build.preview.developmentClient = 'true'; });
  make('preview ios development client string', c => { c.eas.build.preview.ios = { developmentClient: 'true' }; });
  make('preview ios simulator string', c => { c.eas.build.preview.ios = { simulator: 'True' }; });
  make('preview ios debug build', c => { c.eas.build.preview.ios = { buildConfiguration: 'Debug' }; });
  make('preview debug build', c => { c.eas.build.preview.buildConfiguration = 'Debug'; });
  for (const path of IDENTITY_PATHS) {
    [['empty', ''], ['blank', '   '], ['number', 42]].forEach(([label, value]) =>
      make(`identity ${label} ${path}`, c => { const [node, key] = parent(c.app, path); node[key] = value; }));
  }
  make('expo.ios deleted', c => { delete c.app.expo.ios; });
  make('expo.extra deleted', c => { delete c.app.expo.extra; });
  [null, [], 7, {}, { build: 3 }, { build: { preview: 5 } }].forEach((eas, i) => make('malformed eas ' + i, c => { c.eas = eas; }));
  [null, [], {}].forEach((app, i) => make('malformed app ' + i, c => { c.app = app; }));
  make('empty workflow', c => { c.workflow = ''; });
  return out;
}

test('the committed build configuration passes', () => {
  const found = lines(COMMITTED);
  assert.deepEqual(found, [], 'configuration problems:\n' + found.join('\n'));
  const names = Object.keys(COMMITTED.eas.build);
  for (const name of PROFILES) assert.ok(names.includes(name), 'committed eas.json must hold profile ' + name);
});

test('a profile that could ship with cloud features on is named', () => {
  let c = copy();
  c.eas.build.production.env = { [KEY]: 'true' };
  assert.deepEqual(lines(c), [`${EAS}: build.production.env.${KEY}: is "true"; it must be the string "false"`]);

  c = copy();
  delete c.eas.build.base.env[KEY];
  assert.deepEqual(lines(c), PROFILES.map(cloudNotSet));

  for (const [value, shown] of [[false, 'false'], ['False', '"False"'], ['0', '"0"'], ['', '""']] as const) {
    c = copy();
    c.eas.build.preview.env = { [KEY]: value };
    assert.deepEqual(lines(c), [cloudIs('preview', shown)]);
  }

  c = copy();
  c.eas.build.adhoc = { distribution: 'internal' };
  assert.deepEqual(lines(c), [cloudNotSet('adhoc'), `${EAS}: build.adhoc.ios.image: is not set; it must name the Xcode version CI uses`]);
});

test('a platform override of the cloud setting is named', () => {
  for (const platform of ['ios', 'android']) {
    const c = copy();
    c.eas.build.preview[platform] = { ...(c.eas.build.preview[platform] ?? {}), env: { [KEY]: 'true' } };
    assert.deepEqual(lines(c), [cloudIs('preview', '"true"', platform + '.')]);
  }
  for (const env of [{ [KEY]: 'false' }, { OTHER: 'x' }, { [KEY]: 'false', OTHER: 'x' }]) {
    for (const platform of ['ios', 'android']) {
      const c = copy();
      c.eas.build.preview[platform] = { ...(c.eas.build.preview[platform] ?? {}), env };
      assert.deepEqual(lines(c), []);
    }
  }
});

test('extends is followed through a chain, and a missing or looping base is reported', () => {
  let c = copy();
  c.eas.build.mid = { extends: 'base', env: { [KEY]: 'true' } };
  c.eas.build.preview.extends = 'mid';
  assert.deepEqual(lines(c), [cloudIs('preview', '"true"'), cloudIs('mid', '"true"')]);

  c = copy();
  c.eas.build.preview.extends = 'nope';
  assert.deepEqual(lines(c), [`${EAS}: build.preview.extends: names "nope", which is not a profile`]);

  c = copy();
  c.eas.build.base.extends = 'preview';
  let found: string[] = [];
  assert.doesNotThrow(() => { found = lines(c); });
  assert.ok(found.length > 0, 'a loop must be reported');
  for (const line of found) assert.match(line, new RegExp(`^${EAS.replace('.', '\\.')}: build\\.\\w+\\.extends: forms a loop$`));
  assert.ok(found.includes(`${EAS}: build.base.extends: forms a loop`));
  assert.ok(found.includes(`${EAS}: build.preview.extends: forms a loop`));
});

test('an Xcode version that differs between EAS and CI is named', () => {
  let c = copy();
  c.eas.build.base.ios.image = 'macos-sequoia-15.6-xcode-26.1';
  assert.deepEqual(lines(c), PROFILES.map(p => imageMismatch(p, '26.1', '26.2')));

  c = copy();
  c.eas.build.production.ios = { image: 'macos-sequoia-15.6-xcode-26.3' };
  assert.deepEqual(lines(c), [imageMismatch('production', '26.3', '26.2')]);

  c = copy();
  c.workflow = c.workflow.replace('Xcode_26.2.app', 'Xcode_26.3.app');
  assert.deepEqual(lines(c), PROFILES.map(p => imageMismatch(p, '26.2', '26.3')));
});

test('a configuration that names no Xcode version fails', () => {
  let c = copy();
  c.eas.build.base.ios.image = 'latest';
  assert.deepEqual(lines(c), PROFILES.map(p => `${EAS}: build.${p}.ios.image: is "latest", which does not name an Xcode version`));

  c = copy();
  delete c.eas.build.base.ios;
  assert.deepEqual(lines(c), PROFILES.map(p => `${EAS}: build.${p}.ios.image: is not set; it must name the Xcode version CI uses`));

  const noVersion = `${WORKFLOW}: DEVELOPER_DIR: selects no Xcode version`;
  c = copy();
  c.workflow = c.workflow.replace(/^.*DEVELOPER_DIR:.*\r?\n/m, '');
  assert.ok(!/DEVELOPER_DIR/.test(c.workflow));
  assert.deepEqual(lines(c), [noVersion]);

  c = copy();
  c.workflow = c.workflow.replace('DEVELOPER_DIR:', '# DEVELOPER_DIR:');
  assert.ok(c.workflow.includes('# DEVELOPER_DIR:'));
  assert.deepEqual(lines(c), [noVersion]);

  c = copy();
  c.workflow += '\n      DEVELOPER_DIR: /Applications/Xcode_26.1.app/Contents/Developer\n';
  assert.deepEqual(lines(c), [`${WORKFLOW}: DEVELOPER_DIR: selects more than one Xcode version: 26.2, 26.1`]);

  c = copy();
  c.workflow = c.workflow.replace(/\r?\n/g, '\r\n');
  assert.ok(c.workflow.includes('\r\n'));
  assert.deepEqual(lines(c), []);
});

test('preview must be an internal standalone profile', () => {
  let c = copy();
  c.eas.build.preview.distribution = 'store';
  assert.deepEqual(lines(c), [`${EAS}: build.preview.distribution: is "store"; it must be "internal"`]);

  c = copy();
  delete c.eas.build.preview.distribution;
  assert.deepEqual(lines(c), [`${EAS}: build.preview.distribution: is not set; it must be "internal"`]);

  const standalone = `${EAS}: build.preview.developmentClient: is true; preview must be a standalone app`;
  c = copy();
  c.eas.build.preview.developmentClient = true;
  assert.deepEqual(lines(c), [standalone]);

  c = copy();
  c.eas.build.base.developmentClient = true;
  assert.deepEqual(lines(c), [standalone]);

  c = copy();
  delete c.eas.build.preview;
  assert.deepEqual(lines(c), [`${EAS}: build.preview: is missing`]);

  c = copy();
  c.eas.build.preview.ios = { simulator: true };
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.simulator: is true; preview must install on an iPhone`]);

  // The iOS section overrides the common keys for an iOS build.
  c = copy();
  c.eas.build.preview.ios = { developmentClient: true };
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.developmentClient: is true; preview must be a standalone app`]);

  c = copy();
  c.eas.build.preview.ios = { distribution: 'store' };
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.distribution: is "store"; it must be "internal"`]);

  c = copy();
  c.eas.build.base.ios.developmentClient = true;
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.developmentClient: is true; preview must be a standalone app`]);

  c = copy();
  delete c.eas.build.preview.distribution;
  c.eas.build.preview.ios = { distribution: 'internal' };
  assert.deepEqual(lines(c), []);

  // EAS converts the string "true" to true before it resolves a profile.
  c = copy();
  c.eas.build.preview.developmentClient = 'true';
  assert.deepEqual(lines(c), [`${EAS}: build.preview.developmentClient: is "true"; preview must be a standalone app`]);

  c = copy();
  c.eas.build.preview.ios = { developmentClient: 'true' };
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.developmentClient: is "true"; preview must be a standalone app`]);

  c = copy();
  c.eas.build.preview.ios = { simulator: 'True' };
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.simulator: is "True"; preview must install on an iPhone`]);

  c = copy();
  c.eas.build.preview.ios = { buildConfiguration: 'Debug' };
  assert.deepEqual(lines(c), [`${EAS}: build.preview.ios.buildConfiguration: is "Debug"; preview must be a Release build`]);

  c = copy();
  c.eas.build.preview.buildConfiguration = 'Debug';
  assert.deepEqual(lines(c), [`${EAS}: build.preview.buildConfiguration: is "Debug"; preview must be a Release build`]);

  c = copy();
  c.eas.build.preview.ios = { buildConfiguration: 'Release', developmentClient: false, simulator: false };
  assert.deepEqual(lines(c), []);

  assert.equal(COMMITTED.eas.build.development.developmentClient, true);
  assert.deepEqual(lines(COMMITTED), []);
});

test('the app identity and the four usage descriptions are required', () => {
  for (const path of IDENTITY_PATHS) {
    const expected = [`${APP}: ${path}: is missing`];
    for (const mutate of [
      (node: any, key: string) => { delete node[key]; },
      (node: any, key: string) => { node[key] = ''; },
      (node: any, key: string) => { node[key] = '   '; },
      (node: any, key: string) => { node[key] = 42; },
    ]) {
      const c = copy();
      const [node, key] = parent(c.app, path);
      mutate(node, key);
      assert.deepEqual(lines(c), expected, path);
    }
  }

  let c = copy();
  delete c.app.expo.ios;
  assert.deepEqual(lines(c), IDENTITY_PATHS.filter(p => p !== 'expo.extra.eas.projectId').map(p => `${APP}: ${p}: is missing`));

  c = copy();
  delete c.app.expo.extra;
  assert.deepEqual(lines(c), [`${APP}: expo.extra.eas.projectId: is missing`]);
});

test('every problem names its file and place', () => {
  const shape = /^(mobile\/eas\.json|mobile\/app\.json|\.github\/workflows\/mobile-checks\.yml): \S+: \S.*$/;
  let total = 0;
  for (const [name, input] of Object.entries(brokenCopies())) {
    const found = lines(input);
    assert.ok(found.length > 0, name + ' must produce a problem');
    for (const line of found) {
      total += 1;
      assert.match(line, shape, name);
      assert.ok(!/[\r\n]/.test(line), name + ': a problem must be one line');
    }
  }
  assert.ok(total > 20);
});

test('malformed files are reported, not thrown', () => {
  const noProfiles = [`${EAS}: build: has no build profiles`];
  for (const eas of [null, [], 7, {}, { build: 3 }, { build: {} }]) {
    let found: string[] = [];
    assert.doesNotThrow(() => { found = lines({ ...COMMITTED, eas }); });
    assert.deepEqual(found, noProfiles, JSON.stringify(eas));
  }
  assert.deepEqual(lines({ ...COMMITTED, eas: { build: { preview: 5 } } }), [`${EAS}: build.preview: is not an object`]);
  for (const app of [null, [], {}]) {
    let found: string[] = [];
    assert.doesNotThrow(() => { found = lines({ ...COMMITTED, app }); });
    assert.deepEqual(found, IDENTITY_PATHS.map(p => `${APP}: ${p}: is missing`), JSON.stringify(app));
  }
  assert.deepEqual(lines({ ...COMMITTED, workflow: '' }), [`${WORKFLOW}: DEVELOPER_DIR: selects no Xcode version`]);
});
