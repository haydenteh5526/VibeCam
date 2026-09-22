import test from 'node:test';
import assert from 'node:assert/strict';
import { developPhoto } from '../developPhoto';
import { DEFAULT_SETTINGS } from '../settingsCore';

const date = new Date(2026, 8, 21).getTime();
test('server failure falls back to the local look even when local-first is off', async () => {
  const calls: string[] = [];
  const result = await developPhoto('original', 'gr', 42, date, DEFAULT_SETTINGS, true, {
    remote: async () => { calls.push('remote'); throw new Error('Network lost'); },
    local: async (uri, camera, strength, seed) => { assert.deepEqual([uri, camera, strength, seed], ['original', 'gr', 1, 42]); calls.push('local'); return 'local-edit'; },
  });
  assert.deepEqual(calls, ['remote', 'local']);
  assert.equal(result.uri, 'local-edit');
});
test('offline auto uses G7X and explains when selected effects were omitted', async () => {
  const result = await developPhoto('original', 'auto', 1, date, { ...DEFAULT_SETTINGS, frame: 'print' }, false, {
    local: async (_, camera) => { assert.equal(camera, 'g7x'); return 'edit'; },
    remote: async () => { throw new Error('Must not call offline'); },
  });
  assert.equal(result.id, 'g7x');
  assert.match(result.notice!, /not applied/);
});
test('effects prefer the server and date stamp keeps the capture date when redeveloped', async () => {
  const result = await developPhoto('original', 'gr', 2, date, { ...DEFAULT_SETTINGS, dateStamp: true, onDeviceLook: true }, true, {
    local: async () => { assert.fail('Server should handle effects'); },
    remote: async (_, id, headers) => { assert.equal(headers['X-Date-Text'], "'26 09 21"); return { uri: 'remote', id, name: 'GR' }; },
  });
  assert.equal(result.uri, 'remote');
});
test('original bypasses both engines and stays untouched', async () => {
  const unexpected = async () => { assert.fail('Original must not be graded'); };
  assert.equal((await developPhoto('original', 'original', 1, date, DEFAULT_SETTINGS, true, { local: unexpected, remote: unexpected })).uri, 'original');
});
test('local failure falls back to server and total failure is surfaced', async () => {
  const engines = { local: async () => { throw new Error('GL unavailable'); }, remote: async () => ({ uri: 'server', id: 'g7x', name: 'G7X' }) };
  assert.equal((await developPhoto('o', 'g7x', 1, date, { ...DEFAULT_SETTINGS, onDeviceLook: true }, true, engines)).uri, 'server');
  await assert.rejects(developPhoto('o', 'g7x', 1, date, DEFAULT_SETTINGS, false, engines), /unchanged/);
});
