# Build Report in Settings (Issue #34) Implementation Plan

> **For agentic workers:** implement this plan task by task, test first, in the order given. Steps use checkbox (`- [ ]`) syntax for tracking. If a step cannot be done as written, stop and return the plan to the Architect.

**Status:** revision 1, approved by the owner on 16 November 2026 with separate approvals A, B and C as recommended and design decisions 4 to 9 as written. Nothing in this plan is implemented.

**Goal:** Let the person testing VibeCam open `Build details` in Settings, read exactly which build is installed (version, build number, install type, system version, video looks, live colour, cloud state) and share that text, so every device result names its build.

**Architecture:** A pure module turns a small `BuildInfo` record into seven fixed lines of text. A thin reader fills that record from the running app: `expo-application` for version, build and the iOS release type, React Native's `Platform` for the system version, `__DEV__` for the bundle kind, and the existing capability flags (`hasVideoLooks`, `supportsLiveColour`, `CLOUD_FEATURES_ENABLED`). A small `BuildDetails` component in the Settings about block shows the lines when opened and, on native, hands the same text to React Native's built-in `Share`. Nothing is fetched, stored or logged.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, `expo-application` (already installed), `node:test` through `tsx`. No new dependencies and no native code changes.

**Spec:** [Issue #34](https://github.com/haydenteh5526/VibeCam/issues/34) acceptance checks, under [epic #33](https://github.com/haydenteh5526/VibeCam/issues/33). Read both, [AGENTS.md](../../AGENTS.md), [CONTEXT.md](../../CONTEXT.md) and the [walkthrough](../../docs/RELEASE_READINESS.md#required-physical-iphone-walkthrough) before starting. The code this builds on is `mobile/src/screens/SettingsScreen.tsx`, `mobile/src/look/renderVideo.ts`, `mobile/src/components/LiveLookPreview.tsx` and `mobile/src/constants.ts`.

## Decisions

### Fixed by the owner

1. **Offline v1 stays offline.** The report makes no network request, asks for no permission and stores nothing. Cloud features stay off by default.
2. **No unrelated redesign.** The existing `Version … · Build …` line, `No account. No uploads.` and the rest of Settings stay as they are.
3. **Browser checks are not device evidence.** The share sheet and the install type are confirmed only on the signed preview ([#36](https://github.com/haydenteh5526/VibeCam/issues/36)).

### Separate approvals

All three were approved as recommended on 16 November 2026. The tasks implement the recommendation. The "if declined" notes record what the alternative would have changed.

- **A. The report does not include the iPhone model.** *Recommended.* React Native does not expose the model, and reading it needs `expo-device`, a new native dependency added just before the first signed build. The tester writes the model in the device-pass issue. *If declined:* add `expo-device` at the SDK 54 version, add a line `Device: <model name> (<model id>)` after `System`, and add its tests. Affects Tasks 1 and 2 and adds a dependency review.
- **B. The report does not include the Git commit.** *Recommended.* The EAS build page already records the commit for a build number, and embedding it means replacing the static `app.json` with a dynamic config, which touches the build configuration. *If declined:* this becomes a separate issue, not part of this plan.
- **C. The report is shown to every user, behind a closed `Build details` control.** *Recommended.* It keeps one binary for testing and release and shows nothing private. *Alternative:* hide the control unless the install type is not App Store. Declining C adds a rule and a test to Task 2.

### Design decisions to confirm

4. **Seven lines, always in this order, with this wording.**

   | Line | Text |
   | --- | --- |
   | 1 | `VibeCam build report` |
   | 2 | `Version <version> · Build <build>`, or `Version <version>` when there is no build number, or `Version unknown` when there is no version |
   | 3 | `Install: <label>`, with ` · development bundle` appended when the app runs a development bundle |
   | 4 | `System: <label>` |
   | 5 | `Video looks: available` or `Video looks: not in this build` |
   | 6 | `Live colour: available` or `Live colour: not available` |
   | 7 | `Cloud features: off` or `Cloud features: on (development)` |

   Install labels: `Ad hoc`, `App Store or TestFlight`, `Development signing`, `Enterprise`, `Simulator`, `Unknown`, and `Not an iPhone app` when the platform is not iOS. A signed preview is expected to read `Install: Ad hoc` with no development bundle. A development client is also ad hoc signed, and the `development bundle` suffix is what tells them apart.

   System labels: `iOS <version>`, `Android <version>`, `Web`, or the platform name alone when there is no version, and `Unknown` for any other platform.
5. **The formatter is pure and total.** It never throws, always returns seven strings, and each is one line with no leading or trailing space. Whitespace inside a version or build value is collapsed to single spaces.
6. **The facts are read each time the control is opened**, not at app start, so a failure to read them cannot affect startup. If reading fails, the panel shows `Build details are unavailable.` and no Share button.
7. **Share uses React Native's `Share.share({ message })`.** The message is the seven lines joined with a line break, identical to the text on screen. Dismissing the sheet is not an error. A rejected share shows `Could not share the build report. Select the text above to copy it.` The Share button is not rendered on web, where the text is selectable.
8. **Live colour on web reads `available`**, because the browser overlay exists there (`LiveLookPreview.web.tsx`). Line 4 reads `System: Web`, so the report cannot be mistaken for an iPhone result. *Alternative:* report live colour only on iOS.
9. **Placement:** directly under `No account. No uploads.` in the about block, closed by default.

## Global Constraints

- Branch `feature/issue-34-build-report`, cut from the branch that holds this approved plan (`main` once the workflow documents are merged; otherwise `claude/vibecam-architect-setup-33kztq`). Open a PR to protected `main`. Do not merge and do not enable auto-merge.
- No new dependency, no change to `package.json`, `package-lock.json`, `app.json`, `eas.json`, the workflows or `modules/vibecam-video`.
- `mobile/src/buildReport.ts` imports nothing from React Native, Expo or `services/`. It must load under `tsx --test`.
- `mobile/src/buildInfo.ts` and `BuildDetails.tsx` import nothing from `services/api` or `services/request` and call no `fetch`.
- Nothing is written to storage, settings or Film Roll, and nothing is logged to the console.
- Do not change capture, editing, Film Roll, Save, Share, the looks, or any existing Settings control or copy.
- Do not start an EAS build.
- Mobile gate, from `mobile/`: `npm ci`, `npm run typecheck`, `npm test`, and `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false npx expo export --platform all`.
- The PR uses `Part of #34`, not `Closes #34`: the share sheet check in the second acceptance check needs the signed preview. The issue closes when #36 records it.

## Review Focus

Inputs and conditions most likely to break it. Each has a test or a recorded check in the task named.

1. **No build number, a blank one, or no version** (web, or a native value that is `null`). No dangling ` · Build `, no `null` or `undefined` in the text. (Task 1)
2. **A release type the mapping does not know** (a new enum value, `undefined`, a string). It reads `Unknown`, and nothing throws. (Task 1)
3. **A development client mistaken for a preview.** Both are ad hoc signed. The suffix must appear exactly when `__DEV__` is true. (Tasks 1, 2)
4. **The shared text differs from the text on screen.** Both must come from one array. (Task 2)
5. **Reading the facts fails or is slow.** The panel says so, Settings stays usable, and a result that arrives after the panel was closed or the screen was left changes nothing. (Task 2)
6. **Double tap on Share**, cancelling the sheet, and a rejected share. One sheet at most, no error after a cancel, the stated message after a failure. (Task 2)
7. **The module imports something with a side effect.** `buildInfo.ts` must not pull in `services/api`, and opening the panel must make no request. (Task 2)
8. **Small screens and large text.** At 375x667 the lines wrap inside the about block and the controls keep a 44-point touch height. (Task 2)

## File Structure

| File | Responsibility |
| --- | --- |
| `mobile/src/buildReport.ts` (create) | `BuildInfo`, `InstallType`, `installTypeFromRelease`, `systemLabel`, `formatBuildReport`. Pure. |
| `mobile/src/__tests__/buildReport.test.ts` (create) | Unit tests for the three functions. |
| `mobile/src/buildInfo.ts` (create) | `readBuildInfo()`: reads the facts from the running app. |
| `mobile/src/components/BuildDetails.tsx` (create) | The `Build details` control, the report text and `Share build report`. |
| `mobile/src/screens/SettingsScreen.tsx` (modify) | Render `<BuildDetails />` under the existing two version lines. |
| `docs/RELEASE_READINESS.md`, `docs/DEPLOY.md`, `CONTEXT.md` (modify) | Say that device results use `Build details`. |
| `specs/Repo_Current_State.md`, `specs/Tickets.md` (modify) | Record what is implemented and what was run. |

---

### Task 1: The report formatter

**Files:**
- Create: `mobile/src/buildReport.ts`
- Test: `mobile/src/__tests__/buildReport.test.ts`

**Interfaces:**
- Produces:

```ts
export type InstallType = 'simulator' | 'enterprise' | 'development' | 'adHoc' | 'appStore' | 'unknown';

export type BuildInfo = {
  version: string | null;
  build: string | null;
  /** Already formatted with systemLabel. */
  system: string;
  /** null when the platform is not iOS. */
  install: InstallType | null;
  developmentBundle: boolean;
  videoLooks: boolean;
  liveColour: boolean;
  cloudFeatures: boolean;
};

export function installTypeFromRelease(value: unknown): InstallType;
export function systemLabel(os: string, version: string | number | null | undefined): string;
export function formatBuildReport(info: BuildInfo): string[];
```

- `installTypeFromRelease` maps the numeric `ApplicationReleaseType` of `expo-application` (`1` simulator, `2` enterprise, `3` development, `4` ad hoc, `5` App Store) and returns `'unknown'` for `0` and for anything else, including non-numbers. It does not import `expo-application`.
- `systemLabel`: `'ios'` → `iOS`, `'android'` → `Android`, `'web'` → `Web`, anything else → `Unknown`. For iOS and Android a non-empty version is appended after one space.
- `formatBuildReport` follows Decisions 4 and 5. Invariants: length 7; no element contains a line break; no element starts or ends with a space; the words `null` and `undefined` never appear.

- [ ] **Step 1: Write the failing tests** with `node:test` and `node:assert/strict`, in the style of `releaseMode.test.ts`. `PREVIEW` is `{ version: '1.0.0', build: '12', system: 'iOS 18.1', install: 'adHoc', developmentBundle: false, videoLooks: true, liveColour: true, cloudFeatures: false }`.

| Test | Assertions |
| --- | --- |
| `a signed preview reports its build, install type and capabilities` | `formatBuildReport(PREVIEW)` deep-equals `['VibeCam build report', 'Version 1.0.0 · Build 12', 'Install: Ad hoc', 'System: iOS 18.1', 'Video looks: available', 'Live colour: available', 'Cloud features: off']`. |
| `a missing or blank build number leaves only the version` | With `build` `null`, `''` and `'   '`: line 2 is `Version 1.0.0`. With `version` `null` or `''`: line 2 is `Version unknown`, also when a build number is present. |
| `whitespace in version and build is collapsed` | `version: ' 1.0.0\n'`, `build: '1 2\t3'` → line 2 is `Version 1.0.0 · Build 1 2 3`. |
| `every install type has its own label` | `adHoc` → `Install: Ad hoc`; `appStore` → `Install: App Store or TestFlight`; `development` → `Install: Development signing`; `enterprise` → `Install: Enterprise`; `simulator` → `Install: Simulator`; `unknown` → `Install: Unknown`; `null` → `Install: Not an iPhone app`. |
| `a development bundle is marked on the install line` | `{ ...PREVIEW, developmentBundle: true }` → `Install: Ad hoc · development bundle`. With `install: null` → `Install: Not an iPhone app · development bundle`. With `developmentBundle: false` the suffix is absent for every install type. |
| `missing capabilities and enabled cloud features are stated` | `videoLooks: false` → `Video looks: not in this build`; `liveColour: false` → `Live colour: not available`; `cloudFeatures: true` → `Cloud features: on (development)`. |
| `the release type from expo-application maps to an install type` | `1` → `simulator`, `2` → `enterprise`, `3` → `development`, `4` → `adHoc`, `5` → `appStore`; `0`, `6`, `-1`, `4.5`, `NaN`, `'4'`, `null`, `undefined`, `{}` → `unknown`. |
| `the system label names the platform and version` | `('ios', '18.1')` → `iOS 18.1`; `('ios', undefined)`, `('ios', '')` → `iOS`; `('android', 35)` → `Android 35`; `('web', undefined)` and `('web', '1')` → `Web`; `('windows', '11')` → `Unknown`. |
| `the report is always seven single lines` | For every combination of the seven install values, both values of each boolean, and `build` in `(null, '12')`: length is 7; no element matches `/[\r\n]/`; every element equals its own `trim()`; none contains `null` or `undefined`. |

- [ ] **Step 2: Run to see them fail.** Run from `mobile/`: `npm test` · Expected: `buildReport.test.ts` fails to load (`Cannot find module '../buildReport'`); the 84 existing tests still pass.

- [ ] **Step 3: Implement `buildReport.ts`.**

- [ ] **Step 4: Run.** `npm run typecheck` and `npm test` · Expected: clean; 93 tests pass (84 existing and 9 new), 0 fail.

- [ ] **Step 5: Commit.** `git commit -m "Format the build report as fixed lines of text"`

---

### Task 2: Build details in Settings

**Files:**
- Create: `mobile/src/buildInfo.ts`, `mobile/src/components/BuildDetails.tsx`
- Modify: `mobile/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: `BuildInfo`, `installTypeFromRelease`, `systemLabel`, `formatBuildReport` (Task 1); `hasVideoLooks` from `src/look/renderVideo`; `supportsLiveColour` from `src/components/LiveLookPreview`; `CLOUD_FEATURES_ENABLED` from `src/constants`; `theme` from `src/components/ui`.
- Produces, in `buildInfo.ts`:

```ts
export async function readBuildInfo(): Promise<BuildInfo>;
```

  - `version`: `Application.nativeApplicationVersion ?? appConfig.expo.version` (the expression `SettingsScreen` already uses, with `app.json` imported the same way).
  - `build`: `Application.nativeBuildVersion`.
  - `system`: `systemLabel(Platform.OS, Platform.OS === 'web' ? null : Platform.Version)`.
  - `install`: on iOS, `installTypeFromRelease(await Application.getIosApplicationReleaseTypeAsync())`, and `'unknown'` if that call rejects. On any other platform `null`, without calling it.
  - `developmentBundle`: `__DEV__`. `videoLooks`: `hasVideoLooks()`. `liveColour`: `supportsLiveColour`. `cloudFeatures`: `CLOUD_FEATURES_ENABLED`.
- Produces, in `BuildDetails.tsx`:

```ts
export function BuildDetails(props: { read?: () => Promise<BuildInfo> }): React.JSX.Element;
```

  `read` defaults to `readBuildInfo`. The component needs no provider.

**Behaviour.** Exact copy, because the checks match on it.

| State | Content |
| --- | --- |
| **Closed** (initial) | One `Pressable` with the text `Build details`, `accessibilityRole="button"`, `accessibilityLabel="Build details"`, `accessibilityState={{ expanded: false }}`. |
| **Open, read succeeded** | The same control with `expanded: true`. Below it one `<Text selectable>` whose content is the seven lines joined with `\n`. On every platform except web, a `Pressable` with the text `Share build report` and `accessibilityRole="button"`. |
| **Open, read failed** | The control, then `Build details are unavailable.` No Share button. |
| **Share failed** | Below the Share button, with `accessibilityRole="alert"`: `Could not share the build report. Select the text above to copy it.` |

- Pressing the control toggles it. Each opening calls `read()` again. Closing clears the lines and any share message.
- A result from `read()` is ignored if the panel has been closed, reopened or unmounted since the call started (compare a request counter held in a ref).
- `Share build report` calls `Share.share({ message })` where `message` is the same joined string that is on screen. While that promise is pending the button is disabled, so a second tap opens nothing. A resolved promise shows nothing, whatever action it reports. A rejected promise shows the share message. Pressing Share again clears the message first.
- No haptics, no navigation, no change to `settings`.

**Layout.** Centred like the rest of the about block. Both pressables have `minHeight: 44` and centred content. Control text: `theme.muted`, 12 px, weight 600. Report text: `theme.muted`, 11 px, line height 18, centred. Share text: `theme.accent`, 12 px, weight 600. Message text: `theme.muted`, 11 px, centred.

**Wiring.** In `SettingsScreen.tsx`, render `<BuildDetails />` as the last child of the `s.about` view, directly after the `No account. No uploads.` text. Change nothing else in that file.

There is no component test harness in this repository and none is added. This task is verified by the type check, the bundle export and the recorded browser check below. The native share sheet and install type are verified on the signed preview in #36.

- [ ] **Step 1: Implement `buildInfo.ts` and `BuildDetails.tsx`, and add the one line to `SettingsScreen.tsx`.**

- [ ] **Step 2: Run the mobile gate.** `npm run typecheck`, `npm test`, `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false npx expo export --platform all` · Expected: clean; 93 tests pass; iOS, Android and web bundles export.

- [ ] **Step 3: Check in the browser** with `npm run web` (`http://localhost:8081`), at 375x667 and at 390x844. Record what was seen at each size.
  1. Open Settings and scroll to the bottom. `Version 1.0.0` and `No account. No uploads.` are unchanged and `Build details` is below them, closed.
  2. Open it. The text is exactly:

     ```
     VibeCam build report
     Version 1.0.0
     Install: Not an iPhone app · development bundle
     System: Web
     Video looks: not in this build
     Live colour: available
     Cloud features: off
     ```

  3. There is no `Share build report` button. The text can be selected.
  4. With the browser's network log open, opening and closing the panel adds no request.
  5. Close and reopen it three times quickly. One block of text is shown and nothing is duplicated.
  6. Nothing overflows the screen at either size, and the control's accessible name and expanded state are reported by the browser's accessibility tree.

- [ ] **Step 4: Check the failure paths** by rendering the component with a substitute `read`, in a scratch file that is not committed, or by temporarily editing `readBuildInfo`. Record that a rejecting `read` shows `Build details are unavailable.` with no Share button, and that a `read` which resolves after the panel was closed shows nothing. Restore the code and confirm `git status` is clean of the temporary change.

- [ ] **Step 5: Confirm the import boundary.** Run from `mobile/`: `grep -nE "services/(api|request)|fetch\(" src/buildInfo.ts src/buildReport.ts src/components/BuildDetails.tsx` · Expected: no output.

- [ ] **Step 6: Commit.** `git commit -m "Show and share build details in Settings"`

---

### Task 3: Documents, review and pull request

**Files:**
- Modify: `docs/RELEASE_READINESS.md`, `docs/DEPLOY.md`, `CONTEXT.md`, `specs/Repo_Current_State.md`, `specs/Tickets.md`

- [ ] **Step 1: Update the documents.** State only what was run.
  - `docs/RELEASE_READINESS.md`: under "Implemented", one bullet that Settings has `Build details` with the seven facts and Share. In "Required physical iPhone walkthrough", change "Record Settings' Version/Build, device model and iOS version with each result" to say: share `Build details` from Settings and add the iPhone model.
  - `docs/DEPLOY.md` section 5: the same instruction in place of "Record Settings -> Version / Build".
  - `CONTEXT.md`: one line in "Architecture" naming `buildReport.ts`, `buildInfo.ts` and `BuildDetails`.
  - `specs/Repo_Current_State.md`: a verified-results row with the commit, environment, test count and the browser check, and a line under limits that the share sheet and install type are unverified until #36.
  - `specs/Tickets.md`: update the #34 row with the PR link and what remains.

- [ ] **Step 2: Run the mobile gate again** on the final commit and record the output.

- [ ] **Step 3: Request the independent review** described in [AGENTS.md](../../AGENTS.md#workflow): an Opus subagent with a fresh context, read-only, given this plan, issue #34 and the diff against the base branch. Show the owner its full report without shortening it. Apply only the findings the owner approves, rerun the affected checks, and ask for a follow-up review where a fix was not trivial.

- [ ] **Step 4: Commit, push and open the PR** to `main`. Title: `Show and share build details in Settings`. The body starts with `Part of #34`, maps each acceptance check to its test or recorded observation, lists what was not run (the native share sheet, the install type on a signed build, VoiceOver), and contains the Reviewer's full report with the disposition of each finding. Wait for `typecheck`, `ios-build` and `tests`. Do not merge.

---

## Acceptance check coverage

| Issue #34 acceptance check | Verified by |
| --- | --- |
| `Build details` shows version and build, install type, development bundle, system version, video looks, live colour and cloud state, each from the running app | Task 1 `a signed preview reports its build, install type and capabilities`, `every install type has its own label`, `a development bundle is marked on the install line`, `missing capabilities and enabled cloud features are stated`, `the release type from expo-application maps to an install type`, `the system label names the platform and version`; Task 2 interfaces (each field read from the running app) and Step 3.2 (web values). **Native values: device check in #36.** |
| In the installed iPhone app, Share opens the share sheet with the same text; cancelling shows no error; a failure shows a message and the text stays selectable | Task 2 behaviour (one string for screen and share) and Step 4 for the read failure. **The share sheet, cancel and failure on iOS: device check in #36.** Not verifiable before a signed build, which is why the PR uses `Part of #34`. |
| No network request, no permission, nothing stored; an offline build reports cloud features off | Task 2 Step 3.4 (network log), Step 5 (import boundary), Step 3.2 (`Cloud features: off`), Task 1 cloud test; Global Constraints. The existing test `offline builds reject API requests before contacting a server` is unchanged. |
| The existing version line and `No account. No uploads.` are unchanged, and the rest of Settings is unchanged | Task 2 Step 3.1; the diff of `SettingsScreen.tsx` is one added line and one import. |
| Accessible name and expanded state; works at 375x667 and 390x844 | Task 2 Step 3.6 at both sizes. VoiceOver on a device is not run in this plan and is recorded as such. |

## Found while planning, not in this plan

- `rollRepository.load()` drops a Film Roll entry whose developed file is missing even when its original exists, leaving the original on disk with nothing pointing to it.
- Import accepts JPEG and PNG from Files only. HEIC and the Photos library are not offered.
- The exported size of a portrait clip is not checked anywhere before a device (`AVAssetExportPreset1280x720`). It is an acceptance check of #38.
- `npm audit` reported 26 advisories on 15 November against 41 recorded on 6 October. Neither count has been reviewed.
- The repository has no component test harness, so Settings behaviour can only be checked by hand in a browser. Adding one would be a new dependency and its own issue.
- `VibeCamVideo.podspec` names a `vibe-cam` repository URL.
