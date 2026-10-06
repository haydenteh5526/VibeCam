<div align="center">
  <img src="docs/icons/icon.svg" height="80" width="80" />
  <h1>VibeCam</h1>
  <p><strong>Point-and-shoot pocket camera simulator</strong></p>
  <p>Take photos and short videos with six pocket digicam looks — Canon G7X III, Sony RX100, Ricoh GR III, Fuji X100, Y2K CCD and Canon PowerShot.</p>

  ![License](https://img.shields.io/github/license/haydenteh5526/VibeCam)
  ![Last Commit](https://img.shields.io/github/last-commit/haydenteh5526/VibeCam)
  ![Top Language](https://img.shields.io/github/languages/top/haydenteh5526/VibeCam)
</div>

---

## Features

The first iPhone release focuses on **offline photo and video looks, photo import, Film Roll,
Save and Share**. Cloud uploads, AI and server-only effects are hidden and all backend
requests are disabled by default. For cloud development only, set
`EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=true` before starting Expo. EAS build profiles
explicitly keep this disabled.

- **Pocket Camera Emulation** — Six compact-camera-inspired colour looks: Canon G7X III, Sony RX100, Ricoh GR III, Fuji X100, Y2K CCD digicam, and Canon PowerShot
- **Photo Character** — Offline highlight, vignette and sensor grain controls; video uses the selected camera's colour look
- **On-device Developing** — Baked 3D LUTs render photos on the GPU and video during local export
- **Live Colour** — Preview the selected camera's colour while shooting, with an Original/Look comparison. Custom iPhone builds on iOS 16+ and web support this; texture and date finishing are added after capture.
- **Interactive Editing** — Preview camera, strength, exposure, warmth, texture and date changes before applying a full-resolution edit; discard returns to the saved version.
- **Film Roll** — Photos and clips stay on the iPhone with their originals until you delete them; tap an item to try another look
- **Durable Media** — Originals and edits survive cache eviction; preview, saving and sharing use the same committed media
- **Photo Import** — Develop JPEG and PNG photos from Files, including when camera access is off
- **Digicam Video** — Record up to 15 seconds with sound, apply the selected camera's colour look offline, and restyle from the original in Film Roll. Requires an iPhone preview or release build; Expo Go cannot load the local video module.
- **Settings** — Default camera, photo character intensity, auto-save, keep-original, haptics, grid
- **Cloud development mode** — Optional server effects, automatic camera selection and AI experiments behind an explicit developer flag
- **Platform** — iPhone is the first release target; web supports photo workflow previews, and Android remains in development
- **CI/CD** — GitHub Actions for backend tests, mobile unit tests and typechecks

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | Expo SDK 54, React Native 0.81, TypeScript |
| Backend | Python 3.11, FastAPI, Uvicorn, Pydantic v2 |
| Camera | expo-camera |
| Photo/video looks | Expo GL, local Core Image/Metal/AVFoundation module |
| App storage | App documents on iPhone; IndexedDB on web |
| Build | EAS Build on cloud Macs, including from Windows |
| Optional backend | Render; SQLite upload sessions and disk payloads |

## Getting Started

### Prerequisites

- Node.js 20.19+ and npm (the Expo SDK 54 minimum).
- For a signed iPhone build: an Expo account with project access, an active Apple
  Developer membership and a registered iPhone. No local Mac is needed.
- Python 3.11+ is only needed for optional backend development.

### Start on a PC

```powershell
cd mobile
npm ci
npm run web
```

Open `http://localhost:8081`. Import a JPEG/PNG from Files to try the looks when the
PC has no camera. Photos are developed locally and Save downloads the edited image.
Web cannot validate native video, microphone, Photos permissions or camera hardware.

### Install on an iPhone

Follow the [Windows-to-iPhone build guide](docs/DEPLOY.md) to sign in, register the
phone and run `npm run build:iphone` from `mobile`. The preview build contains the
native video/live-colour module and runs offline without a development server.
Expo Go does not contain that module and is not the release test target.

### Optional backend

```bash
cd backend
cp .env.example .env
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health check: `GET http://127.0.0.1:8000/health`

## Project Structure

```
vibe-cam/
├── mobile/          → Expo React Native app
│   ├── src/         → Screens, components, services
│   ├── assets/      → App icons, splash
│   └── App.tsx      → Entry point
├── backend/         → FastAPI service
│   ├── main.py      → API routes & upload logic
│   ├── grading.py   → Camera emulation & color grading engine
│   ├── ai/          → AI models & inference
│   ├── tests/       → Pytest smoke tests
│   └── data/        → Local upload storage
├── docs/            → Documentation & privacy policy
└── .github/         → CI workflows
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| GET | `/cameras` | List available pocket-camera emulations |
| POST | `/grade` | Apply a camera emulation to a photo (select via `X-Camera` header) |
| POST | `/grade/vibe` | AI color grade from a text-described vibe |
| POST | `/guide` | AI composition / pose guidance |
| POST | `/quality` | Blur / sharpness quality check |
| POST | `/uploads/init` | Initialize upload session |
| GET | `/uploads/{id}` | Get upload session status |
| GET | `/uploads/{id}/hash` | Get payload SHA256 hash |
| PUT | `/uploads/{id}/chunks` | Upload file chunks (resumable) |
| PUT | `/uploads/{id}/content` | Upload full file content |

### Camera emulations

Select a look by sending the `X-Camera` header to `POST /grade`:

| `X-Camera` | Camera | Look |
|------------|--------|------|
| `g7x` | Canon G7X III | Warm, punchy, flattering skin tones |
| `rx100` | Sony RX100 VII | Crisp, neutral, true-to-life |
| `gr` | Ricoh GR III | High-contrast street, deep blacks |
| `x100` | Fuji X100 | Classic Chrome — muted, documentary |
| `ccd` | CCD Digicam | Y2K nostalgia — cool-green cast, noise |
| `powershot` | Canon PowerShot | Retro party flash, punchy reds |
| `auto` *(default)* | — | Scene analysis picks the best camera |
| `ai` | — | AI-directed grade (if a provider is configured) |

### Effects & intensity (optional headers on `POST /grade`)

Point-and-shoot signatures, off unless requested. All are deterministic: pass the same
`X-Seed` and a re-develop reproduces the identical leak, dust and grain.

| Header | Values | Effect |
|--------|--------|--------|
| `X-Character` | `0`–`1.5` (default `1`) | Optical/sensor character intensity (bloom, vignette, noise, sharpening). `0` = colour only |
| `X-Date-Stamp` | `1` / `on` | Burn an orange LED date into the corner, seven-segment style |
| `X-Date-Text` | e.g. `'03 08 14` | Override the stamp text |
| `X-Frame` | `white` \| `black` \| `print` | Printed border; `print` leaves a wide base like a photo-lab print |
| `X-Light-Leak` | `0`–`1` | Warm light bleeding in from an edge |
| `X-Dust` | `0`–`1` | Dust specks and hair-thin scratches |
| `X-Seed` | integer | Fixes the random pattern so re-develops match |

### Experimental backend reference profiles

The camera looks are inspired interpretations, not measured hardware matches.
The optional backend can derive reference statistics from straight-out-of-camera
(SOOC) sample JPEGs:

1. Collect SOOC JPEGs from the target camera (e.g. from sample galleries) and sort
   them into `backend/camera_samples/<camera>/<scene>/` (`skin`, `daylight`,
   `indoor`, `flash`). See `backend/camera_samples/README.md`.
2. Verify them: `cd backend && python tools/check_samples.py g7x`
3. Build a profile: `python tools/build_profile.py g7x`
   → writes `backend/camera_profiles/g7x.json` (small derived stats — safe to commit; the images stay local/git-ignored).

Once a profile exists, `POST /grade` with that `X-Camera` uses per-channel mean/spread
matching and reports `X-Grade-Method: reference`.
Without a profile it falls back to the parametric preset (`X-Grade-Method: preset`).

The backend character layer adds optional texture and optical effects. Statistics
from unrelated scenes do not establish camera fidelity and are not the offline
app's rendering path. See [paired-shot calibration](docs/CAMERA_CALIBRATION.md)
for the measurement needed before claiming a match to real cameras.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `VIBECAM_MAX_UPLOAD_BYTES` | Max upload size |
| `VIBECAM_UPLOAD_TTL_MINUTES` | Upload session TTL |
| `VIBECAM_API_KEY` | Shared secret required in the `X-API-Key` header. Empty = open (local dev); **set it for any internet-reachable deploy** |

### Mobile (`mobile/.env`)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` | Defaults off. `true` opts into unfinished cloud development; EAS release profiles force it off |
| `EXPO_PUBLIC_API_BASE_URL` | Backend API URL |
| `EXPO_PUBLIC_API_KEY` | Must match the backend's `VIBECAM_API_KEY` (empty for local dev) |

## Authentication

Every endpoint except `GET /health` requires an `X-API-Key` header **when the backend
has `VIBECAM_API_KEY` set**. With it unset the API is open, which is convenient for
local development and unsafe for a public URL. `/health` stays public so platform
health checks (Render) keep working.

## Testing

```bash
# Backend
cd backend
python -m pytest -q

# Mobile
cd mobile
npm test                     # tsx + node:test
npm run typecheck
npm run check:release         # checks and exports iOS, Android, web bundles
npm run test:gpu              # open http://127.0.0.1:8082 and run the shader check
```

Baked LUT assets must stay in sync with the camera parameters. After changing any
camera's colour values, regenerate them — a test fails if they go stale:

```bash
cd backend
python tools/build_luts.py
```

## Deployment

See **[release readiness and iPhone test checklist](docs/RELEASE_READINESS.md)** for
verified behavior and the remaining steps before store submission.

### Backend (Render)

Blueprint defined in `render.yaml`. Push to deploy. Set `VIBECAM_API_KEY` in the
Render dashboard (declared `sync: false`, so no value lives in the repo).

Physical iPhone build and installation instructions: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

### Mobile (EAS Build)

```bash
cd mobile
npm run build:iphone          # signed internal preview, registered iPhones
npm run build:iphone:store    # App Store/TestFlight binary; does not submit it
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
