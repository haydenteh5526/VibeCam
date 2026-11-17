# Dependency Audit Before the January Build (Issue #44) Implementation Plan

> **For agentic workers:** work through this plan task by task, in the order given. Steps use checkbox (`- [ ]`) syntax for tracking. If a step cannot be done as written, or a result contradicts what this plan expects, stop and return the plan to the Architect.

**Status:** revision 1, approved by the owner on 17 November 2026 with separate approvals A, B and C as recommended and design decisions 4 to 7 as written. Nothing in this plan is done.

**Goal:** Know, with evidence, which of the 25 `npm audit` advisories in `mobile/` reach the app that ships, apply every fix that needs no Expo SDK change, and give the owner the facts to decide whether an Expo upgrade must happen before the January 2027 build.

**Approach:** Classify each advisory by its dependency path and by whether its package appears in the exported bundles' source maps. Apply the semver-compatible fixes through the lockfile only, prove the app still builds and that no Expo or React Native version moved, and record the before and after counts. Advisories that need Expo SDK 58 are listed with their risk, not fixed.

**Spec:** [Issue #44](https://github.com/haydenteh5526/VibeCam/issues/44). Read it, [AGENTS.md](../../AGENTS.md) and `mobile/package.json` before starting.

## What planning found

Run on `main` at `aad3016`, 17 November 2026, Windows 11, `npm audit --json` and `npm ls <package> --all` in `mobile/`. These are the Architect's observations; Task 1 repeats them and records its own.

| Severity | Package | Path | npm's fix |
| --- | --- | --- | --- |
| Critical | `shell-quote` 1.10.0 | `react-native` → `react-devtools-core` | Compatible |
| High | `image-size` 1.2.1 | `expo` → `@expo/metro` → `metro` | Compatible |
| High | `node-forge` 1.4.0 | `expo` → `@expo/cli` (and `@expo/code-signing-certificates`) | Compatible |
| High | `postcss` 8.4.49 | `expo` → `@expo/metro-config` | Compatible |
| High | `source-map-js` 1.2.1 | `expo` → `@expo/metro-config` → `postcss` | Compatible |
| High | `undici` 6.28.1 | `expo` → `@expo/cli` | Compatible |
| High | `sharp` 0.35.4 | direct `devDependency` (`tools/build-icons.mjs`, `tools/build-video-luts.mjs`, `videoLuts.test.ts`) | Compatible (0.35.5 or later) |

- All seven sit in development or build tooling by their paths. **Whether any reaches the shipped bundle is not yet shown;** Task 1 shows it. `react-devtools-core` is required by `react-native/Libraries/Core/setUpReactDevTools.js`, which React Native loads in development only; the bundle check confirms or refutes that for this app.
- Of the 18 moderate advisories, 5 have a compatible fix (`@expo/cli`, `@expo/metro-config`, `@expo/prebuild-config`, `expo-dev-launcher`, `fast-uri`), 12 are fixed only by Expo SDK 58 (`expo`, `expo-asset`, `expo-constants`, `expo-dev-client`, `expo-manifests`, `@expo/config`, `@expo/config-plugins`, `@expo/fingerprint`, `glob`, `minimatch`, `uuid`, `xcode`; their root causes are `glob`, `minimatch`, `uuid` and `xcode` inside Expo's configuration tooling), and 1 has no fix (`@expo/ngrok`, through `uuid`).

## Decisions

### Fixed by the owner

1. **No Expo SDK upgrade in this issue.** If one is needed it gets its own issue and the owner decides.
2. **Offline v1 stays offline.** No configuration value changes.

### Separate approvals

- **A. Remove `@expo/ngrok` and the `go:tunnel` script.** *Recommended.* `@expo/ngrok` is a `devDependency` used only by `npm run go:tunnel`, which starts Expo Go through a tunnel. Expo Go cannot load VibeCam's native module, so the script cannot validate this app, and the package's advisory has no fix. Removing both clears that advisory. *If declined:* the advisory stays and is recorded as development-only.
- **B. Fix the compatible moderate advisories together with the critical and high ones.** *Recommended.* They come from the same lockfile update, and separating them would mean hand-picking packages. *Alternative:* critical and high only, using targeted `npm update <package>` calls.
- **C. Do not use `overrides` to force versions inside Expo's own packages.** *Recommended.* An override can break `expo install --check` or the native build in ways CI may not show, for advisories in build tooling. Anything not fixable by a compatible update is listed for the owner instead. *Alternative:* allow overrides for a named package after the owner sees the list.

### Design decisions to confirm

4. **Fixes go through the lockfile.** `npm audit fix` without `--force`. `package.json` changes only for `sharp`'s range if npm rewrites it, and for approval A. `expo`, `react`, `react-native` and every `expo-*` package keep their exact installed versions; Task 2 proves it with a before and after listing.
5. **Evidence that a package is not in the app** is its absence from the `sources` of the source maps of a production export for iOS, Android and web. A dependency path alone is not accepted as evidence.
6. **Classes:** `bundle` (appears in an exported bundle's sources), `native` (compiled or linked into the iOS app by CocoaPods or autolinking), `tooling` (neither). A `bundle` or `native` advisory that has no compatible fix is reported to the owner at once, before continuing.
7. **Risk wording for an offline app** states, for each unfixed advisory, what input an attacker would need to control and whether the shipped app ever handles such input.

## Global Constraints

- Branch `feature/issue-44-dependency-audit`, which holds this plan. PR to protected `main`. Do not merge.
- Allowed changes: `mobile/package-lock.json`, `mobile/package.json` (only as Decision 4 and approval A allow), `specs/Repo_Current_State.md`, `specs/Tickets.md`, and, with approval A, any document that mentions `go:tunnel`. Nothing under `mobile/src/`, `mobile/modules/`, `.github/`, and no change to `app.json` or `eas.json`.
- Never run `npm audit fix --force`. Never change the Expo SDK, React or React Native version.
- Do not start an EAS build or run any `eas` command.
- No Claude or AI attribution in commits, PRs, issues or comments.
- Mobile gate, from `mobile/`: `npm ci`, `npm run check:release` (typecheck, tests, `expo install --check`, export). Record the test count observed.

## Review Focus

1. **A fix that moves an Expo, React or React Native version.** (Task 2 Step 3)
2. **A classification taken from the dependency path alone.** (Task 1 Step 3, Decision 5)
3. **A lockfile that installs differently on CI.** CI uses Node 20 and `npm ci` on Linux and macOS; the lockfile must be generated so `npm ci` succeeds there. (Task 2 Step 4, and the PR's CI checks)
4. **`sharp` output changing.** `videoLuts.test.ts` compares the committed LUT images through `sharp`; it must still pass, and `npm run assets:video-luts` must leave `git status` clean. (Task 2 Step 5)
5. **A removed script still referenced in documents.** (Task 2 Step 6, approval A)
6. **Counts copied instead of observed.** (Tasks 1 and 3)

---

### Task 1: Classify, with evidence (no file changes)

- [ ] **Step 1:** From a clean `npm ci` in `mobile/`, save `npm audit --json` and record the counts by severity and the list of packages. If they differ from "What planning found", record the difference and continue.
- [ ] **Step 2:** For every critical and high package, record `npm ls <package> --all`.
- [ ] **Step 3:** Export with source maps, with `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false`, into a scratch directory outside the repository. Confirm the flag with `npx expo export --help` first (expected: `--source-maps`, with `--output-dir`). For each of iOS, Android and web, read the `sources` arrays of the emitted `.map` files and record, for every advisory package (all 25), whether any source path contains `node_modules/<package>/`.
- [ ] **Step 4:** For `native`: list the pods and autolinked modules (`npx expo-modules-autolinking resolve --platform ios`, and the `Podfile.lock` from the last `ios-build` CI run if available) and record whether any advisory package is among them. If this cannot be determined on Windows, say so and mark it for the `ios-build` job.
- [ ] **Step 5:** Write the classification table (package, severity, class, evidence, fix available). **If any critical or high package is `bundle` or `native`, stop and report to the owner before Task 2.**

### Task 2: Apply the compatible fixes

- [ ] **Step 1:** Record `npm ls expo react react-native --depth=0` and the versions of every `expo-*` dependency.
- [ ] **Step 2:** Run `npm audit fix` (no `--force`). With approval A, remove `@expo/ngrok` from `devDependencies` and the `go:tunnel` script, then `npm install` to update the lockfile.
- [ ] **Step 3:** Repeat Step 1 and show the two listings are identical. `git diff --stat` shows only `package-lock.json`, and `package.json` only as allowed.
- [ ] **Step 4:** Delete `node_modules`, run `npm ci`, then `npm run check:release`. Record the output and the test count.
- [ ] **Step 5:** Run `npm run assets:video-luts` and confirm `git status` shows no change to `mobile/assets/`.
- [ ] **Step 6:** With approval A, search the repository for `go:tunnel`, `--tunnel` and `ngrok` and update each mention.
- [ ] **Step 7:** Commit: `git commit -m "Update vulnerable development and build dependencies"`.

### Task 3: Record, review and pull request

- [ ] **Step 1:** Run `npm audit` again and record the counts after. For each remaining advisory, write its class, why it remains (needs Expo SDK 58, or no fix) and its risk as Decision 7 says.
- [ ] **Step 2:** `specs/Repo_Current_State.md`: replace the old audit sentence with the commit, the counts before and after, and where the remaining advisories sit. `specs/Tickets.md`: update the #44 row.
- [ ] **Step 3:** Independent review as [AGENTS.md](../../AGENTS.md#workflow) describes: an Opus `reviewer` subagent with a fresh context, read-only, given this plan, issue #44 and the diff. Show the owner its full report. Apply only what the owner approves.
- [ ] **Step 4:** Push and open the PR titled `Update vulnerable development and build dependencies`. The body starts with `Closes #44` only if every acceptance check was observed on the final commit, otherwise `Part of #44`. It contains the classification table, the before and after counts, the version listings from Task 2, the remaining advisories with their risk, and a clear statement of whether an Expo SDK upgrade is needed before January, for the owner to decide. Wait for `typecheck`, `ios-build` and `tests`. Do not merge.

---

## Acceptance check coverage

| Issue #44 acceptance check | Verified by |
| --- | --- |
| Every critical and high advisory is classified, with evidence | Task 1 Steps 2 to 5 |
| Each compatible fix is applied and `npm run check:release` passes | Task 2 Steps 2 to 5 |
| Advisories needing an Expo upgrade, or unfixable, are listed with their risk, and the owner decides | Task 3 Steps 1 and 4 |
| Moderate advisories are listed with the same classification | Task 1 Steps 3 and 5 (all 25 packages) |
| The result is recorded with the commit and counts | Task 3 Step 2 |

## Found while planning, not in this plan

- The backend's Python dependencies have not been audited. The backend is not part of v1.
- Twelve moderate advisories are fixed only by Expo SDK 58. SDK 54 to 58 is four major versions, and would be its own milestone.
- CI runs on Node 20 while the local machine runs Node 24. A lockfile written by a newer npm has installed on CI so far; Review Focus 3 watches for it.
