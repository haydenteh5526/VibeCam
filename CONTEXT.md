# VibeCam — Project Context

> Handoff / working-context doc for VibeCam. Read this first when picking the
> project up on another machine or in a new session.
> Last updated: 2026-07-24.

---

## 1. What VibeCam is

A **point-and-shoot pocket camera simulator**. You capture on your phone and the
backend applies the in-camera color science of popular compact cameras so the
result looks like it came from that camera.

- **Mobile**: Expo SDK 54, React Native 0.81, TypeScript (`mobile/`)
- **Backend**: Python 3.11+, FastAPI, Uvicorn, Pydantic v2 (`backend/`)
- **Intended use**: personal. The camera looks run fully offline/deterministically
  (no API keys required). AI features are optional.

There is also a shorter engineering log at `docs/PROJECT_CONTEXT.md`.

---

## 2. Repository & workflow

- **GitHub**: `haydenteh5526/VibeCam` — default branch **`main`**.
- **Branch workflow (FYP)**: feature branch → open PR → review via CI → squash-merge to `main` → delete branch. Never commit directly to `main`.
- **CI on every PR/push**: `backend-tests` (pytest, Python 3.11), `mobile-checks` (`tsc --noEmit`, Node 20), GitGuardian secret scan.
- **History**:
  - PR #2 → `feat: simulate point-and-shoot pocket cameras` (the six emulations + `/cameras` + `X-Camera` wiring)
  - PR #3 → `feat: reference-based camera matching from real samples` (accurate mode)
- **Note**: a `mvp` branch exists but is **behind `main`**. If you use it, sync first: `git switch mvp && git merge main`.

---

## 3. Layout (key files)

```
vibe-cam/
├── mobile/
│   ├── App.tsx                     # screen orchestration; onCapture -> gradePhoto(camera)
│   └── src/
│       ├── filters.ts              # FilterId + FILTERS = camera emulations (ids match backend)
│       ├── autoFilter.ts           # pickBestFilter() scene-based camera pick (live preview)
│       ├── services/api.ts         # gradePhoto(uri, camera) -> POST /grade w/ X-Camera header
│       └── screens/
│           ├── CameraScreen.tsx     # camera UI + camera strip; sends selected camera
│           └── PreviewScreen.tsx    # shows applied camera badge
├── backend/
│   ├── main.py                     # FastAPI app + /grade, /cameras, /grade/vibe, /guide, uploads
│   ├── grading.py                  # parametric presets (film + CAMERAS) + pipeline + auto-pick
│   ├── camera_match.py             # reference matching (profiles + MKL transfer)  ← accurate mode
│   ├── camera_samples/<cam>/<scene>/   # SOOC reference JPEGs (git-ignored)
│   ├── camera_profiles/<cam>.json  # derived stats built from samples (committable)
│   ├── tools/
│   │   ├── check_samples.py        # EXIF-verify samples
│   │   └── build_profile.py        # build a camera profile from samples
│   ├── ai/                         # optional AI providers (gemini / g4f / openai)
│   └── tests/                      # pytest (test_api_smoke, test_grading, test_camera_match)
└── docs/PROJECT_CONTEXT.md         # engineering log
```

---

## 4. Camera emulations

Ids are shared between mobile (`filters.ts`) and backend (`grading.py` `CAMERAS`).

| id | Camera | Look | Profile |
|----|--------|------|---------|
| `g7x` | Canon G7X III | Warm, punchy, flattering skin tones | reference |
| `rx100` | Sony RX100 VII | Crisp, neutral, true-to-life | reference |
| `gr` | Ricoh GR III | High-contrast street, deep blacks | reference |
| `x100` | Fuji X100 | Classic Chrome — muted, documentary | reference |
| `ccd` | CCD Digicam | Y2K nostalgia — cool-green cast, noise | parametric |
| `powershot` | Canon PowerShot | Retro party flash, punchy reds | parametric |

"reference" = a real-sample profile is committed, so `/grade` returns
`X-Grade-Method: reference` (see §11 for coverage). "parametric" = hand-tuned only;
these are generic aesthetics rather than one specific camera body.

Two ways a look is produced:

1. **Parametric preset** (default, always available) — hand-tuned parameters in
   `grading.py` (temperature/tint, 3-way grading, HSL, vibrance, grain, vignette).
   Good *vibe*, but an approximation.
2. **Reference match** (accurate mode, when a profile exists) — learned from real
   sample photos; see §7.

---

## 5. API (grading-related)

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/health` | contract: `status`, `service`, `timestamp_utc` (do not break) |
| GET | `/cameras` | lists emulations `[{id,name,description}]` |
| POST | `/grade` | apply a look; select with `X-Camera` header |
| POST | `/grade/vibe` | AI grade from `X-Vibe` text prompt (needs AI provider) |
| POST | `/guide` | AI pose/composition guidance (needs AI provider) |
| POST | `/quality` | blur/sharpness score |

`POST /grade` — `X-Camera` header:
- a camera id (`g7x`, …) → that look (reference match if a profile exists, else preset)
- `auto` *(default / missing)* → scene analysis picks a camera (parametric)
- `ai` → AI-directed grade, only if a provider is configured (falls back to auto)

Response headers: `X-Grade-Preset-Id`, `X-Grade-Preset-Name`, `X-Grade-Method`
(`reference` | `preset`), and `X-Grade-Scene` when reference-matched.

---

## 6. Capture → grade flow

`CameraScreen` sends the selection (`FilterId | 'auto'`) → `App.onCapture` →
`api.gradePhoto(uri, camera)` sets the `X-Camera` header → `POST /grade`.
`App` keeps the ungraded frame as `original` and shows the graded result; the
**graded** JPEG is what gets written to the camera roll (`MediaLibrary`), not the raw
capture. `PreviewScreen` shows which look was applied, lets you **re-grade the same
frame** with any camera (always re-grading from `original`, so looks never stack),
and hold-to-compare against the original.
Backend: explicit camera + profile → **reference**; else → **parametric preset**;
`auto` → scene-based parametric pick; `ai` → AI (if configured).

**Grade state** (`App.GradeState`) is surfaced honestly in the UI:
`none` (backend offline) | `grading` | `graded` | `failed` — a failed or skipped grade
says so instead of silently showing the untouched photo.

**Mobile UI principle**: no placebo controls. Only capabilities that actually do
something are exposed (flash, timer, grid, flip, pinch zoom, pose guide). Format /
aspect / night-mode / exposure-slider / tap-focus were removed because expo-camera
exposes no such control — they animated but changed nothing. Zoom reads out as a
percentage of the lens range (expo-camera's `zoom` is 0..1), not a fake "2×".
Scene/portrait classification lives **server-side** only; the app no longer guesses.

---

## 7. Accurate mode — reference matching (the important part)

**Goal**: get color/tone genuinely close to a real camera by learning from its
straight-out-of-camera (SOOC) JPEGs, instead of hand-tuned guesses.

**Method** — two layers, both applied on capture:

1. **Colour** (`backend/camera_match.py`): build a per-scene **RGB mean + covariance**
   profile from samples; at grade time match the photo's **per-channel** mean and spread
   toward the profile, blended (~0.72), with the mean shift capped (±26) and ~60% of the
   original luminance preserved.
   ⚠️ **Deliberately not full-covariance MKL.** Textbook MKL transports the whole
   covariance, which also *rotates hue*. Our profiles are built from whatever the sample
   galleries photographed, so their covariance encodes **scene content** (foliage,
   cityscapes) as much as camera colour science — transporting it produced violent
   green/magenta casts on smooth skies. Per-channel matching can't rotate hue and
   degrades gracefully when the reference is a poor match. The scene bucket is also
   mixed 65/35 toward `overall` so a misclassified scene can't dictate the look.
2. **Character** (`backend/character.py`): the part that actually reads as
   "pocket camera" rather than "filter" — highlight rolloff, warm halation/bloom around
   clipped highlights, radially-weighted chromatic aberration, corner softness, lens
   vignette, luminance-dependent sensor noise + chroma speckle, and in-camera JPEG
   oversharpening. Per-camera parameters in `CHARACTER`, modulated by scene
   (`SCENE_MODIFIERS`: indoor = more gain/noise, flash = more bloom). Applies to **both**
   grading paths, so `ccd`/`powershot` get it too. `apply_character(..., strength=)`
   scales the whole effect.

Scene is auto-classified into `skin | daylight | indoor | flash` (falls back to
`overall`). Implemented in numpy + Pillow — **no new dependencies**.

**Workflow**:
1. Put SOOC JPEGs in `backend/camera_samples/<camera>/<scene>/`
   (`skin`, `daylight`, `indoor`, `flash`). 5+ per scene, skin most important.
2. Verify: `cd backend && python tools/check_samples.py g7x`
   (rejects wrong-camera / edited / low-res via EXIF).
3. Build: `python tools/build_profile.py g7x`
   → writes `backend/camera_profiles/g7x.json`.
4. `POST /grade` with `X-Camera: g7x` now returns `X-Grade-Method: reference`.

**Files & git**: sample **images are git-ignored** (third-party; stay local).
**Profiles** (`camera_profiles/*.json`) are small derived stats and **are committed**.

**Where to get SOOC samples** (free, EXIF intact): Imaging-Resource (great
standardized studio scene), DPReview sample galleries, PhotographyBlog full-size,
Flickr camera-finder for the model.

---

## 8. Key decisions & rationale

- **"Identical" is not achievable — realistic bar is "convincingly close in color/tone."** Two reasons: (a) the camera's JPEG look is a proprietary, scene-adaptive pipeline; (b) capture hardware differs — a phone can't reproduce a 1-inch sensor's depth of field / low-light character / lens rendering. Software matches color/tone, not optics.
- **Deterministic camera emulation is the default** (reliable, offline). The old capture-time AI auto-grade is now **opt-in** via `X-Camera: ai`; AI "vibe" grade and `/guide` are unchanged.
- **Reference matching is wired for explicit camera selection (v1)**; `auto` still uses the parametric pick.
- **No new backend dependencies** — MKL is implemented directly (numpy + Pillow + OpenCV only).

---

## 9. iPhone capture notes

Target device: **iPhone 12 Pro Max**. Dev machine is **Windows**, so `expo run:ios`
(macOS/Xcode only) is unavailable — use **Expo Go** (all deps are first-party Expo
modules, so it works) or an **EAS cloud build**. See `docs/DEPLOY.md`.

Capture goes through **expo-camera / AVFoundation**, *not* Apple's Camera app, so the
stock app's Smart HDR / Deep Fusion / Photographic Styles pipeline largely does not
apply to VibeCam's frames. Helpful for us: a flatter, less-processed input is better
raw material for emulation.

Note **Photographic Styles does not exist on the iPhone 12 Pro Max** (iPhone 13+ only),
so earlier advice to set it to Standard doesn't apply to this device. On iPhone 13+ it
only affects the stock Camera app anyway.

Still true regardless: software matches color/tone, not optics — a phone can't
reproduce a 1-inch sensor's depth of field or low-light character (see §8).

---

## 10. Dev, run & verify

- **Backend venv**: `C:\venv\vibe-cam` (Python 3.14 locally; has fastapi, numpy,
  opencv-python-headless, pillow, pytest). CI uses Python 3.11.
- **Run backend**: `cd backend && uvicorn main:app --host 127.0.0.1 --port 8000 --reload` → health at `GET /127.0.0.1:8000/health`.
- **Backend tests**: `cd backend && python -m pytest -q` → **38 passed**.
  ⚠️ Run from `backend/` (running from repo root also collects `references/**` test files, which error on missing deps).
- **Mobile typecheck**: `cd mobile && npx tsc --noEmit` → clean.
- **Mobile run**: `cd mobile && npm run ios` (or `android`).
- **Env vars**: mobile `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_KEY`; backend
  `VIBECAM_MAX_UPLOAD_BYTES`, `VIBECAM_UPLOAD_TTL_MINUTES`, `VIBECAM_API_KEY`;
  AI optional (`AI_PROVIDER`, `GOOGLE_AI_API_KEY`) — not needed for camera/reference modes.
- **Auth**: `VIBECAM_API_KEY` set → all routes except `GET /health` need a matching
  `X-API-Key` header (mobile sends it via `constants.authHeaders()`). Empty → open (local dev).
- **Deploy / on-device**: see `docs/DEPLOY.md`.

---

## 11. Status & next steps

**Done**: six emulations; `/cameras`; `X-Camera` wiring end-to-end; reference-matching
engine + `check_samples.py` / `build_profile.py` + tests; **real profiles built for
`g7x`, `rx100`, `gr`, `x100`** (`ccd`/`powershot` stay parametric — generic looks with
no single real camera to sample); native-safe grade I/O (`file://`, not web blobs);
optional API-key gate; docs.

**Premium app work (3 phases)**:
- **Effects layer** (`backend/effects.py`) — seven-segment LED date stamp, printed frames,
  edge light leaks, dust/scratches, all per-request via headers. Grading is now
  **deterministic**: grain is seeded, so re-developing a shot reproduces it exactly.
- **Settings** (`mobile/src/settings.ts` + `SettingsScreen`) — default camera, character
  intensity, effects, saving behaviour, haptics, grid. Validated on load so a corrupt
  file can't break the app. One seed per captured frame feeds the reproducibility above.
- **Film roll** (`roll.ts` / `rollStore.ts` / `RollScreen`) — day-grouped grid of
  developed shots; tap to re-develop from the retained original. Developing animation
  and a camera-body picker replace the old chip strip.
- **On-device look engine** (`mobile/src/look/`) — baked 3D LUTs (`backend/lut.py`,
  `mobile/assets/luts/*.png`) applied in an expo-gl shader with rolloff, vignette and
  grain. Capture is instant and works offline.
- **Mobile test harness** — `tsx` + `node:test`, run in CI.

**Test counts**: backend **117**, mobile **46**. Both run in CI alongside the typecheck.

**Unmerged**: `feat/manual-controls-visioncamera` (PR #21, draft) migrates capture to
react-native-vision-camera for real exposure compensation, true zoom factors and
tap-to-focus. **Merging it ends Expo Go support** (EAS builds only), so it waits until
Phases 1–2 are verified on hardware.

**Known limits, stated plainly**:
- **Nothing is verified on a physical device yet.** The GL look engine and the
  VisionCamera screen are the largest untested surfaces.
- On-device looks are an **approximation**: the adaptive reference match can't be baked
  into a fixed LUT, and halation / chromatic aberration / corner softness need extra
  render passes, so both stay server-side.
- **Live look preview does not exist.** expo-camera has no native frame processor, and
  doing it on VisionCamera needs a Skia frame processor (Phase 3b).
- No manual **ISO, shutter or white balance** anywhere — neither expo-camera nor
  VisionCamera 4 exposes them; that would need a custom native module.
- `skin` sample buckets are thin, so portraits lean on `overall`.

**Next**:
1. **Test Phases 1–2 on the iPhone via Expo Go** (`npm run go:tunnel`) — see `docs/DEPLOY.md`.
2. Then merge PR #21 and do an EAS development build for the manual controls.
3. Phase 3b: live look preview via a Skia frame processor.
4. Tune per camera once real photos exist: blend strength, scene thresholds, character
   intensity, effect taste.

**Profile coverage** (samples per scene, from DPReview SOOC galleries):

| camera | skin | daylight | indoor | flash | source |
|--------|------|----------|--------|-------|--------|
| `g7x` | 0 | 23 | 5 | 2 | Canon G7X III gallery (full-res, EXIF verified) |
| `rx100` | 3 | 14 | 1 | 2 | Sony RX100 VII gallery |
| `gr` | 1 | 14 | 3 | 2 | Ricoh GR III gallery |
| `x100` | 1 | 12 | 1 | 6 | Fujifilm X100VI gallery |

Caveats: web-sized DPReview images have **EXIF stripped**, so rx100/gr/x100 were built
with `verify_model=False` (camera confirmed from gallery metadata instead). `skin`
buckets are thin — portraits mostly fall back to `overall`, which is daylight-dominated.
`x100` reflects the X100VI's default SOOC rendering, not specifically Classic Chrome.

**Next**:
1. **Deploy + run on a physical iPhone** (`docs/DEPLOY.md`) — nothing has been validated
   on-device or against real photos yet. This is the highest-value remaining step.
2. Tune per camera: blend strength, scene thresholds; consider matching in LAB.
3. Let `auto` use reference profiles when available (currently explicit-only).
4. Optional: fill `skin` buckets from hand-vetted Flickr portraits (strict model match,
   unedited only); layer per-camera grain/vignette character (esp. `ccd`); `.cube` LUT I/O.
4. Optionally layer each camera's grain/vignette *character* on top of the reference match (esp. `ccd`).
5. Optional `.cube` 3D-LUT support (load/export).
6. **Device testing + real-photo visual validation** (nothing has been run on a device yet — only unit tests + typecheck).
7. Sync the `mvp` branch with `main` if it will be used.

---

## 12. Gotchas

- **Windows/PowerShell**: avoid `>` for generated text files (UTF-16); prefer UTF-8. Shell stdout capture can be flaky — redirect to a file and read it.
- **pytest**: must be run from `backend/`.
- **Samples vs profiles**: never commit third-party sample images (git-ignored); only commit the derived `camera_profiles/*.json`.
- **Ids must stay in sync** between `mobile/src/filters.ts` and `backend/grading.py` `CAMERAS` (they are sent as the `X-Camera` header).
