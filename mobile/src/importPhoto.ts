// Decides what a photo import does. The pickers and the converter are passed in
// so this module needs no native code and its behaviour is tested in Node.
export type ImportSource = 'photos' | 'files';
export type PickedImage = { uri: string };
export type ImportDeps = {
  pickFromPhotos: () => Promise<PickedImage | null>; // null: cancelled
  pickFromFiles: () => Promise<PickedImage | null>; // null: cancelled
  toUprightJpeg: (uri: string) => Promise<string>; // returns the new file's URI
};

export const PHOTOS_UNAVAILABLE = "Couldn't open your photo library. You can still import from Files.";
export const IMPORT_FAILED = "This photo couldn't be imported. Try another photo, or import it from Files.";

/** Only the iPhone has a Photos library to offer; elsewhere Import opens Files directly. */
export function importSourcesFor(platform: string): ImportSource[] {
  return platform === 'ios' ? ['photos', 'files'] : ['files'];
}

/** Resolves the URI to hand to the editor, or null when the person cancelled. */
export async function importPhoto(source: ImportSource, deps: ImportDeps): Promise<string | null> {
  if (source === 'files') return (await deps.pickFromFiles())?.uri ?? null;
  let picked: PickedImage | null;
  try { picked = await deps.pickFromPhotos(); }
  catch { throw new Error(PHOTOS_UNAVAILABLE); }
  if (!picked) return null;
  // A library photo may be HEIC or carry an orientation tag, so every one is rewritten as an upright JPEG.
  try { return await deps.toUprightJpeg(picked.uri); }
  catch { throw new Error(IMPORT_FAILED); }
}
