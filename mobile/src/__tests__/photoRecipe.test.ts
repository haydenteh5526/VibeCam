import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RECIPE, normalizeRecipe, sameRecipe } from '../photoRecipe';

test('corrupt or missing recipe values recover to safe defaults', () => {
  for (const value of [null, undefined, {}, 'broken', { amount: NaN, exposure: Infinity, warmth: 'hot', character: -Infinity, dateStamp: 'yes' }]) {
    assert.deepEqual(normalizeRecipe(value), DEFAULT_RECIPE);
  }
});

test('editing ranges clamp without losing valid values on restart', () => {
  assert.deepEqual(normalizeRecipe({ amount: 5, exposure: -9, warmth: 6, character: 9, dateStamp: true }),
    { amount: 1, exposure: -1.5, warmth: 1, character: 1.5, dateStamp: true });
  const edited = { amount: .7, exposure: .25, warmth: -.3, character: .5, dateStamp: true };
  assert.deepEqual(normalizeRecipe(JSON.parse(JSON.stringify(edited))), edited);
  assert.equal(sameRecipe(edited, { ...edited }), true);
  for (const [key, value] of Object.entries(DEFAULT_RECIPE)) {
    assert.equal(sameRecipe(edited, { ...edited, [key]: value }), false);
  }
});
