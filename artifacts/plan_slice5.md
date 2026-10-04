# Scrollnotes - Slice 5 Implementation Plan: Recording Import & Frame Sampling

> **Goal:** Add the **field session ingestion layer** - import screen recordings, choose
> a sampling strategy, extract candidate frames with full provenance, and hand them to
> the existing curation/OCR/dedup pipeline - without ever guessing a platform and
> without touching ground truth.
>
> **A recording is the first-class unit of ingestion.** Dropping loose image files is
> demoted to a secondary "pre-extracted frames" path used only as a fallback.

---

## 0. Decision Record

### 0.1 `ffmpeg.wasm` vs. browser-native extraction - **browser-native, no dependency**

**Recommendation: do not use ffmpeg.** Reasoning:

| Factor | Browser-native (`<video>`+`canvas`) | ffmpeg.wasm |
|---|---|---|
| Bundle / first-run cost | 0 KB | ~25 MB WASM + init cost per session |
| AGENTS §35 (privacy) | Fully local already | Fully local, but 25 MB of extra surface |
| AGENTS §44 (non-goals) | Neutral | Adds a heavyweight dep for one function |
| Determinism | Frame timestamps come from the grid we compute | Same |
| Exact-keyframe accuracy | **Worse** (weaker; see below) | **Better** |
| Failure modes | Codec unsupported by browser | Out-of-memory / worker crash on long videos |

The *only* genuine advantage ffmpeg buys is precise frame-accurate seeking and exotic
codec support. That advantage is largely **moot here**, and the reason is important:

- You are sampling a **scroll recording** at a coarse interval. We are not cutting video.
- Browsers do not guarantee exact seek, but a screen recording of a scrolling feed is
  **static most of the time**. Consecutive captures at a 1s interval are frequently
  visually identical by design - which is exactly what Slice 4 dedup exists to collapse.
  Sub-frame seek drift costs us essentially nothing, because dedup absorbs it.

`ffmpeg.wasm` would be justified if we ever needed frame-exact cuts or needed to open
MOV/HEVC that Chrome refuses. Neither is in scope. **If this assumption is ever wrong,
the service boundary makes it a one-file swap** (`extractFrames(file, options)`), which
is precisely why that boundary is being drawn in this slice.

**Consequence to accept:** unsupported-codec recordings produce the §39 recovery message
("export as H.264 MP4, or drop pre-extracted frames in") rather than silently working.

### 0.2 Recording-first ingestion - **confirmed**

`Import a screen recording` becomes the **primary** call to action. The image dropzone
stops being framed as a first-class ingestion method; it becomes a labelled fallback
("Pre-extracted frames - no recording provenance"). Rationale: AGENTS §8.2 treats a
recording as the provenance container, and provenance is the product's core promise
(§21). Importing loose frames produces samples with **no** `recordingId`/`timestampMs`,
which is strictly weaker evidence - so it should look like it.

Frame imports are **not removed** (they remain the documented recovery path for
undecodable codecs, and `sampleData.ts` seeds the demo batch through them). They are
demoted and relabelled.

### 0.3 Default sampling - **1.0s interval, PNG**

Set: interval `1.0s`, start `0.0`, end `auto`, PNG, `maxFrames` **1200**.

`maxFrames` is raised from 600 because halving the interval doubles the frame count per
minute: at 1.0s a 10-minute session is 600 frames, so a 600 cap would silently truncate
every realistic session. 1200 covers a 20-minute session at 1.0s. PNG is lossless and
feeds Tesseract better; volume is bounded by the cap and is acceptable at this scale.

---

## 1. Scope & Grounding

Implements AGENTS.md sections 8.2 (Source Recording Import), 9 (Frame Sampling),
21 (Sample Identity & Provenance), 32 (Frame Sampling Service), 39 (Error Handling),
and 42 (Slice 5).

```text
Source recording (mp4/webm/mov...)
        v  frameSampling.extractFrames()
Candidate frames (FrameRecord + provenance)
        v  existing pipeline
OCR (Slice 3) -> Dedup (Slice 4) -> Curation -> Ground truth
```

### Non-negotiable invariants

1. **A recording is a provenance container, never a platform category.** No field on
   `RecordingRecord` holds a platform; `EncounterSample.platform` still starts as
   `'other'` and must be verified by the researcher.
2. **Extraction never invents data.** `durationMs`, frame counts and timestamps come
   from the browser media APIs; if a value is unavailable it is `undefined`, not guessed.
3. **Ground truth is untouched.** Extraction creates *pending* encounters with empty
   items, exactly as `ingestImageFiles` does today. OCR and dedup remain opt-in.
4. **Nothing destructive.** A recording is never deleted; removing one deletes only the
   recording metadata. Derived frames stay (reversibility, section 17).
5. **Provenance survives.** Every extracted frame carries
   `recordingId` + `timestampMs` + deterministic `frameFilename`.

---

## 2. Domain Model Additions (`src/types/schema.ts`)

```ts
// ---- Slice 5 - Field Session / Source Recording ----

export interface RecordingRecord {
  recordingId: string;            // "rec-0001"
  filename: string;               // original upload name
  durationMs?: number;            // probed; omitted when the browser cannot report it
  sizeBytes?: number;
  researcherLabel?: string;       // e.g. "text-heavy session"
  description?: string;           // e.g. "mixed social-media browsing"
  importedAt: string;
}

export interface SamplingConfig {
  intervalSeconds: number;        // >= 0.1; default 1.0
  startSeconds: number;           // >= 0; default 0
  endSeconds?: number;            // omitted => to the end of the recording
  outputFormat: 'image/png' | 'image/jpeg';   // default 'image/png'
  quality: number;                // 0..1, JPEG only; 0.92 default (unused for PNG)
  /** Hard cap so a mis-typed interval cannot flood the corpus. */
  maxFrames: number;              // default 1200 (covers ~20 min at 1.0s)
}

export interface ExtractionRun {
  runId: string;
  recordingId: string;
  sampling: SamplingConfig;
  /** timestamps actually captured, in ms - the reproducible sampling grid. */
  timestampsMs: number[];
  frameIds: string[];             // parallel to timestampsMs
  frameCount: number;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  error?: string;
}

export type ExtractionPhase =
  | 'idle' | 'probing' | 'extracting' | 'persisting' | 'done' | 'error' | 'cancelled';

export interface ExtractionStatus {
  recordingId: string | null;
  phase: ExtractionPhase;
  processed: number;
  total: number;                  // 0 until the sampling grid is computed
  error?: string;
}
```

**Filename convention** (mirrors the AGENTS section 6 example exactly):

```text
<recordingId>_<timestampMs padded to 7>.jpg   ->   rec-0001_0128400.jpg
```

---
## 3. Frame Sampling Service (`src/services/frameSampling.ts`)

Structured like `services/ocr.ts` and `services/deduplication.ts`: a **pure, DOM-free
core** (unit-testable in Node) plus a **browser adapter**.

### 3.1 Pure core (exported, testable)

```ts
export type SamplingOptions = {
  intervalSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
};

export function computeSamplingGrid(
  durationMs: number | undefined,
  options: SamplingOptions,
  maxFrames = 1200
): { timestampsMs: number[]; truncated: boolean; warning?: string }

/** Deterministic, collision-free within a recording. */
export function buildFrameFilename(recordingId: string, timestampMs: number): string

export function deriveRecordingId(existingCount: number): string   // "rec-0001"

export function planExtraction(input): { run: ExtractionRun; warnings: string[] }
```

`computeSamplingGrid` clamps `endSeconds` to `durationMs`, drops a degenerate grid, and
returns `truncated: true` plus a human-readable warning rather than silently returning
fewer frames than the researcher asked for.

### 3.2 Browser adapter

```ts
export function loadVideoElement(url: string): Promise<HTMLVideoElement>
export function probeRecording(file: File): Promise<{ durationMs?: number; width: number; height: number }>
export function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void>
export async function extractFrames(
  file: File,
  recordingId: string,
  options: SamplingOptions & { outputFormat; quality; maxFrames; onProgress?; signal? }
): Promise<{ frames: FrameRecord[]; timestampsMs: number[]; warnings: string[] }>
```

Extraction loop per timestamp:

1. `video.currentTime = t + 0.001`, await the `seeked` event (with a timeout).
2. `canvas.drawImage(video, 0, 0, w, h)` -> `canvas.toDataURL(...)`.
3. Build a `FrameRecord` with `id`, deterministic `filename`, `dataUrl`, `mimeType`,
   `width`, `height`, `sizeBytes` (estimated from the data-URL length), `importedAt`.

**Object-URL lifetime:** the `URL.createObjectURL` created for the `File` is revoked in a
`finally` block; the `<video>` element is released by setting `src = ''` so the decoder
can be garbage-collected between runs.

**Cancellation:** an `AbortSignal` is checked at the top of every iteration; the run
resolves as `cancelled` and returns frames captured so far. Because the orchestrator
persists each frame as it arrives, nothing is lost.

---

## 4. Persistence (`src/services/db.ts`) - `DB_VERSION = 3`

Additive upgrade only; existing sessions survive (same pattern as the Slice 3/4 upgrade).

| Store | Key | Value | Purpose |
|---|---|---|---|
| `recordings` | `recordingId` | `RecordingRecord` | Provenance container metadata |
| `extraction_runs` | `runId` | `ExtractionRun` | Sampling settings + captured grid (reproducibility) |

New helpers, mirroring existing naming:

```ts
saveRecording / getRecording / getAllRecordings / deleteRecording
saveExtractionRun / getAllExtractionRuns / getLatestRunForRecording
```

`clearEntireDatabase()` is extended to clear both new stores. `deleteRecording()` does
**not** cascade-delete frames; they remain and are named in the confirmation text.

---
## 5. Session Hook (`src/hooks/useFieldSession.ts`)

New state:

```ts
const [recordings, setRecordings] = useState<Map<string, RecordingRecord>>(new Map());
const [extractionRuns, setExtractionRuns] = useState<Map<string, ExtractionRun>>(new Map());
const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>({...});
```

New actions:

- `importRecordingFile(file)` - probe, persist a `RecordingRecord`, register in state.
- `runFrameExtraction(recordingId, file, config)` - the orchestrator:
  1. `computeSamplingGrid` -> show the exact frame count **before** starting;
  2. create a `running` `ExtractionRun`;
  3. stream frames from `extractFrames`, **persisting each frame immediately** so an
     interrupted run leaves usable data on disk;
  4. convert each frame into a `pending` encounter through a **new shared helper**
     `createEncounterForFrame(frame, { recordingId, timestampMs, counter })`;
  5. finalize the run (`done` / `error` / `cancelled`) and refresh `frames`/`encounters`.

**Refactor (behaviour-preserving):** `ingestImageFiles` is rewritten to call
`createEncounterForFrame` too, so video-extracted and file-imported frames produce
*identical* encounter shapes - no duplicated construction logic, no drift.

- `cancelExtraction()` - aborts the in-flight run.
- `removeRecording(recordingId)` - deletes only recording metadata.

`loadSampleBatch()` and `clearSession()` are extended to reset the new stores.

---

## 6. UI (`src/components/RecordingImporter.tsx`)

### 6.1 Recording-first empty state

The empty-state card is rebalanced so the **recording is the primary action**:

```text
+--------------------------------------------------------------+
|  IMPORT A FIELD SESSION                                       |
|                                                              |
|  Screen-record yourself browsing feeds, then drop the         |
|  recording here. Frames are sampled on your interval and      |
|  every sample keeps its recording + timestamp provenance.     |
|                                                              |
|  [ + Import a screen recording ]        <- primary button     |
|                                                              |
|  - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  |
|  Pre-extracted frames (no recording provenance)               |
|  [ Drop images or select files ]    [ Load sample batch ]     |
|  Fallback for recordings your browser cannot decode.          |
+--------------------------------------------------------------+
```

The existing `Dropzone` is **not deleted** - it is relabelled, visually demoted (secondary
button styling, smaller type), and annotated so the researcher knows those samples will
lack `recordingId` / `timestampMs`. `Header`'s global upload button is likewise relabelled
"Pre-extracted frames" and its `accept` attribute gains `video/*`, routing videos to the
importer rather than to the image path.

### 6.2 Sessions view

A fourth view tab, `sessions`, placed between **Gallery** and **Deduplicate**:

```text
+------------------------------+----------------------------------+
| FIELD SESSIONS               | IMPORT RECORDING                 |
|  rec-0001  session_01.mp4    |  [ Select video file... ]        |
|    08:43 - 214 frames        |  ------------------------        |
|  rec-0002  session_02.mp4    |  Sampling interval   [ 1.0 ] s    |
|    12:10 - 372 frames        |  Start              [ 0.0 ] s    |
|                              |  End                [ auto ]     |
|                              |  Max frames         [ 1200 ]     |
|                              |  Format             [ PNG v ]    |
|                              |  ------------------------        |
|                              |  Estimated frames:  741          |
|                              |  [ Extract Frames ]              |
+------------------------------+----------------------------------+
```

Behaviour:

- The estimated frame count updates live and turns amber when `maxFrames` would truncate.
- **Extract** shows a determinate progress bar (phase + `n / total`) and a Cancel button.
- On completion the app navigates to the **gallery** (curation is the next action) and
  offers **Run OCR** on the new frames as a one-click follow-up - never auto-run.
- The dropzone accepts videos in addition to images; the empty state gains an
  "Import a screen recording" button.
- `KeyboardShortcutsModal` documents `Esc` = cancel extraction.

### Error copy (section 39)

| Situation | Message shown |
|---|---|
| Unsupported/undemuxable codec | "This video could not be decoded in your browser. Either export it as H.264 MP4, or extract frames externally and drop the images in - provenance fields stay editable either way." |
| `duration` = NaN (streamed WebM) | "The browser could not read this recording's duration. Enter start/end times manually, or import extracted frames instead." |
| `maxFrames` truncation | "Interval would produce 2,410 frames; capped at 1,200 (first 20:00 sampled). Narrow start/end, or raise the interval, to cover the full session." |
| Individual frame capture failure | Frame skipped, counted, and listed in a warning summary - the run still completes. |

No `DOMException 0x...` ever reaches the UI.

---
## 7. Files to Change

| File | Change |
|---|---|
| `src/types/schema.ts` | `RecordingRecord`, `SamplingConfig`, `ExtractionRun`, `ExtractionPhase`, `ExtractionStatus` |
| `src/services/frameSampling.ts` | **New** - pure core + browser adapter |
| `src/services/db.ts` | `DB_VERSION = 3`; `recordings` + `extraction_runs` stores, CRUD, `clearEntireDatabase` |
| `src/hooks/useFieldSession.ts` | Recording/extraction state + actions; `createEncounterForFrame` refactor |
| `src/components/RecordingImporter.tsx` | **New** - sessions list + sampling form |
| `src/components/Header.tsx` | `sessions` view tab + session count badge; relabel global upload button |
| `src/components/Dropzone.tsx` | Recording-first empty state; demote + relabel frame import; accept `video/*` and route to the importer |
| `src/App.tsx` | Fourth view branch; thread new props |
| `src/components/KeyboardShortcutsModal.tsx` | Document cancel-extraction |
| `src/styles/slice5.css` | Importer styles (following the `slices34.css` pattern) |
| `src/test/verifySlice5.ts` | **New** - pure-core verification |
| `package.json` | Add `verify:slice5`, and include it in `verify` |

**No new runtime dependency.** `<video>` + `canvas` are platform APIs.

---

## 8. Verification Plan

1. `npx tsc --noEmit` - types clean across the migration and refactor.
2. `npm run verify:slice5` - Node-runnable assertions on the pure core:
   - grid spacing equals `intervalSeconds`, first timestamp equals `startSeconds`;
   - `endSeconds` clamps to `durationMs`;
   - `maxFrames` truncates **and** sets `truncated` / `warning` (never silently);
   - `buildFrameFilename` is deterministic and unique across a long session;
   - `planExtraction` emits a `running` run whose grid matches `computeSamplingGrid`;
   - **`createEncounterForFrame` produces `platform: 'other'`, `status: 'pending'`, and
     an empty `items[0].content`** - i.e. extraction cannot seed ground truth;
   - `provenance.recordingId` / `timestampMs` / `frameFilename` survive a JSON round-trip.
3. `npm run verify` (slices 1-5) - confirms no regression from the `ingestImageFiles` refactor.
4. `npm run build` - production bundle succeeds.
5. `npm run dev` - manual smoke:
   - import a short MP4 -> estimated count matches duration/interval -> extract ->
     progress bar -> frames land in the gallery with `REC` and `TIME` provenance visible
     in `ImageViewer` -> reload -> frames and recording still listed;
   - run OCR on an extracted frame -> text appears (proves the rasterisation path);
   - deduplicate an idle stretch of a scroll recording -> near-duplicates group, proving
     extraction feeds Slice 4 correctly.

---

## 9. Risks & Decisions

| Risk / decision | Handling |
|---|---|
| Seek-to-keyframe imprecision on long videos | Seek to `t + 0.001` and await `seeked`; visually identical consecutive captures are *expected* and are exactly what Slice 4 dedup is for. Documented as an in-UI hint. |
| Memory blow-up holding hundreds of full-res data URLs | Frames are persisted immediately and yielded one at a time; `maxFrames` (default 1200) caps the worst case. At 1.0s/PNG a 20-minute session is the practical ceiling - beyond that, raise `maxFrames` deliberately or use a coarser interval. |
| PNG storage growth at 1.0s | Accepted: lossless input measurably helps Tesseract. Mitigated by the `maxFrames` cap and the pre-export checklist in Slice 6. |
| `duration` = NaN on streamed WebM | Detect and surface a manual start/end path instead of producing a garbage grid. |
| Cancelling mid-run | Already-persisted frames remain; the run is stored as `cancelled` with its partial `timestampsMs`. |
| Frame naming collisions | Filename is `recordingId` + zero-padded ms; the frame `id` additionally carries a short random suffix, matching today's `frame-` convention. |
| Scope creep toward a CLI extractor | The service boundary (`extractFrames(file, options)`) is the explicit substitution point; a Python extractor can replace it later without touching the UI. |

### Explicit non-goals for this slice

- Export / JSONL / ZIP (Slice 6) - `ExtractionRun` is already persisted so a later
  manifest can report sampling settings verbatim.
- ffmpeg.wasm transcoding, WebCodecs, transmuxing, audio extraction.
- Any platform inference from recording name or frame order (**forbidden**, section 5).
- Auto-accepted candidates, or auto-run OCR/dedup.
- Command-palette polish (Slice 7).

---

## 10. Resolved Decisions (approved)

| # | Question | Resolution |
|---|---|---|
| 1 | ffmpeg vs. browser-native extraction | **Browser-native.** No new dependency; see §0.1 for the full reasoning. Service boundary keeps a swap cheap if this is later disproved. |
| 2 | Fourth "Sessions" tab | **Confirmed.** Recording-first ingestion; loose-frame import demoted to a labelled fallback (§0.2, §6.1). |
| 3 | Default sampling settings | **1.0s interval, start 0, end auto, PNG, `maxFrames` 1200** (§0.3). |
| 4 | Removing a recording cascades to frames? | **No.** Metadata only; derived frames persist (reversibility, §17). |
| 5 | `DB_VERSION = 3` additive migration | **Confirmed.** Two new stores, no data rewrite. |

Plan is approved and ready for implementation.

---

## 11. Implementation Order

1. `schema.ts` types, then `db.ts` migration (compile checkpoint: `tsc --noEmit`).
2. `services/frameSampling.ts` pure core.
3. `src/test/verifySlice5.ts` for the pure core - run before touching UI, so the math is
   proven before it is wired to anything.
4. `frameSampling.ts` browser adapter + `useFieldSession` orchestrator/actions.
5. `RecordingImporter.tsx`, `Header` tab, `App.tsx` branch, recording-first `Dropzone`.
6. Styles, keyboard-shortcut docs, `package.json` scripts.
7. Full gate: `npm run verify` (slices 1-5), `npm run build`, manual `npm run dev` smoke.