# VibeCam Project Context

Last updated: 2026-05-05

## Current State

- Branch in use: mvp
- Monorepo structure is in place with mobile/ and backend/
- Mobile app scaffolded with Expo + TypeScript + expo-dev-client
- Expo prebuild has been run; Android native folder is present
- Backend FastAPI app is implemented in backend/main.py with:
  - Local-testing CORS configuration
  - GET /health endpoint
  - POST /uploads/init endpoint (typed request/response contract)
  - GET /uploads/{upload_id} endpoint for upload session status
  - GET /uploads/{upload_id}/hash endpoint for payload hash retrieval
  - PUT /uploads/{upload_id}/chunks endpoint for resumable chunked ingestion
  - PUT /uploads/{upload_id}/content endpoint for first-pass binary ingestion
  - Local persistence for upload sessions (SQLite) and payload bytes (disk files)
  - SHA256 payload hash computed on ingestion completion and stored with session data
- Backend .env.example provides VIBECAM_MAX_UPLOAD_BYTES and VIBECAM_UPLOAD_TTL_MINUTES defaults
- backend/requirements.txt exists and is UTF-8/plain text
- Repo-level Copilot workflow instructions now exist at .github/copilot-instructions.md
- GitHub Actions workflows run backend tests and mobile typecheck on push/pull request
- Mobile app startup performs a backend health check and displays connection status in UI
- Mobile app includes a real file picker action for selecting local files to upload
- Mobile app includes in-app camera capture for photos and video
- Mobile app includes an upload initialization action that calls POST /uploads/init using selected file metadata and displays upload session details
- Mobile app includes a chunk upload action that streams selected file bytes to PUT /uploads/{upload_id}/chunks and displays resulting upload status
- Mobile app upload test screen is scrollable so action buttons remain reachable after file selection on small screens
- Mobile .env.example supports EXPO_PUBLIC_API_BASE_URL overrides
- Mobile UI displays SHA256 payload hash after completed uploads
- Backend smoke tests are implemented in backend/tests/test_api_smoke.py
- Store metadata and privacy policy drafts are in docs/STORE_METADATA.md and docs/PRIVACY_POLICY.md
- EAS build config is in mobile/eas.json
- Render blueprint is defined in render.yaml
- GitHub Pages content lives under docs/site
- GitHub Pages deployment workflow (.github/workflows/pages.yml) deploys docs/site on push to main/mvp or manual dispatch

## Verified Working

- Python dependencies installed in the selected virtual environment
- GET /health returns HTTP 200 and valid JSON response
- POST /uploads/init returns HTTP 200 and valid typed response payload
- GET /uploads/{upload_id} returns HTTP 200 and current upload state
- PUT /uploads/{upload_id}/chunks supports partial -> ingested transitions with offset validation
- PUT /uploads/{upload_id}/content returns HTTP 200 for valid upload_id and exact-size binary payload
- Completed uploads expose a SHA256 payload hash via GET /uploads/{upload_id} and GET /uploads/{upload_id}/hash
- Upload session state persists across backend restarts via SQLite local storage
- Backend smoke tests pass for health, init/status, chunk ingest, and full ingest flows (pytest)
- Editor diagnostics for backend/main.py are currently clean
- Upload initialization contract is available and validated for type/subtype mime format and file size limits
- TypeScript no-emit check for mobile passes with exit code 0
- Mobile App.tsx diagnostics are clean after chunk upload UI integration
- Mobile App.tsx diagnostics remain clean after real file-picker integration

## Known Gotchas

- In Windows PowerShell, output redirection with > can write UTF-16 LE.
- For plain-text lock/list files (for example requirements.txt), prefer cmd /c redirection or explicit UTF-8 output.

## Suggested Next Implementation Steps

1. Deploy backend via render.yaml and validate production URL.
2. Enable GitHub Pages in repo settings (source: GitHub Actions) to publish docs/site.
3. Build and submit to app stores using EAS and the metadata in docs/STORE_METADATA.md.
4. Add cloud storage integration for upload artifacts (post-MVP).

## Quick Validation Commands

Backend:

```powershell
Set-Location backend
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing
```

Mobile:

```powershell
Set-Location mobile
npm run android
```
