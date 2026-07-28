import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addEntry, groupByDay, MAX_ROLL, normalizeRoll, removeEntry, updateEntry, type RollEntry } from '../roll';

function entry(uri: string, takenAt = 1_000, extra: Partial<RollEntry> = {}): RollEntry {
  return {
    uri,
    originalUri: `${uri}.orig`,
    cameraId: 'g7x',
    cameraName: 'Canon G7X III',
    takenAt,
    seed: 5,
    ...extra,
  };
}

test('addEntry puts newest first', () => {
  const roll = addEntry(addEntry([], entry('a')), entry('b'));
  assert.deepEqual(roll.map(e => e.uri), ['b', 'a']);
});

test('addEntry de-duplicates by uri so a re-develop replaces the entry', () => {
  const first = addEntry([], entry('a', 1, { cameraName: 'Old' }));
  const again = addEntry(first, entry('a', 2, { cameraName: 'New' }));
  assert.equal(again.length, 1);
  assert.equal(again[0].cameraName, 'New');
});

test('addEntry caps the roll length', () => {
  let roll: RollEntry[] = [];
  for (let i = 0; i < MAX_ROLL + 25; i++) roll = addEntry(roll, entry(`u${i}`, i));
  assert.equal(roll.length, MAX_ROLL);
  // The newest survive, the oldest fall off.
  assert.equal(roll[0].uri, `u${MAX_ROLL + 24}`);
});

test('removeEntry drops only the matching uri', () => {
  const roll = addEntry(addEntry([], entry('a')), entry('b'));
  const after = removeEntry(roll, 'a');
  assert.deepEqual(after.map(e => e.uri), ['b']);
});

test('removeEntry on a missing uri is a no-op', () => {
  const roll = addEntry([], entry('a'));
  assert.deepEqual(removeEntry(roll, 'nope'), roll);
});

test('updateEntry patches in place without reordering', () => {
  const roll = addEntry(addEntry([], entry('a')), entry('b'));
  const after = updateEntry(roll, 'a', { uri: 'a2', cameraName: 'Ricoh GR III' });
  assert.deepEqual(after.map(e => e.uri), ['b', 'a2']);
  assert.equal(after[1].cameraName, 'Ricoh GR III');
});

test('normalizeRoll returns empty for non-array input', () => {
  assert.deepEqual(normalizeRoll(null), []);
  assert.deepEqual(normalizeRoll({}), []);
  assert.deepEqual(normalizeRoll('nope'), []);
});

test('normalizeRoll drops malformed entries but keeps good ones', () => {
  const raw = [
    entry('good'),
    null,
    'string',
    { uri: '' },              // empty uri
    { noUri: true },          // missing uri
    entry('alsogood'),
  ];
  const out = normalizeRoll(raw);
  assert.deepEqual(out.map(e => e.uri), ['good', 'alsogood']);
});

test('normalizeRoll repairs bad field types', () => {
  const out = normalizeRoll([
    { uri: 'x', originalUri: 42, cameraId: null, cameraName: {}, takenAt: 'nope', seed: NaN },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].originalUri, null);
  assert.equal(out[0].cameraId, 'unknown');
  assert.equal(out[0].cameraName, 'Unknown');
  assert.equal(out[0].takenAt, 0);
  assert.equal(out[0].seed, 0);
});

test('normalizeRoll enforces the cap', () => {
  const raw = Array.from({ length: MAX_ROLL + 10 }, (_, i) => entry(`u${i}`));
  assert.equal(normalizeRoll(raw).length, MAX_ROLL);
});

test('groupByDay groups shots taken on the same day', () => {
  const day1 = new Date(2026, 0, 15, 9).getTime();
  const day1Later = new Date(2026, 0, 15, 18).getTime();
  const day2 = new Date(2026, 0, 16, 9).getTime();
  const groups = groupByDay([entry('a', day1), entry('b', day1Later), entry('c', day2)]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].items.length, 1);
});

test('groupByDay buckets undated shots separately', () => {
  const groups = groupByDay([entry('a', 0)]);
  assert.equal(groups[0].day, 'unknown');
});
