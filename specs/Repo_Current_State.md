# Repository current state

**Snapshot, 15 November 2026.** `main` is `5a25d95` (PR #32, merged 7 October 2026). VibeCam is an offline iPhone pocket-camera app built with Expo SDK 54. [CONTEXT.md](../CONTEXT.md) describes the product and architecture, and [release readiness](../docs/RELEASE_READINESS.md) lists what is implemented and the physical iPhone walkthrough. This snapshot records what was checked, when and on which commit. It does not repeat those documents.

## Capability

On `main` the app captures or imports a photo, develops it on the device with one of six looks or Original, lets the owner adjust and apply an edit, keeps the original and the applied edit in Film Roll, and saves or shares the applied edit. Custom iPhone builds also record clips of up to 15 seconds at 720p, apply the look's colour, and preview the colour live in the viewfinder on iOS 16 or later. Cloud and AI features are off unless a development build opts in.

All of this is verified by unit tests, browser checks and an unsigned compile. **None of it is verified on a signed build on a physical iPhone.** No signed preview build is recorded. [Epic #33](https://github.com/haydenteh5526/VibeCam/issues/33) covers that step, and the [ticket index](Tickets.md) lists its issues.

## Checked against the code on 15 November

Read from `5a25d95`, not run on a device.

- **Cloud off by default.** `cloudFeaturesEnabled` accepts only the string `true` (`mobile/src/releaseMode.ts`). `eas.json` sets `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` to `false` in `base`, and all three profiles extend it. CI sets it to `false`. A unit test shows an offline build rejects an API request before any fetch.
- **Retained originals and durable commits.** `mobile/src/rollRepository.ts` copies media into app documents before it writes the index and removes unreferenced files only after the write. `writeJson` keeps a `.bak` copy that `readJson` falls back to. `resolveRetainedImage` rebases stored paths when iOS moves the app container.
- **Export of the committed edit.** `saveEntry` and `onShare` in `mobile/App.tsx` use the entry returned by `rollStore.put`.
- **One LUT layout.** `LookCube.swift` (red fastest, sRGB working space) serves both video export and the live preview, and the macOS CI job compares it with the CPU reference for the photo shader.
- **Test count.** `mobile/src/__tests__` holds 84 tests, the number release readiness reports.

Documentation corrected with this snapshot: the branch rule in `CONTEXT.md` now points to [AGENTS.md](../AGENTS.md), `.github/copilot-instructions.md` (which named a retired branch and a historical document) now points there too, and `docs/LIVE_VIEWFINDER.md` no longer says CI compiles a Simulator app. CI compiles an unsigned iPhone Release app.

## Verified results

| Evidence | Result |
| --- | --- |
| [Hosted CI, 7 October](https://github.com/haydenteh5526/VibeCam/actions/runs/37703409884) on `5a25d95` (push to `main`) | `mobile-checks` passed: typecheck, unit tests, bundle export, the Core Image colour check and the unsigned iPhone Release compile on Xcode 26.2. `backend-tests` [passed](https://github.com/haydenteh5526/VibeCam/actions/runs/37703409737). |
| Local gates, 15 November, on `5a25d95` (Linux cloud container, Node 22.23.4, npm 10.9.9, Python 3.13.18) | Mobile: `npm ci`, `npm run typecheck` (clean), `npm test` (84 passed, 0 failed) and `npx expo export --platform all` with cloud features off (iOS, Android and web bundles exported). Backend: `python -m pytest -q` in a fresh virtual environment (120 passed). CI uses Node 20 and Python 3.11, so the versions differ from CI. `npm audit` reported 26 advisories (1 low, 18 moderate, 6 high, 1 critical), not assessed. Not run: `expo install --check`, `npx expo-doctor`, `npm run test:gpu`, `npm run test:camera`, the macOS `ios-build` job, and anything on a device. |
| Issue #34 build report, 16 November 2026, on `d763525` (branch `feature/issue-34-build-report`; only documents change after it) on Windows 11, Node 24.11.1, npm 11.6.2 | `npm ci`, `npm run typecheck` (clean), `npm test` (93 passed, 0 failed) and `npx expo export --platform all` with cloud features off (iOS, Android and web exported). Browser, `npm run web` at 375x667 and 390x844: `Build details` sat closed under `Version 1.0.0` and `No account. No uploads.`; opened, the text was exactly seven lines (`Install: Not an iPhone app · development bundle`, `System: Web`, `Video looks: not in this build`, `Live colour: available`, `Cloud features: off`); no Share button; no request on open or close; repeated toggling left one block; no horizontal overflow; control 44 px high; `aria-expanded` false, then true. Failure paths, with a temporary hook that was reverted: a rejecting read showed `Build details are unavailable.` with no Share button, and a read that resolved after close showed nothing. Not run: share sheet, install type and other native values (signed preview, #36), VoiceOver, Dynamic Type, `ios-build` (CI). |
| Local gates, 16 November, on `46a3321` (branch `feature/issue-35-eas-config-guard`, not merged; Windows 11, Node 24.11.1, npm 11.6.2) | Mobile: `npm ci`, `npm run typecheck` (clean), `npm test` (94 passed, 0 failed, up from 84 on `main`) and `npx expo export --platform all` with cloud features off (iOS, Android and web bundles exported). Each rule of the build configuration check was shown failing on the real files and restored: cloud features, Xcode on the EAS side, Xcode on the CI side, a development client on `preview`, a development client set under `preview.ios`, a Debug build configuration under `preview.ios`, and a missing microphone description. Commits after `46a3321` change only this row. Not run: hosted CI for this branch, the macOS `ios-build` job, and anything on a device. CI uses Node 20. |
| Issue #46 Film Roll fallback, 17 November 2026, on `6d45aed` (branch `feature/issue-46-roll-orphan`, not merged; only this row changes after it) on Windows 11, Node 24.11.1, npm 11.6.2 | `npm ci`, `npm run typecheck` (clean), `npm test` (109 passed, 0 failed, up from 103 on `main`) and `npx expo export --platform all` with cloud features off (iOS, Android and web bundles exported). Browser, `npm run web` at 1024x768: an entry seeded in the browser's IndexedDB with a developed image and an original; its developed image was made unfetchable and the page reloaded. Film Roll listed one item labelled `Original` with a loaded image, the stored index had `uri` equal to `originalUri`, `cameraId` `original`, favourite kept and saved status false; it opened in the editor, took the G7X III look through `Apply changes`, and was saved as `Kept in Film Roll · original preserved`. The entry was seeded by script, not captured or imported through the app, and web stores images inside the index, so this does not exercise iOS files. Not run: hosted CI for this branch, the macOS `ios-build` job, and anything on a device. CI uses Node 20. |

Results in [release readiness](../docs/RELEASE_READINESS.md#verification) dated October (browser walkthroughs, the GPU check, the camera interaction harness, Expo Doctor) are history from earlier commits. They were not repeated for this snapshot.

## Remaining evidence and limits

- **No device evidence.** Camera orientation and mirroring, Photos, sharing, microphone and audio tracks, video export, the live viewfinder, memory, heat and battery are all unchecked on hardware. The walkthrough has 11 steps. #37, #38 and #39 cover steps 1 to 10, and step 11 has no issue yet.
- **No device evidence is expected before January 2027.** The owner's Mac is not available until then and no paid Apple Developer Program membership is held, so the signed build for #36 is a local Release build on that Mac with a free Apple ID ([Mac route](../docs/DEPLOY.md#build-on-a-mac-without-a-paid-membership), [plan](plans/2026-11-16-issue-36-mac-build.md)). It stops opening 7 days after installation, so each device pass needs a recent install. The EAS preview needs the paid membership.
- **Build report unverified on a device.** The share sheet, its cancel and failure paths, the install type and the other native values of `Build details` are unverified until the signed preview in #36.
- **A signed build needs the owner.** Expo project access, an Apple Developer Program membership and a registered iPhone are required ([build guide](../docs/DEPLOY.md)). An agent session cannot do this.
- **Unknown until measured on a device.** The exported size of a portrait clip (the exporter uses the 1280x720 preset). Full-resolution Apply on a large import: the renderer refuses a source wider or taller than the GPU texture limit and keeps the original (`mobile/src/look/renderFrame.ts`).
- **Looks are interpretations.** No paired-shot calibration exists. See [camera fidelity](../docs/CAMERA_CALIBRATION.md).
- **Dependencies.** The audit count above differs from the 41 recorded on 6 October and has not been reviewed. Several fixes are expected to need an Expo major-version migration, which is separate work.
- **Build configuration check (issue #35, on a branch).** `npm test` checks the committed `eas.json`, `app.json` and mobile workflow. It cannot see variables stored on Expo's servers for the `development`, `preview` and `production` environments, a build started with a command-line override, or whether the named EAS image really contains that Xcode. The build guide asks the owner to check the Environment variables page before building.
- **Cloud features** stay outside v1 and are not release-ready.

## Observations with no issue yet

Found while reading the code on 15 November. None is confirmed as a user-visible fault.

- Import uses the Files picker and accepts JPEG and PNG only. HEIC files and the Photos library are not offered.
- `mobile/modules/vibecam-video/ios/VibeCamVideo.podspec` names a `vibe-cam` repository URL. It has no effect on the build.
