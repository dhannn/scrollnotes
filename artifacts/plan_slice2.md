# Scrollnotes — Slice 2 Implementation Plan: Dataset Management

> **Goal:** Expand Scrollnotes with dataset-level controls, structured UGC sample metadata, multi-dimensional search and filtering, stable sample ID configuration, and rich fieldwork progress tracking against target research goals.

---

## 1. Scope & Architecture

Slice 2 implements the dataset management and metadata layer defined in [AGENTS.md §8.1, §14, §15, §42](file:///c:/Users/12131369/Desktop/thinking-pod/scratchpad/scrollnotes/AGENTS.md#L337-L358):

```text
Dataset Configuration (name, version, description, target goal, lifecycle)
        ↓
Stable Sample IDs (prefix, collision check, provenance preservation)
        ↓
Structured Metadata (UGC type, text/visual density, feature tags, review flags)
        ↓
Progress Tracking (target progress, platform distribution, autosave indicator)
        ↓
Multi-Dimensional Gallery Filtering (full-text search, platform, status, flags, sorting)
```

---

## 2. Technical Stack & Data Model Additions

### 2.1 Types (`src/types/schema.ts`)
- **`DatasetLifecycleStatus`**: `'draft' | 'curating' | 'annotating' | 'ready' | 'exported'`
- **`UGCType`**: `'original-post' | 'comment' | 'reply' | 'quoted-post' | 'repost' | 'story-reel' | 'standalone' | 'unknown'`
- **`DensityLevel`**: `'low' | 'medium' | 'high'`
- **`SampleMetadata`** (frame-level; describes the sample as a whole):
  - `ugcType`: `UGCType`
  - `textDensity`: `DensityLevel`
  - `visualDensity`: `DensityLevel`
  - `isFlaggedForReview`: boolean
- **`GroundTruthItem`** (UGC item-level; one entry per visible UGC object):
  - `hasMedia`: boolean (whether **this** UGC item contains visual media)
  - `hasAuthor`: boolean (whether an author handle is visible for **this** item)
  - Note: `hasMedia`/`hasAuthor` must never be lifted onto `SampleMetadata`, because a single frame can contain an image post **and** a text-only reply.
- **`DatasetInfo`**:
  - `id`: `'default'`
  - `name`: string (e.g., `"Social Media UGC Benchmark"`)
  - `version`: string (e.g., `"v0.1"`)
  - `description`: string
  - `targetCount`: number (e.g., `200`)
  - `lifecycleStatus`: `DatasetLifecycleStatus`
  - `sampleIdPrefix`: string (e.g., `"ugc"`)
  - `createdAt`: string, `updatedAt`: string
- **`SessionStats`**:
  - `total`, `annotated`, `pending`, `rejected`, `skipped`, `flagged`
  - `targetCount`, `targetProgressPercent`
  - `platformCounts`: `Record<Platform, number>`

---

## 3. Key Components & Deliverables

### 3.1 Dataset Configuration Modal (`src/components/DatasetSettingsModal.tsx`)
- Form to edit Dataset Name, Version, Description, Target Sample Goal (e.g., 200 samples), and Sample ID Prefix.
- Visual lifecycle selector (`Draft` ➔ `Curating` ➔ `Annotating` ➔ `Ready` ➔ `Exported`).
- Persisted to IndexedDB `dataset_info` store.

### 3.2 Enhanced Ground Truth Form & Metadata Cockpit (`src/components/GroundTruthForm.tsx`)
- **Metadata Section**:
  - UGC Type chip selector (`Post`, `Comment`, `Reply`, `Story/Reel`, `Quote`, `Standalone`).
  - Text Density (`low` | `medium` | `high`) & Visual Density (`low` | `medium` | `high`) button groups.
  - Per-item attribute chips (rendered inside each UGC item block): `📷 media` (`hasMedia`), `👤 author` (`hasAuthor`).
  - **Flag for Review** toggle (`🚩`) for samples needing verification.
- **Autosave Indicator**: Subtle real-time feedback (`✓ Saved locally` / `Editing`).

### 3.3 Multi-Dimensional Search & Filtering in Gallery (`src/components/EncounterGallery.tsx`)
- **Live Search Input**: Instant debounced search querying transcription text, author handles, sample IDs, and filenames.
- **Platform Filter Pills**: Filter by Instagram, TikTok, Reddit, X, YouTube, Threads, Facebook, Other.
- **Status Filter Pills**: Filter by All, Pending, Curated, Skipped, Rejected, and Flagged.
- **Sort Dropdown**: Sort by Import Order, Sample ID, Platform, or Status.
- **Platform Distribution Bar**: Live badges showing count per platform across the session.

### 3.4 Enhanced Header (`src/components/Header.tsx`)
- Displays Dataset Title, Version, and Lifecycle badge (`Annotating`).
- 1-click Dataset Settings trigger button.
- Target Benchmark progress indicator (`12 / 200 Target`).

### 3.5 Card Badges (`src/components/EncounterCard.tsx`)
- Visual display of review flags (`🚩`), UGC types (`comment`, `post`), and density tags directly on gallery cards.

---

## 4. Verification & Testing

- Automated verification suite (`src/test/verifySlice2.ts`) verifying:
  - Dataset metadata persistence & defaults.
  - Multi-criteria filtering (search text, platform, status, review flags).
  - Target progress and platform breakdown calculations.
  - Sample ID stability and structured metadata updating.
- Production build validation (`npm run build`).
