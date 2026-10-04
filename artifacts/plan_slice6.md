# Scrollnotes — Slice 6 Implementation Plan: Corpus Export

> **Goal:** turn a curated, annotated field session into a **reproducible benchmark
> dataset** on disk: `images/ + annotations.jsonl + ocr.jsonl + manifest.json`, zipped,
> ready to drop into a Python evaluation script.

---

## 0. Decision Record

### 0.1 ZIP writer — hand-rolled STORE method, no dependency

| Option | Verdict |
|---|---|
| `jszip` / `fflate` | Rejected. ~40 KB dep for one function; AGENTS §4 says do not add dependencies merely because they are fashionable. |
| `fflate` + deflate | Rejected. Payloads are JPEG/PNG (already entropy-coded) plus small text files. Deflate would shave ~1% while adding a core dependency. |
| **Hand-rolled STORE ZIP** | **Chosen.** CRC-32 table + local file headers + central directory ≈ 90 lines of pure TS, runs in Node and the browser, directly unit-testable. |

The service boundary (`buildExportBundle` → `createZip`) keeps this a one-file swap if real
compression is ever wanted.

### 0.2 Which samples ship

Only `status === 'annotated'`. Rejected / skipped / pending frames stay in the working
dataset (§10) but never enter the benchmark export (§8.3: "the final benchmark export can
contain only the curated samples"). OCR artifacts are exported for **exported samples only**,
so `ocr.jsonl` cannot be mistaken for evidence about frames that were never curated.

### 0.3 Validation severity — `pass` / `warn` / `fail`

§24 lists required checks but not their severity. Splitting them matters:

- **fail** — data is corrupt or missing. Blocks export: duplicate/blank sample ids, missing
  frame image, empty ground truth, no items, missing provenance filename.
- **warn** — legitimate research states a researcher may knowingly accept: frames imported
  without a recording (no `recordingId`/`timestampMs` — the documented fallback path),
  platform left as `'other'`, OCR missing for some frames, samples still pending, extraction
  runs that ended in error/cancel.

§24's intent — "Do not allow an accidental half-annotated dataset to masquerade as complete"
— is served by recording every check and every warning **in the manifest**, plus a
top-level `annotationComplete` boolean. The export is honest rather than blocked.

### 0.4 Quality flags

`QualityFlag` is added to the domain (`SampleMetadata.qualityFlags`) and emitted in
`annotations.jsonl` — §25 requires flags to survive export. **No annotation UI in this
slice** (Slice 7, §42). The field is optional, so every existing sample stays valid.

---

## 1. Scope & Grounding

Implements AGENTS §22 (Export), §23 (Manifest), §24 (Validation), §21 (provenance
survives export), §25 (flags survive export), §41 (export tests), §42 (Slice 6).

### Non-negotiable invariants

1. **Ground truth and OCR never mix.** `annotations.jsonl` carries human transcription;
   `ocr.jsonl` carries raw engine output. Two files, two schemas, no shared field.
2. **OCR is never rewritten.** Export copies `OcrArtifact.text` byte-for-byte. No
   trimming, no normalisation, no "cleaning".
3. **Provenance survives.** Every line carries `recordingId`, `sourceTimestampMs`,
   `frameFilename`, and the exported image path.
4. **Export is never destructive and never automatic.** It only reads and writes a
   downloaded file. Nothing in the session is modified.
5. **No invented data.** Unknown fields are omitted from the manifest, never guessed —
   the same rule the OCR service follows for `engineVersion`.
6. **Schema is versioned.** Every export carries `SCHEMA_VERSION`.
---

## 2. Domain Additions (`src/types/schema.ts`)

```ts
export const SCHEMA_VERSION = '1.0';

// §25 — flags survive export; the annotation UI for them lands in Slice 7.
export type QualityFlag =
  | 'low-quality-frame' | 'partially-occluded' | 'ambiguous-author'
  | 'ambiguous-content' | 'multiple-ugc-items' | 'ui-heavy'
  | 'unusual-layout' | 'annotation-uncertain';

// On SampleMetadata:
qualityFlags?: QualityFlag[];

export interface ExportedAnnotation { /* sampleId, datasetId, platform, image,
  items[], context, metadata(+qualityFlags), provenance, notes, timestamps */ }
export interface ExportedOcrRecord { /* sampleId, frameId, engine, text, language,
  engineVersion?, wrapperVersion?, confidence?, generatedAt */ }
export interface ExportManifest { /* §23 fields + validation + counts */ }
export type CheckSeverity = 'pass' | 'warn' | 'fail';
export interface ExportCheck { id, label, severity, detail, sampleIds? }
export interface ExportValidation { checks, canExport, counts }
```

`ExportedAnnotation.image` is the path **inside the bundle** (`images/<sampleId>.jpg`),
which is what makes the export self-consistent for a downstream script.

---

## 3. Services

### 3.1 `src/services/exportValidation.ts` (pure)

```ts
validateForExport(input: {
  encounters: EncounterSample[];
  frameIds: Set<string>;
  ocrFrameIds: Set<string>;
  dedupRecords: Map<string, DedupRecord>;
  dataset: DatasetInfo;
  extractionRuns: ExtractionRun[];
}): ExportValidation
```

Checks (§24): sample id present/unique/prefix-shaped · frame exists · ground truth object
exists · at least one item · item content non-empty · platform verified · provenance
filename present · recording provenance complete · OCR artifact present · dedup decision
resolved · extraction runs succeeded · dataset schema version present.

### 3.2 `src/services/export.ts` (pure)

```ts
selectExportableSamples(encounters): EncounterSample[]
buildAnnotationRecord(encounter, dataset, imagePath): ExportedAnnotation
buildOcrRecord(sample, artifact): ExportedOcrRecord
buildAnnotationsJsonl(records): string        // one JSON object per line
buildOcrJsonl(records): string
buildAnnotationsCsv(records): string           // RFC 4180 quoting
buildManifest(...): ExportManifest
buildReadme(dataset, manifest): string
buildExportBundle(...): ExportBundle           // { files: ExportFile[] }
```

Text is emitted with `\n` endings and a single trailing newline so the files diff cleanly
across platforms.

### 3.3 `src/services/zip.ts` (pure)

```ts
crc32(bytes): number
createZip(files: { path, bytes }[]): Uint8Array
dataUrlToBytes(dataUrl): Uint8Array   // base64 and percent-encoded forms
downloadBlob(blob, filename): void    // the only DOM-aware export
```

STORE method (compression method 0). The DOS date/time is derived from a `Date` the caller
passes in, so the writer stays deterministic and testable.

---

## 4. UI (`src/components/ExportDialog.tsx`)

A pre-export checklist in the existing modal idiom (`.modal-overlay` / `.modal-dialog`),
opened from a new **Export Corpus** action in the `Header`.

```text
┌─ Export Corpus ─────────────────────────────────┐
│  ✓ 200/200 frames present                       │
│  ✓ 200/200 ground truths complete               │
│  ✓ 200/200 valid sample IDs                     │
│  ✓ Provenance complete                          │
│  ⚠ OCR artifacts present for 187/200 frames     │
│  ✓ Schema valid (1.0)                           │
│  ⚠ 12 samples still pending — they will NOT ship │
│                                                 │
│  Format  [ Benchmark ZIP ] [ JSONL ] [ CSV ]     │
│  ┌────────────────────────────────────────────┐  │
│  │ dataset/                                   │  │
│  │ ├── images/           200 files            │  │
│  │ ├── annotations.jsonl                      │  │
│  │ ├── ocr.jsonl                              │  │
│  │ ├── manifest.json                          │  │
│  │ └── README.md                              │  │
│  └────────────────────────────────────────────┘  │
│                          [ Export Dataset ]     │
└─────────────────────────────────────────────────┘
```

Progress is reported per image (`✓ 143 / 200`) because a 200-image bundle takes a moment
and a frozen dialog would read as a hang (§39: always give the researcher a way forward).

---

## 5. Tests (`src/test/verifySlice6.ts`)

Node, pure functions only, matching the slice 1–5 harness style.

- `selectExportableSamples` ships annotated only.
- Every JSONL line parses and carries the required fields.
- **OCR text is byte-identical** after a round trip (including newlines and unicode).
- Provenance survives export → `recordingId` / `timestampMs` / `frameFilename`.
- Sample ids stay stable and unique across two exports.
- `createZip` produces a buffer whose entries re-parse from the central directory and whose
  CRC matches `crc32` of the payload.
- Manifest is valid JSON with `schemaVersion`, counts, and the validation block.
- A dataset with a missing frame **fails** and blocks export; one missing only a recording
  id **warns** and still exports.
- Quality flags survive into `annotations.jsonl`.
- CSV quoting survives embedded newlines, commas, and quotes.

---

## 6. Explicit Non-Goals for This Slice

- Deflate compression, ZIP64, streaming ZIP writes (a 200-image bundle fits in memory).
- Import / re-import of an exported bundle.
- Uploading anywhere. §35 — export is an explicit local download and nothing else.
- The quality-flag annotation UI (Slice 7).
- Command palette, shortcut polish (Slice 7).