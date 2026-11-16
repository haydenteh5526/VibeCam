# Signed Build on the Owner's Mac (Issue #36) Plan

> **For agentic workers:** Task 1 is documentation an Issue session can build now. Tasks 2 and 3 are the owner's steps in January 2027, with the Architect recording the evidence. If a step cannot be done as written, stop and return the plan to the Architect.

**Status:** revision 1, written on 16 November 2026. Waiting for the owner's approval. Nothing in this plan is done.

**Goal:** Install a signed, standalone VibeCam on the owner's iPhone without a paid Apple Developer Program membership, by building it locally on the owner's M1 MacBook Air with a free Apple ID, and record its identity so the device passes #37, #38 and #39 and the remaining check of #34 can run against a known build.

**Why the route changed:** #36 was written for an EAS cloud build with ad hoc signing, which needs the paid membership (US$99 a year). On 16 November 2026 the owner chose to wait until the Mac is available in January 2027 and use the free route instead. A paid membership is still needed later for TestFlight and the App Store; that is outside this epic.

**Approach:** On the Mac, `npx expo run:ios --device --configuration Release` generates the iOS project, installs CocoaPods, compiles a Release build with the JavaScript bundle embedded, signs it with the owner's free personal team and installs it on the connected iPhone. A Release build sets `__DEV__` to false and needs no Metro server, so it is standalone. Its provisioning profile is a development profile (`get-task-allow` true), so `Build details` reads `Install: Development signing` (`mobile/node_modules/expo-application/ios/EXApplication/EXProvisioningProfile.m`, `appReleaseType`). Nothing in the repository changes except documentation.

**Checked while planning (16 November 2026, on `main` at `29f7f0a`):** the installed Expo CLI accepts `run:ios --device --configuration Release`; `expo-application` maps a development-signed profile to release type 3 (`Development signing` in `mobile/src/buildReport.ts`); `app.json` has `version` `1.0.0` and `ios.buildNumber` `1`, so a local build reads `Version 1.0.0 · Build 1`; `app.json` declares no entitlements beyond the four usage descriptions. **Not checked, and only knowable in January:** whether `com.vibecam.app` can be registered by a free personal team, whether Xcode 26.2 supports the iPhone's iOS version, and whether free signing accepts every native module in the build.

## Decisions

### Fixed by the owner

1. **Free route, January 2027.** No paid membership for now. No EAS build for #36.
2. **Offline v1 stays offline.** No configuration value changes. Cloud features stay off.
3. **Browser checks, Expo Go, the unsigned CI build and the simulator are not device evidence.**

### Separate approvals

- **A. Rewrite the acceptance checks of issue #36 for the Mac route.** *Recommended.* The current checks name `npm run build:iphone`, the EAS build ID and `Ad hoc`, none of which apply. The proposed text is in [Proposed acceptance checks for #36](#proposed-acceptance-checks-for-36). On approval the Architect edits the issue body; nothing else in the issue changes. *If declined:* the issue keeps its checks and is recorded as not completed by this route.
- **B. If `com.vibecam.app` is unavailable to the free team, change the bundle identifier only in the generated Xcode project, never in `app.json`.** *Recommended.* The generated `mobile/ios/` folder is ignored by Git, so the change stays on the Mac. Use `com.<your-apple-id-name>.vibecam.local`. The app then installs as a separate app with its own empty Film Roll, which does not matter for testing. The identifier used is recorded with the build. *Alternative:* stop and decide then.
- **C. Build the documentation (Task 1) now, as a docs-only PR, rather than in January.** *Recommended,* so January is only following the guide. *Alternative:* the owner follows this plan directly in January and the documents are updated afterwards.
- **D. If the iPhone's iOS is newer than Xcode 26.2 supports, use the oldest Xcode that supports it and record its version.** *Recommended.* `eas.json` and CI stay on 26.2; a different local Xcode is a recorded difference, not a configuration change. *Alternative:* update the iPhone or stop.

### Design decisions to confirm

5. **Primary command and one fallback.** Primary: `npx expo run:ios --device --configuration Release` from `mobile/`. Fallback, if the command cannot sign or select the device: open `mobile/ios/VibeCam.xcworkspace` in Xcode, choose the personal team under Signing & Capabilities, set the Run scheme's Build Configuration to Release, select the iPhone and press Run. Both produce the same kind of build.
6. **The commit built is a commit on `main`,** with a clean checkout, recorded by its full hash. `npm run check:release` is run on that commit on the Mac before building.
7. **The 7-day limit is part of the record.** Record the install date and the date the app stops opening (install date plus 7 days). A device pass runs on an install less than 7 days old. Reinstalling the same commit is allowed and is recorded with its new install date; it keeps the build identity.
8. **Trust before airplane mode.** iOS asks the owner to trust the developer under Settings → General → VPN & Device Management the first time; that verification needs a network connection. Airplane mode starts after the app has opened once.

## Global Constraints

- Branch `feature/issue-36-mac-build`, which holds this plan. Task 1 opens a PR to protected `main` and does not merge; the owner decides on merging.
- Task 1 changes documentation only: `docs/DEPLOY.md`, `docs/RELEASE_READINESS.md`, `CONTEXT.md`, `specs/Tickets.md`, `specs/Repo_Current_State.md`. No change to `mobile/`, `backend/`, `.github/`, `app.json` or `eas.json`.
- No agent session signs in to Apple or Expo, signs, builds on the Mac or installs on the iPhone. The owner runs Tasks 2 and 3; the Architect records what the owner reports.
- Never commit anything from `mobile/ios/`.
- No Claude attribution in commits, PRs, issues or comments.

## Review Focus

1. **A development build mistaken for the standalone one.** Debug builds need Metro and append `· development bundle`. The record must show `Install: Development signing` with no `development bundle`, and the app must open in airplane mode with the Mac disconnected. (Task 3)
2. **An expired install used for a device pass.** The install date and expiry must be recorded and checked against each pass. (Task 3, Decision 7)
3. **A changed bundle identifier leaking into the repository.** `git status` on the Mac is clean after the build. (Task 2, Decision B)
4. **A local Xcode different from CI.** Recorded, never resolved by editing `eas.json` or the workflow. (Decision D)
5. **Documentation that tells a Windows-only reader they can use this route.** The new section says it needs a Mac. (Task 1)

## File Structure

| File | Change |
| --- | --- |
| `docs/DEPLOY.md` (modify) | New section "Build on a Mac without a paid membership", placed before "5. Test the installed build". |
| `docs/RELEASE_READINESS.md` (modify) | Walkthrough introduction accepts either the EAS preview or the Mac Release build, and names the 7-day limit. |
| `CONTEXT.md` (modify) | "Next release work" names both routes. |
| `specs/Tickets.md` (modify) | #36 row: Mac route, on hold until January 2027, plan link. Order line updated. |
| `specs/Repo_Current_State.md` (modify) | Limits: no device evidence before January 2027, and why. |

---

### Task 1: Documentation (Issue session, now)

- [ ] **Step 1: `docs/DEPLOY.md`.** Add the section below before "## 5. Test the installed build", and add one sentence at the top of section 2: "Without an Apple Developer Program membership, use [Build on a Mac without a paid membership](#build-on-a-mac-without-a-paid-membership) instead of sections 2 to 4." The section's content, in the file's style:
  1. **What it needs:** a Mac with Apple silicon or Intel that runs macOS 15.6 or later; Xcode 26.2 from Apple's developer downloads with the iOS platform installed; at least 40 GB free; Node 20; CocoaPods; a free Apple ID added in Xcode → Settings → Accounts; the iPhone and its cable.
  2. **What it gives:** a signed Release build with the JavaScript embedded, installed only on phones connected to that Mac, which stops opening 7 days after installation. No TestFlight or App Store. `Build details` reads `Install: Development signing`.
  3. **Steps:** `git clone`, `git checkout <commit on main>`, `cd mobile`, `npm ci`, `npm run check:release`; connect and unlock the iPhone, trust the Mac, and turn on Developer Mode when iOS offers it (Settings → Privacy & Security); `npx expo run:ios --device --configuration Release`, choosing the iPhone and the personal team when asked; on the iPhone, trust the developer under Settings → General → VPN & Device Management; open the app once while online.
  4. **If signing fails** because the bundle identifier is unavailable: open `ios/VibeCam.xcworkspace`, change the bundle identifier under Signing & Capabilities to `com.<your-apple-id-name>.vibecam.local`, keep the Release configuration, and run from Xcode. Do not change `app.json`. Record the identifier used.
  5. **Record:** commit, macOS and Xcode versions, bundle identifier, install date and expiry date, and the `Build details` text shared from Settings.
- [ ] **Step 2: `docs/RELEASE_READINESS.md`.** Replace the first sentence of "Required physical iPhone walkthrough" with: "Use a signed standalone build that includes the local video module: the EAS preview ([build guide](DEPLOY.md)) or a Release build from a Mac ([Mac route](DEPLOY.md#build-on-a-mac-without-a-paid-membership)), installed less than 7 days earlier." Keep the rest.
- [ ] **Step 3: `CONTEXT.md`.** In "Next release work", say the first device pass uses a Release build from the owner's Mac with a free Apple ID, planned for January 2027, and that the EAS preview needs the paid membership.
- [ ] **Step 4: `specs/Tickets.md`.** #36 row: "Owner task. Local Release build on the owner's Mac with a free Apple ID, installed and recorded. On hold until January 2027. [Plan](plans/2026-11-16-issue-36-mac-build.md)." Order line: #36 runs in January 2027; #37, #38 and #39 follow it, each on an install less than 7 days old; #34 stays open until its share-sheet check is recorded in #36.
- [ ] **Step 5: `specs/Repo_Current_State.md`.** Under "Remaining evidence and limits": no device evidence is expected before January 2027, because the owner's Mac is not available until then and no paid membership is held.
- [ ] **Step 6:** Check every link resolves (`#build-on-a-mac-without-a-paid-membership` must match the heading). Commit, push, open a PR to `main` titled `Document the Mac build route for the first device pass`, body starting `Part of #36`. There is no app code, so the gate is the three required CI checks. No independent review is needed for a documentation-only change unless the owner asks for one.

### Task 2: Build and install (owner, January 2027)

- [ ] **Step 1: Prepare the Mac.** macOS 15.6 or later; Xcode 26.2 and its iOS platform (Decision D if the iPhone needs newer); `xcodebuild -version` shows it; Node 20 (`node -v`); CocoaPods (`pod --version`); Apple ID added in Xcode.
- [ ] **Step 2: Gate.** On a clean clone at the chosen commit on `main`: `npm ci` and `npm run check:release` in `mobile/`. Record the full commit hash and the result.
- [ ] **Step 3: Build and install** with the primary command, or the fallback (Decision 5), applying Decision B if needed. Record macOS, Xcode, bundle identifier and the install date.
- [ ] **Step 4: Confirm the checkout is clean:** `git status` shows no change outside the ignored `mobile/ios/`.

### Task 3: Launch check and record (owner, with the Architect)

- [ ] **Step 1:** Trust the developer, open the app once online.
- [ ] **Step 2:** Disconnect the iPhone from the Mac, turn on airplane mode, force quit and reopen. The app opens to the camera or the permission screen, and Settings opens.
- [ ] **Step 3:** Settings → `Build details`. Expected: `Version 1.0.0 · Build 1`, `Install: Development signing` with no `development bundle`, `System: iOS <version>`, `Video looks: available`, `Live colour: available` on iOS 16 or later, `Cloud features: off`.
- [ ] **Step 4:** `Share build report`: the share sheet opens with the same text; cancel it and confirm no error appears. This is the remaining acceptance check of #34.
- [ ] **Step 5:** Send the Architect the shared report, the iPhone model, the iOS version and the records from Task 2. The Architect posts them to #36, updates `specs/Repo_Current_State.md` and `specs/Tickets.md` on a branch, and asks the owner whether to close #36 and #34.

## Proposed acceptance checks for #36

Replace the issue's "Acceptance checks" section with:

- `npm run check:release` passes on the commit that is built, and the full commit hash is recorded.
- A Release build of that commit is compiled on the owner's Mac and signed with the owner's Apple ID. The macOS version, Xcode version and bundle identifier are recorded.
- The build installs on the iPhone. The install date and the date it stops opening are recorded.
- With the iPhone disconnected from the Mac and in airplane mode, the app opens to the camera or the permission screen and Settings opens.
- `Build details` reads the recorded version and build, `Install: Development signing` with no development bundle, video looks available, live colour available on iOS 16 or later, and cloud features off. `Share build report` opens the share sheet with that text, and cancelling shows no error.
- The iPhone model and iOS version are recorded for the device passes to reuse.

The "Tasks" checklist changes to match Task 2 and Task 3. The scope line drops "one `preview` build" and the EAS and Apple team access, and names the Mac and a free Apple ID.

## Found while planning, not in this plan

- #37, #38 and #39 say "the signed preview from #36". The Mac build is signed and standalone, so the wording still holds; each pass should add its install date to the build record because of the 7-day limit.
- The Mac also makes `ios-build` reproducible locally and provides Instruments for walkthrough step 11 (latency, memory, heat), which has no issue yet.
- Local leftovers on the Windows PC from the November build sessions: two worktrees under `.claude/worktrees`, their feature branches, and a local `claude/…` branch. None is on GitHub.
