# VibeCam project context

Updated 2026-10-05. This document supersedes the historical branch/status notes.

## Product

An iPhone-first offline pocket-camera app. Six selectable inspired looks: G7X III,
RX100, GR III, X100, CCD 2004 and PowerShot, plus untouched Original.
Photo capture/import, editing, Film Roll, Save and Share work without an account.
Native iPhone builds also record and style clips up to 15 seconds at 720p.
Cloud/AI/upload features are hidden and blocked by default.

Camera looks are interpretations, not measured reproductions of real hardware.
Read docs/CAMERA_CALIBRATION.md before making fidelity claims.

## Workflow and state

- Repository: haydenteh5526/VibeCam; default branch main.
- Use codex/ feature branches, PRs and passing checks before merging.
- Main requires typecheck, tests and ios-build; administrators are included.
- Prior offline workflow PR #26 merged. Old draft PR #21 is closed; its prototype
  survives as tag archive/visioncamera-manual-controls-2026-07. Stale branches were removed.
- PR #27 merged the refined camera, editor and Film Roll, plus corrected LUT axes.
- PR #28 merged interactive photo editing previews. PR #29 adds live camera colour.
- docs/RELEASE_READINESS.md records verification and the remaining physical iPhone gates.

## Architecture

- mobile/: Expo SDK 54, React Native 0.81, TypeScript, expo-camera.
- App.tsx owns capture, committed media, navigation, settings and export.
- src/components/ui.tsx and CameraPicker.tsx provide the shared design and camera selector.
- src/photoRecipe.ts validates per-photo strength, exposure, warmth, texture and date.
- src/look/renderFrame.ts + shader.ts apply bundled LUTs and photo character offline.
  renderStill.ts uses expo-gl on native; renderWeb.ts exercises the same shader in browsers.
- PhotoLookPreview + PhotoSurface reuse the same renderer for interactive draft edits.
  The photo stays visible while adjusting. Apply renders/commits at full resolution;
  Discard restores the applied edit. Export is unavailable until a draft is applied/discarded.
  Preview sources are capped at 1280px and reused across camera choices. Native
  thumbnails live in purgeable cache and are deleted on exit. GL resources are released
  before export/on background. The original is reserved for full-quality Apply.
- LUT PNG layout is FLAT .cube order: red fastest, then green horizontally, blue by row.
  It is not the conventional blue-tile layout. CPU, shader and video must agree.
- src/look/videoLuts.ts is generated from these same PNGs by npm run assets:video-luts.
  modules/vibecam-video is the native Core Image/AVFoundation video exporter.
- LiveLookPreview overlays the selected colour table on Expo Camera's existing feed.
  Native LiveColourView finds the sibling through EXCameraInterface and adds/removes
  one video-data output on its session queue. It uses Core Image/Metal, at most one
  frame in flight, 24 fps and a 1280px display limit. No per-frame JS bridge or files.
  The web overlay uses the photo shader, the existing video, and a bounded canvas.
  Original/Look compares without changing the captured look. Failure hides the overlay;
  Retry restores it where supported. iOS 15/Expo Go/old builds/Android retain raw preview.
  Live colour excludes photo character/date finishing; it is not exact hardware emulation.
  See docs/LIVE_VIEWFINDER.md for integration and device validation.
- src/rollRepository.ts serializes durable commits. Original, rendered image and poster
  are retained before the index is written; only unreferenced owned files are removed afterward.
  Favourites, saved status and recipes survive restart. Bulk deletion commits once.
- src/services/storage.ts uses app documents on native and IndexedDB on web.
- backend/: optional FastAPI/Python grading and cloud development. Not needed for v1.
  Reference statistics from unrelated sample scenes are not paired calibration data.

## Local checks

Run npm run typecheck and npm test in mobile; run .venv/Scripts/python.exe -m pytest
from backend (use the full path to the interpreter).
npm run test:gpu serves the real shader check on localhost:8082; press Run GPU check.
npx expo export --platform all checks bundles. npx expo-doctor checks dependencies.
GitHub macOS CI checks the actual Core Image LUT against 4,096 colours per table and
compiles an unsigned Simulator build; it does not validate real camera,
microphone, native image orientation, Photos, sharing or thermal behaviour.

## Next release work

Produce a signed iPhone preview build; follow docs/RELEASE_READINESS.md on hardware.
Validate live colour preview framing, front mirroring, recording coexistence and battery
on hardware, then calibrate against paired camera/iPhone shots.
Video currently uses camera colour, without photo texture/date adjustments.
