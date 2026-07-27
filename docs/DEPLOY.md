# Deploy & run on your iPhone

Runbook for getting VibeCam onto a physical iPhone. Steps needing your accounts
(Render, Apple ID) are marked **[you]**.

---

## 1. Generate an API key

The backend gate is off when `VIBECAM_API_KEY` is empty. Any internet-reachable
deployment should set it, or strangers can spend your `/grade` CPU and fill your disk
via `/uploads`.

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Keep the value handy — the backend and the app both need it. Don't commit it.

## 2. Deploy the backend **[you]**

`render.yaml` is a ready Render blueprint (free plan, `rootDir: backend`, Python
3.11.9, health check on `/health`).

1. Render dashboard → **New → Blueprint** → pick the `VibeCam` repo.
2. Confirm the deploy branch is **`main`** (the old `mvp` branch was deleted).
3. When prompted for `VIBECAM_API_KEY`, paste the key from step 1
   (it's declared `sync: false`, so it is never stored in the repo).
4. Optional: add `GOOGLE_AI_API_KEY` if you want `/grade/vibe` and `/guide`.
   The six camera looks do **not** need it — they run offline and deterministically.

Verify once live (replace the host):

```powershell
# public — should return {"status":"ok",...}
curl.exe -s https://vibecam-backend.onrender.com/health

# gated — should return 401
curl.exe -s -o NUL -w "%{http_code}`n" https://vibecam-backend.onrender.com/cameras

# with the key — should return 200 and the camera list
curl.exe -s -H "X-API-Key: YOUR_KEY" https://vibecam-backend.onrender.com/cameras
```

> Free-plan instances sleep when idle, so the first capture after a pause can take
> ~30–60 s to wake. Nothing is broken — it's a cold start.

## 3. Point the app at it

`mobile/.env` (copy from `.env.example`):

```
EXPO_PUBLIC_API_BASE_URL=https://vibecam-backend.onrender.com
EXPO_PUBLIC_API_KEY=<the same key>
```

`EXPO_PUBLIC_*` values are compiled into the bundle. That's fine here: the key stops
random internet traffic, it isn't a secret from someone holding your build.

## 4. Build onto the iPhone **[you]**

Camera access needs a real build (Expo Go can't use the native camera config here).

```bash
cd mobile
npx expo prebuild --platform ios
npx expo run:ios --device        # USB-connected iPhone; needs macOS + Xcode
```

No Mac? Use EAS cloud builds:

```bash
npx eas build -p ios --profile development   # then install via the QR/link
```

Both paths need a free Apple ID for signing; a paid account isn't required for
personal device installs.

## 5. Camera settings for best accuracy

The looks are calibrated against straight-out-of-camera JPEGs, so give the app the
most neutral possible input:

- **Settings → Camera → Photographic Styles → Standard** (a baked-in style fights the emulation)
- **Settings → Camera → Formats → Most Compatible** (JPEG rather than HEIF)
- Leave HDR on; turn Night mode off for `ccd`/`powershot`, whose character is partly noise

## 6. What to check on device

- [ ] Capture → graded photo appears (this exercises the `file://` path from PR #8)
- [ ] Each of the six looks visibly differs on the same scene
- [ ] `g7x`/`rx100`/`gr`/`x100` responses carry `X-Grade-Method: reference`
- [ ] Skin tones on a portrait — the known weak spot (thin `skin` sample coverage)
- [ ] Cold-start delay is tolerable

Bring back anything that looks off and we can tune blend strength and scene
thresholds per camera.

## Local-only alternative

To skip Render entirely, run the backend on your machine and use its LAN IP:

```powershell
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Set `EXPO_PUBLIC_API_BASE_URL=http://<your-LAN-IP>:8000` and leave
`EXPO_PUBLIC_API_KEY` empty (`--host 0.0.0.0` exposes it to your local network only).
Phone and computer must share a Wi-Fi network.
