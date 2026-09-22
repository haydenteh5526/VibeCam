import { deleteRetainedImage, fileExists, readJson, retainImage, resolveRetainedImage, writeJson } from './services/storage';
import { createRollRepository } from './rollRepository';

export * from './roll';

export const rollStore = createRollRepository({
  read: () => readJson('vibecam-roll.json'),
  write: roll => writeJson('vibecam-roll.json', roll),
  retain: retainImage,
  exists: fileExists,
  resolve: resolveRetainedImage,
  remove: deleteRetainedImage,
});
