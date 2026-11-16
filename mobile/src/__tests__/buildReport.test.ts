import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBuildReport, installTypeFromRelease, systemLabel, type BuildInfo, type InstallType } from '../buildReport';

const PREVIEW: BuildInfo = { version: '1.0.0', build: '12', system: 'iOS 18.1', install: 'adHoc', developmentBundle: false, videoLooks: true, liveColour: true, cloudFeatures: false };
const INSTALLS: (InstallType | null)[] = ['adHoc', 'appStore', 'development', 'enterprise', 'simulator', 'unknown', null];

test('a signed preview reports its build, install type and capabilities', () => {
  assert.deepEqual(formatBuildReport(PREVIEW), [
    'VibeCam build report', 'Version 1.0.0 · Build 12', 'Install: Ad hoc', 'System: iOS 18.1',
    'Video looks: available', 'Live colour: available', 'Cloud features: off',
  ]);
});
test('a missing or blank build number leaves only the version', () => {
  for (const build of [null, '', '   ']) assert.equal(formatBuildReport({ ...PREVIEW, build })[1], 'Version 1.0.0');
  for (const version of [null, '']) {
    assert.equal(formatBuildReport({ ...PREVIEW, version, build: null })[1], 'Version unknown');
    assert.equal(formatBuildReport({ ...PREVIEW, version, build: '12' })[1], 'Version unknown');
  }
});
test('whitespace in version and build is collapsed', () => {
  assert.equal(formatBuildReport({ ...PREVIEW, version: ' 1.0.0\n', build: '1 2\t3' })[1], 'Version 1.0.0 · Build 1 2 3');
});
test('every install type has its own label', () => {
  const labels: [InstallType | null, string][] = [['adHoc', 'Ad hoc'], ['appStore', 'App Store or TestFlight'], ['development', 'Development signing'],
    ['enterprise', 'Enterprise'], ['simulator', 'Simulator'], ['unknown', 'Unknown'], [null, 'Not an iPhone app']];
  for (const [install, label] of labels) assert.equal(formatBuildReport({ ...PREVIEW, install })[2], `Install: ${label}`);
});
test('a development bundle is marked on the install line', () => {
  assert.equal(formatBuildReport({ ...PREVIEW, developmentBundle: true })[2], 'Install: Ad hoc · development bundle');
  assert.equal(formatBuildReport({ ...PREVIEW, install: null, developmentBundle: true })[2], 'Install: Not an iPhone app · development bundle');
  for (const install of INSTALLS) assert.ok(!formatBuildReport({ ...PREVIEW, install, developmentBundle: false })[2].includes('development bundle'));
});
test('missing capabilities and enabled cloud features are stated', () => {
  assert.equal(formatBuildReport({ ...PREVIEW, videoLooks: false })[4], 'Video looks: not in this build');
  assert.equal(formatBuildReport({ ...PREVIEW, liveColour: false })[5], 'Live colour: not available');
  assert.equal(formatBuildReport({ ...PREVIEW, cloudFeatures: true })[6], 'Cloud features: on (development)');
});
test('the release type from expo-application maps to an install type', () => {
  const known: [number, InstallType][] = [[1, 'simulator'], [2, 'enterprise'], [3, 'development'], [4, 'adHoc'], [5, 'appStore']];
  for (const [value, type] of known) assert.equal(installTypeFromRelease(value), type);
  for (const value of [0, 6, -1, 4.5, NaN, '4', null, undefined, {}]) assert.equal(installTypeFromRelease(value), 'unknown');
});
test('the system label names the platform and version', () => {
  assert.equal(systemLabel('ios', '18.1'), 'iOS 18.1');
  assert.equal(systemLabel('ios', undefined), 'iOS');
  assert.equal(systemLabel('ios', ''), 'iOS');
  assert.equal(systemLabel('android', 35), 'Android 35');
  assert.equal(systemLabel('web', undefined), 'Web');
  assert.equal(systemLabel('web', '1'), 'Web');
  assert.equal(systemLabel('windows', '11'), 'Unknown');
});
test('the report is always seven single lines', () => {
  const bools = [true, false];
  for (const install of INSTALLS) for (const developmentBundle of bools) for (const videoLooks of bools) for (const liveColour of bools)
    for (const cloudFeatures of bools) for (const build of [null, '12']) {
      const lines = formatBuildReport({ ...PREVIEW, install, developmentBundle, videoLooks, liveColour, cloudFeatures, build });
      assert.equal(lines.length, 7);
      for (const line of lines) {
        assert.doesNotMatch(line, /[\r\n]/);
        assert.equal(line, line.trim());
        assert.doesNotMatch(line, /null|undefined/);
      }
    }
});
