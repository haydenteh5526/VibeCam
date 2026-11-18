# Import from the Photos Library, Including HEIC (Issue #45) Implementation Plan

> **For agentic workers:** implement this plan task by task, test first, in the order given. Steps use checkbox (`- [ ]`) syntax for tracking. If a step cannot be done as written, or a result contradicts what this plan expects, stop and return the plan to the Architect.

**Status:** revision 1, approved by the owner on 17 November 2026 with separate approvals A, B and C as recommended and design decisions 4 to 8 as written. Nothing in this plan is implemented.

**Goal:** On iPhone, Import offers the Photos library as well as Files; a photo chosen there, HEIC included, enters Film Roll as an upright, full-resolution JPEG and opens in the editor like a capture.

**Architecture:** A pure module, `mobile/src/importPhoto.ts`, decides what an import does (which sources a platform offers, cancel, conversion, error copy) with its pickers and converter passed in, so it is unit-tested in Node. A thin native module, `mobile/src/services/photoImport.ts`, supplies the real pickers (`expo-image-picker` for Photos, `expo-document-picker` for Files, as today), the converter (`expo-image-manipulator`, already a dependency) and the iOS action sheet. `onImport` in `App.tsx` chooses a source, imports, and hands the resulting URI to the existing `capturePhoto`, so Film Roll, the editor and Save see nothing new.

**Tech Stack:** TypeScript, `node:test` through `tsx`, `expo-image-picker` ~17.0.11 (new), `expo-image-manipulator` ~14.0.8 and `expo-document-picker` ~14.0.8 (existing), React Native `ActionSheetIOS`.

**Spec:** [Issue #45](https://github.com/haydenteh5526/VibeCam/issues/45). Read it, [AGENTS.md](../../AGENTS.md), `mobile/App.tsx` (`onImport`, `capturePhoto`), `mobile/src/look/previewSource.ts` (how the manipulator is already used) and `mobile/app.json` before starting.

## What planning found

Read on `main` at `24838b9` and in Expo's `sdk-54` sources on 17 November 2026. Not run on a device.

- `onImport` (`App.tsx`, line 216) calls `DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false })` and passes the URI to `capturePhoto`. It is wired to two buttons: `Import photo` in Film Roll (`RollScreen.tsx`, line 80) and `Import a photo` on the camera-permission screen (`PermissionScreen.tsx`, line 18). `CameraScreen` has no import button.
- `capturePhoto` retains the original through `rollStore.put` before developing, so a URI in the picker's cache is copied into app documents. Nothing else is needed for durability.
- Expo's SDK 54 list (`node_modules/expo/bundledNativeModules.json`) names `expo-image-picker` `~17.0.11`. It is not installed today.
- **The Photos picker needs no Photos permission.** `launchImageLibraryAsync` in `expo-image-picker/ios/ImagePickerModule.swift` (`sdk-54`) presents `PHPickerViewController` and checks no permission; only the camera source checks one. The picker runs out of process and shows the whole library whatever the app's Photos access is (None, Limited or Full).
- **What the picker returns.** In `MediaHandler.swift`, with `quality: 1`, no editing and `preferredAssetRepresentationMode: current` (the default), it copies the original file: a HEIC photo arrives as a `.heic` file with its EXIF orientation tag, not upright pixels.
- **The converter makes it upright.** `expo-image-manipulator` (`ImageManipulatorModule.swift`, `sdk-54`) decodes through `UIImage(data:)`, which reads HEIC on iOS, adds `ImageFixOrientationTransformer` as soon as an image loads, and `saveAsync({ format: JPEG, compress })` writes `jpegData`. The output is an upright JPEG at the source's pixel size.
- **Config plugin.** `expo-image-picker`'s plugin only fills `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` when they are missing; passing `false` deletes them. `app.json` already sets all three, and `tools/config-guard.ts` requires them, so the plugin is not needed.
- **Web** has no Photos library; the browser `Import photo` keeps opening the file chooser, as today.

## Decisions

### Fixed by the owner (from the issue)

1. **Offline.** No network request from the app, cloud features stay off.
2. **Scope:** one photo at a time from the Photos library, HEIC accepted, Files import stays. No video import, no multiple selection, no Android work.
3. **No Expo SDK change.** `expo-image-picker` is the SDK 54 version.

### Separate approvals

- **A. Add `expo-image-picker` ~17.0.11 for the Photos library.** *Recommended.* It is Expo's SDK 54 picker, uses the system `PHPickerViewController`, and needs no Photos permission. *Alternative:* a local native module around `PHPickerViewController`, which is more code to keep for the same result.
- **B. No Photos permission prompt and no "access denied" message for import.** *Recommended.* The system picker works with Photos access set to None, Limited or Full, so nothing is blocked and there is nothing to explain; asking for read access the picker does not use would add a prompt and a denial path for no benefit. The acceptance check "If Photos access is denied or limited, the app explains what to do" is met by import working in every state, recorded on the iPhone in #37. If the picker fails to open, the app says so and points to Files (Decision 6). *Alternative:* request read access before opening the picker and explain a denial, which this plan does not cover.
- **C. Every Photos import becomes a full-resolution, upright JPEG before it enters Film Roll, and the HEIC file is not kept.** *Recommended.* The editor, Save and Share handle JPEG today, so nothing downstream changes. JPEG quality is 1.0, so the file is larger than the HEIC. The conversion drops EXIF metadata (location, camera, capture date); Film Roll already dates imports by import time (walkthrough step 4). *Alternative:* keep the HEIC as the original and convert only for rendering, which would need HEIC support in the editor, Save and Share.

### Design decisions to confirm

4. **Choosing the source.** On iPhone, both Import buttons show the system action sheet with `Photo Library`, `Files` and `Cancel` (cancel index 2). On web and Android, Import opens Files directly, as today.
5. **Files import is unchanged:** JPEG and PNG, no conversion.
6. **Copy, exact:**
   - Photos picker fails to open: `Couldn't open your photo library. You can still import from Files.`
   - Conversion fails: `This photo couldn't be imported. Try another photo, or import it from Files.`
   - Cancelling the action sheet or either picker shows nothing and leaves the screen as it was.
7. **Picker options, exact:** `{ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false, base64: false }`. Converter: `ImageManipulator.manipulate(uri).renderAsync()` then `saveAsync({ format: SaveFormat.JPEG, compress: 1 })`, releasing the context and image in `finally`, as `previewSource.ts` does.
8. **No `expo-image-picker` entry in `app.json` `plugins`.** If `npx expo install` adds one, remove it. The four `infoPlist` usage strings stay exactly as they are.

## Global Constraints

- Branch `feature/issue-45-photos-import`, which holds this plan. #44 is merged (`2dfbb4d`) and this branch already contains it; run `git merge origin/main` first anyway in case `main` has moved, then install. PR to protected `main`. Do not merge.
- Code changes only in: `mobile/src/importPhoto.ts` (new), `mobile/src/services/photoImport.ts` (new), `mobile/src/__tests__/importPhoto.test.ts` (new), `mobile/App.tsx` (`onImport` and imports only), `mobile/package.json` and `mobile/package-lock.json` (only `expo-image-picker`). No change to the screens, `rollRepository.ts`, the renderers, `app.json`, `eas.json` or the workflows.
- `mobile/src/importPhoto.ts` imports nothing from React Native or Expo, so its tests run in Node.
- Install with `npx expo install expo-image-picker` from `mobile/`. Afterwards `expo`, `react`, `react-native` and every other `expo-*` version are unchanged (compare `npm ls expo react react-native --depth=0` and the `expo-*` versions before and after), and the lockfile contains no `58.x` Expo package.
- No Claude or AI attribution in commits, PRs, issues or comments. Do not start an EAS build or run any `eas` command.
- Browser checks use the desktop app's built-in browser pane, never the owner's Chrome.
- Mobile gate, from `mobile/`: `npm ci`, `npm run check:release` (typecheck, tests, `expo install --check`, export with `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false`). Record the test count before and after; this plan adds 7.

## Review Focus

1. **Cancelling** the action sheet or either picker leaves no error, no spinner and no new Film Roll entry. (Task 1 tests 3 and 4; App wiring in Task 2)
2. **A HEIC or rotated photo stored as-is.** Every Photos result goes through the converter, even a JPEG. (Task 1 tests 1 and 2)
3. **A Photos failure blocking Files.** After the Photos picker throws, Files import still works. (Task 1 test 5)
4. **A double tap** opening two pickers. The whole import runs inside `run`, whose lock already serialises actions. (Task 2 Step 1)
5. **Usage strings changed by the new package.** `npx expo config --type introspect` shows the same four strings as `app.json`. (Task 2 Step 3)

---

### Task 1: Import decisions, tested in Node

**Files:**
- Create: `mobile/src/importPhoto.ts`
- Test: `mobile/src/__tests__/importPhoto.test.ts`

**Interfaces (produced, used by Task 2):**
```ts
export type ImportSource = 'photos' | 'files';
export type PickedImage = { uri: string };
export type ImportDeps = {
  pickFromPhotos: () => Promise<PickedImage | null>;   // null: cancelled
  pickFromFiles: () => Promise<PickedImage | null>;    // null: cancelled
  toUprightJpeg: (uri: string) => Promise<string>;     // returns the new file's URI
};
export const PHOTOS_UNAVAILABLE: string;   // Decision 6, first line
export const IMPORT_FAILED: string;        // Decision 6, second line
export function importSourcesFor(platform: string): ImportSource[];
export function importPhoto(source: ImportSource, deps: ImportDeps): Promise<string | null>;
```

- [ ] **Step 1: Write the failing tests** with fake `ImportDeps` that record their calls.

| # | Test | Assertions |
| --- | --- | --- |
| 1 | `a photo from the library is converted before import` | `pickFromPhotos` returns `{ uri: 'cache/IMG_1.heic' }`, `toUprightJpeg` returns `'cache/IMG_1.jpg'`: `importPhoto('photos', deps)` resolves `'cache/IMG_1.jpg'`; `toUprightJpeg` was called once with `'cache/IMG_1.heic'`; `pickFromFiles` was not called. |
| 2 | `a JPEG from the library is converted too` | Picked `cache/IMG_2.jpg`: `toUprightJpeg` is called once with it and its result is returned. |
| 3 | `cancelling the library picker imports nothing` | `pickFromPhotos` returns `null`: resolves `null`; `toUprightJpeg` not called. |
| 4 | `files import is unchanged, and cancelling it imports nothing` | `pickFromFiles` returns `{ uri: 'cache/a.png' }`: resolves `'cache/a.png'`, `toUprightJpeg` not called. Returning `null`: resolves `null`. |
| 5 | `a library that will not open points to Files, which still works` | `pickFromPhotos` rejects: `importPhoto('photos', deps)` rejects with an `Error` whose message equals `PHOTOS_UNAVAILABLE`, which equals the copy in Decision 6; then `importPhoto('files', deps)` with the same deps resolves the Files URI. |
| 6 | `a photo that cannot be converted is not imported` | `toUprightJpeg` rejects: rejects with message `IMPORT_FAILED`, equal to the copy in Decision 6. |
| 7 | `only the iPhone offers the library` | `importSourcesFor('ios')` deep-equals `['photos', 'files']`; `'web'` and `'android'` give `['files']`. |

- [ ] **Step 2: Run to see them fail.** From `mobile/`: `npm test` · Expected: the 7 new tests fail (module missing), every other test passes. Record the count.
- [ ] **Step 3: Implement** `mobile/src/importPhoto.ts` with the interfaces above. A rejection from a picker other than the Photos one is passed through unchanged.
- [ ] **Step 4: Run.** `npm run typecheck` and `npm test` · Expected: clean; 7 more passing tests than `main`, 0 fail.
- [ ] **Step 5: Commit.** `git commit -m "Decide how a photo import from Photos or Files is handled"`

### Task 2: Native pickers, the source sheet and `onImport`

**Files:**
- Create: `mobile/src/services/photoImport.ts`
- Modify: `mobile/App.tsx` (`onImport` and its imports), `mobile/package.json`, `mobile/package-lock.json`

**Interfaces:**
- Consumes: Task 1's `ImportSource`, `ImportDeps`, `importSourcesFor`, `importPhoto`.
- Produces: `export const photoImportDeps: ImportDeps;` and `export function chooseImportSource(): Promise<ImportSource | null>;` in `photoImport.ts`.

- [ ] **Step 1: Install and wire.**
  - Record the version listing of Global Constraints, then `npx expo install expo-image-picker`; apply Decision 8; repeat the listing and show only `expo-image-picker` was added.
  - `photoImportDeps`: `pickFromPhotos` calls `launchImageLibraryAsync` with Decision 7's options and returns `null` when `canceled`, else `{ uri: assets[0].uri }`; `pickFromFiles` moves today's `getDocumentAsync` call here unchanged; `toUprightJpeg` follows Decision 7.
  - `chooseImportSource`: when `importSourcesFor(Platform.OS)` has one entry, resolve it; otherwise show `ActionSheetIOS.showActionSheetWithOptions({ options: ['Photo Library', 'Files', 'Cancel'], cancelButtonIndex: 2 }, …)` and resolve `'photos'`, `'files'` or `null`.
  - `onImport` stays inside `run`: choose the source; on `null` return; `importPhoto(source, photoImportDeps)`; on `null` return; otherwise `capturePhoto(uri, effectiveSettings.defaultCamera, screen === 'roll' ? 'roll' : 'camera')` as today.
- [ ] **Step 2: Gates.** Delete `node_modules`, `npm ci`, `npm run check:release` · Expected: typecheck clean, the Task 1 count, 0 fail, `expo install --check` up to date, export OK. Record the output.
- [ ] **Step 3: Usage strings.** `npx expo config --type introspect` · Expected: `ios.infoPlist` has the same `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryAddUsageDescription` and `NSPhotoLibraryUsageDescription` strings as `app.json`. Record them.
- [ ] **Step 4: Browser check** in the built-in browser with `npm run web`: Film Roll `Import photo` opens the file chooser directly with no sheet, a JPEG imports and opens in the editor, and cancelling the chooser leaves Film Roll unchanged with no error. Record what was seen. This says nothing about iPhone behaviour.
- [ ] **Step 5: Commit.** `git commit -m "Import a photo from the Photos library on iPhone"`

### Task 3: Documents, review and pull request

- [ ] **Step 1: Documents.**
  - `CONTEXT.md`, Architecture: add a line that import on iPhone offers the Photos library (system picker, no Photos permission) and Files, and that Photos imports are stored as upright JPEG.
  - `docs/RELEASE_READINESS.md`: under Implemented, the same in one sentence; walkthrough step 1, append: "Import from Photo Library a HEIC photo taken in portrait and one in landscape, with Photos access set to None, then Limited, then Full; each opens upright in the editor and develops with every look. Cancel each picker."
  - `specs/Repo_Current_State.md`: remove the observation "Import uses the Files picker and accepts JPEG and PNG only…", add a verified-results row with the commit, environment, test count and the Step 4 browser result.
  - `specs/Tickets.md`: update the #45 row.
- [ ] **Step 2: Independent review** as [AGENTS.md](../../AGENTS.md#workflow) describes: an Opus `reviewer` subagent with a fresh context, read-only, given this plan, issue #45 and the diff against `main`. Show the owner its full report. Apply only what the owner approves.
- [ ] **Step 3: Push and open the PR** titled `Import a photo from the Photos library on iPhone`. The body starts with `Part of #45`: the issue's last check needs the iPhone pass in #37. It maps each acceptance check to its test or to #37, records what was run and not run, and contains the Reviewer's full report with the disposition of each finding. Wait for `typecheck`, `ios-build` and `tests`. Do not merge.

---

## Acceptance check coverage

| Issue #45 acceptance check | Verified by |
| --- | --- |
| Import offers Photos as well as Files; a chosen photo opens in the editor like a capture | Task 1 tests 1 and 7; Task 2 wiring through `capturePhoto`. iPhone: #37, walkthrough step 1. |
| A HEIC photo imports and develops with every look; the kept original is upright, full resolution, and not the HEIC file | Task 1 tests 1 and 2 (always converted); Decision C. Upright and every look: #37 only. |
| Cancelling either picker returns to where you were, with no error | Task 1 tests 3 and 4; Task 2 Step 4 (web). iPhone: #37. |
| Photos access denied or limited: the app explains what to do, and Files still works | Decision B (import works in every state), Task 1 test 5. iPhone with None, Limited, Full: #37. |
| No network request, cloud features stay off | No network code added; the export runs with cloud features off. iOS may fetch an iCloud original inside its own picker; record it in #37. |
| iPhone pass in #37 records Photos import and HEIC; until then `Part of` | Task 3 Step 3. The Architect adds the #45 steps to #37 after merge, with the owner's yes. |

## Found while planning, not in this plan

- Files imports are not orientation-normalised. A JPEG from Files with an EXIF rotation tag may show sideways; unobserved, record in #37 if seen.
- The converted JPEG and the picker's copy stay in the purgeable cache until iOS clears it, as Files imports do today.
- A HEIC larger than the GPU texture limit is refused at Apply and the original kept (`renderFrame.ts`), as for any large import.
- `NSPhotoLibraryUsageDescription` says the app saves photos; the picker never shows it. Rewording it is separate.
