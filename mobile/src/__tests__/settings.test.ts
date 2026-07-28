/**
 * Unit tests for settings validation and header mapping.
 *
 * Run with `npm test` (tsx + node:test). These cover the pure logic in settingsCore;
 * the file I/O in settings.ts needs native modules and is exercised on device.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SETTINGS, gradeHeaders, normalize } from '../settingsCore';

test('normalize returns defaults for empty, null and undefined input', () => {
  assert.deepEqual(normalize({}), DEFAULT_SETTINGS);
  assert.deepEqual(normalize(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalize(undefined), DEFAULT_SETTINGS);
});

test('normalize survives a corrupt settings file', () => {
  // Every field the wrong type — the app must still come up with usable settings.
  const junk = {
    defaultCamera: 42,
    characterStrength: 'loud',
    dateStamp: 'yes',
    frame: {},
    lightLeak: [],
    dust: null,
    autoSave: 1,
    saveOriginal: 'no',
    haptics: 0,
    grid: 'true',
  };
  assert.deepEqual(normalize(junk), DEFAULT_SETTINGS);
});

test('normalize clamps numbers into range', () => {
  assert.equal(normalize({ characterStrength: 99 }).characterStrength, 1.5);
  assert.equal(normalize({ characterStrength: -5 }).characterStrength, 0);
  assert.equal(normalize({ lightLeak: 3 }).lightLeak, 1);
  assert.equal(normalize({ dust: -1 }).dust, 0);
});

test('normalize rejects NaN and Infinity', () => {
  assert.equal(normalize({ characterStrength: NaN }).characterStrength, DEFAULT_SETTINGS.characterStrength);
  assert.equal(normalize({ lightLeak: Infinity }).lightLeak, DEFAULT_SETTINGS.lightLeak);
});

test('normalize accepts valid values unchanged', () => {
  const s = normalize({
    defaultCamera: 'g7x',
    characterStrength: 1.25,
    dateStamp: true,
    frame: 'print',
    lightLeak: 0.5,
    dust: 0.25,
    autoSave: false,
    saveOriginal: true,
    haptics: false,
    grid: true,
  });
  assert.equal(s.defaultCamera, 'g7x');
  assert.equal(s.characterStrength, 1.25);
  assert.equal(s.dateStamp, true);
  assert.equal(s.frame, 'print');
  assert.equal(s.lightLeak, 0.5);
  assert.equal(s.dust, 0.25);
  assert.equal(s.autoSave, false);
  assert.equal(s.saveOriginal, true);
  assert.equal(s.haptics, false);
  assert.equal(s.grid, true);
});

test('normalize rejects unknown camera ids and frame styles', () => {
  assert.equal(normalize({ defaultCamera: 'leica_m11' }).defaultCamera, 'auto');
  assert.equal(normalize({ frame: 'polaroid' }).frame, 'none');
});

test('normalize accepts every real camera id', () => {
  for (const id of ['auto', 'g7x', 'rx100', 'gr', 'x100', 'ccd', 'powershot']) {
    assert.equal(normalize({ defaultCamera: id }).defaultCamera, id);
  }
});

test('gradeHeaders always sends character strength and seed', () => {
  const h = gradeHeaders(DEFAULT_SETTINGS, 123);
  assert.equal(h['X-Character'], '1');
  assert.equal(h['X-Seed'], '123');
});

test('gradeHeaders omits effects that are off', () => {
  const h = gradeHeaders(DEFAULT_SETTINGS, 1);
  assert.equal('X-Date-Stamp' in h, false);
  assert.equal('X-Frame' in h, false);
  assert.equal('X-Light-Leak' in h, false);
  assert.equal('X-Dust' in h, false);
});

test('gradeHeaders includes enabled effects', () => {
  const h = gradeHeaders(
    { ...DEFAULT_SETTINGS, dateStamp: true, frame: 'white', lightLeak: 0.5, dust: 0.75 },
    7,
  );
  assert.equal(h['X-Date-Stamp'], '1');
  assert.equal(h['X-Frame'], 'white');
  assert.equal(h['X-Light-Leak'], '0.5');
  assert.equal(h['X-Dust'], '0.75');
});

test('gradeHeaders sends an integer seed', () => {
  // The backend parses the seed with int(); a float would be rejected and silently
  // fall back to 0, quietly breaking reproducible re-develops.
  const h = gradeHeaders(DEFAULT_SETTINGS, 12.9);
  assert.equal(h['X-Seed'], '12');
  assert.match(h['X-Seed'], /^-?\d+$/);
});

test('gradeHeaders can express character off', () => {
  const h = gradeHeaders({ ...DEFAULT_SETTINGS, characterStrength: 0 }, 1);
  assert.equal(h['X-Character'], '0');
});

test('every header value is a string', () => {
  const h = gradeHeaders(
    { ...DEFAULT_SETTINGS, dateStamp: true, frame: 'black', lightLeak: 1, dust: 1 },
    5,
  );
  for (const [k, v] of Object.entries(h)) {
    assert.equal(typeof v, 'string', `${k} must be a string`);
  }
});
