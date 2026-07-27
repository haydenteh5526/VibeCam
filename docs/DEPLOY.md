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

## 4. Get it onto the iPhone **[you]**

Every dependency is a first-party Expo module (no custom native code), so **Expo Go
works** — which matters because `npx expo run:ios` needs macOS + Xcode and is not an
option from Windows.

### Fastest: Expo Go (no build, no Mac)

```bash
cd mobile
npm install
npx expo start
```

Install **Expo Go** from the App Store, then scan the QR code with the iPhone camera.
Phone and PC must be on the same Wi-Fi.

#### Phone not on the same network (mobile data, guest Wi-Fi, office network)

LAN mode serves the JS bundle from the laptop's private address (e.g.
`192.168.0.237:8081`), which a phone on cellular cannot reach. Use tunnel mode:

```bash
npx expo start --tunnel
```

`@expo/ngrok` is already a pinned devDependency, so this runs without an install
prompt. The bundle is relayed through a public URL, so the phone can be on mobile data
or any other network. It's slower to load and hot-reload than LAN — prefer plain
`npx expo start` when both devices share Wi-Fi.

Tunnel mode only covers the **dev server**. A backend on `http://<LAN-IP>:8000` is
still unreachable from another network, so pair tunnel mode with the deployed Render
URL in `EXPO_PUBLIC_API_BASE_URL` (it's on the public internet, so any connection
works).

#### If Expo Go won't connect on the same Wi-Fi

- **Client isolation**: many routers, and most guest/hotel/office networks, block
  device-to-device traffic. Same SSID, still no connection → use `--tunnel`.
- **Windows Firewall** commonly blocks inbound `8081`. Allow Node through, or
  use `--tunnel`.

Caveats: Expo Go ignores `app.json`'s `infoPlist` / plugin config and uses its own
permission strings, so the photo-library prompt will say *Expo Go* wants access.
Saving still works. Nothing else in this app depends on custom native config.

### For a standalone app: EAS cloud build

Builds on Apple hardware in the cloud, so it works from Windows:

```bash
cd mobile
npx eas build -p ios --profile development   # install via the QR/link it prints
```

Needs a free Apple ID for signing; a paid developer account isn't required for
personal device installs.

## 5. Camera settings — what actually matters

The app captures through **expo-camera (AVFoundation)**, not Apple's Camera app. The
stock app's computational pipeline — Smart HDR, Deep Fusion, Photographic Styles — is
part of *Apple's* app, so those Settings toggles largely do not affect what VibeCam
captures. That works in our favour: a less-processed, flatter frame is better input
for camera emulation.

Notes for specific devices:

- **iPhone 12 Pro Max** (and any pre-iPhone-13): **Photographic Styles doesn't exist**
  on this hardware — it arrived with the iPhone 13. Nothing to disable.
- **iPhone 13 and later**: Photographic Styles applies only to the stock Camera app,
  so it shouldn't affect VibeCam either. Set it to Standard anyway if you also want
  your normal photos neutral for comparison.
- **Settings → Camera → Formats** likewise governs the stock app; expo-camera returns
  a JPEG regardless.

Exactly how much processing AVFoundation applies by default on a given iPhone is worth
confirming on-device — shoot the same scene in VibeCam and the stock Camera app and
compare. If VibeCam's frame looks flatter, that's expected and correct.

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
