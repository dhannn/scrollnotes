export type Platform =
  | 'instagram'
  | 'tiktok'
  | 'reddit'
  | 'x'
  | 'youtube'
  | 'facebook'
  | 'threads'
  | 'other';

export type EncounterStatus = 'pending' | 'annotated' | 'rejected' | 'skipped';

export type DatasetLifecycleStatus =
  | 'draft'
  | 'curating'
  | 'annotating'
  | 'ready'
  | 'exported';

export type UGCType =
  | 'original-post'
  | 'comment'
  | 'reply'
  | 'quoted-post'
  | 'repost'
  | 'story-reel'
  | 'standalone'
  | 'unknown';

export type DensityLevel = 'low' | 'medium' | 'high';

export type GroundTruthItemRole =
  | 'post'
  | 'comment'
  | 'reply'
  | 'quoted-post'
  | 'card'
  | 'standalone';

export interface GroundTruthItem {
  id: string;
  role: GroundTruthItemRole;
  orderIndex: number; // 0 = topmost in frame, 1 = second, etc.
  content: string;
  author: string;
  mediaDescription: string;
  hasMedia: boolean; // UGC-level property (e.g. image post vs text reply)
  hasAuthor: boolean; // UGC-level property (e.g. visible author handle vs anonymous)
}

export interface SampleContext {
  type?: UGCType;
  threadDepth?: number;
}

export interface SampleMetadata {
  ugcType?: UGCType;
  textDensity?: DensityLevel;
  visualDensity?: DensityLevel;
  hasContext?: boolean;
  isFlaggedForReview?: boolean;
  /**
   * AGENTS §25 — data quality flags. They survive export so later error analysis can
   * filter them out. The annotation UI for these lands in Slice 7; the field is optional
   * so every existing sample remains valid.
   */
  qualityFlags?: QualityFlag[];
}

/**
 * AGENTS §25 — researcher-applied flags describing unusual or hard samples.
 * Deliberately descriptive of *the artifact*, not of the person depicted.
 */
export type QualityFlag =
  | 'low-quality-frame'
  | 'partially-occluded'
  | 'ambiguous-author'
  | 'ambiguous-content'
  | 'multiple-ugc-items'
  | 'ui-heavy'
  | 'unusual-layout'
  | 'annotation-uncertain';

export const QUALITY_FLAG_LABELS: Record<QualityFlag, string> = {
  'low-quality-frame': 'Low quality frame',
  'partially-occluded': 'Partially occluded',
  'ambiguous-author': 'Ambiguous author',
  'ambiguous-content': 'Ambiguous content',
  'multiple-ugc-items': 'Multiple UGC items',
  'ui-heavy': 'UI-heavy',
  'unusual-layout': 'Unusual layout',
  'annotation-uncertain': 'Annotation uncertain',
};

export interface Provenance {
  recordingId?: string;
  frameFilename: string;
  timestampMs?: number;
  importedAt: string;
}

export interface EncounterSample {
  sampleId: string;
  frameId: string;
  platform: Platform;
  items: GroundTruthItem[]; // First-class multi-item array
  status: EncounterStatus;
  context?: SampleContext;
  metadata?: SampleMetadata;
  notes?: string;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}

export interface FrameRecord {
  id: string;
  filename: string;
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  importedAt: string;
}

export interface DatasetInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  targetCount: number;
  lifecycleStatus: DatasetLifecycleStatus;
  sampleIdPrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStats {
  total: number;
  totalItems: number;
  annotated: number;
  pending: number;
  rejected: number;
  skipped: number;
  flagged: number;
  progressPercent: number;
  targetCount: number;
  targetProgressPercent: number;
  platformCounts: Record<Platform, number>;
}

// ============================================================================
// Slice 3 — OCR Preprocessing
// OCR is preprocessing evidence, never ground truth.
// ============================================================================

export type OcrEngine = 'tesseract';

/** Immutable OCR evidence attached to a FRAME (never to human ground truth). */
export interface OcrArtifact {
  frameId: string;
  engine: OcrEngine;
  /** Raw output preserved exactly as generated. */
  text: string;
  /** OCR language, e.g. 'eng'. */
  language: string;
  /** Recorded only when the engine actually exposes it (never invented). */
  engineVersion?: string;
  /** tesseract.js wrapper package version. */
  wrapperVersion?: string;
  /** Mean confidence 0..100 when reported by the engine. */
  confidence?: number;
  /** ISO timestamp — provenance for reproducibility. */
  generatedAt: string;
}

export type OcrPhase = 'idle' | 'running' | 'done' | 'error';

export interface OcrStatus {
  frameId: string | null;
  phase: OcrPhase;
  progressMessage?: string;
  /** 0..1 overall progress where available. */
  progress?: number;
  error?: string;
}

/** Explicit researcher decision when OCR text is written into a content field. */
export type OcrInsertMode = 'replace' | 'append';

// ============================================================================
// Slice 4 — Perceptual Deduplication
// Deduplication decisions are reversible and never delete source frames.
// ============================================================================

export type HashAlgorithm = 'phash' | 'dhash' | 'ahash';

export type DedupRole = 'unique' | 'representative' | 'duplicate';

export interface FrameHash {
  frameId: string;
  /** hex string, hashSize * hashSize bits */
  hash: string;
  algorithm: HashAlgorithm;
  /** default 8 → 64-bit hash */
  hashSize: number;
  computedAt: string;
}

/** One reversible deduplication decision per frame. */
export interface DedupRecord {
  frameId: string;
  hash: string;
  algorithm: HashAlgorithm;
  hashSize: number;
  /** undefined ⇒ ungrouped / not yet hashed */
  groupId?: string;
  role: DedupRole;
  /** set when role === 'duplicate' */
  representativeFrameId?: string;
  /** true ⇒ researcher decision, not raw algorithm output */
  overridden: boolean;
  computedAt: string;
}

export interface DuplicateGroup {
  groupId: string;
  frameIds: string[];
  representativeFrameId: string;
  /** worst hamming distance inside the group */
  maxDistance: number;
}

export interface DedupConfig {
  id: 'default';
  algorithm: HashAlgorithm;
  /** hamming distance threshold (default 8; conservative) */
  threshold: number;
  /** default 8 → 64-bit hash */
  hashSize: number;
  lastRunAt?: string;
}

export type DedupPhase = 'idle' | 'hashing' | 'grouping' | 'done' | 'error';

export interface DedupStatus {
  phase: DedupPhase;
  processed: number;
  total: number;
  error?: string;
}

export interface DedupStats {
  hashed: number;
  groups: number;
  representatives: number;
  duplicates: number;
  unique: number;
  /** number of frames suppressed by deduplication */
  suppressedSavings: number;
}

export type DedupFilterOption = 'all' | DedupRole;

// ============================================================================
// Slice 5 — Field Session / Source Recording
// A recording is a PROVENANCE CONTAINER. It deliberately has no platform field:
// platform belongs to the individual sample/encounter (AGENTS §5, §8.2).
// ============================================================================

export interface RecordingRecord {
  /** e.g. "rec-0001" — stable, human-readable, used in frame filenames. */
  recordingId: string;
  filename: string;
  /** Probed from the browser media API. Omitted when it cannot be read. */
  durationMs?: number;
  sizeBytes?: number;
  /** Optional researcher metadata, e.g. "text-heavy session". */
  researcherLabel?: string;
  description?: string;
  importedAt: string;
}

export interface SamplingConfig {
  /** >= 0.1; default 1.0 */
  intervalSeconds: number;
  /** >= 0; default 0 */
  startSeconds: number;
  /** Omitted ⇒ sample to the end of the recording. */
  endSeconds?: number;
  /** default 'image/png' — lossless input measurably helps Tesseract. */
  outputFormat: 'image/png' | 'image/jpeg';
  /** 0..1, JPEG only; ignored when outputFormat is 'image/png'. */
  quality: number;
  /** Hard cap so a mis-typed interval cannot flood the corpus. */
  maxFrames: number;
}

export type ExtractionRunStatus = 'running' | 'done' | 'error' | 'cancelled';

/**
 * One sampling attempt against one recording. Persisted so the manifest (Slice 6)
 * can report exactly which settings produced the corpus.
 */
export interface ExtractionRun {
  runId: string;
  recordingId: string;
  sampling: SamplingConfig;
  /** Timestamps actually captured, in ms — the reproducible sampling grid. */
  timestampsMs: number[];
  /** Parallel to timestampsMs. */
  frameIds: string[];
  frameCount: number;
  startedAt: string;
  completedAt?: string;
  status: ExtractionRunStatus;
  /** Human-readable failure summary (never a raw DOMException). */
  error?: string;
  /** Non-fatal issues: skipped frames, truncation, decode warnings. */
  warnings?: string[];
}

export type ExtractionPhase =
  | 'idle'
  | 'probing'
  | 'extracting'
  | 'persisting'
  | 'done'
  | 'error'
  | 'cancelled';

export interface ExtractionStatus {
  recordingId: string | null;
  phase: ExtractionPhase;
  processed: number;
  /** 0 until the sampling grid has been computed. */
  total: number;
  error?: string;
  warnings: string[];
}

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  intervalSeconds: 1.0,
  startSeconds: 0,
  outputFormat: 'image/png',
  quality: 0.92,
  maxFrames: 1200,
};


// ============================================================================
// Slice 6 — Corpus Export
// The exported bundle is the research artifact. Ground truth (annotations.jsonl)
// and OCR evidence (ocr.jsonl) are separate files by construction — they are
// never merged into one record, so a downstream script can never confuse a
// machine transcription for the human gold standard (AGENTS §8.3, §22).
// ============================================================================

/** Version of the on-disk export schema. Bumped when a field changes meaning. */
export const SCHEMA_VERSION = '1.0';

export const EXPORT_FILES = {
  annotations: 'annotations.jsonl',
  ocr: 'ocr.jsonl',
  manifest: 'manifest.json',
  readme: 'README.md',
  imagesDir: 'images',
} as const;

/** One curated sample, as written to `annotations.jsonl`. */
export interface ExportedAnnotation {
  sampleId: string;
  datasetId: string;
  datasetVersion: string;
  platform: Platform;
  /** Path to the image INSIDE the bundle, e.g. "images/ugc-000001.png". */
  image: string;
  /** Human ground truth. Authoritative. Never derived from OCR. */
  items: GroundTruthItem[];
  context?: SampleContext;
  metadata?: SampleMetadata;
  provenance: {
    recordingId?: string;
    sourceTimestampMs?: number;
    frameFilename: string;
    frameId: string;
    importedAt: string;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** One OCR artifact, as written to `ocr.jsonl`. Raw text preserved verbatim. */
export interface ExportedOcrRecord {
  sampleId: string;
  frameId: string;
  engine: OcrEngine;
  language: string;
  engineVersion?: string;
  wrapperVersion?: string;
  confidence?: number;
  /** Byte-for-byte the engine output. Never normalised, trimmed, or corrected. */
  text: string;
  generatedAt: string;
}

export type CheckSeverity = 'pass' | 'warn' | 'fail';

/** AGENTS §23 — everything needed to reconstruct how the corpus was produced. */
export interface ExportManifest {
  dataset: string;
  datasetId: string;
  datasetVersion: string;
  description: string;
  schemaVersion: string;
  generator: 'scrollnotes';
  exportedAt: string;
  sampleCount: number;
  ocrRecordCount: number;
  imageCount: number;
  /** Recording is provenance, never a platform category (§8.2). */
  sourceRecordings: {
    recordingId: string;
    filename: string;
    researcherLabel?: string;
    description?: string;
    importedAt: string;
    sampleCount: number;
    extractionRuns: {
      runId: string;
      status: ExtractionRunStatus;
      sampling: SamplingConfig;
      frameCount: number;
      startedAt: string;
      completedAt?: string;
      warnings?: string[];
    }[];
  }[];
  /** Verbatim sampling settings from the runs that produced these frames. */
  samplingSettings?: SamplingConfig[];
  deduplication: {
    method: HashAlgorithm;
    threshold: number;
    hashSize: number;
    lastRunAt?: string;
    /** Samples whose dedup role was manually overridden by the researcher. */
    overriddenSampleCount: number;
  };
  ocr: {
    engine: OcrEngine;
    /** Languages actually observed in the exported artifacts. */
    languages: string[];
    engineVersions?: string[];
  };
  annotation: {
    lifecycleStatus: DatasetLifecycleStatus;
    /** False when samples are still pending — prevents a half-annotated corpus from
     * masquerading as complete (§24). */
    annotationComplete: boolean;
    annotated: number;
    pending: number;
    rejected: number;
    skipped: number;
    flaggedForReview: number;
  };
  platformCounts: Record<string, number>;
  qualityFlagCounts: Record<string, number>;
  validation: {
    canExport: boolean;
    checks: ExportCheck[];
  };
}

/** A file staged in memory before the bundle is zipped or downloaded. */
export interface ExportFile {
  path: string;
  bytes: Uint8Array;
}

export type ExportFormat = 'zip' | 'jsonl' | 'csv';
/** One line of the pre-export checklist (AGENTS §24). */
export interface ExportCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail: string;
  /** Affected samples, so a failure is actionable without re-scanning the gallery. */
  sampleIds?: string[];
}

export interface ExportValidation {
  /** canExport === false means at least one 'fail'. Warnings never block. */
  checks: ExportCheck[];
  canExport: boolean;
  counts: {
    exportable: number;
    pending: number;
    rejected: number;
    skipped: number;
    withOcr: number;
    withoutOcr: number;
    withRecordingProvenance: number;
    totalCandidates: number;
  };
}