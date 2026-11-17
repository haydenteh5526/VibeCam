import { ActionSheetIOS, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { importSourcesFor, type ImportDeps, type ImportSource } from '../importPhoto';

// The system photo picker runs out of process and needs no Photos permission.
export const photoImportDeps: ImportDeps = {
  async pickFromPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false, base64: false,
    });
    return result.canceled ? null : { uri: result.assets[0].uri };
  },
  async pickFromFiles() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
    return result.canceled ? null : { uri: result.assets[0].uri };
  },
  async toUprightJpeg(uri) {
    const context = ImageManipulator.manipulate(uri);
    try {
      const image = await context.renderAsync();
      try { return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 1 })).uri; }
      finally { image.release(); }
    } finally { context.release(); }
  },
};

/** The one source this platform offers, or the person's choice from the iPhone action sheet; null if cancelled. */
export function chooseImportSource(): Promise<ImportSource | null> {
  const sources = importSourcesFor(Platform.OS);
  if (sources.length === 1) return Promise.resolve(sources[0]);
  return new Promise(resolve => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Photo Library', 'Files', 'Cancel'], cancelButtonIndex: 2 },
      index => resolve(index === 0 ? 'photos' : index === 1 ? 'files' : null),
    );
  });
}
