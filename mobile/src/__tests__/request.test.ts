import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../services/request';

test('requests time out even when the response body stalls', async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_, init) => { signal = init?.signal as AbortSignal; return new Response('ok'); };
  try {
    await assert.rejects(request('https://example.test', {}, () => new Promise(() => {}), 10), /timed out/);
    assert.ok(signal?.aborted);
  } finally { globalThis.fetch = original; }
});
