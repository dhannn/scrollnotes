# AGENTS.md — Scrollnotes

> **Scrollnotes**  
> *A fieldwork instrument for documenting, annotating, and curating social-media UGC.*

## 1. Project Summary

Build a small, polished React web application called **Scrollnotes** that acts as a **research fieldwork instrument for documenting, annotating, and curating visual social-media user-generated content (UGC)**.

The tool is used to generate a controlled corpus of real-world social-media screenshots/frames containing UGC, annotate each sample with researcher-verified ground truth, attach useful metadata, preserve provenance, and export the resulting dataset for later VLM experimentation and analysis.

The application is a standalone research instrument and is **not itself responsible for VLM inference or model evaluation**. Its job is to make the tedious dataset-generation workflow extremely fast, clear, reproducible, and pleasant.

The conceptual framing is **digital fieldwork**:

- the researcher enters a social-media environment
- encounters visual/textual UGC
- captures traces of those encounters
- documents selected encounters with field notes
- preserves provenance
- curates them into a research corpus

The metaphor should inform the information architecture and vocabulary without turning the application into a novelty-themed interface.

### Core research workflow

```text
Digital field session / screen recording
        ↓
Frame extraction / sampling
        ↓
OCR trace (Tesseract)
        ↓
Candidate encounter gallery
        ↓
Automatic near-duplicate detection
        ↓
Manual curation
        ↓
Field note / human ground truth
        ↓
Encounter metadata + provenance
        ↓
Validation
        ↓
Corpus export
        ↓
VLM experiment / statistical analysis
```

The researcher should be able to move through this pipeline without constantly opening Python scripts, renaming files, editing JSON manually, or maintaining spreadsheets.

---

## 2. Primary Goal

Optimize for:

1. **Researcher throughput** — annotating hundreds of samples should feel fast.
2. **Ground-truth quality** — the researcher personally verifies/transcribes the target UGC.
3. **Dataset provenance** — every sample should be traceable to its source recording/frame.
4. **Reproducibility** — exports should contain enough metadata to reconstruct what happened.
5. **Low cognitive overhead** — the UI should make the next annotation action obvious.
6. **Experiment-readiness** — output should be clean enough to feed directly into evaluation scripts.
7. **A pleasant interface** — this is a tool the researcher may stare at for hours, so it should feel more like a polished annotation workstation than an admin dashboard.

Do **not** optimize for building a generic social-media scraper or a production data-labeling platform.

---

## 3. Product Identity and Vocabulary

The product name is **Scrollnotes**.

The intended conceptual framing is:

> **Scrollnotes** is a fieldwork instrument for documenting, annotating, and curating social-media UGC.

The name combines:

- **scroll** — the act of moving through social-media environments
- **notes** — field notes, observations, and researcher annotation

Use the fieldwork metaphor lightly. The application should feel like a serious research workstation with personality, not a themed role-playing interface.

Preferred vocabulary when it improves conceptual clarity:

| Fieldwork concept | Technical/product concept |
|---|---|
| Field session | Browsing / screen-recording session |
| Encounter | Curated sample |
| Field note | Human ground truth |
| Trace | OCR / preprocessing evidence |
| Corpus | Curated dataset |
| Provenance | Source recording + timestamp |
| Platform | Property of an encounter/sample |

Conventional technical labels are completely acceptable where they reduce ambiguity. Do not force metaphorical terminology into every button, menu, or error message.

The application should remain **platform-agnostic**. Do not design the core architecture around Instagram, TikTok, Reddit, X, YouTube, or any other single platform.

---

## 4. Technology

### Frontend

- React
- TypeScript
- Vite
- Modern CSS or Tailwind CSS
- Component-based architecture
- Client-side state management appropriate to project size
- Local-first persistence where practical

The application should run locally during development.

### Suggested supporting libraries

Use libraries when they materially simplify the implementation:

- `lucide-react` for icons
- `react-router` if multiple views become necessary
- `zod` for validating dataset/sample schemas
- `idb` or Dexie for IndexedDB persistence if local persistence is needed
- `papaparse` for CSV export/import if useful
- `file-saver` for downloads
- a perceptual-hash implementation or WebAssembly/image hashing approach for duplicate detection

Do not add dependencies merely because they are fashionable.

---

## 5. Product Mental Model

Scrollnotes uses a lightweight **digital fieldwork** metaphor. The metaphor should clarify the research workflow, not replace precise technical concepts.

### Dataset

A collection of curated encounters generated during one research dataset-building effort.

Example:

```text
"Social Media UGC Benchmark v1"
```

### Field Session / Source Recording

A screen recording from which frames are extracted.

A recording is a **provenance container**, not a platform category.

One recording may contain:

```text
Reddit → TikTok → Instagram → X → Reddit
```

Never infer platform from the recording name or from neighboring frames.

### Frame

A visual artifact extracted from a recording.

A frame is the visual evidence the researcher inspects and may eventually include in the benchmark corpus.

### OCR Trace

An automatically generated textual extraction associated with a frame, produced by Tesseract OCR.

OCR is **preprocessing evidence**, not ground truth.

OCR output must be preserved exactly as generated and must never be silently overwritten by human corrections.

### Encounter / Sample

A curated frame that the researcher decides belongs in the corpus.

An encounter records what was actually encountered in the digital field.

Its `platform` belongs to the encounter/sample itself.

### Field Note / Ground Truth

The researcher's manually verified interpretation of an encounter.

The field note is authoritative for the benchmark.

Human ground truth must remain separate from OCR output, even when the researcher uses OCR as the starting point for transcription.

### Corpus

The collection of curated encounters that becomes the exported research dataset.

### Provenance

The chain connecting an encounter back to its source recording, source frame, and timestamp.

---

## 6. Current Research Schema

The current conceptual UGC object is:

```json
{
  "platform": "instagram",
  "content": "Actual textual/verbal content of the UGC",
  "mediaDescription": "Description of salient visual/media content",
  "author": "Author/account/person shown in the UI"
}
```

`platform` is a property of the **individual sample**, not of the source recording.

A recording may contain any number of platforms.

Do not assume:

```text
one recording = one platform
```

Instead:

```text
recording
├── frame → Reddit
├── frame → Instagram
├── frame → TikTok
├── frame → X
└── frame → Reddit
```

This is intentional.

**Recordings are provenance containers, not semantic dataset categories.**

Future-compatible fields:

```json
{
  "context": {
    "type": "original-post | comment | reply | quoted-post | repost | standalone | unknown"
  },
  "engagement": {
    "likes": null,
    "comments": null,
    "shares": null
  }
}
```

A fuller sample may therefore look like:

```json
{
  "sampleId": "ugc-000001",
  "platform": "instagram",
  "items": [
    {
      "id": "item-001",
      "role": "post",
      "content": "...",
      "author": "...",
      "mediaDescription": "...",
      "hasMedia": true,
      "hasAuthor": true
    }
  ],
  "context": {
    "type": "original-post"
  },
  "metadata": {
    "textDensity": "high",
    "visualDensity": "medium",
    "isFlaggedForReview": false
  },
  "provenance": {
    "recordingId": "recording-001",
    "timestampMs": 128400,
    "frameFilename": "recording-001_0128400.jpg"
  }
}
```

The exact schema may evolve, but the following distinctions should remain stable:

- OCR is preprocessing evidence.
- Human ground truth is authoritative.
- `hasMedia` and `hasAuthor` are **UGC item-level properties** (e.g. an original post in a frame may have media while a reply in the same frame is text-only).
- Platform is sample-level.
- Recording is provenance.
- Provenance survives export.
- Schema is versioned.

Do not force future fields into the current annotation workflow unless they are explicitly enabled.

---

## 7. Important Concept: A Frame May Contain Multiple UGC Objects

Do not architect the data model around the assumption that one frame equals one UGC item.

A social-media frame may contain:

- an original post
- a reply
- a comment
- quoted content
- multiple cards
- multiple visible users
- other simultaneously visible UGC objects

The application should therefore be capable of representing:

```json
{
  "items": [
    {
      "role": "post",
      "content": "...",
      "author": "...",
      "mediaDescription": "...",
      "hasMedia": true,
      "hasAuthor": true
    },
    {
      "role": "reply",
      "content": "...",
      "author": "...",
      "mediaDescription": "...",
      "hasMedia": false,
      "hasAuthor": true
    }
  ]
}
```

However, the initial UI may reasonably optimize for one primary UGC item per sample if that makes annotation dramatically faster.

The data model should not make future multi-item support impossible.

---

## 8. Core Features

### 8.1 Dataset Creation

The researcher can:

- create a dataset
- name it
- optionally describe its purpose
- specify dataset version
- see sample count
- see annotation progress
- export the dataset

Example:

```text
UGC Benchmark

v0.1

147 / 200 samples annotated
```

---

### 8.2 Source Recording Import

Allow the researcher to import screen recordings or extracted frames.

A source recording is simply a **provenance container**.

Do not require the researcher to declare that a recording belongs to one platform.

A single long recording may contain:

```text
Reddit → TikTok → Instagram → X → Reddit → YouTube
```

Alternatively, the researcher may create separate recordings based on whatever sampling strategy is convenient, such as:

```text
recording_01 = text-heavy browsing
recording_02 = media-heavy browsing
recording_03 = mixed browsing
```

The application should remain agnostic to this organization.

Recording-level metadata may optionally include:

```json
{
  "recordingId": "recording-001",
  "description": "mixed social-media browsing session",
  "researcherLabel": "text-heavy session"
}
```

However, platform should be recorded at the **sample/frame level**, based on what is actually visible.

Ideal workflow:

```text
Import Recording
        ↓
Choose frame sampling strategy
        ↓
Generate candidate frames
        ↓
Identify platform per curated sample
```

Support common video formats where browser capabilities permit.

If browser-side video decoding becomes cumbersome, it is acceptable for an initial version to accept already-extracted image frames.

The architecture should keep recording ingestion separate from annotation.

---

## 8.3 OCR Preprocessing

OCR should be a **first-class preprocessing step** in the tool.

The current research workflow assumes that OCR will later be available as auxiliary textual context for VLM inference. Therefore, the dataset-generation tool should generate and preserve OCR output alongside each frame.

Use **Tesseract** for the initial implementation.

The conceptual pipeline is:

```text
recording
    ↓
frame extraction
    ↓
OCR (Tesseract)
    ↓
candidate frame
    ↓
deduplication / curation
    ↓
human ground truth
```

### OCR is not ground truth

This distinction is critical.

Store:

```json
{
  "ocr": {
    "engine": "tesseract",
    "text": "text extracted from the frame"
  },
  "groundTruth": {
    "content": "researcher-verified transcription"
  }
}
```

Never replace the OCR field with the researcher's corrected transcription.

The researcher may use OCR as a starting point, but the resulting ground truth must remain independently editable and independently stored.

### Annotation workflow

The UI should make OCR useful without making it authoritative.

For example:

```text
OCR EXTRACT
────────────────────────
holy shit i just
realized...

[Insert into Content]
[Copy]
```

Clicking **Insert into Content** may populate the ground-truth content field with the OCR text.

The researcher can then:

- correct OCR errors
- add omitted text
- remove OCR artifacts
- preserve line breaks where appropriate
- manually transcribe text OCR missed

The application must make it visually obvious that the text is an OCR suggestion and not the ground truth.

### OCR provenance

Store enough information to identify how the OCR artifact was produced:

```json
{
  "ocr": {
    "engine": "tesseract",
    "version": "...",
    "language": "eng",
    "text": "...",
    "generatedAt": "..."
  }
}
```

Where exact engine/version information is unavailable, omit it rather than inventing it.

### OCR at the frame level

OCR belongs to the **frame**, not only to the final curated sample.

Conceptually:

```text
Frame
├── image
├── OCR result
├── source recording
├── source timestamp
└── deduplication metadata
        ↓
Researcher curates frame
        ↓
Sample
├── ground truth
├── platform
└── dataset metadata
```

This means rejected or duplicate frames may still have OCR artifacts in the working dataset, while the final benchmark export can contain only the curated samples.

### OCR should remain reproducible

If the researcher changes OCR configuration later, do not silently overwrite existing results.

Treat OCR output as a generated artifact with provenance.

Future versions may support:

```text
OCR run v1
OCR run v2
```

but the MVP may simply preserve one immutable OCR result per frame.

### OCR is also useful for research analysis

Preserving OCR separately enables later analysis of:

- OCR quality against human ground truth
- common OCR failure modes
- text-heavy versus image-heavy performance
- how much correction the researcher needed to make
- the effect of OCR assistance on VLM extraction

The tool itself does not need to perform these analyses.

---

## 9. Frame Sampling

The researcher wants to screen-record themselves continuously browsing real social-media feeds.

The tool should therefore support extracting candidate frames from recordings.

Useful controls:

- sampling interval
- start/end time
- frame preview
- number of candidate frames
- optional extraction at regular intervals

Example:

```text
Recording: session_01.mp4

Duration: 08:43

Sampling:
[ 2.0 ] seconds

Candidate frames:
428
```

Do not assume that every sampled frame becomes a dataset sample.

---

## 10. Deduplication

This is a major feature.

Continuous scrolling produces many nearly identical frames. The tool should automatically identify likely duplicates so the researcher does not manually inspect hundreds of redundant frames.

### Desired behavior

Compute a visual similarity signal such as:

- perceptual hash
- difference hash
- average hash
- image embedding similarity if later justified

Group or suppress frames that are extremely similar.

Example:

```text
428 candidate frames
        ↓
93 duplicate groups
        ↓
271 unique-ish candidates
```

Do not silently delete source data.

Instead:

```text
Source frames
    ↓
Candidate frames
    ↓
Deduplication decision
```

Preserve provenance.

The researcher should be able to:

- see duplicate groups
- choose the representative frame
- override automatic deduplication
- restore a suppressed frame

### Important

Deduplication should be conservative.

A frame that differs meaningfully in visible UGC should not disappear merely because most of the screen looks similar.

Deduplication should be reversible.

---

## 11. Candidate Curation

Provide a fast visual gallery for reviewing extracted frames.

The researcher should be able to:

- accept
- reject
- skip
- mark duplicate
- undo
- open a large preview
- inspect source timestamp
- filter by status

Keyboard shortcuts are strongly encouraged.

Suggested shortcuts:

```text
A = accept
R = reject
D = duplicate
S = skip
← / → = previous / next
Enter = open/confirm
Esc = close preview
```

Do not make the researcher click tiny buttons hundreds of times.

---

## 12. Annotation / Ground Truth Interface

This is the most important screen in the application.

The researcher should see:

```text
┌───────────────────────────────┬─────────────────────────────┐
│                               │ OCR Extract                 │
│                               │                             │
│                               │ extracted text              │
│                               │                             │
│       LARGE FRAME             │ [Insert into Content]       │
│                               │                             │
│                               ├─────────────────────────────┤
│                               │ Ground Truth                │
│                               │                             │
│                               │ Content                     │
│                               │ [researcher annotation]     │
│                               │                             │
│                               │ Author                      │
│                               │ [........................]  │
│                               │                             │
│                               │ Media Description           │
│                               │ [........................]  │
│                               │                             │
│                               │ Platform [...............]  │
│                               │                             │
│                               │      [Save & Next →]        │
└───────────────────────────────┴─────────────────────────────┘
```

The exact layout may differ, but:

- the frame must remain visually prominent
- OCR must be immediately accessible
- ground truth must be clearly distinguished from OCR
- inserting OCR into ground truth must be one action
- correcting OCR must require no awkward copy/paste workflow
- OCR must never silently overwrite existing human annotation
- platform should be easy to set or verify
- provenance should remain visible or one action away

The researcher should never have to repeatedly open files in another application to inspect the image.

---

## 13. Manual Ground Truth

The researcher personally provides the gold-standard annotation.

This is deliberately manual.

For `content`, allow the researcher to transcribe exactly what should count as the textual/verbal UGC content.

The tool should make exact transcription easy:

- large text area
- optional monospace mode for literal transcription
- preserve line breaks
- no automatic rewriting
- no AI paraphrasing
- explicit "exact transcription" semantics

For `author`:

- free-text field
- allow values such as account/user name shown
- allow `"unknown"` when genuinely unavailable

For `mediaDescription`:

- researcher writes a concise description of the salient visual/media content
- do not encourage unsupported inference about intent, emotion, or psychology

Example:

```text
Bad:

"The user is angry about politics."
```

Better:

```text
"Screenshot of a politician speaking at a rally, with a red banner visible behind them."
```

The annotation tool should make this distinction clear.

---

## 13.1 OCR-Assisted Annotation Interface

The annotation workspace should expose OCR alongside the frame and ground-truth fields.

Preferred layout:

```text
┌─────────────────────────────┬──────────────────────────────┐
│                             │ OCR EXTRACT                  │
│                             │                              │
│                             │ extracted text               │
│                             │                              │
│        LARGE FRAME          │ [Insert into Content]        │
│                             │                              │
│                             ├──────────────────────────────┤
│                             │ GROUND TRUTH                 │
│                             │                              │
│                             │ Content                      │
│                             │ [researcher annotation]      │
│                             │                              │
│                             │ Author                       │
│                             │ [........................]   │
│                             │                              │
│                             │ Media Description             │
│                             │ [........................]   │
│                             │                              │
│                             │ Platform [...............]   │
│                             │                              │
│                             │      [Save & Next →]         │
└─────────────────────────────┴──────────────────────────────┘
```

The exact layout may differ, but the following principles are important:

- the image remains visually prominent
- OCR is immediately accessible
- ground truth is clearly distinguished from OCR
- inserting OCR into ground truth is one action
- correcting OCR requires no awkward copy/paste workflow
- OCR must never silently overwrite existing human annotation

The researcher should be able to annotate without leaving the application.

---

## 14. Annotation Metadata

Each sample and each UGC item has structured metadata useful for later analysis:

- **Sample-Level Metadata**:
```json
{
  "platform": "x",
  "textDensity": "low | medium | high",
  "visualDensity": "low | medium | high",
  "isFlaggedForReview": false
}
```

- **UGC Item-Level Metadata**:
```json
{
  "role": "post | comment | reply | quoted-post | card | standalone",
  "author": "@handle",
  "hasMedia": true,
  "hasAuthor": true
}
```

`hasMedia` and `hasAuthor` describe a **single UGC item**, never the frame. A frame containing an image post and a text-only reply stores `hasMedia` on each item, so the same sample legitimately holds both `true` and `false` values across its `items`. These flags must never appear on sample/frame-level metadata. Where a frame-level summary is convenient (e.g. a gallery badge), derive it from the items rather than persisting it.

Text-heaviness is already captured by `textDensity` (alongside `visualDensity`), so sample metadata deliberately has **no** separate `isTextHeavy` flag. Derive any such summary from the density fields when needed.

Potential platform values:

- Reddit
- Instagram
- TikTok
- X
- YouTube
- Facebook
- Other

Platform is a **sample-level field**.

It should never be inferred from the recording's name or assumed from the previous/next sample.

The researcher should explicitly verify the platform for each curated sample.

Do not hard-code platform-specific semantics into the core UGC model.

Metadata describes the sample; it is not necessarily part of model output.

---

## 15. Annotation Progress

The UI should constantly show progress.

Examples:

```text
147 / 200 annotated

73.5%
```

Also useful:

```text
Accepted: 173
Rejected: 38
Duplicates: 217
Needs annotation: 26
```

A dataset should have an explicit status:

```text
Draft

Curating

Annotating

Ready

Exported
```

---

## 16. Autosave

Never make the researcher fear losing annotations.

Save changes automatically.

A subtle indicator is sufficient:

```text
✓ Saved locally
```

or:

```text
Saving...
```

Avoid disruptive save dialogs.

---

## 17. Undo / Recovery

Annotation is repetitive and error-prone.

Support:

- undo last action
- undo rejection
- restore duplicate
- restore deleted candidate
- recover interrupted session

Do not permanently destroy raw source frames from normal UI actions.

---

## 18. Keyboard-First UX

This tool will potentially be used to annotate hundreds of samples.

Keyboard navigation is therefore a first-class feature.

Recommended:

```text
← / →             Navigate samples
A                 Accept
R                 Reject
D                 Duplicate
N                 Next
P                 Previous
Cmd/Ctrl+S        Save
Cmd/Ctrl+Z        Undo
Cmd/Ctrl+Enter    Save and next
```

The exact mapping may be refined after implementation.

Display shortcut hints in the UI.

---

## 19. "Save & Next" Is the Primary Action

The researcher should be able to annotate one sample and immediately continue.

The happy path should be:

```text
Inspect frame
    ↓
Type content
    ↓
Type author
    ↓
Type media description
    ↓
Verify platform / metadata
    ↓
Save & Next
    ↓
Next frame
```

Avoid forcing navigation through multiple screens.

---

## 20. Smart Defaults

Reduce repetitive work.

Examples:

- remember last selected platform
- remember common metadata choices
- allow quick toggles
- auto-fill source recording
- auto-fill timestamp
- auto-generate sample ID
- preserve current filter after saving

Do not automatically fill ground-truth content.

Ground truth must remain deliberate.

Smart defaults should be easy to override and should never silently change the meaning of a sample.

---

## 21. Sample Identity and Provenance

Every sample needs a stable ID.

Example:

```text
scrollnotes-ugc-000001
scrollnotes-ugc-000002
```

Each sample should retain:

```json
{
  "sampleId": "scrollnotes-ugc-000001",
  "datasetId": "social-ugc-v1",
  "recordingId": "recording-001",
  "sourceTimestampMs": 12400,
  "frameFilename": "recording-001_012400.jpg"
}
```

This makes the dataset auditable and reproducible.

Do not use a project-specific research-project prefix in sample IDs.

Sample identity should belong to Scrollnotes/dataset semantics, not to an external project.

---

## 22. Export

The tool must export machine-readable data.

### Primary format

## JSONL

One sample per line.

Example:

```json
{"sampleId":"scrollnotes-ugc-000001","platform":"instagram","sourceTimestampMs":12400,"groundTruth":{"content":"...","mediaDescription":"...","author":"..."}}
```

Also consider:

- JSON
- CSV
- ZIP containing images + JSONL + manifest

### Recommended benchmark export

```text
dataset/
├── images/
│   ├── scrollnotes-ugc-000001.jpg
│   ├── scrollnotes-ugc-000002.jpg
│   └── ...
├── annotations.jsonl
├── ocr.jsonl
├── manifest.json
└── README.md
```

The ZIP should be directly usable by later Python evaluation scripts.

The exported annotations and OCR should remain clearly separated.

---

## 23. Manifest

Every export should include a manifest describing:

- dataset name
- dataset version
- schema version
- export timestamp
- sample count
- source recordings
- sampling settings
- deduplication settings
- annotation completion status
- OCR configuration where available

Example:

```json
{
  "dataset": "UGC Benchmark",
  "datasetVersion": "0.1",
  "schemaVersion": "1.0",
  "sampleCount": 200,
  "samplingIntervalSeconds": 2,
  "deduplication": {
    "method": "perceptual-hash",
    "threshold": 8
  },
  "ocr": {
    "engine": "tesseract"
  }
}
```

---

## 24. Validation

Before export, validate every sample.

Required checks should include:

- sample ID exists
- frame exists
- ground truth object exists
- required fields are present
- strings are not accidentally empty
- metadata values are valid
- schema version is present
- provenance is present
- OCR artifact references are valid where applicable

The UI should provide a pre-export checklist.

Example:

```text
✓ 200/200 frames present
✓ 200/200 ground truths complete
✓ 200/200 valid sample IDs
✓ Provenance complete
✓ OCR artifacts valid
✓ Schema valid
✓ No unresolved duplicate decisions

[ Export Dataset ]
```

Do not allow an accidental half-annotated dataset to masquerade as complete.

---

## 25. Data Quality Flags

Allow the researcher to flag unusual samples.

Examples:

```text
☐ Low quality frame
☐ Partially occluded
☐ Ambiguous author
☐ Ambiguous content
☐ Multiple UGC items
☐ UI-heavy
☐ Unusual layout
☐ Annotation uncertain
```

These flags should survive export.

They are valuable for later error analysis.

---

## 26. Filtering and Search

The researcher should be able to quickly filter samples by:

- annotation status
- platform
- source recording
- accepted/rejected
- duplicate
- text density
- visual density
- UGC type
- quality flags

A simple search box should search sample IDs and annotation text.

---

## 27. Dataset Dashboard

A lightweight dashboard should answer:

> "Where am I in building this dataset?"

Show:

- total candidates
- unique candidates
- accepted samples
- rejected samples
- duplicates
- annotated samples
- remaining samples
- platform distribution
- UGC-type distribution
- metadata distribution

Do not turn this into an analytics-heavy dashboard.

The primary job remains annotation.

---

## 28. Research-Oriented Metadata

The tool should support metadata that makes later experiment analysis easier.

Useful dimensions:

```text
platform
ugcType
textDensity
visualDensity
hasMedia
hasContext
qualityFlag
sourceRecording
```

This enables later questions such as:

- Does OCR help more on text-heavy samples?
- Does model size matter more on image-heavy samples?
- Are media descriptions worse on video-heavy content?
- Does performance vary by platform?
- Are certain layouts disproportionately difficult?

The tool itself does not need to answer these questions.

It just needs to preserve the information.

---

## 29. Architecture

Prefer a simple architecture.

```text
React UI
   │
   ├── Dataset state
   ├── Recording/frame state
   ├── Annotation state
   ├── OCR state
   ├── Deduplication state
   └── Export state
        │
        ↓
Local persistence
        │
        ↓
Exportable dataset
```

Keep research data local by default.

Avoid requiring a backend for the initial version.

If browser storage becomes insufficient for large videos/images, introduce a local filesystem/desktop bridge only when necessary.

Do not introduce cloud storage unless explicitly required.

---

## 30. Suggested Component Structure

Possible structure:

```text
src/
├── app/
│   ├── App.tsx
│   └── routes/
├── components/
│   ├── DatasetDashboard/
│   ├── RecordingImporter/
│   ├── FrameGallery/
│   ├── FrameViewer/
│   ├── DeduplicationReview/
│   ├── AnnotationWorkspace/
│   ├── OCRPanel/
│   ├── MetadataPanel/
│   ├── ProgressBar/
│   ├── KeyboardShortcuts/
│   └── ExportDialog/
├── domain/
│   ├── dataset.ts
│   ├── recording.ts
│   ├── frame.ts
│   ├── sample.ts
│   ├── annotation.ts
│   ├── ocr.ts
│   └── schema.ts
├── services/
│   ├── frameSampling.ts
│   ├── ocr.ts
│   ├── deduplication.ts
│   ├── persistence.ts
│   └── export.ts
├── hooks/
├── utils/
└── styles/
```

Keep domain models independent from UI components.

---

## 31. Deduplication Service

Deduplication should be implemented as a replaceable service.

Example interface:

```ts
type SimilarityResult = {
  frameId: string;
  similarTo: string;
  distance: number;
};

interface DeduplicationStrategy {
  compare(frames: Frame[]): Promise<SimilarityResult[]>;
}
```

Start simple.

A perceptual-hash approach is sufficient for the first implementation.

Do not prematurely implement image embeddings.

---

## 32. Frame Sampling Service

Frame extraction should also be isolated from the UI.

Conceptually:

```ts
type SamplingOptions = {
  intervalSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
};

extractFrames(
  recording: File,
  options: SamplingOptions
): Promise<Frame[]>
```

If browser constraints make direct video processing awkward, make the service boundary explicit so a Python/CLI extractor can later be substituted.

---

## 33. OCR Service

OCR should likewise be isolated from the UI.

Conceptually:

```ts
type OcrOptions = {
  language?: string;
  // Additional Tesseract configuration as needed.
};

type OcrResult = {
  text: string;
  engine: "tesseract";
  version?: string;
  language?: string;
  generatedAt: string;
};

runOcr(
  frame: Frame,
  options?: OcrOptions
): Promise<OcrResult>
```

The service should:

- operate on frames
- return structured OCR artifacts
- preserve raw output
- expose enough provenance for reproducibility
- avoid modifying ground truth
- remain replaceable if OCR implementation changes later

---

## 34. Persistence

The app should persist work locally.

Preferred progression:

### MVP

Local React state + browser persistence.

### Larger dataset

IndexedDB.

### Future

Optional local filesystem/Desktop integration.

Never make cloud persistence a prerequisite for the core workflow.

---

## 35. Privacy

This application handles real social-media content.

Design accordingly.

Requirements:

- local-first by default
- no automatic upload
- no external analytics
- no telemetry
- no third-party image hosting
- no unnecessary network requests
- make export explicit
- avoid retaining raw recordings longer than needed

The dataset may contain usernames, profile photos, comments, or other personally identifiable information.

The researcher should be able to redact or exclude sensitive samples.

The tool should not encourage collecting DMs or private content.

Use the researcher's own/publicly accessible feed context as appropriate to the research protocol.

---

## 36. UI / Visual Design

The UI should feel like a **serious research workstation with a little personality**, not an enterprise CRUD application.

Desired characteristics:

- excellent typography
- large image previews
- strong visual hierarchy
- minimal chrome
- subtle borders
- restrained color palette
- clear focus states
- generous spacing
- compact metadata controls
- obvious progress
- responsive layout

The fieldwork metaphor may appear subtly through terminology, empty states, headings, or provenance presentation, but the interface should remain immediately understandable.

Avoid:

- dashboard-card overload
- giant gradients
- excessive rounded rectangles
- unnecessary animations
- excessive modal dialogs
- tiny form controls
- dense spreadsheet-like tables as the primary annotation interface
- decorative "fieldwork" UI that interferes with annotation

The annotation screen is the heart of the product.

---

## 37. UX Principle: "Don't Make Me Think"

The researcher already has to inspect and transcribe the content.

The tool should handle the administrative burden.

Good:

```text
[frame] → [annotate] → [Save & Next]
```

Bad:

```text
open sample
→ choose edit mode
→ open metadata tab
→ open annotation tab
→ save
→ confirm
→ navigate back
→ select next sample
```

Every unnecessary click becomes expensive at 200+ samples.

---

## 38. UX Principle: Preserve Researcher Attention

The application should minimize context switching.

The researcher should not need:

- a separate image viewer
- a spreadsheet
- a text editor
- a file manager
- a Python script
- a terminal

for normal annotation.

The application is essentially a specialized research cockpit.

The ideal interaction should feel continuous:

```text
see
→ inspect
→ annotate
→ verify
→ save
→ continue
```

---

## 39. Error Handling

Errors should be understandable.

Bad:

```text
Error: DOMException 0x80004005
```

Better:

```text
This video could not be decoded in the browser.

Try extracting frames with the project's frame-extraction script and import the images instead.
```

Always provide a recovery path.

Errors involving research data should clearly distinguish:

- what failed
- whether data was lost
- what remains available
- what the researcher can do next

Never silently discard source frames or annotations.

---

## 40. Performance

The application may handle hundreds or thousands of candidate frames.

Therefore:

- virtualize large galleries if necessary
- generate thumbnails
- lazy-load full-resolution images
- avoid decoding every full-resolution frame simultaneously
- keep annotation transitions fast
- debounce expensive searches
- perform deduplication asynchronously where possible
- avoid rerunning OCR unnecessarily
- avoid recomputing expensive derived metadata on every keystroke

The researcher should not wait several seconds after every annotation.

---

## 41. Testing

Prioritize tests around research integrity.

Important tests:

### Data model

- required fields
- schema version
- serialization/deserialization
- multi-item compatibility

### Annotation

- autosave
- Save & Next
- undo
- navigation
- incomplete annotation handling
- OCR insertion does not overwrite existing ground truth

### OCR

- OCR artifacts remain separate from ground truth
- OCR provenance survives persistence
- changing OCR configuration does not silently overwrite prior results

### Deduplication

- obvious duplicate frames are grouped
- distinct frames remain distinct
- manual override works
- suppressed frames can be restored

### Export

- JSONL is valid
- all referenced images exist
- OCR artifacts are valid
- manifest is valid
- incomplete datasets are clearly flagged

### Provenance

- source recording and timestamp survive export
- sample IDs remain stable
- frame filenames remain traceable

---

## 42. Development Strategy

Build in small vertical slices.

### Slice 1 — Annotation prototype

Implement:

```text
Import images
    ↓
gallery
    ↓
open frame
    ↓
annotate content/author/mediaDescription
    ↓
Save & Next
    ↓
local persistence
```

This is the most important proof of concept.

### Slice 2 — Dataset management

Add:

```text
dataset
    ↓
sample IDs
    ↓
metadata
    ↓
progress
    ↓
filtering
```

### Slice 3 — OCR

Add:

```text
frame
    ↓
Tesseract OCR
    ↓
OCR panel
    ↓
Insert into Content
```

### Slice 4 — Deduplication

Add:

```text
candidate frames
    ↓
perceptual similarity
    ↓
duplicate review
```

### Slice 5 — Recording/frame extraction

Add:

```text
video
    ↓
sampled frames
    ↓
OCR
```

### Slice 6 — Export

Add:

```text
images + annotations.jsonl + ocr.jsonl + manifest.json
    ↓
ZIP
```

### Slice 7 — Polish

Add:

- keyboard shortcuts
- command palette if useful
- better progress indicators
- quality flags
- refined visual design

Do not begin by building the entire architecture.

Get one annotation loop feeling excellent first.

---

## 43. MVP Definition

The MVP is successful if the researcher can:

1. import a set of screenshots
2. generate Tesseract OCR alongside frames
3. browse them quickly
4. accept/reject samples
5. use OCR as an optional starting point for manual ground truth
6. attach metadata
7. save automatically
8. move to the next sample with one action
9. recover work after reload
10. export valid JSONL + images + OCR artifacts
11. know exactly which source frame produced each sample
12. preserve source recording and timestamp provenance

Video extraction and sophisticated deduplication can follow if they threaten the MVP timeline.

---

## 44. Explicit Non-Goals

Do **NOT** build:

- social-media scraping
- automated account login
- feed crawling
- automatic dataset generation without researcher review
- VLM inference
- model benchmarking
- BLEU/WER/CER evaluation
- statistical experiment analysis
- cloud dataset hosting
- user accounts/authentication
- multi-user collaboration
- automated semantic labeling of ground truth
- AI-generated ground truth

Tesseract OCR **is** in scope.

Those other capabilities belong to other parts of the research pipeline.

Scrollnotes prepares the data used by those later systems.

---

## 45. Relationship to the VLM Experiment

The resulting dataset will later be used to evaluate configurations such as:

```text
Qwen3-VL 2B + no OCR
Qwen3-VL 2B + OCR
Qwen3-VL 4B + no OCR
Qwen3-VL 4B + OCR
Qwen3-VL 8B + no OCR
Qwen3-VL 8B + OCR
Qwen3-VL 32B + no OCR
Qwen3-VL 32B + OCR
```

The dataset builder should therefore keep:

- exact source frame
- human ground truth
- OCR artifact
- sample metadata
- stable sample ID
- provenance

separate from model outputs.

Later experiment outputs should be stored separately.

For example:

```text
dataset/
├── images/
├── annotations.jsonl
├── ocr.jsonl
└── manifest.json

experiments/
├── qwen3vl-2b-no-ocr/
├── qwen3vl-2b-ocr/
├── qwen3vl-4b-no-ocr/
├── qwen3vl-4b-ocr/
├── qwen3vl-8b-no-ocr/
├── qwen3vl-8b-ocr/
├── qwen3vl-32b-no-ocr/
└── qwen3vl-32b-ocr/
```

Do not mix ground truth with model predictions.

---

## 46. Golden Rule

**The human annotation is the ground truth.**

Do not let convenience features silently alter it.

AI-assisted annotation may be added in the future, but if it is ever introduced:

- it must be clearly labeled as a suggestion
- the original human annotation must remain recoverable
- the researcher must explicitly accept/edit it
- provenance must indicate that AI assistance was used

For the initial benchmark dataset, manual transcription is preferred because it makes the gold standard easier to defend methodologically.

---

## 47. Final Product Vision

The ideal experience is:

```text
I screen-record myself browsing social media,
potentially switching between platforms
            ↓
I import the recording.
            ↓
The tool samples frames.
            ↓
Tesseract extracts OCR alongside each frame.
            ↓
The tool identifies obvious near-duplicates.
            ↓
I quickly curate the remaining frames.
            ↓
For each useful frame, I see the image LARGE and its OCR.
            ↓
I use OCR as a starting point when useful.
            ↓
I correct/complete it into human ground truth.
            ↓
I verify the platform and tag a few useful metadata fields.
            ↓
I hit Save & Next.
            ↓
The next encounter is immediately ready.
            ↓
When I reach 200 samples:
            ↓
I click Export.
            ↓
I get a clean, reproducible benchmark dataset.
```

The product should make the researcher feel like they are **documenting a digital field site and building a corpus**, not filling out a form.

The fieldwork metaphor should make the research process feel coherent:

```text
social-media environment
        ↓
      scroll
        ↓
    encounter
        ↓
      trace
        ↓
    field note
        ↓
      corpus
```

But the interface should always prioritize speed, clarity, provenance, and research integrity over metaphor.