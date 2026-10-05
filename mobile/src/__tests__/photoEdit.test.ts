import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPhotoChanges } from '../photoEdit';
import { DEFAULT_RECIPE } from '../photoRecipe';

test('changing the camera requires Apply even with the same recipe', () => {
  assert.equal(hasPhotoChanges('ccd', DEFAULT_RECIPE, 'g7x', DEFAULT_RECIPE), true);
  assert.equal(hasPhotoChanges('original', DEFAULT_RECIPE, 'g7x', DEFAULT_RECIPE), true);
});

test('saving or favouriting with a freshly normalized recipe does not change the draft', () => {
  assert.equal(hasPhotoChanges('g7x', { ...DEFAULT_RECIPE }, 'g7x', { ...DEFAULT_RECIPE }), false);
  assert.equal(hasPhotoChanges('g7x', { ...DEFAULT_RECIPE, exposure: .25 }, 'g7x', { ...DEFAULT_RECIPE }), true);
});

test('Original ignores retained adjustments until a camera look is selected', () => {
  const adjusted = { ...DEFAULT_RECIPE, exposure: .5, dateStamp: true };
  assert.equal(hasPhotoChanges('original', adjusted, 'original', DEFAULT_RECIPE), false);
  assert.equal(hasPhotoChanges('g7x', adjusted, 'original', DEFAULT_RECIPE), true);
});

test('a custom developed look can be replaced with a bundled look without losing its identity', () => {
  assert.equal(hasPhotoChanges('ai', DEFAULT_RECIPE, 'ai', DEFAULT_RECIPE), false);
  assert.equal(hasPhotoChanges('g7x', DEFAULT_RECIPE, 'ai', DEFAULT_RECIPE), true);
});
