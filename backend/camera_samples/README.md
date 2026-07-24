# Camera reference samples

Drop **straight-out-of-camera (SOOC) JPEGs** from the *real* cameras here. These
are the ground truth the color-matching engine learns each camera's look from.
The closer these are to real, unedited camera output, the more "true to the real
thing" your results will be.

## Folder layout

```
camera_samples/
└── g7x/                 # one folder per camera id (matches backend/grading.py)
    ├── skin/            # portraits / faces / people
    ├── daylight/        # outdoor, natural light
    ├── indoor/          # indoor, artificial / mixed light
    └── flash/           # on-camera flash / night
```

## What makes a good sample

- **SOOC JPEG** — no edits, no filters, no Instagram/VSCO. If it was opened in
  Lightroom/Photoshop/Snapseed, don't use it.
- **Default picture style**, auto white balance (the camera's normal look).
- **EXIF intact** — needed to confirm the camera and settings.
- **Full resolution** (short side ≥ 1000 px).
- **5+ per scene** (8+ total minimum), varied subjects.

## Verify before profiling

```bash
cd backend
python tools/check_samples.py g7x
```

This reports, per scene, how many valid samples you have and flags anything that
is edited, low-res, or from the wrong camera.

> Sample images are **git-ignored** on purpose (third-party photos) — they stay
> local and are not committed.
