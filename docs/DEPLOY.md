# Build and test VibeCam on an iPhone

The first release is offline. No backend, API key or app account is required to use
it. Building and signing it requires developer accounts. These steps work from
Windows because EAS builds on cloud Macs.

## 1. Prepare the PC

From the repository root:

```powershell
cd mobile
npm ci
npm run check:release
```

The npm scripts use EAS CLI 24.11.0. `eas.json` pins Xcode 26.2 for iOS, including
preview and production. `npm test`, and so `npm run check:release` and CI, fails if a
build profile could ship with cloud features on, if the EAS and CI Xcode versions
differ, or if the preview profile or the app identity is incomplete. Apple requires
the iOS 26 SDK or later for uploads from April 28, 2026. The SDK used to build the
app is separate from its minimum supported iOS version; live colour requires iOS 16+,
while older supported iPhones retain the raw viewfinder. See
[Apple's requirement](https://developer.apple.com/news/?id=ueeok6yw) and
[Expo's build images](https://docs.expo.dev/build-reference/infrastructure/).

## 2. Sign in and verify project access

Without an Apple Developer Program membership, use
[Build on a Mac without a paid membership](#build-on-a-mac-without-a-paid-membership)
instead of sections 2 to 4.

Run these in an interactive terminal; keep passwords and verification codes there:

```powershell
npm run eas -- login
npm run eas -- whoami
npm run eas -- project:info
```

The configured project belongs to `hayyyyy`, has ID
`054f74da-a7ed-4340-84cb-eb5f257ae716`, and uses bundle ID `com.vibecam.app`.
Use that Expo account or one granted access to its project. If project access fails,
resolve access before building; do not create an unrelated project or replace the ID.

The configuration check reads committed files only. Before building, open the
project's Environment variables page on expo.dev and confirm that
`EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` is not defined for any environment a profile
uses: `development`, `preview` and `production`.

An active Apple Developer Program membership and permission to manage signing for
its team are required for the following physical-device cloud build. A free Apple
ID alone does not support this EAS signing workflow. See
[Expo's device build guide](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/).

## 3. Register the iPhone before building

```powershell
npm run eas -- device:create
npm run eas -- device:list
```

Choose website registration and open the resulting link in Safari **on the iPhone**.
Follow the device registration instructions and confirm the phone appears in the
list. Choose the intended Apple Developer team when prompted. EAS adds registered
devices to the ad hoc provisioning profile during the build/signing process.

## 4. Build and install the standalone preview

```powershell
npm run build:iphone
```

Follow the Apple login/signing prompts in the terminal, select the correct team,
and include the registered iPhone when choosing devices for the provisioning profile.
If `com.vibecam.app` is unavailable to that team, resolve the app identity before
changing it; changing it later creates a separate installed app and Film Roll.

After the build succeeds, open its install link/QR on the registered iPhone and
install VibeCam. The preview contains the local video/live-colour module and its
JavaScript/assets. It runs without Metro, the PC or a network connection.
Use airplane mode to verify that during the device walkthrough.

- If a new phone cannot install an older build, register it and create a new preview
  (or re-sign with an updated provisioning profile). Registration alone does not
  change an existing binary. See [internal distribution](https://docs.expo.dev/build/internal-distribution/).
- `development` is a custom development client that needs `npm start`; `preview` is
  the standalone app to use for acceptance testing.
- Expo Go cannot load VibeCam's custom native module. Its SDK availability also
  changes over time, so do not use it to validate this release.
- Do not uninstall an existing preview just to update it: save any wanted items to
  Photos first. Uninstalling deletes that app's Film Roll.

## Build on a Mac without a paid membership

Use this route when there is no Apple Developer Program membership. It needs a Mac and
cannot be done from Windows. It builds VibeCam on the Mac and signs it with a free
Apple ID.

It needs:

- a Mac, Apple silicon or Intel, that runs macOS 15.6 or later and has at least 40 GB
  free;
- Xcode 26.2 from Apple's developer downloads, with the iOS platform installed;
- Node 20 and CocoaPods;
- a free Apple ID, added in Xcode -> Settings -> Accounts;
- the iPhone and its cable.

It gives a signed Release build with the JavaScript embedded, installed only on phones
connected to that Mac. The app stops opening 7 days after installation, so run a device
pass on an install less than 7 days old. There is no TestFlight or App Store build.
**Settings -> Build details** reads `Install: Development signing`.

On the Mac, build a commit on `main` from a clean checkout:

```bash
git clone https://github.com/haydenteh5526/VibeCam.git
cd VibeCam
git checkout <commit on main>
cd mobile
npm ci
npm run check:release
```

Connect and unlock the iPhone, trust the Mac, and turn on Developer Mode when iOS
offers it (Settings -> Privacy & Security). Then build and install:

```bash
npx expo run:ios --device --configuration Release
```

Choose the iPhone and the personal team when asked. On the iPhone, trust the developer
under Settings -> General -> VPN & Device Management; that verification needs a network
connection. Open the app once while online. Use airplane mode only after that.

- If the command cannot sign or select the device, open `ios/VibeCam.xcworkspace` in
  Xcode, choose the personal team under Signing & Capabilities, set the Run scheme's
  Build Configuration to Release, select the iPhone and press Run. Both routes produce
  the same kind of build.
- If signing fails because the bundle identifier is unavailable, open
  `ios/VibeCam.xcworkspace`, change the bundle identifier under Signing & Capabilities
  to `com.<your-apple-id-name>.vibecam.local`, keep the Release configuration and run
  from Xcode. Do not change `app.json`: the generated `ios/` folder is ignored by Git,
  so the change stays on the Mac. The app then installs as a separate app with its own
  empty Film Roll.
- Do not commit anything from `ios/`. After the build, `git status` should show no
  change outside it.

Record the full commit hash, the macOS and Xcode versions, the bundle identifier used,
the install date and the date the app stops opening (install date plus 7 days), and the
**Build details** text shared from Settings.

## 5. Test the installed build

Share **Settings -> Build details** and add the iPhone model when
reporting an issue. Follow the full [physical iPhone checklist](RELEASE_READINESS.md#required-physical-iphone-walkthrough).
Start with:

1. Capture, edit, save and share a photo in airplane mode with each of the six looks.
2. Check framing/orientation/front mirroring, Original/Look and every available lens.
3. Record a clip with sound, then one with microphone access denied; save and share.
4. Force quit and reopen; verify Film Roll, originals, favourites and saved edits.
5. Deny Photos permission, then grant it and retry Save without losing the capture.
6. Repeat captures and recordings with live colour active; check interruptions,
   memory, temperature and battery on the actual phone.

GitHub CI compiles an **unsigned iPhone Release build** using Xcode 26.2, checks the
embedded JavaScript bundle and runs the native colour/orientation fixtures. This
catches compile and packaging failures; it does not produce an installable signed
IPA or validate camera, microphone, Photos or device performance.

## 6. After the device checks: TestFlight

```powershell
npm run build:iphone:store
```

This creates a store-signed binary; it does not upload or publish it. After reviewing
that exact build and completing App Store Connect setup, submit its specific build
ID with `npm run eas -- submit --platform ios --id BUILD_ID`. Avoid `--latest` when
there are multiple profiles, because the internal preview is not a TestFlight build.
See [Expo's TestFlight guide](https://docs.expo.dev/submit/testflight/).

Preview and production use EAS remote build numbers with auto-increment. The local
`app.json` build number seeds a new remote counter; afterward the installed native
build number is authoritative. If this bundle ID already has App Store builds,
check the highest uploaded number and run `npm run eas -- build:version:set` before
building so the next number is higher. Keep the public app version in `app.json`.
See [Expo's version management](https://docs.expo.dev/build-reference/app-versions/).

Before submission, complete the remaining [release gates](RELEASE_READINESS.md#remaining-release-gates),
review [store metadata](STORE_METADATA.md), verify privacy/support URLs, and take
screenshots from the signed app. Camera looks remain inspired interpretations until
[paired-shot calibration](CAMERA_CALIBRATION.md) is completed.

## PC preview without developer accounts

```powershell
npm run web
```

Open `http://localhost:8081`. Import JPEG/PNG photos from Files if the PC has no camera.
Photo editing runs locally through the same LUT/shader path; Film Roll uses IndexedDB
and Save downloads a JPEG. Web cannot record native styled clips or validate iPhone
camera behaviour. Keep the browser profile to preserve its Film Roll.

## Optional backend development

The backend is outside the first release. The [README](../README.md) lists its API,
local setup and environment variables; `render.yaml` contains the Render blueprint.
Use a separate development environment with `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=true`
only when working on those features. Every EAS app profile inherits an explicit
`false` value from `base`. Never put private credentials in `EXPO_PUBLIC_*` values:
they are readable in the client bundle. A shared client API key is not per-user
authorization; cloud features still need the isolation and privacy work listed in
the release gates.
