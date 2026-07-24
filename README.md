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
- **Auto Camera Match** — Scene analysis picks the best-fitting camera look automatically
- **Camera Capture** — In-app photo and video recording
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

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `VIBECAM_MAX_UPLOAD_BYTES` | Max upload size |
| `VIBECAM_UPLOAD_TTL_MINUTES` | Upload session TTL |

### Mobile (`mobile/.env`)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_API_BASE_URL` | Backend API URL |

## Testing

```bash
cd backend
python -m pytest -q
```

## Deployment

### Backend (Render)

Blueprint defined in `render.yaml`. Push to deploy.

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
