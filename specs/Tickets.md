# Tickets

GitHub Issues holds the live backlog, acceptance checks, task checklists and discussion. This index maps the release work to those issues. [Open the GitHub backlog](https://github.com/haydenteh5526/VibeCam/issues)

## M1 · Signed preview and first device pass

[Epic #33](https://github.com/haydenteh5526/VibeCam/issues/33) takes the offline iPhone v1 from passing CI to a signed standalone preview with a recorded device pass. [Release readiness](../docs/RELEASE_READINESS.md) lists what is implemented and the walkthrough the device passes follow.

| Issue | Type | Delivery and acceptance summary |
| --- | --- | --- |
| [#33 · Validate the offline iPhone workflow on a signed preview build](https://github.com/haydenteh5526/VibeCam/issues/33) | Epic | The signed preview is installed, each device pass has a result for every step it covers, and every failure has its own issue. |
| [#34 · See which build and capabilities are installed, from Settings](https://github.com/haydenteh5526/VibeCam/issues/34) | Story | `Build details` in Settings shows version, build, install type, system version, video looks, live colour and cloud state, and shares them as text. No dependencies. [Plan](plans/2026-11-15-issue-34-build-report.md) approved by the owner on 16 November 2026. Implemented on branch `feature/issue-34-build-report` and checked in a browser, PR to follow (`Part of #34`). The share sheet and install type remain unverified until #36. |
| [#35 · Keep every EAS build profile offline and on the CI toolchain](https://github.com/haydenteh5526/VibeCam/issues/35) | Story | A check in `npm test` fails when a profile could ship with cloud features on, when the EAS and CI Xcode versions differ, or when the preview profile or app identity is incomplete. No dependencies. [Plan](plans/2026-11-16-issue-35-eas-config-guard.md) approved by the owner on 16 November 2026, amended after review (revision 2) for platform overrides of the preview profile. Implemented on branch `feature/issue-35-eas-config-guard` in [PR #42](https://github.com/haydenteh5526/VibeCam/pull/42), open and not merged. Variables stored on Expo's servers are outside the check. |
| [#36 · Install a signed standalone preview on a registered iPhone](https://github.com/haydenteh5526/VibeCam/issues/36) | Owner task | Local Release build on the owner's Mac with a free Apple ID, installed and recorded. On hold until January 2027. [Plan](plans/2026-11-16-issue-36-mac-build.md) approved by the owner on 16 November 2026. The documentation of this route is in [PR #43](https://github.com/haydenteh5526/VibeCam/pull/43) (`Part of #36`). |
| [#37 · Device pass: capture or import, edit, Film Roll, Save and Share, offline](https://github.com/haydenteh5526/VibeCam/issues/37) | Device validation | Walkthrough steps 1 to 8 on the build from #36. Evidence only. |
| [#38 · Device pass: video looks, sound and recording](https://github.com/haydenteh5526/VibeCam/issues/38) | Device validation | Walkthrough step 9 on the build from #36, including the exported dimensions and the muted-export audio track. Evidence only. |
| [#39 · Device pass: live colour viewfinder](https://github.com/haydenteh5526/VibeCam/issues/39) | Device validation | Walkthrough step 10 on the build from #36, on iOS 16 or later. Evidence only. |

Order: #34 and #35 are merged; #34 stays open until its share-sheet check is recorded in #36. #36 runs in January 2027 on the owner's Mac. #37, #38 and #39 follow it, are independent of each other, and each runs on an install less than 7 days old.

## M2 · Ready for the January build

Work that changes the app and can be finished before the January 2027 device passes, so those passes run on the version that would ship.

| Issue | Type | Delivery and acceptance summary |
| --- | --- | --- |
| [#44 · Assess the npm audit advisories before the January build](https://github.com/haydenteh5526/VibeCam/issues/44) | Investigation | Classify the 25 advisories by whether they reach the shipped app, apply the fixes that need no Expo SDK change, and list the rest for the owner. No dependencies. [Plan](plans/2026-11-17-issue-44-dependency-audit.md) approved by the owner on 17 November 2026. Built on `feature/issue-44-dependency-audit`: 7 critical and high advisories classified as tooling, 25 advisories down to 18 (0 critical, 2 high), no Expo SDK change. Result in the [current state](Repo_Current_State.md). |
| [#45 · Import photos from the Photos library, including HEIC](https://github.com/haydenteh5526/VibeCam/issues/45) | Story | Import offers the Photos library and accepts HEIC. Needs #44 first. Verified on the iPhone in #37. Not planned yet. |
| [#46 · Keep Film Roll entries whose developed file is missing](https://github.com/haydenteh5526/VibeCam/issues/46) | Story | An entry whose developed file is missing but whose original exists is kept and stays editable. No dependencies. Its plan is on `feature/issue-46-roll-orphan`. |

Order: #44 and #46 are independent. #45 follows #44.

## Later, with no issue yet

Open an issue when the work is about to start, or when a device pass gives it a concrete failure.

- Latency, peak memory, warm-device performance and battery (walkthrough step 11). Memory profiling needs a Mac with Instruments.
- Paired-shot calibration of the looks. See [camera fidelity](../docs/CAMERA_CALIBRATION.md).
- Store submission: privacy and support URLs, store copy, screenshots from the signed app, and the TestFlight build.
- Review of the npm audit advisories, and a separate Expo SDK migration if the fixes need one.
- Observations from the 15 November code reading, listed in the [repository snapshot](Repo_Current_State.md#observations-with-no-issue-yet).

## How to track work

1. Use an epic for a user outcome and a story or issue for a testable increment. Put the user goal, scope and exclusions, dependencies and observable acceptance checks in the issue. Use a checklist for small implementation steps and a separate issue for work that needs its own review.
2. Use a separate investigation or device-validation issue when evidence is needed before a fix can be specified. A device pass records results and opens an issue for each failure.
3. Work in a branch and reference the issue in the pull request. For a partial increment use `Part of #N`. Use `Closes #N` only when the PR meets all of that issue's acceptance checks.
4. Record verification against the acceptance checks in the PR. Wait for the required CI checks, resolve review conversations and merge through protected `main`. Link the outcome or evidence to the issue.
5. Update this index when the epic, story breakdown or delivery dependencies change. Update the issue for progress. Record the verified result in the [repository snapshot](Repo_Current_State.md) and link the evidence.
