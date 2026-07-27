<div align="center">
  <img src="docs/icons/icon.svg" height="80" width="80" />
  <h1>VibeCam</h1>
  <p><strong>Point-and-shoot pocket camera simulator</strong></p>
  <p>Capture photos with the color science of iconic compact cameras — Canon G7X III, Sony RX100, Ricoh GR III, Fuji X100, Y2K CCD digicams, and Canon PowerShot.</p>

  ![License](https://img.shields.io/github/license/haydenteh5526/VibeCam)
  ![Last Commit](https://img.shields.io/github/last-commit/haydenteh5526/VibeCam)
  ![Top Language](https://img.shields.io/github/languages/top/haydenteh5526/VibeCam)
</div>

---

## Features

- **Pocket Camera Emulation** — Reproduces the in-camera color science of popular point-and-shoot cameras: Canon G7X III, Sony RX100, Ricoh GR III, Fuji X100 (Classic Chrome), Y2K CCD digicam, and Canon PowerShot
- **Auto Camera Match** — The backend analyzes the captured pixels and picks the best-fitting camera
- **Photo Capture** — Point-and-shoot capture with flash, timer, grid, pinch zoom and pose guidance
- **Graded Photos Saved Automatically** — The emulated result is written to your camera roll
- **Re-develop After the Shot** — Tap any camera in the preview to re-grade the same frame; hold to compare against the untouched original
- **Vibe Grading** — Optional AI color grade from a text prompt (e.g. "warm nostalgic sunset")
- **File Upload** — Select files from device with resumable chunked uploads
- **Cross-Platform** — iOS and Android via Expo
- **CI/CD** — GitHub Actions for backend tests and mobile typechecks

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | Expo SDK 54, React Native 0.81, TypeScript |
| Backend | Python 3.11, FastAPI, Uvicorn, Pydantic v2 |
| Camera | expo-camera |
| Upload | expo-file-system (chunked streaming) |
| Storage | SQLite (sessions), disk (payloads) |
| Deploy | Render (backend), EAS Build (mobile) |

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- Android Studio or Xcode (for device/emulator testing)

### Backend

```bash
cd backend
cp .env.example .env
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health check: `GET http://127.0.0.1:8000/health`

### Mobile

```bash
cd mobile
cp .env.example .env
npm install
npx expo prebuild
npm run android  # or: npm run ios
```

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

### Accurate mode — match a real camera from samples

The `X-Camera` looks above are hand-tuned approximations. For results grounded in
a **real** camera, teach the app from straight-out-of-camera (SOOC) sample JPEGs:

1. Collect SOOC JPEGs from the target camera (e.g. from sample galleries) and sort
   them into `backend/camera_samples/<camera>/<scene>/` (`skin`, `daylight`,
   `indoor`, `flash`). See `backend/camera_samples/README.md`.
2. Verify them: `cd backend && python tools/check_samples.py g7x`
3. Build a profile: `python tools/build_profile.py g7x`
   → writes `backend/camera_profiles/g7x.json` (small derived stats — safe to commit; the images stay local/git-ignored).

Once a profile exists, `POST /grade` with that `X-Camera` maps your photo toward the
real camera's color/tone using a scene-aware Monge–Kantorovich (MKL) color transfer,
and reports `X-Grade-Method: reference`. Without a profile it falls back to the
parametric preset (`X-Grade-Method: preset`). Color/tone can get convincingly close;
optical traits (a 1-inch sensor's depth of field, low-light character) can't be reproduced from a phone frame.

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
| `EXPO_PUBLIC_API_BASE_URL` | Backend API URL |
| `EXPO_PUBLIC_API_KEY` | Must match the backend's `VIBECAM_API_KEY` (empty for local dev) |

## Authentication

Every endpoint except `GET /health` requires an `X-API-Key` header **when the backend
has `VIBECAM_API_KEY` set**. With it unset the API is open, which is convenient for
local development and unsafe for a public URL. `/health` stays public so platform
health checks (Render) keep working.

## Testing

```bash
cd backend
python -m pytest -q
```

## Deployment

### Backend (Render)

Blueprint defined in `render.yaml`. Push to deploy. Set `VIBECAM_API_KEY` in the
Render dashboard (declared `sync: false`, so no value lives in the repo).

Full walkthrough for deploying and running on a physical iPhone, including
recommended iOS camera settings: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

### Mobile (EAS Build)

```bash
cd mobile
npx eas build -p ios --profile production
npx eas build -p android --profile production
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
