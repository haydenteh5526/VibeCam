import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudFeaturesEnabled, settingsForReleaseMode } from '../releaseMode';
import { DEFAULT_SETTINGS } from '../settingsCore';
import { createCloudRequest } from '../services/request';

test('cloud access requires an explicit build opt-in', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1']) assert.equal(cloudFeaturesEnabled(value), false);
  assert.equal(cloudFeaturesEnabled('true'), true);
});
test('old settings cannot enable cloud processing in the offline release', () => {
  const stored = { ...DEFAULT_SETTINGS, dateStamp: true, frame: 'print' as const, dust: 1, lightLeak: 1 };
  const effective = settingsForReleaseMode(stored, false);
  assert.equal(effective.defaultCamera, 'g7x');
  assert.equal(effective.onDeviceLook, true);
  assert.deepEqual([effective.dateStamp, effective.frame, effective.dust, effective.lightLeak], [false, 'none', 0, 0]);
  assert.equal(stored.dateStamp, true);
  assert.equal(settingsForReleaseMode(stored, true), stored);
});
test('offline builds reject API requests before contacting a server', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network request'); };
  try {
    await assert.rejects(createCloudRequest(false)('https://example.test/grade', {}, async r => r.json()), /disabled/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
