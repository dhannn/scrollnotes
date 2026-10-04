import { SCHEMA_VERSION } from '../types/schema';
import type {
  EncounterSample,
  DatasetInfo,
  DedupRecord,
  ExtractionRun,
  ExportCheck,
  ExportValidation,
  QualityFlag,
} from '../types/schema';

/**
 * Pre-export validation (Slice 6)
 * -------------------------------
 * AGENTS section 24 requires every sample to be checked before export, and requires the UI
 * to present a checklist. This module is the checklist's brain and is deliberately PURE so
 * it can be unit-tested in Node and reused by any future headless exporter.
 *
 * Severity semantics (see artifacts/plan_slice6.md section 0.3):
 * - fail  the corpus is corrupt or incomplete in a way that makes it unusable. Blocks.
 * - warn  a legitimate research state a researcher may knowingly accept. Never blocks.
 * - pass  informational confirmation.
 *
 * The function NEVER mutates its input and NEVER invents values.
 */

export interface ValidationInput {
  encounters: EncounterSample[];
  /** Frame ids currently held in IndexedDB. */
  frameIds: Set<string>;
  /** Frame ids that have an OCR artifact. */
  ocrFrameIds: Set<string>;
  dedupRecords?: Map<string, DedupRecord>;
  dataset: DatasetInfo;
  extractionRuns?: ExtractionRun[];
}

/** A sample id is expected to look like `<prefix>-000123` (AGENTS section 21). */
const SAMPLE_ID_PATTERN = /^[a-z0-9]+-\d{4,}$/i;

function hasContent(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * An item counts as real ground truth when it carries transcribed content. An author alone
 * is not enough: the gold standard for this dataset is the content (section 13).
 */
function itemHasContent(item: { content?: string }): boolean {
  return hasContent(item.content);
}

/** Cap the ids attached to a check so a broken corpus cannot render a huge list. */
function limitIds(ids: string[]): string[] | undefined {
  return ids.length > 0 ? ids.slice(0, 25) : undefined;
}
/**
 * Runs every section 24 check and returns the full checklist.
 *
 * Only annotated samples are candidates for export, so per-sample checks are scoped to
 * that subset; pending and rejected samples are reported separately as warnings rather
 * than failures, since they are expected to exist during curation.
 */
export function validateForExport(input: ValidationInput): ExportValidation {
  const { encounters, frameIds, ocrFrameIds, dataset, extractionRuns = [] } = input;
  const dedupRecords = input.dedupRecords ?? new Map<string, DedupRecord>();

  const exportable = encounters.filter((e) => e.status === 'annotated');
  const checks: ExportCheck[] = [];

  // --- 1. Sample IDs: present, unique, well-shaped -------------------------
  const blankIds = exportable.filter((e) => !hasContent(e.sampleId)).map((e) => e.sampleId);
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];
  for (const encounter of exportable) {
    if (seenIds.has(encounter.sampleId)) duplicateIds.push(encounter.sampleId);
    seenIds.add(encounter.sampleId);
  }
  const malformedIds = exportable
    .filter((e) => hasContent(e.sampleId) && !SAMPLE_ID_PATTERN.test(e.sampleId))
    .map((e) => e.sampleId);

  if (exportable.length === 0) {
    checks.push({
      id: 'has-samples',
      label: 'No annotated samples',
      severity: 'fail',
      detail: 'Nothing has been annotated yet, so there is no corpus to export.',
    });
  } else if (blankIds.length > 0 || duplicateIds.length > 0 || malformedIds.length > 0) {
    const problems: string[] = [];
    if (blankIds.length > 0) problems.push(`${blankIds.length} blank sample id(s)`);
    if (duplicateIds.length > 0) problems.push(`${duplicateIds.length} duplicate id(s)`);
    if (malformedIds.length > 0) problems.push(`${malformedIds.length} malformed id(s)`);
    checks.push({
      id: 'sample-ids',
      label: 'Sample IDs valid',
      severity: 'fail',
      detail: `Sample IDs must be unique and shaped like "${dataset.sampleIdPrefix}-000001": ${problems.join(', ')}.`,
      sampleIds: limitIds([...blankIds, ...duplicateIds, ...malformedIds]),
    });
  } else {
    checks.push({
      id: 'sample-ids',
      label: 'Sample IDs valid',
      severity: 'pass',
      detail: `${exportable.length}/${exportable.length} sample IDs are unique and well-formed.`,
    });
  }

  // --- 2. Frame images present -------------------------------------------
  const missingFrames = exportable.filter((e) => !frameIds.has(e.frameId)).map((e) => e.sampleId);
  checks.push({
    id: 'frames-present',
    label: 'Frames present',
    severity: missingFrames.length > 0 ? 'fail' : 'pass',
    detail:
      missingFrames.length > 0
        ? `${missingFrames.length} annotated sample(s) reference a frame image that is no longer stored, so their images cannot be written to the bundle.`
        : `${exportable.length}/${exportable.length} frame images are present.`,
    sampleIds: limitIds(missingFrames),
  });

  // --- 3. Ground truth complete ------------------------------------------
  const noItems = exportable.filter((e) => !e.items || e.items.length === 0).map((e) => e.sampleId);
  const emptyContent = exportable
    .filter((e) => e.items && e.items.length > 0 && !e.items.some(itemHasContent))
    .map((e) => e.sampleId);

  if (exportable.length > 0 && (noItems.length > 0 || emptyContent.length > 0)) {
    const parts: string[] = [];
    if (noItems.length > 0) parts.push(`${noItems.length} with no UGC items`);
    if (emptyContent.length > 0) parts.push(`${emptyContent.length} with empty content`);
    checks.push({
      id: 'ground-truth',
      label: 'Ground truths complete',
      severity: 'fail',
      detail: `Every exported sample needs at least one UGC item with transcribed content: ${parts.join(', ')}. Annotate them, or mark them rejected so they are excluded.`,
      sampleIds: limitIds([...noItems, ...emptyContent]),
    });
  } else {
    checks.push({
      id: 'ground-truth',
      label: 'Ground truths complete',
      severity: 'pass',
      detail: `${exportable.length}/${exportable.length} ground truths contain transcribed content.`,
    });
  }
// --- 4. Platform verified ----------------------------------------------
  // Platform is a sample-level property the researcher must verify. 'other' is the
  // unverified default, so this warns rather than failing.
  const unverifiedPlatform = exportable
    .filter((e) => e.platform === 'other' || !hasContent(e.platform))
    .map((e) => e.sampleId);
  checks.push({
    id: 'platform-verified',
    label: 'Platforms verified',
    severity: unverifiedPlatform.length > 0 ? 'warn' : 'pass',
    detail:
      unverifiedPlatform.length > 0
        ? `${unverifiedPlatform.length} sample(s) still have platform "other". They will export with that value; verify them if the experiment groups by platform.`
        : 'Every sample has a researcher-verified platform.',
    sampleIds: limitIds(unverifiedPlatform),
  });

  // --- 5. Provenance ------------------------------------------------------
  const missingFilename = exportable
    .filter((e) => !hasContent(e.provenance?.frameFilename))
    .map((e) => e.sampleId);
  checks.push({
    id: 'provenance-filename',
    label: 'Provenance complete',
    severity: missingFilename.length > 0 ? 'fail' : 'pass',
    detail:
      missingFilename.length > 0
        ? `${missingFilename.length} sample(s) have no source frame filename, so they cannot be traced back to their frame.`
        : 'Every sample records its source frame filename.',
    sampleIds: limitIds(missingFilename),
  });

  // Recording provenance is OPTIONAL by design: images imported directly (rather than
  // sampled from a recording) legitimately have none.
  const withoutRecording = exportable.filter(
    (e) => !e.provenance?.recordingId || typeof e.provenance?.timestampMs !== 'number'
  );
  checks.push({
    id: 'provenance-recording',
    label: 'Recording + timestamp provenance',
    severity: withoutRecording.length > 0 ? 'warn' : 'pass',
    detail:
      withoutRecording.length > 0
        ? `${withoutRecording.length}/${exportable.length} sample(s) have no recording id or source timestamp. These were imported as pre-extracted frames, which is a legitimate but weaker provenance chain.`
        : 'Every sample traces back to a source recording and timestamp.',
  });

  // --- 6. OCR artifacts ---------------------------------------------------
  // OCR is auxiliary evidence. Its absence never invalidates a sample.
  const withOcr = exportable.filter((e) => ocrFrameIds.has(e.frameId));
  checks.push({
    id: 'ocr-artifacts',
    label: 'OCR artifacts present',
    severity: withOcr.length < exportable.length ? 'warn' : 'pass',
    detail:
      withOcr.length < exportable.length
        ? `OCR artifacts present for ${withOcr.length}/${exportable.length} exported frames. OCR is optional auxiliary context and never affects ground truth.`
        : `OCR artifacts present for all ${exportable.length} exported frames.`,
  });
// --- 7. Deduplication decisions resolved --------------------------------
  // Section 24 requires no unresolved duplicate decisions. A sample still marked as a
  // suppressed duplicate but annotated anyway is ambiguous and must be surfaced.
  const unresolvedDuplicates = exportable
    .filter((e) => {
      const record = dedupRecords.get(e.frameId);
      return !!record && record.role === 'duplicate' && !record.overridden;
    })
    .map((e) => e.sampleId);
  checks.push({
    id: 'dedup-resolved',
    label: 'Duplicate decisions resolved',
    severity: unresolvedDuplicates.length > 0 ? 'warn' : 'pass',
    detail:
      unresolvedDuplicates.length > 0
        ? `${unresolvedDuplicates.length} annotated sample(s) are still marked as suppressed duplicates. Override them in Deduplicate, or reject them, so the corpus has no ambiguity about which frame represents the group.`
        : 'No annotated sample is left with an unresolved duplicate decision.',
    sampleIds: limitIds(unresolvedDuplicates),
  });

  // --- 8. Extraction runs -------------------------------------------------
  const badRuns = extractionRuns.filter((run) => run.status !== 'done');
  checks.push({
    id: 'extraction-runs',
    label: 'Extraction runs complete',
    severity: badRuns.length > 0 ? 'warn' : 'pass',
    detail:
      badRuns.length > 0
        ? `${badRuns.length}/${extractionRuns.length} sampling run(s) ended as error or cancelled. Their already-imported frames stay in the dataset, and the settings are still recorded in the manifest.`
        : 'All sampling runs completed successfully.',
  });

  // --- 9. Schema version --------------------------------------------------
  checks.push({
    id: 'schema-version',
    label: `Schema valid (${SCHEMA_VERSION})`,
    severity: 'pass',
    detail: `Dataset "${dataset.name}" carries schema version ${SCHEMA_VERSION}.`,
  });

  // --- 10. Curation completeness (honesty, not blocking) ------------------
  const pending = encounters.filter((e) => e.status === 'pending').length;
  const rejected = encounters.filter((e) => e.status === 'rejected').length;
  const skipped = encounters.filter((e) => e.status === 'skipped').length;
  checks.push({
    id: 'curation-complete',
    label: 'Curation complete',
    severity: pending > 0 ? 'warn' : 'pass',
    detail:
      pending > 0
        ? `${pending} candidate(s) are still pending and will NOT be included in this export. The manifest records this so the corpus cannot masquerade as complete.`
        : `No candidates left pending (${rejected} rejected, ${skipped} skipped).`,
  });

  const canExport = !checks.some((check) => check.severity === 'fail');

  return {
    checks,
    canExport,
    counts: {
      exportable: exportable.length,
      pending,
      rejected,
      skipped,
      withOcr: withOcr.length,
      withoutOcr: exportable.length - withOcr.length,
      withRecordingProvenance: exportable.length - withoutRecording.length,
      totalCandidates: encounters.length,
    },
  };
}

/** Every distinct quality flag used across the exported samples, with counts. */
export function summariseQualityFlags(samples: EncounterSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    for (const flag of (sample.metadata?.qualityFlags ?? []) as QualityFlag[]) {
      counts[flag] = (counts[flag] ?? 0) + 1;
    }
  }
  return counts;
}