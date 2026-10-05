# iPhone release readiness

Updated 2026-10-05. Target: an offline iPhone camera with photo and short video looks.
This is a tested development foundation, not yet a device-verified App Store binary.

## Implemented

- A consistent pocket-camera interface, accessible labelled controls, safe areas,
  responsive viewfinder and compact camera selector on short screens.
- Photo/video mode, actual hardware lens choices when available, flash/torch, timer
  with cancellation, grid, digital zoom and microphone permission handling.
- One camera picker across capture, editing and settings; the last selected camera is remembered.
- Live colour previews for six looks in custom iPhone builds (iOS 16+) and the browser. Compare
  Original/Look without changing the selected capture look. Native processing shares
  the existing capture session; browser processing shares the existing camera stream.
  Late frames are dropped, display size is capped, and preview failure exposes the raw
  feed with Retry. iOS 15, Expo Go, older builds and Android keep the raw feed without a dead
  Retry control. Photo character/date are added after capture, as the caption explains.
- Six offline photo looks plus Original. Strength, exposure, warmth and texture adjustments
  and an amber date stamp are stored per photo. Interactive editing previews use the
  export shader; Apply renders and commits at full quality. Camera changes are previewed
  before committing. Discard restores the last applied edit; leaving a draft asks first.
- The editor keeps the photo visible above compact adjustment panels. Save/Share only
  appear after applying/discarding a draft, preventing export of an older edit by mistake.
  GPU previews draw on changes (no continuous render loop) and release on background.
  One resized source (long edge at most 1280px) is reused across camera choices; native
  decode jobs are serialized and temporary thumbnails are deleted when editing ends.
  Preview failure clearly shows the last applied edit and still allows full-quality Apply.
- Corrected an existing LUT axis mismatch: green and blue were swapped by the photo
  shader and video table generator. Both now follow the actual PNG .cube ordering.
- Highlight compression is monotonic, never brightens highlights and preserves hue.
- Film Roll retains originals, rendered media and video posters in app documents
  (IndexedDB in a browser); edits do not compound. Favourites, save status, date grouping,
  photo/video filters and confirmed bulk deletion are available.
- Save and Share use the committed edit. Failed processing retains the original;
  failed index writes preserve the previous version. Browser downloads can be retried.
- Photos saving requests add-only permission. Import and Film Roll remain available
  without camera permission. Camera timers cancel and playback pauses on backgrounding.
- Native video: six colour LUTs, up to 15 seconds, 720p, original retention, restyling,
  poster, audio when microphone access is granted, and save/share of the styled MP4.
  Video requires a custom iPhone build; Expo Go and web explain this.
- Offline builds disable all backend traffic and hide AI, uploads, Auto scene selection,
  frames, dust and light leaks. Date stamps now work offline for photos.
  EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=true remains a developer-only opt-in.

## Verification

- 79 mobile tests and TypeScript pass, including recipe validation, metadata restart,
  atomic bulk deletion and real bundled video LUT ordering.
- 120 backend tests pass, including highlight monotonicity and hue preservation.
- Expo Doctor: 18/18 checks after installing the SDK-compatible expo-font peer.
- iOS, Android and web bundle export passes; GitHub CI also exports final PR bundles.
- GPU test: 32,768 pixels, identity error 0/255, all six actual bundled PNG tables
  within 0.58/255 of the CPU interpolation reference. Zero strength, +1 EV and
  lower-right stamp placement also pass. Interactive preview matches the export target
  exactly at test resolution (0/255), including repeated exposure adjustment and revert.
  Display scaling and JPEG compression can affect screen/export pixel comparisons.
- The shared native Core Image colour filter matches the CPU/photo LUT reference
  within 0.56/255 across 4,096 colours for each of the six looks and an identity table.
  Both live preview and video export explicitly use the LUT's encoded sRGB working space.
  This validates the transform, not physical camera capture or screen colour calibration.
  The native Metal test also checks all four corners of portrait/landscape pixel buffers
  through the actual aspect-fill presentation path, catching and fixing a vertical flip.
- Browser live viewfinder at 390x844 and 375x667: all six camera colours verified on
  a controlled moving canvas feed, Original/Look toggling, active-look reselection,
  front/back mirroring, capture while comparing Original (selected look still saved),
  compact picker, GPU context-loss fallback/retry and stalled-feed fallback. Repeated
  toggling leaves one preview surface; capture remains available after preview failure.
  The GPU check also exercises repeated source-frame replacement without stale pixels.
- Browser walkthrough at 428x926 and 375x667: JPEG import, camera changes, adjustments,
  stamp, compare, favourites, reload persistence, settings return, filtering and
  confirmed deletion. Fake browser camera capture and timer cancellation pass.
- Browser downloads complete when the automation browser has an explicit download
  directory. The downloaded JPEG was opened and visually verified; retry also works.
- Review regressions checked in the browser: unapplied exposure survives favourite
  and save actions; custom AI results retain their stored style name and cannot open
  unsupported adjustment controls. AI preview verification used stored test metadata,
  not a live provider request.
- Interactive editor walkthrough: all six draft looks, Original, exposure/date previews,
  Compare, Apply, Discard, leaving/keeping a draft, favourite preservation and reload.
  Injected WebGL context loss falls back to the applied edit; Apply still succeeds.
  Repeated adjustments after context loss cannot falsely report a recovered preview.
  A browser 8064x6048 import uploads only a 1280x960 preview texture, and three camera
  choices reuse the same resized source. Native decode peak memory still needs profiling.
  Injected IndexedDB write failure leaves the draft pending and permits a successful retry.
  Browser WCAG 2 A/AA audit reports zero violations; icon contrast, the live video
  surface and native VoiceOver still require manual verification. The full web audit
  also flags existing document heading/landmark structure outside the WCAG-tagged run.
- PR #27 compiled successfully in GitHub's macOS iOS Simulator job.
  Native camera, Photos, orientation, video/audio export and sharing still require hardware.

## Required physical iPhone walkthrough

Use a signed standalone preview build, including the local video module.

1. Deny camera, open Film Roll and import. Enable camera in Settings and return.
2. Capture an asymmetric chart in portrait/landscape, front/back and each available
   lens. Check orientation, mirroring, framing, resolution and the copy in Photos.
3. In airplane mode, capture/redevelop with all six looks and compare to the original.
   Verify greens stay green and blue patches stay blue. Repeat the same edit to check
   deterministic grain. Test strength zero, exposure extremes, warmth and date stamp.
4. Confirm no backend requests. The date is the Film Roll capture/import date;
   imported EXIF capture dates are not currently extracted.
5. Disable auto-save, capture, force quit, reopen, favourite and edit. Confirm originals,
   recipes, saved state and favourites persist. Exercise storage-full failures.
6. Deny Photos access, capture, grant add-only access and retry Save. Saving the same
   unchanged native edit twice must not create duplicates. Restyle then save again.
7. Compare the interactive draft, applied edit, Photos and shared JPEG. Exercise rapid
   camera/adjustment changes, Compare, Discard, leaving a draft, and background/resume.
   Verify native preview orientation, memory release and full-resolution export. Preview
   failure must retain the applied edit; failed Apply must keep the draft for retry.
8. Test timer cancellation, rapid taps, background/foreground, compact screens,
   bulk-delete cancellation/confirmation, large text and VoiceOver.
9. Record each video look with and without microphone permission; stop early and at
   the 15-second limit. Verify colour, dimensions, orientation, sound, poster, restyle,
   restart, Photos and Share. Repeat after backgrounding and in low storage.
10. Check live colour on every lens and mode: portrait orientation, aspect-fill crop,
    front mirroring, Original/Look, fast selection, interruptions and background/resume.
    Ensure video/audio recording remains reliable with the optional preview output.
    Failure must reveal the raw camera, never leave a frozen styled image. Test Retry.
    Compare colour-only preview with exports, allowing for photo character/date finishing.
11. Measure repeated-capture latency, peak memory, warm-device performance and battery.

## Remaining release gates

- A signed preview/TestFlight build and the physical iPhone walkthrough above.
- Measured paired-shot calibration; see CAMERA_CALIBRATION.md. The live viewfinder
  previews colour, not the full photo finish or real-camera optics. Do not advertise exact matching.
- Review final privacy/support URLs, store copy and screenshots against the actual binary.
- Assess remaining SDK 54 toolchain advisories (35: 11 moderate, 24 high in the October 4 npm audit).
  Several fixes require a major Expo migration; perform that separately with device regression checks.
- Cloud features remain outside v1. They need user isolation, retention/deletion and a
  corrected/tested optional AI integration before public exposure.

## Commands

From mobile: npm run typecheck; npm test; npx expo-doctor; npx expo export --platform all.
npm run test:gpu serves localhost:8082. Open it and press Run GPU check.
From backend: C:\vibe-cam\.venv\Scripts\python.exe -m pytest -q.
