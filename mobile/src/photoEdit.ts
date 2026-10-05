import { sameRecipe, type PhotoRecipe } from './photoRecipe';

/** Original has no adjustments. Preserve its draft recipe for switching back to a look. */
export function hasPhotoChanges(camera: string, recipe: PhotoRecipe, appliedCamera: string, appliedRecipe: PhotoRecipe): boolean {
  return camera !== appliedCamera || (camera !== 'original' && !sameRecipe(recipe, appliedRecipe));
}
