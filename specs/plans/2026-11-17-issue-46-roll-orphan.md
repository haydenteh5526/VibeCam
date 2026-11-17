# Keep Film Roll Entries Whose Developed File Is Missing (Issue #46) Implementation Plan

> **For agentic workers:** implement this plan task by task, test first, in the order given. Steps use checkbox (`- [ ]`) syntax for tracking. If a step cannot be done as written, stop and return the plan to the Architect.

**Status:** revision 1, written on 17 November 2026. Waiting for the owner's approval. Nothing in this plan is implemented.

**Goal:** When Film Roll loads and an entry's developed file is gone but its original is still on disk, keep the entry, showing the original and leaving it editable, so a lost file never leaves an original on disk with nothing pointing to it.

**Architecture:** One change inside `load()` in `mobile/src/rollRepository.ts`. Today the loop skips an entry when `storage.exists(uri)` is false. The change checks the original first: if it exists, the entry is kept in the same state a fresh capture has before a look is applied (`uri` and `originalUri` both the original, camera `original`). Nothing else in the repository, the storage layer or the screens changes, because every screen already handles that state.

**Tech Stack:** TypeScript, `node:test` through `tsx`. No new dependency and no native code.

**Spec:** [Issue #46](https://github.com/haydenteh5526/VibeCam/issues/46). Read it, [AGENTS.md](../../AGENTS.md), `mobile/src/rollRepository.ts`, `mobile/src/roll.ts` and `mobile/src/__tests__/rollRepository.test.ts` before starting.

## What planning found

Read on `main` at `aad3016`, not run on a device.

- `load()` (`rollRepository.ts`, lines 49 to 62) resolves `entry.uri`, and `continue`s when that file does not exist, before it looks at `originalUri`.
- A fresh capture or import is stored as `{ uri, originalUri: uri, cameraId: 'original', cameraName: 'Original', … }` (`mobile/App.tsx`, lines 175 and 191). The editor, Film Roll and Save already work with that shape, and the existing test `editing an original-only entry never deletes its retained original` covers editing it.
- `persist()` removes only files that were in the previous in-memory index. On a fresh launch that index is empty, so `load()` never deletes a file. That is why the original is left behind today, and it also means this change cannot delete anything.
- The repository never writes an index that names a missing file, so this state needs outside interference (storage pressure, a restore, a crash between app versions). It has not been observed on a device.

## Decisions

### Fixed by the owner

1. **Film Roll keeps the original.** Edits are non-destructive. A commit is durable before the index says so.
2. **No unrelated change** to Film Roll, the editor, Save or Share.

### Separate approvals

- **A. The recovery is silent.** *Recommended.* The item reappears as its original, ready to edit, with no message. A message would need new copy and a new place to show it, for a case that should be rare. *Alternative:* a one-time notice in Film Roll, which becomes its own issue.
- **B. The recovered entry keeps its `recipe` and `favorite`, and resets `savedToLibrary` to false.** *Recommended.* The recipe holds the owner's adjustments, so re-editing starts from them. The copy in Photos, if any, was of the lost edit, so the original has not been saved. *Alternative:* drop the recipe so the item looks like a new import.

### Design decisions to confirm

3. **Recovered shape.** `uri` and `originalUri` are both the resolved original. `cameraId` is `'original'` and `cameraName` is `'Original'`. `takenAt`, `seed`, `mediaType`, `durationMs`, `favorite` and `recipe` are kept. `savedToLibrary` is `false`. `thumbnailUri` follows today's rule: kept if its file exists, otherwise `null`.
4. **Videos are treated the same way.** A clip whose styled file is missing falls back to its original recording and keeps its poster if the poster exists.
5. **No duplicates.** If two entries would end up with the same `uri`, one is kept: an entry whose own developed file exists always wins over a recovered one, and between two recovered entries the earlier one in the index wins. Order is otherwise unchanged.
6. **Both files missing:** the entry is dropped, as today. **Developed file present, original missing:** unchanged (`originalUri` becomes `null`, as the existing test `migrates old cache entries…` asserts).
7. **The recovered index is written by the existing `persist()` call** at the end of `load()`, so the next launch reads the repaired index.

## Global Constraints

- Branch `feature/issue-46-roll-orphan`, which holds this plan. PR to protected `main`. Do not merge.
- Code changes only in `mobile/src/rollRepository.ts` and `mobile/src/__tests__/rollRepository.test.ts`. No change to `roll.ts`, `services/storage.ts`, `App.tsx`, any screen, `package.json`, `app.json`, `eas.json` or the workflows.
- `load()` must not call `storage.remove`, directly or through `persist()`, for any file of a recovered entry.
- The ten existing tests in `rollRepository.test.ts` pass unchanged.
- No Claude or AI attribution in commits, PRs, issues or comments. Do not start an EAS build.
- Mobile gate, from `mobile/`: `npm ci`, `npm run typecheck`, `npm test`, and `npx expo export --platform all` with `EXPO_PUBLIC_ENABLE_CLOUD_FEATURES=false`. Record the test count before and after; this plan adds 5.
- `specs/Tickets.md` has an M2 section only once the #44 plan branch is merged. If the #46 row is not on `main` when Task 2 runs, say so in the PR and leave the row to the Architect.

## Review Focus

1. **A recovery that deletes something.** No file is removed during `load()`. (Task 1 tests 1 and 5)
2. **Two entries sharing one original**, both missing their developed files, or one intact and one not. (Task 1 test 4)
3. **A moved app container.** `storage.resolve` rebases paths on iOS; existence must be checked on the resolved original, and the resolved path stored. (Task 1 test 1 uses a resolving fixture)
4. **A recovered entry that cannot be edited or deleted afterwards.** (Task 1 test 5)
5. **Intact entries changed by accident:** their order, fields and files. (Task 1 test 3)
6. **A video without a poster.** The tile already shows a placeholder when `thumbnailUri` is null. (Task 1 test 2)

---

### Task 1: Fall back to the original in `load()`

**Files:**
- Modify: `mobile/src/rollRepository.ts` (`load()` only)
- Test: `mobile/src/__tests__/rollRepository.test.ts`

- [ ] **Step 1: Write the failing tests**, using the file's existing `shot` and `fixture` helpers. Where a test needs `resolve` to rebase a path, build the storage object inline in the same style.

| # | Test | Assertions |
| --- | --- | --- |
| 1 | `a photo whose developed file is missing falls back to its original` | Put `shot()` with `favorite: true`, `savedToLibrary: true` and a recipe. Delete `documents/photo` from `files`. A new repository's `load()` returns one entry with `uri` and `originalUri` both `documents/original`, `cameraId` `'original'`, `cameraName` `'Original'`, `savedToLibrary` `false`, and `favorite`, `recipe`, `takenAt` and `seed` unchanged. `disk()` deep-equals the result. `removed` is empty and `documents/original` still exists. With a `resolve` that maps `old/` to `documents/`, an index naming `old/photo` and `old/original` gives the resolved `documents/original`. |
| 2 | `a clip whose styled file is missing falls back to its recording` | A video entry with `originalUri`, `thumbnailUri` and `durationMs`. With the styled file deleted: `uri` equals the original, `mediaType` is `'video'`, `durationMs` is kept, and `thumbnailUri` is kept. With the poster also deleted: `thumbnailUri` is `null`. |
| 3 | `intact entries are unchanged beside a recovered one` | Three entries, the middle one missing its developed file. The first and third deep-equal what `load()` returned before the deletion, and the order is first, recovered, third. |
| 4 | `entries that fall back to the same original become one entry` | Two entries sharing an original, both missing their developed files: one entry is returned, the earlier one's `takenAt`. An intact entry whose `uri` is the original plus a second entry that would fall back to it: one entry is returned and it deep-equals the intact one. |
| 5 | `an entry with neither file is dropped, and a recovered one can be edited and removed` | With developed file and original both deleted, `load()` returns `[]` and `removed` is empty. After the recovery in test 1, `put` of an edit with `previousUri` set to the recovered `uri` keeps `documents/original` on disk and returns the edit with `originalUri` `documents/original`; `remove` of that entry then deletes both files. |

- [ ] **Step 2: Run to see them fail.** From `mobile/`: `npm test` · Expected: tests 1 to 4 fail on their first assertion (the entry is missing); the first half of test 5 passes today and its second half fails; every other test passes. Record the count.
- [ ] **Step 3: Implement.** In `load()`, resolve and check the original before deciding. Keep the entry as today when the developed file exists; build the recovered entry (Decision 3) when only the original exists; skip when neither exists. Apply Decision 5 before the `persist` call. Keep the function's style and length close to the current one.
- [ ] **Step 4: Run.** `npm run typecheck` and `npm test` · Expected: clean; the count from Step 2's run plus the newly passing tests, 0 fail, and 5 more tests than `main`.
- [ ] **Step 5: Commit.** `git commit -m "Keep a Film Roll entry when only its original remains"`

### Task 2: Documents, review and pull request

- [ ] **Step 1: Documents.**
  - `CONTEXT.md`, the `src/rollRepository.ts` line: add that an entry whose developed file is missing falls back to its retained original on load.
  - `specs/Repo_Current_State.md`: remove the first bullet under "Observations with no issue yet" (the dropped entry), and add a verified-results row with the commit, environment and test count.
  - `specs/Tickets.md`: update the #46 row if it exists on `main` (see Global Constraints).
- [ ] **Step 2: Run the mobile gate** on the final commit and record the output.
- [ ] **Step 3: Independent review** as [AGENTS.md](../../AGENTS.md#workflow) describes: an Opus `reviewer` subagent with a fresh context, read-only, given this plan, issue #46 and the diff against `main`. Show the owner its full report. Apply only what the owner approves.
- [ ] **Step 4: Push and open the PR** titled `Keep a Film Roll entry when only its original remains`. The body starts with `Closes #46` if every acceptance check was observed on the final commit, otherwise `Part of #46`. It maps each acceptance check to its test, records what was run and what was not (nothing on a device), and contains the Reviewer's full report with the disposition of each finding. Wait for `typecheck`, `ios-build` and `tests`. Do not merge.

---

## Acceptance check coverage

| Issue #46 acceptance check | Verified by |
| --- | --- |
| Developed file missing, original exists: kept, original shown, re-editable, never shown as broken | Task 1 tests 1, 2 and 5. "Shown" follows from the recovered shape being the fresh-capture shape (`App.tsx` lines 175 and 191); no screen changes. Not checked on a device. |
| Both files missing: dropped, as today | Task 1 test 5 |
| Entries whose files all exist are unchanged | Task 1 test 3 and the ten existing tests |
| Unit tests cover all three cases; existing tests pass | Task 1 Steps 2 and 4 |

## Found while planning, not in this plan

- Film Roll gives no sign that a developed edit was lost (approval A).
- `load()` checks every file of every entry on each launch. With a large Film Roll that is many file-system calls; its cost on a device is unmeasured (walkthrough step 11).
- A recovered clip is shown as its unstyled recording. Restyling it uses the normal video path.
