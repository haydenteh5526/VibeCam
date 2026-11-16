# EAS Configuration Guard (Issue #35) Implementation Plan

> **For agentic workers:** implement this plan task by task, test first, in the order given. Steps use checkbox (`- [ ]`) syntax for tracking. If a step cannot be done as written, stop and return the plan to the Architect.

**Status:** revision 2, approved by the owner on 16 November 2026. Revision 2 amends Decisions 4 and 7 after the independent review (finding H1).

**Goal:** Make `npm test`, and therefore CI and `npm run check:release`, fail when a committed EAS build profile could ship with cloud features on, when the Xcode version EAS builds with differs from the one CI compiles with, or when the `preview` profile or the app identity is incomplete, so that no signed build or device pass is spent on a misconfigured binary.

**Architecture:** One pure module, `mobile/tools/config-guard.ts`, takes the parsed `eas.json`, the parsed `app.json` and the text of the mobile workflow, and returns a list of problems. Each problem carries the file, the profile or key at fault, and a message. A test file under `mobile/src/__tests__/` reads the three committed files, asserts that the list is empty, and asserts that deliberately broken copies (clones of the committed files with one value changed) produce the expected problem. The module lives in `tools/` so it is never part of the app bundle. The test lives in `src/__tests__/` because the `npm test` glob is `src/**/*.test.ts` and `package.json` is not changed.

**Tech Stack:** TypeScript, `node:test` and `node:assert/strict` through `tsx`, `node:fs`. No new dependency, no YAML parser, no native code.

**Spec:** [Issue #35](https://github.com/haydenteh5526/VibeCam/issues/35) acceptance checks, under [epic #33](https://github.com/haydenteh5526/VibeCam/issues/33). Read both, [AGENTS.md](../../AGENTS.md), `mobile/eas.json`, `mobile/app.json`, `.github/workflows/mobile-checks.yml` and the [build guide](../../docs/DEPLOY.md) before starting. Follow the file-reading style of `mobile/src/__tests__/videoLuts.test.ts` (`fileURLToPath(new URL(..., import.meta.url))`).

## Decisions

### Fixed by the owner

1. **The check reads configuration and changes none of it.** `eas.json`, `app.json`, `package.json`, `package-lock.json` and the workflows are not edited.
2. **Offline v1 stays offline.** The only accepted value of `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` in a build profile is the string `"false"`.
3. **No EAS build, no sign-in.** Nothing in this plan contacts Expo or Apple.

### Separate approvals

All three were approved as recommended on 16 November 2026. The tasks implement the recommendation. The "if declined" and "alternative" notes record what the other choice would have changed.

- **A. Variables stored on Expo's servers are outside the check, and the build guide gains one manual step for them.** *Recommended.* Each profile names an EAS environment (`development`, `preview`, `production`). Variables defined for those environments in the Expo dashboard are not in the repository, so no committed-file check can see them. The plan adds one sentence to `docs/DEPLOY.md` section 2: before building, open the project's Environment variables page and confirm `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` is not defined for `preview` or `production`. Which of the two sources wins when both define the variable was **not verified** for EAS CLI 24.11.0 during planning, so the step asks for absence, which is safe either way. *If declined:* the limit is recorded in the repository snapshot only, and the build guide is not changed for it.
- **B. Every key under `build` is checked, including `base`.** *Recommended.* `eas build --profile base` is a valid command, so `base` is a profile that could be built. *Alternative:* check only `development`, `preview` and `production`. Declining B removes one loop and weakens the first acceptance check ("any build profile").
- **C. `preview` also fails when it resolves to `ios.simulator: true`.** *Recommended.* A simulator build cannot be installed on an iPhone, so it is not the standalone preview #36 needs. The issue names only the development client. *If declined:* drop that rule and its test row.

### Design decisions to confirm

4. **`extends` is resolved the way EAS resolves it.** The profile's own keys replace the base's keys. `env` is merged key by key. `ios` and `android` are merged the same way, including their own `env`. Chains are followed to any depth. A base that does not exist and a chain that loops are each a problem, not a crash. This rule was written from memory of `@expo/eas-json`. **Task 1 Step 1 confirms it against the published package before any code is written, and returns the plan if it differs.** After `extends`, EAS resolves a profile for the platform being built by applying the keys under that platform's section over the common keys (`resolveBuildProfile` in `@expo/eas-json` 24.9.0). The preview rule uses this iOS-resolved profile. EAS also refuses `extends` chains of five or more; the check follows any depth.
5. **Cloud rule.** For every profile, the resolved common `env` must hold `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` equal to the string `"false"`. A missing key, the boolean `false`, `"False"`, `"0"` and `""` all fail. If the resolved `ios.env` or `android.env` defines the key, that value must also be `"false"`.
6. **Xcode rule.** For every profile, the resolved `ios.image` must end in `-xcode-<version>`. The workflow must contain at least one uncommented `DEVELOPER_DIR: /Applications/Xcode_<version>.app/` line, and all such lines must name one version. The versions are compared as text: `26.2` and `26.2.0` differ. An image such as `latest` or `auto`, a missing image, and a workflow that selects Xcode in any other way all fail. Failing in those cases is intended: the check must not pass when it cannot read a version.
7. **Preview rule.** `build.preview` must exist. Resolved for iOS (common keys, overridden by the resolved `ios` section), it must have `distribution: "internal"` and must not have `developmentClient: true` (and, with approval C, not `ios.simulator: true`). When the value at fault comes from the resolved `ios` section, the problem names `build.preview.ios.distribution` or `build.preview.ios.developmentClient`; otherwise the common key as before. Messages are unchanged. The Android section is not checked by this rule.
8. **Identity rule.** In `mobile/app.json`, each of `expo.ios.bundleIdentifier`, `expo.extra.eas.projectId`, and `expo.ios.infoPlist.NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryAddUsageDescription` and `NSPhotoLibraryUsageDescription` must be a string that is not blank after trimming. The check does not compare them with a known value: changing the bundle identifier is a decision the owner makes elsewhere.
9. **One line per problem:** `<file>: <place>: <message>`, with the file written from the repository root (`mobile/eas.json`, `mobile/app.json`, `.github/workflows/mobile-checks.yml`). The test for the committed files prints every problem line in its failure message.
10. **The checker is total.** Input that is `null`, an array, a number, or has no `build` object yields problems and never throws. An `eas.json` with no profiles is a problem, so the check cannot pass by checking nothing.

## Global Constraints

- Branch `feature/issue-35-eas-config-guard`, which holds this plan. Open a PR to protected `main`. Do not merge and do not enable auto-merge.
- No change to `mobile/eas.json`, `mobile/app.json`, `mobile/package.json`, `mobile/package-lock.json`, `.github/workflows/`, `mobile/modules/` or any file under `mobile/src/` other than the new test. No new dependency.
- `mobile/tools/config-guard.ts` imports nothing. It reads no file and no environment variable: the test passes everything in.
- The test resolves the three files from its own location, not from the working directory.
- Do not start an EAS build, sign in to Expo, or run any `eas` command.
- Mobile gate, from `mobile/`: `npm ci`, `npm run typecheck`, `npm test`, and `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false npx expo export --platform all`.
- The test count on `main` is 84. If [#34](https://github.com/haydenteh5526/VibeCam/issues/34) merged first it is 93. This plan adds 10. Record the count observed before and after, not a count copied from here.
- The PR may use `Closes #35` only if every acceptance check, including the recorded failing runs in Task 3, was observed on the final commit. Otherwise `Part of #35`.
- `specs/Tickets.md` and `specs/Repo_Current_State.md` exist on `main` only after PR #40 merges. If #34 has merged, both files have changed: bring the branch up to date with `main` before editing them.

## Review Focus

Inputs and conditions most likely to break it. Each has a test or a recorded check in the task named.

1. **A check that passes because it read nothing.** No profiles, a wrong path, a regular expression that matches no line. (Task 1 tests 1, 6 and 10; Task 3 Step 2)
2. **Inherited values.** A base two levels up that turns cloud on, a profile with no `extends` at all, a profile that overrides `ios.image` or sets `ios.env`. (Task 1 tests 2, 3, 4 and 5)
3. **Values that look false but are not the string `"false"`.** (Task 1 test 2)
4. **`developmentClient: true` inherited by `preview` from a base.** (Task 1 test 7)
5. **A commented-out `DEVELOPER_DIR` line, or two jobs that select different Xcode versions.** (Task 1 test 6)
6. **Windows line endings.** A checkout with CRLF must give the same result: the workflow expression must not depend on `\n` at the end of a line. (Task 1 test 6)
7. **A broken copy that mutates the committed object.** Each broken copy is a `structuredClone`; the committed-files test must still pass when it runs after the others. (Task 1 Step 2)
8. **A problem line that does not say where.** (Task 1 test 9)

## File Structure

| File | Responsibility |
| --- | --- |
| `mobile/tools/config-guard.ts` (create) | `ConfigProblem`, `ConfigInput`, `checkBuildConfig`, `formatProblem`. Pure. |
| `mobile/src/__tests__/configGuard.test.ts` (create) | Reads the three committed files; tests the committed files and the broken copies. |
| `docs/DEPLOY.md`, `docs/RELEASE_READINESS.md`, `CONTEXT.md` (modify) | Say that `npm test` guards the build configuration, and what it cannot see. |
| `specs/Repo_Current_State.md`, `specs/Tickets.md` (modify) | Record what is implemented and what was run. |

---

### Task 1: The configuration check

**Files:**
- Create: `mobile/tools/config-guard.ts`
- Test: `mobile/src/__tests__/configGuard.test.ts`

**Interfaces:**
- Produces:

```ts
export type ConfigProblem = {
  /** Path from the repository root. */
  file: 'mobile/eas.json' | 'mobile/app.json' | '.github/workflows/mobile-checks.yml';
  /** The profile or key at fault, for example `build.preview.distribution`. */
  where: string;
  message: string;
};

export type ConfigInput = {
  /** JSON.parse of mobile/eas.json. */
  eas: unknown;
  /** JSON.parse of mobile/app.json. */
  app: unknown;
  /** Text of .github/workflows/mobile-checks.yml. */
  workflow: string;
};

export function checkBuildConfig(input: ConfigInput): ConfigProblem[];
export function formatProblem(problem: ConfigProblem): string;
```

- `formatProblem` returns `` `${file}: ${where}: ${message}` ``.
- `checkBuildConfig` follows Decisions 4 to 10 and returns problems in this order: structure, cloud, Xcode, preview, identity; within a rule, in the order the profiles appear in the file.
- Expressions: image `/-xcode-(\d+(?:\.\d+)*)$/`; workflow `/^[ \t]*DEVELOPER_DIR:[ \t]*\/Applications\/Xcode_(\d+(?:\.\d+)*)\.app\//gm`.

**Problem lines.** Exact, because the tests match on them. `<p>` is the profile name and `<v>` is `JSON.stringify` of the value found.

| Rule | `file` | `where` | `message` |
| --- | --- | --- | --- |
| Structure | `mobile/eas.json` | `build` | `has no build profiles` |
| Structure | `mobile/eas.json` | `build.<p>` | `is not an object` |
| Structure | `mobile/eas.json` | `build.<p>.extends` | `names <v>, which is not a profile` |
| Structure | `mobile/eas.json` | `build.<p>.extends` | `forms a loop` |
| Cloud | `mobile/eas.json` | `build.<p>.env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` | `is not set; it must be the string "false"` |
| Cloud | `mobile/eas.json` | `build.<p>.env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` | `is <v>; it must be the string "false"` |
| Cloud | `mobile/eas.json` | `build.<p>.ios.env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` (or `.android.env.`) | `is <v>; it must be the string "false"` |
| Xcode | `mobile/eas.json` | `build.<p>.ios.image` | `is not set; it must name the Xcode version CI uses` |
| Xcode | `mobile/eas.json` | `build.<p>.ios.image` | `is <v>, which does not name an Xcode version` |
| Xcode | `.github/workflows/mobile-checks.yml` | `DEVELOPER_DIR` | `selects no Xcode version` |
| Xcode | `.github/workflows/mobile-checks.yml` | `DEVELOPER_DIR` | `selects more than one Xcode version: <a>, <b>` |
| Xcode | `mobile/eas.json` | `build.<p>.ios.image` | `uses Xcode <a>, but CI uses Xcode <b>` |
| Preview | `mobile/eas.json` | `build.preview` | `is missing` |
| Preview | `mobile/eas.json` | `build.preview.distribution`, or `build.preview.ios.distribution` when the value comes from the resolved `ios` section | `is <v>; it must be "internal"` (`is not set; …` when absent) |
| Preview | `mobile/eas.json` | `build.preview.developmentClient`, or `build.preview.ios.developmentClient` when the value comes from the resolved `ios` section | `is true; preview must be a standalone app` |
| Preview | `mobile/eas.json` | `build.preview.ios.simulator` | `is true; preview must install on an iPhone` (approval C) |
| Identity | `mobile/app.json` | the key path, for example `expo.ios.infoPlist.NSCameraUsageDescription` | `is missing` |

A profile with a structure problem is skipped by the other rules. The version mismatch line is reported only when both versions could be read.

- [ ] **Step 1: Confirm the `extends` rule before writing code.** Read `build/resolver.js` (the `mergeProfiles` function) of `@expo/eas-json` at the version EAS CLI 24.11.0 depends on, from the npm registry page or its source repository, without installing it into `mobile/`. Record in the PR the version read and whether it matches Decision 4: own keys replace base keys; `env`, `ios` and `android` merge; a platform's `env` merges. **If it differs, stop and return the plan to the Architect.**

- [ ] **Step 2: Write the failing tests.** `node:test` and `node:assert/strict`. Load the three committed files once at the top (`COMMITTED`). Every broken copy is `structuredClone(COMMITTED)` with one change. `lines(input)` is `checkBuildConfig(input).map(formatProblem)`.

| # | Test | Assertions |
| --- | --- | --- |
| 1 | `the committed build configuration passes` | `lines(COMMITTED)` deep-equals `[]`. `Object.keys(COMMITTED.eas.build)` includes `base`, `development`, `preview` and `production`, so the pass is not empty. |
| 2 | `a profile that could ship with cloud features on is named` | `production.env` set to `{ EXPO_PUBLIC_ENABLE_CLOUD_FEATURES: 'true' }` → exactly one line, `mobile/eas.json: build.production.env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES: is "true"; it must be the string "false"`. Key deleted from `base.env` → four `is not set` lines, one per profile, in file order. Boolean `false`, `'False'`, `'0'`, `''` on `preview` → one line each naming `preview` and the value. A new profile `adhoc: { distribution: 'internal' }` with no `extends` → its cloud `is not set` line and its image `is not set` line. |
| 3 | `a platform override of the cloud setting is named` | `preview.ios = { env: { EXPO_PUBLIC_ENABLE_CLOUD_FEATURES: 'true' } }` → one line with `build.preview.ios.env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES`. The same under `android`. A platform `env` that holds `"false"` or other keys only → `[]`. |
| 4 | `extends is followed through a chain, and a missing or looping base is reported` | `mid: { extends: 'base', env: { EXPO_PUBLIC_ENABLE_CLOUD_FEATURES: 'true' } }` and `preview.extends = 'mid'` → cloud lines for `mid` and `preview` only. `preview.extends = 'nope'` → `build.preview.extends: names "nope", which is not a profile`. `base.extends = 'preview'` → `forms a loop` lines and no throw. |
| 5 | `an Xcode version that differs between EAS and CI is named` | `base.ios.image = 'macos-sequoia-15.6-xcode-26.1'` → four lines `uses Xcode 26.1, but CI uses Xcode 26.2`, one per profile. `production.ios = { image: 'macos-sequoia-15.6-xcode-26.3' }` → one line naming `production`. Workflow text with `Xcode_26.2.app` replaced by `Xcode_26.3.app` → four lines `uses Xcode 26.2, but CI uses Xcode 26.3`. |
| 6 | `a configuration that names no Xcode version fails` | Image `'latest'` → `is "latest", which does not name an Xcode version`. `base.ios` deleted → four `is not set` lines. Workflow with the `DEVELOPER_DIR` line removed, and with it commented out (`# DEVELOPER_DIR: …`) → `selects no Xcode version` and no mismatch line. Workflow with a second `DEVELOPER_DIR: /Applications/Xcode_26.1.app/Contents/Developer` line → `selects more than one Xcode version: 26.2, 26.1`. The committed workflow with every `\n` replaced by `\r\n` → `[]`. |
| 7 | `preview must be an internal standalone profile` | `preview.distribution = 'store'` → the `must be "internal"` line. `distribution` deleted → `is not set`. `preview.developmentClient = true` → the standalone line. `base.developmentClient = true` → the standalone line for `preview` (inherited). `preview` deleted → `build.preview: is missing`. `preview.ios = { simulator: true }` → the simulator line (approval C). `development` keeping `developmentClient: true` causes no line. `preview.ios = { developmentClient: true }` → `mobile/eas.json: build.preview.ios.developmentClient: is true; preview must be a standalone app`. `preview.ios = { distribution: 'store' }` → `mobile/eas.json: build.preview.ios.distribution: is "store"; it must be "internal"`. `base.ios.developmentClient = true` (image kept) → the `build.preview.ios.developmentClient` line for `preview`. Common `distribution` deleted from `preview` with `preview.ios = { distribution: 'internal' }` → no preview problem. |
| 8 | `the app identity and the four usage descriptions are required` | For each of the six key paths in Decision 8: deleted, `''`, `'   '` and `42` each → exactly one line, `mobile/app.json: <path>: is missing`. `expo.ios` deleted → five lines. `expo.extra` deleted → one line. |
| 9 | `every problem names its file and place` | For the union of the broken copies above, every line matches `/^(mobile\/eas\.json|mobile\/app\.json|\.github\/workflows\/mobile-checks\.yml): \S+: \S.*$/` and contains no line break. |
| 10 | `malformed files are reported, not thrown` | `eas` of `null`, `[]`, `7`, `{}`, `{ build: 3 }`, `{ build: {} }` → `build: has no build profiles`. `{ build: { preview: 5 } }` → `build.preview: is not an object`. `app` of `null`, `[]`, `{}` → six `is missing` lines. `workflow` of `''` → `selects no Xcode version`. None throws. |

- [ ] **Step 3: Run to see them fail.** From `mobile/`: `npm test` · Expected: `configGuard.test.ts` fails to load (cannot find `../../tools/config-guard`); every existing test still passes. Record the count.

- [ ] **Step 4: Implement `config-guard.ts`.**

- [ ] **Step 5: Run.** `npm run typecheck` and `npm test` · Expected: clean; the existing count plus 10 pass, 0 fail.

- [ ] **Step 6: Commit.** `git commit -m "Check EAS profiles, Xcode pin and app identity in npm test"`

---

### Task 2: Documents

**Files:**
- Modify: `docs/DEPLOY.md`, `docs/RELEASE_READINESS.md`, `CONTEXT.md`, `specs/Repo_Current_State.md`, `specs/Tickets.md`

- [ ] **Step 1: Update the documents.** State only what was run.
  - `docs/DEPLOY.md` section 1, after the sentence that says `eas.json` pins Xcode 26.2: `npm test`, and so `npm run check:release` and CI, fails if a build profile could ship with cloud features on, if the EAS and CI Xcode versions differ, or if the preview profile or app identity is incomplete.
  - `docs/DEPLOY.md` section 2 (approval A): the check reads committed files only. Before building, open the project's Environment variables page on expo.dev and confirm `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` is not defined for `preview` or `production`.
  - `docs/RELEASE_READINESS.md`: one bullet under the implemented list that the build configuration is guarded by a unit test, naming the three rules.
  - `CONTEXT.md` "Local checks": one line naming `tools/config-guard.ts` and what `npm test` now covers.
  - `specs/Repo_Current_State.md`: a verified-results row with the commit, environment and test count, and a line under limits that variables stored on Expo's servers are not checked.
  - `specs/Tickets.md`: update the #35 row with the plan link, the PR link and what remains.

- [ ] **Step 2: Commit.** `git commit -m "Document the build configuration check"`

---

### Task 3: Recorded failing runs, review and pull request

- [ ] **Step 1: Run the mobile gate on the final commit** and record the output: `npm ci`, `npm run typecheck`, `npm test`, `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false npx expo export --platform all`.

- [ ] **Step 2: Show each rule failing on the real files.** For each row, make the one edit to the working copy, run `npm test` from `mobile/`, copy the failing test name and the problem line into the PR, then restore the file with `git checkout -- <file>` before the next row. Commit none of these edits.

| Rule | Edit | Expected problem line |
| --- | --- | --- |
| Cloud | `mobile/eas.json`: `base.env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` to `"true"` | Four `…env.EXPO_PUBLIC_ENABLE_CLOUD_FEATURES: is "true"; it must be the string "false"` lines |
| Xcode, EAS side | `mobile/eas.json`: image to `macos-sequoia-15.6-xcode-26.1` | `build.base.ios.image: uses Xcode 26.1, but CI uses Xcode 26.2` and the three profiles that extend it |
| Xcode, CI side | `.github/workflows/mobile-checks.yml`: `Xcode_26.2.app` to `Xcode_26.3.app` | `uses Xcode 26.2, but CI uses Xcode 26.3` |
| Preview | `mobile/eas.json`: add `"developmentClient": true` to `preview` | `build.preview.developmentClient: is true; preview must be a standalone app` |
| Identity | `mobile/app.json`: delete `NSMicrophoneUsageDescription` | `mobile/app.json: expo.ios.infoPlist.NSMicrophoneUsageDescription: is missing` |
| Preview, platform override | `mobile/eas.json`: add `"ios": { "developmentClient": true }` to `preview` | `build.preview.ios.developmentClient: is true; preview must be a standalone app` |

  After the last row, run `git status` (expected: clean) and `npm test` (expected: all pass). Record both.

- [ ] **Step 3: Request the independent review** described in [AGENTS.md](../../AGENTS.md#workflow): an Opus subagent with a fresh context, read-only, given this plan, issue #35 and the diff against `main`. Show the owner its full report without shortening it. Apply only the findings the owner approves, rerun the affected checks, and ask for a follow-up review where a fix was not trivial.

- [ ] **Step 4: Push and open the PR** to `main`. Title: `Check EAS profiles, Xcode pin and app identity in npm test`. The body starts with `Closes #35` or `Part of #35` as the Global Constraints say, maps each acceptance check to its test and its recorded failing run, records the result of Task 1 Step 1, lists what was not run, and contains the Reviewer's full report with the disposition of each finding. Wait for `typecheck`, `ios-build` and `tests`. Do not merge.

---

## Acceptance check coverage

| Issue #35 acceptance check | Verified by |
| --- | --- |
| Fails if any profile, after resolving `extends`, does not set `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES` to `"false"`; passes for the committed file | Task 1 tests 1, 2, 3 and 4; Task 3 Step 2 row 1. The `extends` rule itself: Task 1 Step 1. |
| Fails if the Xcode version in the EAS iOS image and the one CI selects differ; passes for the committed files | Task 1 tests 1, 5 and 6; Task 3 Step 2 rows 2 and 3. |
| Fails if `preview` is not an internal-distribution standalone profile, or if the bundle identifier, the EAS project ID or any of the four usage descriptions is missing | Task 1 tests 7 and 8; Task 3 Step 2 rows 4, 5 and 6. |
| Each failure names the file and the profile or key at fault | Task 1 test 9 and the exact lines asserted in tests 2 to 8 and 10. |
| For each rule, the PR shows the check failing on a deliberately broken copy and passing on the committed files | Task 3 Step 2 (failing runs on the real files, then a clean passing run) and Task 3 Step 1. |

## What the check does not cover

- Variables defined on Expo's servers for an EAS environment (approval A).
- A build started with a command-line or shell override, or from a commit other than the one tested.
- Whether the named EAS image exists, and which Xcode the image really contains.
- Signing, provisioning and device registration ([#36](https://github.com/haydenteh5526/VibeCam/issues/36)).
- The Android side of `app.json`, which is not part of v1.
- Plugin options in `app.json` (`expo-camera`, `expo-media-library`) can override or remove the usage descriptions in the built Info.plist. The check reads only `expo.ios.infoPlist`.
- The workflow pattern is line-based. It does not confirm that the `DEVELOPER_DIR` line belongs to the `ios-build` job.
- EAS's limit on `extends` depth (five or more is refused). The check follows any depth.

## Found while planning, not in this plan

- `npm run check:release` runs `expo export` without setting `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES`. The app treats anything but `"true"` as off, so the export is offline unless the shell or a local `.env` file sets it to `true`. CI sets it to `"false"` explicitly.
- `mobile/eas.json` sets `EXPO_PUBLIC_API_BASE_URL` in `base`, so the backend address is embedded in an offline build. It is unused while cloud features are off.
- CI runs on Node 20 and nothing pins the Node version EAS uses for the build.
- `specs/Tickets.md` on PR #40 lists #35 as "Not planned yet". That row is updated in Task 2 once the branch contains `main` with PR #40.
