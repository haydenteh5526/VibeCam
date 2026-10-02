# VibeCam project context

Updated 2026-10-02. This document supersedes the historical branch/status notes.

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
- Current refinement work: codex/refined-digicam-experience.
- docs/RELEASE_READINESS.md records verification and the remaining physical iPhone gates.

## Architecture

- mobile/: Expo SDK 54, React Native 0.81, TypeScript, expo-camera.
- App.tsx owns capture, committed media, navigation, settings and export.
- src/components/ui.tsx and CameraPicker.tsx provide the shared design and camera selector.
- src/photoRecipe.ts validates per-photo strength, exposure, warmth, texture and date.
- src/look/renderFrame.ts + shader.ts apply bundled LUTs and photo character offline.
  renderStill.ts uses expo-gl on native; renderWeb.ts exercises the same shader in browsers.
- LUT PNG layout is FLAT .cube order: red fastest, then green horizontally, blue by row.
  It is not the conventional blue-tile layout. CPU, shader and video must agree.
- src/look/videoLuts.ts is generated from these same PNGs by npm run assets:video-luts.
  modules/vibecam-video is the native Core Image/AVFoundation video exporter.
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
GitHub macOS CI compiles an unsigned Simulator build; it does not validate real camera,
microphone, native image orientation, Photos, sharing or thermal behaviour.

## Next release work

Produce a signed iPhone preview build; follow docs/RELEASE_READINESS.md on hardware.
Calibrate against paired camera/iPhone shots. A real processed live viewfinder requires
a native frame pipeline; the current viewfinder explicitly shows the unprocessed camera.
Video currently uses camera colour, without photo texture/date adjustments.
