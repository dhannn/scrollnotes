# Scrollnotes — Slice 1 Implementation Plan: Annotation Prototype

> **Goal:** Deliver a working, local-first annotation loop where a researcher can import visual social-media frames, inspect them in high detail, rapidly transcribe gold-standard human ground truth, advance with single-action efficiency (**Save & Next**), and persist all data reliably across browser reloads.

---

## 1. Scope & Architecture

Slice 1 focuses on the core human annotation workflow defined in [AGENTS.md §42](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L1665-L1685):

```text
Import images / screenshots
        ↓
Candidate encounter gallery
        ↓
Open frame & inspect
        ↓
Annotate ground truth (content / author / mediaDescription / platform)
        ↓
Save & Next (single-action advancement)
        ↓
Local persistence (IndexedDB)
```

---

## 2. Technical Stack & Foundation

- **Framework & Build:** React + TypeScript + Vite.
- **Styling:** Custom Vanilla CSS Design System with dark-mode optimized research palette, subtle glassmorphism, responsive grid layouts, and typography (`Inter` + `JetBrains Mono`).
- **Icons:** `lucide-react`.
- **Local Persistence:** `idb` (IndexedDB) storing image blobs, frame metadata, and human ground-truth annotations with zero storage quota limitations.

---

## 3. Data Schema & Model

Following [AGENTS.md §6 & §7](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L202-L332):

### 3.1 Data Types (`src/types/schema.ts`)
- **`Platform`**: `'instagram' | 'tiktok' | 'reddit' | 'x' | 'youtube' | 'facebook' | 'other'` (sample-level attribute).
- **`GroundTruthItem`**:
  - `content`: string (literal transcription, preserves linebreaks and formatting).
  - `author`: string (account handle or name, with helper for `"unknown"`).
  - `mediaDescription`: string (concise visual description of salient media without unsupported inferences).
  - `hasMedia`: boolean (UGC **item-level** property — e.g. an image post vs a text-only reply).
  - `hasAuthor`: boolean (UGC **item-level** property — e.g. a visible author handle vs anonymous content).
- **`EncounterSample`**:
  - `sampleId`: string (stable unique identifier, e.g. `ugc-000001`).
  - `frameId`: string (associated frame identifier).
  - `platform`: `Platform`.
  - `items`: `GroundTruthItem[]` (multi-item compatible array; default UI focuses on primary item `items[0]`).
  - `status`: `'pending' | 'annotated' | 'rejected' | 'skipped'`.
  - `metadata`: `{ ugcType?: UGCType; textDensity?: 'low' | 'medium' | 'high'; visualDensity?: 'low' | 'medium' | 'high'; isFlaggedForReview?: boolean }` (frame-level; `hasMedia`/`hasAuthor` deliberately live on each `GroundTruthItem` instead, and text-heaviness is derived from `textDensity` rather than a separate flag).
  - `provenance`: `{ recordingId?: string; frameFilename: string; timestampMs?: number; importedAt: string }`.
  - `createdAt`: string;
  - `updatedAt`: string;
- **`Frame`**:
  - `id`: string.
  - `filename`: string.
  - `dataUrl`: string (or Blob URL).
  - `width`: number; `height`: number.
  - `importedAt`: string.

---

## 4. Components & Views

### 4.1 Navigation & Header
- **Field Session Header**: Shows current dataset metrics (e.g. `14 / 50 Curated`, progress bar, status filter badges).
- Mode toggle: **Gallery View** ⇄ **Annotation Cockpit**.

### 4.2 Image Ingestion & Ingest Hub
- Drag-and-drop / file browser image importer (supports `.png`, `.jpg`, `.jpeg`, `.webp`).
- **"Load Fieldwork Sample Batch"**: One-click instant population of realistic mock social-media screenshots for immediate evaluation and workflow testing.

### 4.3 Candidate Encounter Gallery
- Grid view of extracted frames with quick visual status indicators (Pending, Curated, Rejected, Skipped).
- Quick keyboard-driven gallery navigation.
- Filter by status (`All`, `Pending`, `Curated`, `Skipped`, `Rejected`).
- Bulk actions & individual card click to enter Annotation Cockpit.

### 4.4 Annotation Cockpit (The Core Workstation)
- **Visual Stage**: High-resolution image canvas with zoom (+ / - / reset / 1:1), panning, and high-contrast view toggle.
- **Ground Truth Editor**:
  - `Platform Selector`: 1-click pill buttons for major platforms (Instagram, TikTok, Reddit, X, YouTube, Facebook, Other).
  - `Content Field`: Whitespace-preserving transcription textarea with Monospace toggle for verbatim transcription.
  - `Author Field`: Free-text field with 1-click `"unknown"` chip.
  - `Media Description Field`: Free-text field with explanatory guide ("Describe salient visual elements; do not infer hidden intent or emotion").
- **Workflow & Keyboard Shortcuts**:
  - Primary CTA: **Save & Next** (`Cmd+Enter` / `Ctrl+Enter`).
  - Previous (`←` or `Ctrl+[`), Next (`→` or `Ctrl+]`).
  - Quick Mark: Accept (`A`), Reject (`R`), Skip (`S`).
  - Monospace toggle (`Ctrl+M`).

---

## 5. Local-First Persistence Layer

- IndexedDB store (`scrollnotes_db`) managing:
  - `frames`: stores binary frame blobs / URLs and file dimensions.
  - `encounters`: stores ground truth annotations, platform tags, metadata, and status.
  - `session_meta`: stores current active sample pointer and dataset statistics.
- Automatic debounce-autosave as the researcher types, ensuring zero data loss on accidental navigation or reload.

---

## 6. Implementation Steps

1. **Step 1: Project Setup & Build Config**:
   - Initialize Vite + React + TypeScript configuration.
   - Install dependencies (`lucide-react`, `idb`).
   - Setup styling foundation (`index.css`) with theme variables and reset.
2. **Step 2: Schema & DB Service**:
   - Create schema definitions in `src/types/`.
   - Implement IndexedDB wrapper in `src/services/db.ts`.
   - Implement sample dataset generator for fast testing in `src/services/sampleData.ts`.
3. **Step 3: State Management & Hooks**:
   - Create `useFieldSession` hook for global dataset state, progress calculation, and persistence coordination.
4. **Step 4: Image Ingest & Gallery Components**:
   - Build `Dropzone` / file loader component.
   - Build `EncounterGallery` and `EncounterCard` with status badges.
5. **Step 5: Annotation Cockpit & Controls**:
   - Build `AnnotationCockpit` with responsive split view (Image Viewer on left, Ground Truth Form on right).
   - Implement image inspection tools (zoom/pan).
   - Implement ground truth inputs with exact transcription helpers.
   - Implement global keyboard shortcuts.
6. **Step 6: Verification & Polish**:
   - Test image loading, annotation creation, and local persistence across reload.
   - Verify keyboard workflow responsiveness.
