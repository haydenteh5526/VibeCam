# Repository working guide

- Read [CONTEXT.md](CONTEXT.md) for the product and architecture, [release readiness](docs/RELEASE_READINESS.md) for what is implemented and what still needs an iPhone, the [ticket index](specs/Tickets.md) and the [current state](specs/Repo_Current_State.md) before changing anything. Those two documents stay authoritative for their subjects. Link to them and do not copy them.
- Use the [README](README.md#getting-started) for setup and the [build guide](docs/DEPLOY.md) for signed iPhone builds. [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) is a historical log.
- Run mobile commands from `mobile/` and backend commands from `backend/`. On Windows, write generated text files as UTF-8 and avoid PowerShell `>` redirection for them.
- Update the relevant document when behaviour changes. Keep proposed work, work on a branch and verified results apart, and never describe a check as passed unless it was run on the commit named.

## Product constraints

- The offline iPhone workflow is the product: capture or import, edit, Film Roll, Save and Share. It needs no account, backend or network.
- Cloud and AI features stay off by default. `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=true` is a development opt-in and no build profile sets it.
- Film Roll keeps the original. Edits are non-destructive and do not compound. A commit is durable before the index says so, and Save and Share export the committed edit, never a draft.
- Photo, video and live preview use one colour transform and one LUT layout: flat `.cube` order, red fastest, then green, then blue by row. A change to one path needs the parity checks for the others.
- Camera looks are inspired interpretations. Do not write, in code, copy or documents, that a look matches or reproduces a named camera. See [camera fidelity](docs/CAMERA_CALIBRATION.md).
- Keep the backend `/health` response contract: `status`, `service`, `timestamp_utc`. The backend is optional development and is not part of v1.
- No unrelated redesign, speculative rewrite or Expo major-version migration inside a feature. Each needs its own issue.

## Workflow

One Architect session plans, and each active issue has one Issue session that builds, has the work reviewed and fixes it.

| Role | Where | Does | Must not |
| --- | --- | --- | --- |
| Architect | The root checkout on `main`. One long-lived session, with its context cleared between unrelated features. Runs on the most capable model available. | Turns an issue's acceptance checks into a plan in `specs/plans/`: files, names, signatures, exact copy, tests, device steps and the decisions for the owner. Commits the plan on the issue's feature branch and waits for the owner's approval. | Change application code or commit to `main`. |
| Issue | Its own worktree, cut from the feature branch that holds the approved plan. One Sonnet session per active issue. | Implements the plan test first, runs the gates, has the Reviewer check the result, shows the owner the Reviewer's full report, applies the findings the owner approves and opens the PR. | Add scope, change the plan's decisions, shorten or filter the Reviewer's report, or merge. |
| Reviewer | An Opus subagent inside the Issue session, started with a fresh context that has not seen the build. Read-only. | Reads the approved plan, the issue's acceptance checks, the actual diff and the code around it. Re-runs the gates that apply. Reports findings by severity with file, line, a failure scenario and evidence, and lists acceptance checks that have no verification. | Change code, post to GitHub, or merge. |

- The owner approves the plan, decides which findings to fix, and merges.
- Record the Reviewer's full report in the PR description, with what was fixed and what was left.
- A plan that proves wrong or ambiguous goes back to the Architect. Do not improvise around it.
- If the Issue session cannot start an Opus subagent, it writes a handoff for a separate Opus review session and marks the independent review as pending. A review by the building session does not count.
- A device pass is an issue of its own. It records evidence and opens a new issue for each failure. It does not fix anything.

## Branches and pull requests

- Name a branch `feature/issue-N-short-name`, `fix/issue-N-short-name` or `docs/short-name`. Where a tool requires its own branch namespace, keep that name and say in the PR which issue it serves.
- Submit a pull request to protected `main` and reference the issue. Use `Part of #N` for a partial increment. Use `Closes #N` only when every acceptance check of that issue is verified, including any that need an iPhone.
- The PR description records the commit, the environment, what was run with its observed result, what was not run, the Reviewer's full report, and which findings were fixed and which remain.
- Keep the branch current with `main` and wait for `typecheck`, `ios-build` and `tests` before merging. Only the owner merges.
- Do not start an EAS build, submit to the App Store or deploy the backend from an agent session.

## Verification

The [mobile workflow](.github/workflows/mobile-checks.yml) and the [backend workflow](.github/workflows/backend-tests.yml) are the full gate. Run the checks that apply from their directories.

| Directory | Checks |
| --- | --- |
| `mobile/` | `npm ci`, `npm run typecheck`, `npm test`, and `npx expo export --platform all` with `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false`. `npm run check:release` runs these with `expo install --check`. |
| `mobile/` (browser) | `npm run test:gpu` serves the shader check on `localhost:8082` (press Run GPU check). `npm run test:camera` serves the simulated camera check on `127.0.0.1:8083` (press Run checks). `npm run web` serves the app on `localhost:8081`. |
| `mobile/` (macOS only) | The `ios-build` job: the Core Image colour check against the photo LUTs (`tools/native-look-fixture.ts`, `tools/native-look-smoke.swift`), `expo prebuild`, `pod install`, and an unsigned iPhone Release compile on Xcode 26.2. It runs in CI. |
| `backend/` | `python -m pip install -r requirements.txt` and `python -m pytest -q`. After a backend change, check `GET /health`. |

After changing a camera's colour values, run `python tools/build_luts.py` in `backend/` and `npm run assets:video-luts` in `mobile/`, then the mobile tests.

What these checks do not show: browser checks, mocks, Expo Go and the unsigned CI build say nothing about the physical camera, microphone, Photos, sharing, native image orientation, memory or heat. Only a signed build on an iPhone does, following the [physical iPhone walkthrough](docs/RELEASE_READINESS.md#required-physical-iphone-walkthrough). Record the build number from Settings, the iPhone model and the iOS version with every device result.

Record the commit, environment and observed results in the PR and in the [repository snapshot](specs/Repo_Current_State.md). A result from an earlier commit is history, not a current pass.
