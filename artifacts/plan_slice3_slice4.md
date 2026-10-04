# Scrollnotes — Slices 3 & 4 Implementation Plan: OCR Preprocessing & Perceptual Deduplication

> **Goal:** Extend the existing annotation prototype (Slices 1–2) with two first-class
> preprocessing pipelines — **Tesseract OCR** (Slice 3) and **perceptual-hash
> near-duplicate detection** (Slice 4) — wired into the annotation cockpit and the
> curation gallery, with full provenance, immutability, and reversibility.
>
> Both slices are delivered **together** but are **independently verifiable**.

---

## 1. Scope & Grounding

Directly implements [AGENTS.md §8.3 OCR Preprocessing](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L429-L563),
[§10 Deduplication](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L606-L663),
[§13.1 OCR-Assisted Annotation](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L705-L740),
[§31 Deduplication Service](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L1351-L1374),
[§33 OCR Service](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L1400-L1435),
and [§42 Slices 3 & 4](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L1720-L1747).

```text
Slice 3:  frame → Tesseract OCR → OCR panel → [Insert into Content] → human ground truth
Slice 4:  candidate frames → perceptual similarity → duplicate review → reversible curation
```

**Non-negotiable invariants** (from the Golden Rule, §46, and §8.3):

1. **OCR is preprocessing evidence, never ground truth.** OCR text is stored in a
   *separate* record from `GroundTruthItem.content` and is never silently written
   over human annotation.
2. **OCR output is immutable & versioned.** Re-running OCR replaces only the OCR
   artifact (with fresh provenance); it never touches ground truth.
3. **Deduplication never deletes source data.** Frames are grouped/suppressed by a
   *decision* record; every decision is reversible and manually overridable.
4. **Provenance survives.** OCR and dedup records key off `frameId` and remain
   traceable to `provenance.recordingId` / `frameFilename` / `timestampMs`.

---

## 2. Cross-Cutting Foundation

### 2.1 New dependency: `tesseract.js`

- Add `tesseract.js` (current `7.0.0`) as a runtime dependency.
- **Why a dependency here is justified:** OCR is explicitly in scope (AGENTS §44)
  and there is no reasonable in-house substitute for a WASM Tesseract runtime.
- The OCR engine (`tesseract.js-core` WASM + `eng.traineddata`) is fetched **once**
  and cached by the browser. This is local, client-side processing — no image ever
  leaves the machine. We surface a one-time "downloading OCR engine…" status and
  document it in the UI; we do **not** add analytics/telemetry (AGENTS §35).
- The wrapper version is recorded in provenance; the core/engine version is recorded
  only when the API exposes it, otherwise **omitted rather than invented** (§8.3).

### 2.2 IndexedDB migration → `DB_VERSION = 2`

`src/services/db.ts` gains two object stores (existing stores are untouched, so
existing sessions survive the upgrade):

| Store | Key | Value | Purpose |
|---|---|---|---|
| `ocr_artifacts` | `frameId` | `OcrArtifact` | Immutable OCR evidence per frame |
| `dedup` | `frameId` | `DedupRecord` | Hash + duplicate-group decision per frame |
| `dedup_config` | `id` (`'default'`) | `DedupConfig` | Algorithm, threshold, last-run timestamp |

`clearEntireDatabase()` is extended to clear the three new stores.

New DB helpers (mirroring existing naming/style): `saveOcrArtifact`,
`getOcrArtifact`, `getAllOcrArtifacts`, `saveDedupRecord`, `getAllDedupRecords`,
`saveDedupConfig`, `getDedupConfig`.

### 2.3 Verification harness (headless, offline)

Existing `src/test/verifySlice1.ts` / `verifySlice2.ts` are standalone TS scripts
using `console.assert`, run by bundling with the already-installed `esbuild`. We
follow the same convention and add npm scripts so tests run deterministically:

```jsonc
"verify:slice3": "esbuild src/test/verifySlice3.ts --bundle --platform=node --format=esm --outfile=node_modules/.verify/s3.mjs && node node_modules/.verify/s3.mjs",
"verify:slice4": "esbuild src/test/verifySlice4.ts --bundle --platform=node --format=esm --outfile=node_modules/.verify/s4.mjs && node node_modules/.verify/s4.mjs"
```

Both new tests are **pure/dependency-injected** (no real Tesseract, no canvas, no
DOM) so they run in Node exactly like Slice 1/2 — matching the existing mock-DB
pattern.

---

# Part A — Slice 3: OCR Preprocessing

## A1. Domain types (`src/types/schema.ts`)

```ts
export type OcrEngine = 'tesseract';

/** Immutable OCR evidence attached to a FRAME. Never ground truth. */
export interface OcrArtifact {
  frameId: string;
  engine: OcrEngine;
  text: string;            // raw output, preserved exactly as generated
  language: string;        // e.g. 'eng'
  engineVersion?: string;  // recorded only when the API exposes it
  wrapperVersion?: string; // tesseract.js package version
  confidence?: number;     // 0..100, when reported
  generatedAt: string;     // ISO timestamp (provenance)
}
```

`FrameRecord` is left unchanged (OCR lives in its own store so it can be re-run /
versioned independently and exported to a dedicated `ocr.jsonl`).

## A2. OCR service (`src/services/ocr.ts`) — replaceable, UI-independent

Interface mirrors AGENTS §33:

```ts
export interface OcrOptions { language?: string; onProgress?: (p: OcrProgress) => void; }
export interface OcrProgress { status: 'loading engine' | 'loading language' | 'recognizing text';
                              progress: number; /* 0..1 */ }

export async function runOcr(frame: FrameRecord, options?: OcrOptions): Promise<OcrResult>;
```

Implementation notes:

- Lazily create **one** shared `Worker` (`createWorker('eng', undefined, onProgress)`)
  and reuse it across frames; terminated on `unload`. Avoids re-initialising WASM per frame (§40).
- Rasterise the input via an offscreen `<canvas>` (draw the `<img>` at natural size,
  export `image/png`) before recognition. This (a) normalises SVG mock frames to a
  raster tesseract can read, and (b) gives a single preprocessing choke point.
- Return `{ text, engine: 'tesseract', language, confidence, engineVersion?, wrapperVersion, generatedAt }`.
- Pure helper `buildOcrArtifact(frameId, result)` so the artifact shape is testable
  without a browser.

## A3. Persistence

- `saveOcrArtifact` / `getOcrArtifact` / `getAllOcrArtifacts` in `db.ts`.
- **Reproducibility rule (§8.3):** re-running OCR creates a *new* artifact and
  replaces the previous OCR artifact for that frame id; it must **never** read from
  or write to `EncounterSample.items`. (Multiple named runs are a future extension;
  MVP keeps one current artifact per frame.)

## A4. Hook state (`src/hooks/useFieldSession.ts`)

Add:

- `ocrArtifacts: Map<frameId, OcrArtifact>` (loaded on init, like `frames`).
- `ocrStatus: { frameId: string | null; phase: 'idle'|'running'|'done'|'error';
  status?: string; progress?: number; error?: string }`.
- `runOcrForFrame(frameId)` → sets status, calls the service, persists, updates map.
- `hasOcrForFrame(frameId)` / `getOcrArtifact(frameId)` accessors.

**Caching (§40):** if an artifact already exists and the language is unchanged, the
panel offers *Re-run* explicitly rather than auto-recomputing. Gallery / cockpit
## A5. OCR panel UI (`src/components/OCRPanel.tsx`)

Docked in the **right column above the ground-truth form** (AGENTS §13.1):

```text
┌─ OCR EXTRACT ─ preprocessing evidence, not ground truth ── [collapse] ─┐
│ engine: tesseract · lang: eng · conf 87.4 · 2026-…                      │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ holy shit i just                                                   │ │
│ │ realized...                        (read-only, monospace)          │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ Insert into:  [#1 Post ▾]   [Insert into Content] [Copy] [Re-run OCR]  │
└────────────────────────────────────────────────────────────────────────┘
```

- States: **no OCR** (button: *Run OCR*), **running** (progress bar + phase label),
  **done** (text + provenance + actions), **error** (human-readable recovery message, §39).
- The block is visually branded as an *OCR suggestion* (amber / `--accent-amber` accent,
  explicit "not ground truth" caption) so it can never be mistaken for the field note.
- **Insert into Content guard (Golden Rule):**
  - target item = selected chip (`#1`, `#2`, …), defaulting to item #1;
  - if the target item's `content` is **empty** → insert directly (**one action**);
  - if it is **non-empty** → do **not** overwrite: reveal inline choices
    `[Replace] [Append] [Cancel]`; `Append` guarantees existing human text is preserved.
  - Insertion writes into the *textarea buffer* only; it is persisted on Save.

## A6. Cockpit integration

- `AnnotationCockpit` gains a `.cockpit-right-column` flex layout. `GroundTruthForm`
  renders `<OCRPanel/>` (collapsible: default collapsed when an artifact exists,
  expanded while running or when none exists) directly beneath its panel header and
  above `<form className="form-scroll-area">`, keeping insertion logic colocated with
  `updateItemField`. `OCRPanel` is a presentational component receiving
  `ocrArtifact`, `ocrStatus`, `onRunOcr`, `items`, and `onInsert(text, mode)`.
- New props threaded `App → AnnotationCockpit → GroundTruthForm → OCRPanel`:
  `ocrArtifact`, `ocrStatus`, `onRunOcr`. Keeps App as the single composition root.
- `ImageViewer`'s existing "OCR Contrast" toggle stays as a viewing aid (unchanged).

## A7. Keyboard

- `Alt+I` → Insert current OCR into the targeted content field.
- `Alt+O` → Run / re-run OCR for the active frame.
- Both registered in the cockpit and documented in `KeyboardShortcutsModal`.

## A8. Error handling (§39)

- Engine/lang download failure → "Could not load the OCR engine. Check your network
  connection; OCR runs locally and nothing is uploaded. You can retry, or annotate
  manually." with a **Retry** button.
- Undecodable image → recovery message suggesting re-importing a PNG/JPG/WebP frame.
- OCR failure **never** blocks `Save & Next`.

## A9. Tests (`src/test/verifySlice3.ts`)

Dependency-injected mock recognizer (no browser). Asserts:

1. **Separation:** storing an OCR artifact leaves `items[].content` byte-identical.
2. **Insert-into-empty** populates `content`; **insert-into-non-empty** never
   overwrites without an explicit `Replace`/`Append` decision; `Append` preserves the
   original substring.
3. **Provenance round-trip:** `engine`/`language`/`generatedAt` (and optional
   `engineVersion`/`confidence`) survive save → load unchanged.
4. **Immutability/reproducibility:** re-running OCR replaces the *artifact* but the
   unchanged ground truth is untouched; artifact count stays 1 per frame.
5. **Caching:** `hasOcrForFrame` short-circuits re-computation unless explicitly re-run.

---

# Part B — Slice 4: Perceptual Deduplication

## B1. Domain types (`src/types/schema.ts`)

```ts
export type HashAlgorithm = 'phash' | 'dhash' | 'ahash';
export type DedupRole = 'unique' | 'representative' | 'duplicate';

export interface FrameHash {
  frameId: string;
  hash: string;            // hex, hashSize*hashSize bits
  algorithm: HashAlgorithm;
  hashSize: number;        // 8 → 64-bit hash
  computedAt: string;
}

/** One reversible decision per frame. Maps 1:1 onto FrameHash. */
export interface DedupRecord {
  frameId: string;
  hash: string;
  algorithm: HashAlgorithm;
  hashSize: number;
  groupId?: string;        // undefined ⇒ ungrouped/unhashed
  role: DedupRole;
  representativeFrameId?: string; // set when role === 'duplicate'
  overridden: boolean;     // true ⇒ researcher decision, not algorithm output
  computedAt: string;
}

export interface DuplicateGroup {
  groupId: string;
  frameIds: string[];
  representativeFrameId: string;
  maxDistance: number;     // worst hamming distance inside the group
}

export interface DedupConfig {
  id: 'default';
  algorithm: HashAlgorithm;
  threshold: number;       // hamming distance (default 8; conservative)
  lastRunAt?: string;
}
```

## B2. Service (`src/services/deduplication.ts`) — replaceable strategy

Follows AGENTS §31 (`DeduplicationStrategy`). Split into a **pure core** (testable in
Node) and a **browser adapter**:

```ts
// PURE — no DOM. Powers the tests and the browser path.
export function hashPixels(
  rgba: Uint8ClampedArray, width: number, height: number,
  opts: { algorithm?: HashAlgorithm; hashSize?: number }
): string;                                   // hex hash

export function hammingDistance(a: string, b: string): number;

export function groupBySimilarity(
  hashes: { frameId: string; hash: string }[],
  threshold: number
): DuplicateGroup[];                          // union-find, conservative

// BROWSER — decodes a frame to pixels, then reuses the pure core.
export function computeFrameHash(
  frame: FrameRecord, opts?: { algorithm?: HashAlgorithm; hashSize?: number }
): Promise<FrameHash>;

export class PerceptualHashStrategy implements DeduplicationStrategy {
  compare(frames: FrameRecord[]): Promise<SimilarityResult[]>;
}
```

Algorithm details:

- Default **`phash`** (DCT over a 32×32 grayscale downscale → top-left 8×8 median
  threshold). `dhash` and `ahash` provided as selectable, cheaper alternatives
  (all explicitly listed in AGENTS §10).
- `hashSize` default `8` (64-bit). Hamming distance over the hex bits.
- `groupBySimilarity` uses **union-find** so chains (A≈B, B≈C) collapse into one
  group; `maxDistance` is surfaced for researcher inspection.
- **Conservative by default:** `threshold = 8` from a 64-bit hash; frames whose
  visible UGC differs meaningfully fall outside the threshold and stay distinct.

## B3. Persistence

- `saveDedupRecord` / `getAllDedupRecords` (store `dedup`, key `frameId`).
- `saveDedupConfig` / `getDedupConfig` (store `dedup_config`, key `'default'`,
  seeded `{ algorithm: 'phash', threshold: 8 }`).
- Records are additive/updatable; **no frame is ever removed** (AGENTS §10, §17).

## B4. Hook state (`src/hooks/useFieldSession.ts`)

- `dedupRecords: Map<frameId, DedupRecord>`, `dedupConfig: DedupConfig`.
- `dedupStatus: { phase: 'idle'|'hashing'|'grouping'|'done'|'error'; processed; total; error? }`.
- `runDeduplication()` → hash all frames (progress per frame), group, persist records
  + config + `lastRunAt`, batched to keep the UI responsive (§40).
- `setRepresentative(frameId)`, `markDuplicate(frameId, representativeFrameId?)`,
  `restoreFrame(frameId)` (= `role: 'unique'`, `overridden: true`),
  `setDedupThreshold(n)`, `setDedupAlgorithm(a)` (changing algorithm marks existing
  records stale → prompts a re-scan rather than silently mixing algorithms).
- `dedupStats: { hashed, groups, representatives, duplicates, unique, suppressedSavings }`.
- Filtering: `dedupFilter: 'all'|'unique'|'representative'|'duplicate'` and
  `hideSuppressedDuplicates: boolean` feed `filteredEncounters`.

## B5. Deduplication Review view (`src/components/DeduplicationReview.tsx`)

New third view: `currentView: 'gallery' | 'cockpit' | 'dedup'` (Header gains a
"Deduplicate" tab with a badge showing the suppressed-duplicate count).

```text
┌ Candidates: 428  Scanned: 428  Groups: 93  Suppressed: 271  Algorithm: [pHash ▾] Threshold: [8]  [Rescan] ┐
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ GROUP #1  (3 frames, max Δ = 4)                                                                                │
│ ┌── REP ──┐ ┌─ dup Δ0 ─┐ ┌─ dup Δ4 ─┐                      [Set as representative] [Restore] [Keep as distinct] │
│ │ ugc-0007│ │ugc-0008 │ │ugc-0009  │                                                                             │
│ └─────────┘ └─────────┘ └──────────┘                                                                             │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Empty ("Run a scan…"), progress, and "no duplicates found — threshold may be too
  strict" states.
- Group strip: representative emphasised; members show `Δ` hamming distance and role;
  per-frame actions as buttons. Restored / kept-distinct frames leave the group.
- Collapsible **Settings**: algorithm selector, threshold slider (0–16) with a
  conservative-tolerance caption, and a note that dedup is reversible.

## B6. Gallery & card integration

- `EncounterCard`: `role === 'duplicate'` → grey "Duplicate of ⟨rep id⟩" badge and a
  dimmed thumbnail; `'representative'` → amber "Rep ✓" badge.
- `EncounterGallery`: a "Deduplicate" toolbar CTA, a dedup filter chip row
  (`Unique / Representative / Duplicate`), and a "Hide suppressed duplicates" toggle.
- Header / gallery counts surface suppressed duplicates (derived, never persisted).

## B7. Reversibility & safety

- Every mutation writes a `DedupRecord`; `restoreFrame` flips `role → 'unique'` with
  `overridden: true`. Suppressed duplicates remain visible in the gallery (dimmed)
  unless the researcher toggles "hide".
- `Ctrl+Z`-style undo for the last dedup action is deferred to Slice 7 (§42); this
  slice guarantees reversibility via explicit restore/override controls.

## B8. Keyboard (scoped to the review view; avoids clashing with cockpit A/R/S/D)

- `← / →` move between groups; `Enter` set current frame as representative;
  `D` mark duplicate of the group representative; `U` restore (keep unique).

## B9. Tests (`src/test/verifySlice4.ts`)

Pure core, no canvas/DOM. Asserts:

1. **Identical images** → identical hash (distance `0`); **near-identical** (a few
   changed pixels) → small distance ≤ threshold; **very different** → distance well
   above threshold.
2. **Grouping:** obvious duplicates are grouped into one `DuplicateGroup`; distinct
   frames remain distinct (conservative); chained similarity collapses via union-find.
3. **Representative selection:** `setRepresentative` updates the group and reassigns
   members' `representativeFrameId`.
4. **Override / restore:** a manually suppressed frame can be restored to `unique`
   and reappears as a standalone candidate.
5. **Threshold sensitivity:** lowering/raising the threshold changes grouping as
   expected, and changing algorithm marks records stale.
6. **Persistence round-trip:** `DedupRecord`s + `DedupConfig` survive save → load
   (no frame data lost).

---

## 3. Styling additions (`src/styles/index.css`)

New blocks appended to the existing design system (same tokens/variables, no new
palette):

- `.cockpit-right-column` (flex column; replaces the direct `GroundTruthForm` grid cell).
- `.ocr-panel`, `.ocr-panel-header`, `.ocr-text-viewer` (monospace, amber accent),
  `.ocr-provenance`, `.ocr-insert-row`, `.ocr-guard-actions`, `.ocr-progress`.
- `.dedup-container`, `.dedup-toolbar`, `.dedup-group`, `.dedup-frame-card`,
  `.dedup-badge` (representative / duplicate), `.dedup-settings`.
- `.card-dedup-badge`, `.card-dedup-dim` for gallery cards.
- Responsive tweak under the existing `@media (max-width: 1140px)` breakpoint.

---

## 4. Files Changed

### Added
- `src/services/ocr.ts` — OCR service (worker lifecycle, rasterise, artifact builder).
- `src/services/deduplication.ts` — pure hash core + browser adapter + strategy.
- `src/components/OCRPanel.tsx` — OCR extract panel with guarded insertion.
- `src/components/DeduplicationReview.tsx` — duplicate-group review view.
- `src/test/verifySlice3.ts`, `src/test/verifySlice4.ts` — headless verification.
- `artifacts/plan_slice3_slice4.md` (this document).

### Modified
- `package.json` — add `tesseract.js`; add `verify:slice3` / `verify:slice4` scripts.
- `src/types/schema.ts` — `OcrArtifact`, `FrameHash`, `DedupRecord`, `DuplicateGroup`,
  `DedupConfig`, `HashAlgorithm`, `DedupRole`.
- `src/services/db.ts` — `DB_VERSION = 2`, three new stores + CRUD helpers,
  `clearEntireDatabase` extended.
- `src/hooks/useFieldSession.ts` — OCR + dedup state, actions, derived stats, filters.
- `src/components/AnnotationCockpit.tsx` — right-column layout + OCR prop threading.
- `src/components/GroundTruthForm.tsx` — render `OCRPanel`, guarded `onInsert`.
- `src/components/EncounterCard.tsx` — dedup badges / dimming.
- `src/components/EncounterGallery.tsx` — dedup CTA, filter chips, hide toggle.
- `src/components/Header.tsx` — `dedup` view tab + suppressed count badge.
- `src/App.tsx` — third view branch; thread OCR/dedup props.
- `src/components/KeyboardShortcutsModal.tsx` — document new shortcuts.
- `src/styles/index.css` — new component styles.
- `src/services/sampleData.ts` — *(minor)* replace SVG `foreignObject` body text with
  real `<text>` lines so the built-in mock batch rasterises and yields non-empty OCR.

---

## 5. Verification Plan

1. `npx tsc --noEmit` — type-safety across all changes.
2. `npm run verify:slice3` — OCR separation, insertion guard, provenance, caching.
3. `npm run verify:slice4` — hashing, grouping, representative, override/restore,
   threshold sensitivity, persistence.
4. `npm run build` — production bundle succeeds (Tesseract WASM worker resolves).
5. `npm run dev` — manual smoke:
   - import a real screenshot → **Run OCR** → text appears → **Insert into Content**
     fills an empty field in one action; a populated field prompts Replace/Append.
   - "Load Sample Batch" → **Deduplicate** tab → scan → groups appear → set
     representative / restore → gallery reflects badges; reload to confirm persistence.

---

## 6. Risks, Decisions & Non-Goals

| Risk / decision | Handling |
|---|---|
| Tesseract WASM/lang fetched from CDN on first run | One-time, cached, client-side only; status surfaced; `corePath`/`langPath` configurable later for offline |
| SVG mock frames not OCR-able | Rasterise to PNG in the OCR service **and** convert mock body text to real `<text>` |
| OCR overwriting ground truth | Structural separation + explicit Replace/Append guard (tested) |
| Hash collisions / over-aggressive grouping | Conservative default threshold, union-find + `maxDistance` surfaced, always reversible |
| Style conflict between dedup keys and cockpit A/R/S/D | Dedup shortcuts scoped to the review view only |
| IndexedDB upgrade on existing sessions | Additive stores only; old stores untouched; verified by reload |

**Explicit non-goals for this slice:** export/JSONL/ZIP (Slice 6), video frame
extraction (Slice 5), image-embedding similarity, VLM inference, and command palette
polish (Slice 7). OCR and dedup artifacts are stored so a later Slice 6 can emit
`ocr.jsonl` and dedup metadata without schema changes.

---

## 7. Approval Questions

1. **Confirm** `tesseract.js@7` as the OCR engine dependency (browser WASM) — acceptable?
2. **Confirm** the dedicated third **"Deduplicate"** view tab (vs. a modal/drawer) for
   duplicate review.
3. **Confirm** the default hash algorithm/threshold (`pHash`, `Δ ≤ 8`) and that changing
   them simply requires a re-scan (no silent mingling).
4. **Confirm** the minor `sampleData.ts` change (SVG `foreignObject` → `<text>`) so the
   built-in mock batch demonstrates real OCR.

Awaiting your approval before implementation.





