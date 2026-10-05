# Slice 8 — Bulk Recording Ingestion

> **Objective:** Allow importing many screen recordings at once and extracting frames
> from all of them in one action, without corrupting sample identity or provenance.

---

## 1. The reported symptom

"it wont upload multiple recordings."

The video input in `RecordingImporter.tsx` had no `multiple` attribute, so the OS picker
allowed exactly one file. Every image input in the codebase already had it.

## 2. The two bugs hiding behind the symptom

Fixing only the attribute would have made the feature *appear* to work while silently
corrupting the corpus. Both bugs are the same root cause: **ids derived from React state
that has not yet committed**.

1. **Recording IDs came from `recordings.size`.** Inside a bulk loop, React has not
   re-rendered, so every iteration read the same stale count and minted the **same**
   `rec-XXXX`. IndexedDB keys on `recordingId`, so recordings silently overwrote one
   another — no error, no loss report, no recovery.
2. **Sample IDs came from `encounters.length + 1`.** Identical staleness, so a second
   recording reused the first's counters and produced **duplicate `sampleId`s**, breaking
   the stable-identity guarantee (§21) and export reproducibility.

Both now allocate from **monotonic refs** that increment synchronously and skip ids
already present in the store, so a re-import after a reload cannot collide either.

`deriveRunId` had the same defect: its `Date.now()` suffix repeats when two runs start
within the same millisecond, which is routine during a batch. It now takes a sequence
number.

## 3. Behaviour

- Many recordings selectable at once. A single undecodable file never blocks the others.
- `importRecordings` returns `{ recording, file }` **pairs**, never parallel arrays.
  Pairing by index misaligns as soon as a failure is skipped; pairing by filename is
  ambiguous because the researcher can select the same file twice.
- A total failure is **not thrown**. Throwing would replace the per-file report with one
  generic message, losing the only useful detail — which file to fix.
- `runBulkExtraction` runs sequentially with per-recording progress and a working cancel.
  Sequential because decoding N videos in parallel multiplies peak memory, and it makes
  cancel clean: every completed recording is fully persisted before the next begins.

## 4. Two bugs found by reading a screenshot, not by a failing test

- The progress bar stayed stuck on **"Reading recording… 8%"** after every file had
  finished failing. `importRecordingFile` set `phase: 'probing'` but only reset it on
  success, so a throw left the UI looking permanently busy with a live Cancel button.
- The first version of the regression test passed **vacuously**: the assertion was
  `cards === 0 || mentioned`, and zero session cards short-circuited the entire check
  while the UI was showing a generic, filename-free error. Tightened to require every
  failed filename to appear, plus assertions that the panel returns to idle.

Both fixes were confirmed by temporarily reverting them: the stuck-spinner assertion
hangs on the reverted build, proving it genuinely catches the defect rather than merely
passing.

## 5. Known limitations (deliberate)

- The **happy path is covered only by typecheck**, not runtime — that needs binary `.mp4`
  fixtures. The *failure* path is covered, since that is what breaks silently.
- Bulk extraction holds File handles **in memory only**. After a reload the recordings
  are still listed but their sources are gone, so the bulk button is hidden rather than
  failing mysteriously. Persisting File handles to IndexedDB would close this gap.

## 6. Verification

**28/28 Playwright** (24 → 28: one new test across four viewports), **95/95 pure**,
**45/45 UI**, clean `tsc --noEmit` and production build.