import type { EncounterSample, FrameRecord, GroundTruthItem } from '../types/schema';

/**
 * Encounter construction (shared by Slice 1 image import and Slice 5 extraction)
 * ---------------------------------------------------------------------------
 * Both ingestion paths MUST produce identical encounter shapes, so the logic lives
 * in exactly one place and the two paths cannot drift.
 *
 * THE GOLDEN RULE: this factory only ever creates BLANK, PENDING encounters.
 * - `platform` is 'other' and MUST be verified by the researcher. It is never
 *   inferred from a recording name or from neighbouring frames (AGENTS §5).
 * - `content` / `author` / `mediaDescription` start EMPTY. Ground truth is a
 *   deliberate human act; OCR is a separate, clearly-labelled artifact.
 * - `recordingId` / `timestampMs` are set ONLY when they are genuinely known,
 *   so pre-extracted frames never fabricate recording provenance.
 */
export function createEncounterForFrame(
  frame: FrameRecord,
  options: {
    /** Counter used to build the sequential sample id. */
    counter: number;
    sampleIdPrefix: string;
    recordingId?: string;
    timestampMs?: number;
  }
): EncounterSample {
  const now = frame.importedAt || new Date().toISOString();
  const sampleId = buildSampleId(options.sampleIdPrefix, options.counter);

  const item: GroundTruthItem = {
    id: `item-${sampleId}-1`,
    role: 'post',
    orderIndex: 0,
    content: '',
    author: '',
    mediaDescription: '',
    // hasMedia / hasAuthor are UGC item-level properties, never frame-level.
    hasMedia: true,
    hasAuthor: true,
  };

  return {
    sampleId,
    frameId: frame.id,
    platform: 'other',
    items: [item],
    status: 'pending',
    metadata: {
      ugcType: 'original-post',
      textDensity: 'medium',
      visualDensity: 'medium',
      isFlaggedForReview: false,
    },
    provenance: {
      frameFilename: frame.filename,
      importedAt: now,
      ...(options.recordingId ? { recordingId: options.recordingId } : {}),
      ...(typeof options.timestampMs === 'number' ? { timestampMs: options.timestampMs } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Sequential sample id, matching the dataset prefix convention. */
export function buildSampleId(prefix: string, counter: number): string {
  return `${prefix || 'ugc'}-${String(counter).padStart(6, '0')}`;
}