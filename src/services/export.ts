import { SCHEMA_VERSION, EXPORT_FILES } from '../types/schema';
import type {
  DatasetInfo,
  EncounterSample,
  ExportedAnnotation,
  ExportedOcrRecord,
  ExportFile,
  ExportManifest,
  FrameRecord,
  OcrArtifact,
  DedupConfig,
  DedupRecord,
  RecordingRecord,
  ExtractionRun,
  ExportValidation,
} from '../types/schema';
import { summariseQualityFlags, validateForExport } from './exportValidation';
import { dataUrlToBytes, extensionForMime } from './zip';
import type { ZipEntry } from './zip';

/**
 * Corpus export (Slice 6)
 * ----------------------
 * Pure serializers that turn the working session into the benchmark bundle described in
 * AGENTS section 22:
 *
 *     dataset/
 *       images/<sampleId>.<ext>
 *       annotations.jsonl   <- human ground truth (authoritative)
 *       ocr.jsonl           <- raw Tesseract output (evidence)
 *       manifest.json       <- section 23 reproducibility record
 *       README.md
 *
 * TWO INVARIANTS DOMINATE THIS FILE:
 *
 * 1. Ground truth and OCR are emitted to SEPARATE FILES with separate schemas. They are
 *    never merged, so a downstream script cannot mistake a machine transcription for the
 *    human gold standard (section 8.3).
 * 2. OCR text is copied byte-for-byte. No trimming, no whitespace normalisation, no
 *    "cleaning"; the artifact must stay reproducible (section 8.3).
 *
 * Everything here is DOM-free and therefore unit-testable in Node.
 */

const encoder = new TextEncoder();

/**
 * The samples that belong in the benchmark corpus.
 *
 * Only annotated ones ship (section 8.3). Rejected, skipped and pending candidates remain
 * in the working dataset; export never deletes or hides them, it simply excludes them.
 */
export function selectExportableSamples(encounters: EncounterSample[]): EncounterSample[] {
  return encounters
    .filter((encounter) => encounter.status === 'annotated')
    .sort((a, b) => (a.sampleId < b.sampleId ? -1 : a.sampleId > b.sampleId ? 1 : 0));
}

/** Path of a sample's image INSIDE the bundle. Stable, and derived from the sample id. */
export function imagePathForSample(sampleId: string, mimeType?: string): string {
  return `${EXPORT_FILES.imagesDir}/${sampleId}.${extensionForMime(mimeType)}`;
}

/**
 * Build the annotations.jsonl record for one curated sample.
 *
 * `image` points at the file inside the bundle so the export is self-describing.
 * Provenance is flattened to explicit recordingId / sourceTimestampMs keys, which is what
 * section 21 promises an auditor can find.
 */
export function buildAnnotationRecord(
  encounter: EncounterSample,
  dataset: DatasetInfo,
  imagePath: string
): ExportedAnnotation {
  return {
    sampleId: encounter.sampleId,
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    platform: encounter.platform,
    image: imagePath,
    items: encounter.items,
    ...(encounter.context ? { context: encounter.context } : {}),
    ...(encounter.metadata ? { metadata: encounter.metadata } : {}),
    provenance: {
      ...(encounter.provenance.recordingId
        ? { recordingId: encounter.provenance.recordingId }
        : {}),
      ...(typeof encounter.provenance.timestampMs === 'number'
        ? { sourceTimestampMs: encounter.provenance.timestampMs }
        : {}),
      frameFilename: encounter.provenance.frameFilename,
      frameId: encounter.frameId,
      importedAt: encounter.provenance.importedAt,
    },
    ...(encounter.notes ? { notes: encounter.notes } : {}),
    createdAt: encounter.createdAt,
    updatedAt: encounter.updatedAt,
  };
}

/**
 * Build the ocr.jsonl record for one sample.
 *
 * `text` is passed through untouched. Optional engine metadata is omitted rather than
 * defaulted, because section 8.3 says to omit unknown provenance instead of inventing it.
 */
export function buildOcrRecord(
  encounter: EncounterSample,
  artifact: OcrArtifact
): ExportedOcrRecord {
  return {
    sampleId: encounter.sampleId,
    frameId: artifact.frameId,
    engine: artifact.engine,
    language: artifact.language,
    ...(artifact.engineVersion ? { engineVersion: artifact.engineVersion } : {}),
    ...(artifact.wrapperVersion ? { wrapperVersion: artifact.wrapperVersion } : {}),
    ...(typeof artifact.confidence === 'number' ? { confidence: artifact.confidence } : {}),
    text: artifact.text,
    generatedAt: artifact.generatedAt,
  };
}

/** One JSON object per line, newline-terminated, with a single trailing newline. */
export function toJsonl(records: unknown[]): string {
  if (records.length === 0) return '';
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

export function buildAnnotationsJsonl(records: ExportedAnnotation[]): string {
  return toJsonl(records);
}

export function buildOcrJsonl(records: ExportedOcrRecord[]): string {
  return toJsonl(records);
}

/**
 * RFC 4180 field quoting.
 *
 * Ground truth content is free text: it routinely contains commas, double quotes and hard
 * line breaks. Quoting must survive all of them, otherwise the CSV silently shifts columns
 * for exactly the samples a researcher cared most about.
 */
export function csvField(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',');
}
/**
 * Flat, one-row-per-sample CSV for spreadsheet inspection.
 *
 * This is a convenience view, NOT the benchmark format: multi-item samples are collapsed
 * into their first item's fields and JSONL remains authoritative (section 22).
 */
export function buildAnnotationsCsv(records: ExportedAnnotation[]): string {
  const header = csvRow([
    'sampleId',
    'platform',
    'image',
    'content',
    'author',
    'mediaDescription',
    'itemCount',
    'ugcType',
    'textDensity',
    'visualDensity',
    'qualityFlags',
    'recordingId',
    'sourceTimestampMs',
    'frameFilename',
  ]);

  const rows = records.map((record) => {
    const primary = record.items[0];
    return csvRow([
      record.sampleId,
      record.platform,
      record.image,
      primary?.content ?? '',
      primary?.author ?? '',
      primary?.mediaDescription ?? '',
      record.items.length,
      record.metadata?.ugcType ?? '',
      record.metadata?.textDensity ?? '',
      record.metadata?.visualDensity ?? '',
      record.metadata?.qualityFlags ?? [],
      record.provenance.recordingId ?? '',
      record.provenance.sourceTimestampMs ?? '',
      record.provenance.frameFilename,
    ]);
  });

  return [header, ...rows].join('\n') + '\n';
}

/** Count a dimension across the exported samples, skipping absent values. */
function countBy<T extends string>(
  samples: EncounterSample[],
  pick: (sample: EncounterSample) => T | undefined
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    const key = pick(sample);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export interface ManifestInput {
  dataset: DatasetInfo;
  /** Samples that actually shipped, in export order. */
  samples: EncounterSample[];
  ocrArtifacts: OcrArtifact[];
  validation: ExportValidation;
  dedupConfig: DedupConfig;
  dedupRecords: Map<string, DedupRecord>;
  recordings: RecordingRecord[];
  extractionRuns: ExtractionRun[];
  exportedAt: string;
}

/**
 * Build manifest.json (AGENTS section 23).
 *
 * This is the reproducibility contract: enough to reconstruct how the corpus came to be.
 * Two rules shape the output:
 *
 * - A recording is a PROVENANCE CONTAINER, so sourceRecordings carries no platform field.
 *   Platform counts come from sample-level metadata instead (sections 5 and 14).
 * - Unknown values are omitted, never defaulted. engineVersion and lastRunAt simply do not
 *   appear when the engine did not report them (section 8.3).
 */
export function buildManifest(input: ManifestInput): ExportManifest {
  const {
    dataset,
    samples,
    ocrArtifacts,
    validation,
    dedupConfig,
    dedupRecords,
    recordings,
    extractionRuns,
    exportedAt,
  } = input;
// Sampling settings, verbatim, deduplicated by run so the manifest reflects what was
  // actually executed rather than the current UI state.
  const samplingSettings = Array.from(
    new Map(
      extractionRuns
        .filter((run) => run.status === 'done')
        .map((run) => [JSON.stringify(run.sampling), run.sampling] as const)
    ).values()
  );

  const languages = Array.from(new Set(ocrArtifacts.map((a) => a.language))).sort();
  const engineVersions = Array.from(
    new Set(ocrArtifacts.map((a) => a.engineVersion).filter((v): v is string => !!v))
  ).sort();

  const flaggedForReview = samples.filter((sample) => sample.metadata?.isFlaggedForReview).length;

  // Only recordings that actually contributed a frame to this export are listed.
  const usedRecordingIds = new Set(
    samples.map((s) => s.provenance.recordingId).filter((id): id is string => !!id)
  );

  return {
    dataset: dataset.name,
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    description: dataset.description,
    schemaVersion: SCHEMA_VERSION,
    generator: 'scrollnotes',
    exportedAt,
    sampleCount: samples.length,
    ocrRecordCount: ocrArtifacts.length,
    imageCount: samples.length,
    sourceRecordings: recordings
      .filter((recording) => usedRecordingIds.has(recording.recordingId))
      .map((recording) => ({
        recordingId: recording.recordingId,
        filename: recording.filename,
        ...(recording.researcherLabel ? { researcherLabel: recording.researcherLabel } : {}),
        ...(recording.description ? { description: recording.description } : {}),
        importedAt: recording.importedAt,
        sampleCount: samples.filter((s) => s.provenance.recordingId === recording.recordingId)
          .length,
        extractionRuns: extractionRuns
          .filter((run) => run.recordingId === recording.recordingId)
          .map((run) => ({
            runId: run.runId,
            status: run.status,
            sampling: run.sampling,
            frameCount: run.frameCount,
            startedAt: run.startedAt,
            ...(run.completedAt ? { completedAt: run.completedAt } : {}),
            ...(run.warnings && run.warnings.length > 0 ? { warnings: run.warnings } : {}),
          })),
      })),
    ...(samplingSettings.length > 0 ? { samplingSettings } : {}),
    deduplication: {
      method: dedupConfig.algorithm,
      threshold: dedupConfig.threshold,
      hashSize: dedupConfig.hashSize,
      ...(dedupConfig.lastRunAt ? { lastRunAt: dedupConfig.lastRunAt } : {}),
      overriddenSampleCount: samples.filter((sample) => {
        const record = dedupRecords.get(sample.frameId);
        return !!record && record.overridden;
      }).length,
    },
    ocr: {
      engine: 'tesseract',
      languages,
      ...(engineVersions.length > 0 ? { engineVersions } : {}),
    },
    annotation: {
      lifecycleStatus: dataset.lifecycleStatus,
      // Section 24: a half-annotated corpus must not masquerade as complete.
      annotationComplete: validation.counts.pending === 0 && validation.counts.skipped === 0,
      annotated: validation.counts.exportable,
      pending: validation.counts.pending,
      rejected: validation.counts.rejected,
      skipped: validation.counts.skipped,
      flaggedForReview,
    },
    platformCounts: countBy(samples, (sample) => sample.platform),
    qualityFlagCounts: summariseQualityFlags(samples),
    validation: {
      canExport: validation.canExport,
      checks: validation.checks,
    },
  };
}
/**
 * A README for whoever opens the zip first, usually a future researcher or a script author.
 * It states the one rule that matters: annotations.jsonl is the ground truth and
 * ocr.jsonl is machine evidence.
 */
export function buildReadme(manifest: ExportManifest): string {
  const warnings = manifest.validation.checks.filter((check) => check.severity === 'warn');

  const lines = [
    `# ${manifest.dataset} ${manifest.datasetVersion}`,
    '',
    manifest.description || 'Curated social-media UGC corpus built with Scrollnotes.',
    '',
    `Exported: ${manifest.exportedAt}  `,
    `Schema version: ${manifest.schemaVersion}  `,
    `Samples: ${manifest.sampleCount}  `,
    `Images: ${manifest.imageCount}  `,
    `OCR records: ${manifest.ocrRecordCount}`,
    '',
    '## Contents',
    '',
    '```text',
    'dataset/',
    `|-- images/            ${manifest.imageCount} source frame image(s)`,
    '|-- annotations.jsonl  human ground truth - AUTHORITATIVE',
    '|-- ocr.jsonl          raw Tesseract output - auxiliary evidence',
    '|-- manifest.json      dataset, sampling, dedup and validation metadata',
    '|-- README.md',
    '```',
    '',
    '## Ground truth vs OCR',
    '',
    '`annotations.jsonl` holds the researcher-verified transcription. It is the gold',
    'standard. `ocr.jsonl` holds Tesseract output preserved exactly as generated: it is',
    'preprocessing evidence, never ground truth. The two are deliberately kept in separate',
    'files so they cannot be confused. Join them on `sampleId` to compare OCR quality',
    'against the human transcription.',
    '',
    '## Record shape',
    '',
    'One JSON object per line. Each annotation carries:',
    '',
    '```json',
    '{',
    '  "sampleId": "ugc-000001",',
    '  "platform": "instagram",',
    '  "image": "images/ugc-000001.png",',
    '  "items": [',
    '    { "role": "post", "content": "...", "author": "...", "mediaDescription": "..." }',
    '  ],',
    '  "metadata": { "ugcType": "original-post", "textDensity": "medium" },',
    '  "provenance": {',
    '    "recordingId": "rec-0001",',
    '    "sourceTimestampMs": 128400,',
    '    "frameFilename": "rec-0001_0128400.png"',
    '  }',
    '}',
    '```',
    '',
    '`hasMedia` and `hasAuthor` are UGC item-level properties, never frame-level: a frame',
    'may hold an image post and a text-only reply, and both values legitimately appear.',
    '',
    '## Provenance',
    '',
    'A recording is a provenance container, not a platform category. `platform` is a',
    'property of the individual sample and must never be inferred from the recording',
    'filename. Frames imported directly as pre-extracted images carry no `recordingId` or',
    '`sourceTimestampMs`; their `frameFilename` still traces them to the source image.',
    '',
    '## Validation at export time',
    '',
    ...(warnings.length === 0
      ? ['All checks passed when this corpus was exported.']
      : warnings.map((check) => `- **${check.label}** - ${check.detail}`)),
    '',
    manifest.annotation.annotationComplete
      ? 'All candidates had been curated when this corpus was exported.'
      : `**Annotation was NOT complete when this corpus was exported** (${manifest.annotation.pending} pending, ${manifest.annotation.skipped} skipped). Treat it as a partial corpus.`,
    '',
    '## Loading in Python',
    '',
    '```python',
    'import json',
    '',
    'with open("dataset/annotations.jsonl", encoding="utf-8") as f:',
    '    samples = [json.loads(line) for line in f if line.strip()]',
    '',
    'with open("dataset/ocr.jsonl", encoding="utf-8") as f:',
    '    ocr = {}',
    '    for line in f:',
    '        if line.strip():',
    '            rec = json.loads(line)',
    '            ocr[rec["sampleId"]] = rec["text"]',
    '',
    'for sample in samples:',
    '    image_path = "dataset/" + sample["image"]',
    '    gold = sample["items"][0]["content"]',
    '    print(sample["sampleId"], image_path, gold, ocr.get(sample["sampleId"]))',
    '```',
    '',
    '## Privacy',
    '',
    'This corpus contains real social-media content, which may include usernames, profile',
    'photos and comments. It was assembled locally and exported explicitly; nothing was',
    'uploaded. Handle it according to your research ethics protocol.',
    '',
  ];

  return lines.join('\n');
}
export interface BundleInput {
  dataset: DatasetInfo;
  encounters: EncounterSample[];
  frames: Map<string, FrameRecord>;
  ocrArtifacts: Map<string, OcrArtifact>;
  dedupConfig: DedupConfig;
  dedupRecords: Map<string, DedupRecord>;
  recordings: RecordingRecord[];
  extractionRuns: ExtractionRun[];
  exportedAt: string;
}

export interface ExportBundle {
  validation: ExportValidation;
  manifest: ExportManifest;
  /** The samples that actually made it into the bundle, in export order. */
  samples: EncounterSample[];
  annotations: ExportedAnnotation[];
  ocrRecords: ExportedOcrRecord[];
  /** Text files, ready to zip or download. */
  textFiles: ExportFile[];
  /** Decoded image bytes keyed by their in-bundle path. */
  images: { path: string; bytes: Uint8Array }[];
  /** Samples whose image could not be decoded, reported rather than silently dropped. */
  imageErrors: { sampleId: string; reason: string }[];
  /** Suggested filename stem, e.g. "ugc-benchmark-v0-1-2026-10-04". */
  filenameStem: string;
}

/** Filesystem-safe filename derived from the dataset name and version. */
export function buildFilenameStem(dataset: DatasetInfo, exportedAt: string): string {
  const slug = `${dataset.name}-${dataset.version}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const day = exportedAt.slice(0, 10);
  return `${slug || 'scrollnotes-dataset'}-${day}`;
}

/**
 * Assemble every file of the benchmark bundle, without touching the DOM.
 *
 * Images are decoded here rather than in the UI so the whole bundle is verifiable in a
 * Node test. A frame whose data URL cannot be decoded is reported in imageErrors and its
 * sample is excluded from the bundle: the alternative, shipping a manifest that points at
 * missing files, is exactly the failure section 24 exists to prevent.
 */
export function buildExportBundle(input: BundleInput): ExportBundle {
  const { dataset, frames, ocrArtifacts, exportedAt } = input;

  const candidates = selectExportableSamples(input.encounters);

  const validation = validateForExport({
    encounters: input.encounters,
    frameIds: new Set(frames.keys()),
    ocrFrameIds: new Set(ocrArtifacts.keys()),
    dedupRecords: input.dedupRecords,
    dataset,
    extractionRuns: input.extractionRuns,
  });

  const annotations: ExportedAnnotation[] = [];
  const ocrRecords: ExportedOcrRecord[] = [];
  const images: { path: string; bytes: Uint8Array }[] = [];
  const imageErrors: { sampleId: string; reason: string }[] = [];
  const shipped: EncounterSample[] = [];

  for (const sample of candidates) {
    const frame = frames.get(sample.frameId);
    if (!frame) {
      imageErrors.push({
        sampleId: sample.sampleId,
        reason: 'the frame image is no longer stored in this session',
      });
      continue;
    }

    const bytes = dataUrlToBytes(frame.dataUrl);
    if (!bytes) {
      imageErrors.push({
        sampleId: sample.sampleId,
        reason: `the frame image data (${frame.filename}) could not be decoded`,
      });
      continue;
    }

    const path = imagePathForSample(sample.sampleId, frame.mimeType);
    images.push({ path, bytes });
    annotations.push(buildAnnotationRecord(sample, dataset, path));
    shipped.push(sample);

    // Only OCR for frames that actually shipped, so ocr.jsonl can never reference a
    // sample the consumer cannot find in annotations.jsonl.
    const artifact = ocrArtifacts.get(sample.frameId);
    if (artifact) {
      ocrRecords.push(buildOcrRecord(sample, artifact));
    }
  }

  const manifest = buildManifest({
    dataset,
    samples: shipped,
    ocrArtifacts: ocrRecords.map((record) => ({
      frameId: record.frameId,
      engine: record.engine,
      text: record.text,
      language: record.language,
      engineVersion: record.engineVersion,
      wrapperVersion: record.wrapperVersion,
      confidence: record.confidence,
      generatedAt: record.generatedAt,
    })),
    validation,
    dedupConfig: input.dedupConfig,
    dedupRecords: input.dedupRecords,
    recordings: input.recordings,
    extractionRuns: input.extractionRuns,
    exportedAt,
  });

  // The manifest must report what actually shipped, not what was intended: a sample whose
  // image failed to decode is excluded from every count.
  manifest.sampleCount = shipped.length;
  manifest.imageCount = images.length;
  manifest.ocrRecordCount = ocrRecords.length;
  manifest.platformCounts = countBy(shipped, (sample) => sample.platform);
  manifest.qualityFlagCounts = summariseQualityFlags(shipped);

  const textFiles: ExportFile[] = [
    {
      path: EXPORT_FILES.annotations,
      bytes: encoder.encode(buildAnnotationsJsonl(annotations)),
    },
    { path: EXPORT_FILES.ocr, bytes: encoder.encode(buildOcrJsonl(ocrRecords)) },
    {
      path: EXPORT_FILES.manifest,
      bytes: encoder.encode(JSON.stringify(manifest, null, 2) + '\n'),
    },
    { path: EXPORT_FILES.readme, bytes: encoder.encode(buildReadme(manifest)) },
  ];

  return {
    validation,
    manifest,
    samples: shipped,
    annotations,
    ocrRecords,
    textFiles,
    images,
    imageErrors,
    filenameStem: buildFilenameStem(dataset, exportedAt),
  };
}

/** Flatten a bundle into zip entries, images first so archives list them predictably. */
export function bundleToZipEntries(bundle: ExportBundle): ZipEntry[] {
  return [
    ...bundle.images.map((image) => ({ path: image.path, bytes: image.bytes })),
    ...bundle.textFiles.map((file) => ({ path: file.path, bytes: file.bytes })),
  ];
}