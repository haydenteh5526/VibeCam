# iPhone release readiness

Updated 2026-09-22. Target: iPhone first, retaining Expo SDK 54 for photo iteration in
Expo Go. Styled video requires a custom native build. This is a release candidate foundation, not a signed
or device-verified App Store build.

**Agreed v1 scope, expanded by the owner:** offline photo and short video looks, JPEG/PNG photo import, Film Roll, Save and Share.
All EAS profiles and the default app disable cloud features. No backend is required;
AI, uploads, Auto scene selection and server-only effects are hidden. Old settings
cannot re-enable them, and API calls are rejected before reaching the network.
`EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=true` is an explicit developer opt-in for later work.

## Implemented in this pass

- Captures and JPEG/PNG imports retain the original in app documents before developing.
  Film Roll keeps shots until the user deletes them; the UI suggests saving a separate copy to Photos.
- Re-developing and AI results commit through one photo state. Preview, Save, Share,
  Upload and Film Roll use that exact edit. A failed edit keeps the previous image.
- Film Roll migrates surviving old cached images, repairs missing original references,
  serializes writes and removes superseded files only after the index commits.
  Browser images and settings use IndexedDB and survive reloads.
- Offline camera selection works in preview. A server failure falls back to the local
  engine. Original bypasses grading; unavailable originals cannot be graded again.
- GL reads dimensions for native image URIs, keeps photo/LUT/target textures separate,
  checks the framebuffer, captures the intended dimensions and destroys the native context.
  LUT interpolation now addresses texel centres correctly.
- Server URLs and access keys use Expo's required static environment references.
  Requests have timeouts, and health is rechecked after foregrounding and during use.
- Effects route to the server; an offline fallback states which effects were omitted.
  Date stamps use the capture date when a shot is re-developed later.
- Photos saving requests add-only permission. Permission denial and failed writes are
  visible. Film Roll and importing stay accessible without camera permission.
- Repeated shutter/preview actions are guarded, and capture timers are cancelled on exit.
- Dependencies are updated within SDK 54, native modules deduplicated, and CI now exports
  release bundles as well as running typechecks and tests.
- App icon, splash and favicon use the existing VibeCam vector identity rather than
  Expo placeholders. Regenerate with `npm run assets:icons` after editing `docs/icons/icon.svg`.
- Photo and Video modes share the six camera choices. On iPhone, video recording runs
  for up to 15 seconds at 720p. A local Expo module applies the same camera colour LUT
  to every video frame during MP4 export, preserving audio when microphone access is
  granted. Film Roll retains the clip, original and poster; Save/Share use the styled MP4.
  Expo Go and web lack this native module, so Video mode explains the requirement there.

## Verification on Windows

- Mobile: 64 tests; TypeScript check passes. The video roll persistence path is covered.
- Backend: 118 tests, including browser access to grading response metadata.
- Expo Doctor: all 18 checks pass; SDK dependency versions are aligned.
- iOS, Android and web release bundle export passes. Export is not a signed native build.
- Real WebGL smoke check compiles the app's shaders and exercises the shared renderer:
  512 test pixels, maximum channel error 0/255, no GL feedback/framebuffer errors.
- Browser walkthrough: import a generated JPEG, develop as G7X, re-develop as RX100,
  upload, reload the page, reopen the same retained RX100 edit. Film Roll stayed at one shot.
  This walkthrough used the optional cloud development path. The default offline interface
  was subsequently checked: no AI, Upload, Auto or server-effect controls; Film Roll and
  settings remain accessible without camera permission. On-device looks remain native-only.
- iOS config introspection confirms camera, microphone and add-to-Photos permission descriptions.
  Autolinking discovers the local video module. EAS CLI is available but reports **Not logged in**.
- AI provider execution, native capture, Photos, native GL decoding/orientation, native video export/audio and sharing
  have not been verified on an iPhone.

Re-run checks:

```powershell
cd C:\vibe-cam\mobile
npm ci
npm run check:release
npx expo-doctor@latest
npm run test:gpu
# Open http://127.0.0.1:8082 and press Run GPU check.

cd C:\vibe-cam\backend
C:\vibe-cam\.venv\Scripts\python.exe -m pytest -q
```

## Required iPhone walkthrough

Use the iPhone 12 Pro Max and a standalone preview build for the final check.
Expo Go is useful for iteration but does not verify production permission strings or signing.

1. Fresh install: deny camera permission, open Film Roll, import a JPEG/PNG, then enable
   camera access in Settings and return. Confirm the camera becomes available.
2. Capture an asymmetric chart in portrait and landscape, front and back cameras.
   Check orientation, mirroring, dimensions, edges and the saved image in Photos.
3. In airplane mode, capture and re-develop with all six cameras. Repeat the same look:
   colour/grain should match. Confirm there is no Auto/cloud camera option.
4. Confirm no server requests on launch, capture, import, edit or foregrounding and
   no AI, Upload, date stamp, frame, dust or light-leak controls in this build.
5. Disable Auto-save, capture, force quit, reopen Film Roll and edit again. Confirm both
   the displayed image and the original survive restart. Repeat with low device storage.
6. Deny Photos permission: capture still belongs in Film Roll and Save reports the issue.
   Grant add-only permission and retry. Save twice must not create duplicate copies.
7. Change the look and save/share it. Compare each exported result to the preview and
   use Hold to compare to confirm the original is unchanged.
8. Use a timer, leave the camera before it fires, return and capture. Try quick repeated
   taps, background/foreground, deleting a shot, and reopening the newest thumbnail.
9. Verify import, settings, camera controls, permissions and errors with large text and VoiceOver.
10. In Video mode, grant and deny microphone access in separate runs. Record with each
    camera, stop early and let the 15-second limit stop a clip. Confirm exported colour,
    orientation, sound/silence, poster, restart persistence, restyling from the original,
    Photos Save and Share. Repeat in low storage and after backgrounding.

## Remaining release gates

- Produce and run a signed preview build with the owner's Expo/Apple accounts. Windows
  cannot run the iOS Simulator. Device signing requires Apple Developer membership.
- Compile and exercise the new Swift video module on an iPhone. Windows can validate
  autolinking and JavaScript bundles but cannot compile or execute its AVFoundation path.
- Resolve or explicitly assess remaining SDK 54 toolchain advisories. After compatible
  updates, npm audit reports 20 findings (11 moderate, 9 high, 0 critical). They trace to
  image-size/Metro, PostCSS and uuid/xcode toolchains; npm proposes an Expo major upgrade
  for several chains. Plan that migration separately with device regression testing.
- Review the updated offline privacy/store copy and verify published support/privacy URLs,
  screenshots, signing and metadata against the final binary. Local site edits are not published.

## Future cloud work (outside v1)

- Verify optional AI providers. The current vibe endpoint still implements a Gemini-specific
  request even when other providers are selected; public availability must wait for this
  integration to be corrected and tested. Core camera looks need no AI provider.
- Decide the public backend model before publishing. The existing shared access key is
  embedded in the app, and uploads are shared under that key, not isolated per account.
  Public multi-user uploads need user isolation, retention/deletion and abuse controls,
  or should be omitted from the first public release.
- Update the privacy disclosures again before exposing any cloud feature.

## Reference notes

- [Expo environment variable inlining](https://docs.expo.dev/guides/environment-variables/)
  requires direct `process.env.EXPO_PUBLIC_*` references. These values are public bundle data.
- [Expo Go version compatibility](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)
  documents SDK 54 compatibility and device-specific installation constraints.
- [EAS iOS device builds](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)
  explains signing and Apple Developer requirements.
