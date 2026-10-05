# Live colour viewfinder

The camera previews the selected colour table before capture. Original/Look only
changes what is displayed; the chosen look is still applied to the saved shot.
Selecting a new camera exits Original comparison. Timer/capture/recording lock the
comparison toggle to avoid changing the native session's outputs mid-shot.

This is a colour preview. Photo tonal finishing, vignette, grain and date stamp are
applied during development. Video currently uses colour only. No exact match to a
named physical camera is claimed; see CAMERA_CALIBRATION.md.

## iPhone integration

Build the custom app to include the local VibeCamVideo view. Live colour requires iOS 16+
for preview-sized buffers and movie/data-output coexistence. Its capability constant
keeps iOS 15, Expo Go and older builds on the working raw preview.
Keep CameraView and LiveLookPreview inside the same uncollapsible finder parent.
The overlay resolves the camera via ExpoModulesCore's EXCameraInterface, which
expo-camera implements. It does not depend on the old React bridge or private refs.

An optional AVCaptureVideoDataOutput attaches on the camera's own sessionQueue.
The camera still owns still capture, movie output and microphone. If another output
cannot coexist, the overlay reports unavailable and the original feed remains visible.
The output requests preview-sized buffers on iOS 16+, discards late frames and admits
at most one retained buffer / GPU command. Rendering is capped at 24 fps and 1280px
on the long edge. No image frames are passed through JS or written to disk.

Core Image applies the same decoded cube as video export, explicitly in encoded sRGB.
The result is cropped to fill the portrait finder and presented through Metal. Front
preview is mirrored, following the normal camera view; capture retains Expo's existing
orientation/mirroring policy. Physical front/back framing still requires verification.

Leaving the finder, backgrounding, or preview failure removes only the optional output.
A 1.5-second stale-frame watchdog hides the surface and stops processing. GPU completion
checks attachment identity and look revision, so late work cannot restore an old view.
Retry remounts the overlay. A new look can also restart an unavailable native preview.

## PC simulation

The browser overlay reads the video inside its finder, without requesting another
camera. It centre-crops into a bounded canvas, updates the photo shader's source
texture and draws colour only. It pauses when hidden, cleans up on exit, and hides
itself on context loss, stalled frames or LUT loading failure. The raw camera and
shutter stay available. This works with Chrome's fake-media feed used by the local
iPhone-shaped test launcher; it does not emulate native iOS hardware or Photos.

## Verification

- `npm test`: crop geometry and truthful preview captions, alongside existing app tests.
- `npm run test:gpu`: real shader, all six PNG tables, replacing frames, context loss.
- macOS CI: builds a colour sweep from the independent CPU reference and executes
  `LookCube.swift` using Core Image, checks portrait/landscape pixel buffers through
  the Metal presentation path (including all four corners), then compiles the unsigned
  iOS Simulator app. The native test caught and verified the fix for a vertical flip.
- Browser walkthrough: real frame changes, six looks, comparison, capture, compact
  screens, repeated toggles, camera flip, failure fallback and recovery.
- Required before shipping: physical iPhone view hierarchy/attachment, orientation,
  front mirroring, lens changes, photo capture and recording/audio coexistence,
  interruptions, Photos/Share, latency, memory and thermal/battery measurements.
