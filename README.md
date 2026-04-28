# VibeCam

VibeCam is a monorepo with a React Native mobile app and a Python backend API.

## Repository Layout

- mobile/: Expo React Native app (TypeScript, custom dev client flow)
- backend/: FastAPI service
- .gitignore: Monorepo-safe ignore rules for Node, native, and Python artifacts

## Tech Stack

- Mobile
  - Expo SDK 54
  - React Native 0.81
  - TypeScript
  - expo-dev-client (custom native dev client)
  - expo-camera (in-app video capture)
  - expo-document-picker (real file selection for upload flow)
  - expo-file-system (chunked file reads without loading the entire file into memory)
- Backend
  - Python 3.11
  - FastAPI
  - Uvicorn
  - Pydantic v2

## Prerequisites

- Node.js 20+ and npm
- Python 3.11+
- Android Studio (for Android emulator/device testing)
- Xcode (for iOS builds on macOS only)

## Environment Configuration

- Backend: copy backend/.env.example to backend/.env and adjust values if needed.
- Mobile: copy mobile/.env.example to mobile/.env and set EXPO_PUBLIC_API_BASE_URL for your device.

## Publishing

- Update the bundle identifiers in mobile/app.json if you own a different reverse-DNS name.
- Deploy the backend (Render blueprint in render.yaml) and confirm the service URL.
- Update EXPO_PUBLIC_API_BASE_URL in mobile/eas.json for preview/production builds.
- Publish docs/site via GitHub Pages, then use the generated privacy/support URLs.
- Build with EAS:

```powershell
Set-Location mobile
npx eas build -p ios --profile production
npx eas build -p android --profile production
```

## Backend Quick Start

1. Create and activate a virtual environment.
2. Install dependencies from requirements.txt.
3. Run Uvicorn.

Example (Windows):

```powershell
Set-Location backend
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

- URL: http://127.0.0.1:8000/health
- Expected status: 200
- Expected shape:

```json
{
  "status": "ok",
  "service": "vibecam-backend",
  "timestamp_utc": "2026-04-21T21:20:45.605438+00:00"
}
```

## Mobile Quick Start (Custom Dev Client)

1. Install dependencies.
2. Ensure native project exists (prebuild).
3. Build and run on Android/iOS.

Example:

```powershell
Set-Location mobile
Copy-Item .env.example .env
npm install
npx expo prebuild
npm run android
```

Useful scripts in mobile/package.json:

- npm start
- npm run android
- npm run ios
- npm run web

Mobile runtime note:

- App startup performs a backend GET /health check.
- App includes camera controls to take photos or record video clips.
- App includes a "Select File" action that opens a real document picker.
- App includes an "Initialize Upload" action that calls POST /uploads/init using selected file metadata.
- App includes an "Upload Selected File" action that streams the chosen file in chunks from disk to PUT /uploads/{upload_id}/chunks and displays session progress/state from GET /uploads/{upload_id}.
- The screen content is scrollable so controls remain reachable on smaller displays.
- Default endpoint selection:
  - Android emulator: http://10.0.2.2:8000
  - iOS simulator and web: http://127.0.0.1:8000
- To override, set EXPO_PUBLIC_API_BASE_URL in mobile/.env.
- After a completed upload, the UI shows the SHA256 payload hash.

## Backend Smoke Tests

Run API smoke tests from backend/:

```powershell
Set-Location backend
python -m pytest -q
```

Smoke tests cover:

- GET /health contract
- POST /uploads/init and GET /uploads/{upload_id}
- PUT /uploads/{upload_id}/chunks partial -> ingested flow
- PUT /uploads/{upload_id}/content full ingest flow
- Resumable retries with overlapping chunk uploads
- Payload hash generation on ingest

## CI

GitHub Actions runs backend smoke tests and mobile typechecks on push and pull request via the backend-tests and mobile-checks workflows.

## Current API

- GET /health
- POST /uploads/init
- GET /uploads/{upload_id}
- GET /uploads/{upload_id}/hash
- PUT /uploads/{upload_id}/chunks
- PUT /uploads/{upload_id}/content

Example request for POST /uploads/init:

```json
{
  "file_name": "clip-001.mp4",
  "mime_type": "video/mp4",
  "size_bytes": 10485760
}
```

Example response for POST /uploads/init:

```json
{
  "status": "accepted",
  "upload_id": "c6ff9ac6-f2b1-4598-86ab-8c9307b7bb75",
  "max_size_bytes": 52428800,
  "expires_at_utc": "2026-04-21T22:00:00.000000+00:00"
}
```

Example request for PUT /uploads/{upload_id}/content (PowerShell):

```powershell
$upload = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/uploads/init -ContentType "application/json" -Body '{"file_name":"clip-001.mp4","mime_type":"video/mp4","size_bytes":4}'
[byte[]]$payload = 65,66,67,68
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:8000/uploads/$($upload.upload_id)/content" -ContentType "application/octet-stream" -Body $payload
```

Example request sequence for resumable chunk upload (PowerShell):

```powershell
$upload = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/uploads/init -ContentType "application/json" -Body '{"file_name":"clip-002.mp4","mime_type":"video/mp4","size_bytes":4}'
[byte[]]$chunk1 = 65,66
[byte[]]$chunk2 = 67,68
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:8000/uploads/$($upload.upload_id)/chunks?offset=0" -ContentType "application/octet-stream" -Body $chunk1
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:8000/uploads/$($upload.upload_id)/chunks?offset=2" -ContentType "application/octet-stream" -Body $chunk2
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/uploads/$($upload.upload_id)"
```

Example request for GET /uploads/{upload_id}/hash (PowerShell):

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/uploads/$($upload.upload_id)/hash"
```

Current ingestion behavior:

- The single-shot ingest endpoint expects one payload with exact byte length matching size_bytes from /uploads/init.
- The chunk endpoint supports resumable uploads with explicit offset and enforces contiguous writes.
- upload_id must exist and be unexpired.
- content-type must be application/octet-stream.
- On completion, the backend computes a SHA256 payload hash and returns it in ingest responses and upload status.
- Upload session state persists locally in backend/data/vibecam.db.
- Uploaded payload bytes are written locally under backend/data/uploads/ as upload_id.bin files.

CORS is configured in the backend for localhost, 127.0.0.1, 10.0.2.2, and common LAN ranges to support local mobile testing.

## Notes

- This repo is set up for a non-Expo-Go workflow using a custom dev client.
- On Windows, PowerShell redirection with > can create UTF-16 output files. For plain text outputs like requirements.txt, prefer cmd redirection when needed.

## Copilot And Session Context

- Repo-level Copilot instructions: .github/copilot-instructions.md
- Session/project handoff context: docs/PROJECT_CONTEXT.md
