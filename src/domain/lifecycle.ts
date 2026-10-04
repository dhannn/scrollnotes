import type { DatasetLifecycleStatus, TargetAttainment } from '../types/schema';

/**
 * Dataset lifecycle state machine (Slice 7)
 * -------------------------------------------
 * AGENTS §15 gives a dataset an explicit status, but the pre-Slice-7 UI let the
 * researcher click any state freely, which allowed a 0-sample dataset to be
 * marked "exported" and an empty default dataset to be born "annotating".
 *
 * The fix here is deliberate: lifecycle status is DERIVED, not declared.
 * `deriveLifecycle()` is a pure function of corpus facts, so an impossible status
 * is not representable. A researcher who finds a mistake still needs to act, so
 * `checkTransition()` permits demotion unconditionally while validating promotion.
 *
 * This module is intentionally free of React and IndexedDB so it can be unit
 * tested in Node (see src/test/verifySlice7.ts) and reused by any headless
 * exporter.
 */

/** Every input the lifecycle decision depends on. All are already available in the app. */
export interface CorpusFacts {
  totalEncounters: number;
  annotatedCount: number;
  rejectedCount: number;
  skippedCount: number;
  /** Frames suppressed by deduplication (source data is still retained). */
  suppressedDuplicates: number;
  /** Frames in storage that never produced an encounter - a provenance hole. */
  framesWithoutEncounter: number;
  /** True once a deduplication pass has completed at least once. */
  dedupEverRun: boolean;
  ocrArtifactCount: number;
  /** Advisory lower bound of the intended corpus size. NEVER gates the lifecycle. */
  targetMin: number;
  /** Advisory upper bound of the intended corpus size. NEVER gates the lifecycle. */
  targetMax: number;
  /** Count of `severity: 'fail'` checks from exportValidation (§24). */
  blockingValidationFailures: number;
  /** Distinct platforms the researcher has explicitly verified (§14). */
  curatedPlatformCount: number;
  /** True once a corpus has been successfully exported at least once. */
  hasExportedBefore: boolean;
  /** Written exactly once by the setup wizard (§5). */
  isSetupComplete: boolean;
}

/** Ranked so promotion (increasing) and demotion (decreasing) can be distinguished. */
const RANK: Record<DatasetLifecycleStatus, number> = {
  draft: 0,
  curating: 1,
  annotating: 2,
  ready: 3,
  exported: 4,
};

export const LIFECYCLE_ORDER: DatasetLifecycleStatus[] = [
  'draft',
  'curating',
  'annotating',
  'ready',
  'exported',
];

/**
 * Evaluation order for `deriveLifecycle`, which differs from LIFECYCLE_ORDER.
 *
 * `exported` must be tested BEFORE `ready`, because `exported` implies `ready`:
 * if it were tested second, every exported corpus would match `ready` first and
 * the more specific (and more useful) `exported` state would never be reported.
 * Testing it first also gives us the demotion behaviour for free - once a
 * corpus stops being genuinely ready, the exported predicate falls through.
 */
const DERIVATION_ORDER: DatasetLifecycleStatus[] = [
  'exported',
  'draft',
  'curating',
  'annotating',
  'ready',
];

export const LIFECYCLE_LABELS: Record<DatasetLifecycleStatus, string> = {
  draft: 'Draft',
  curating: 'Curating',
  annotating: 'Annotating',
  ready: 'Ready',
  exported: 'Exported',
};

export const LIFECYCLE_DESCRIPTIONS: Record<DatasetLifecycleStatus, string> = {
  draft: 'Setup incomplete, or the corpus is not yet coherent enough to curate.',
  curating: 'Frames are being screened and deduplicated before annotation begins.',
  annotating: 'Human ground truth is being transcribed. This is the working state.',
  ready: 'Every sample is verified and the corpus passes every export check.',
  exported: 'A corpus bundle has been produced from this dataset.',
};

/**
 * Pending is derived rather than stored, so a caller cannot report an
 * inconsistent outstanding-work count.
 */
export function pendingCountOf(facts: CorpusFacts): number {
  return Math.max(
    0,
    facts.totalEncounters - facts.annotatedCount - facts.rejectedCount - facts.skippedCount
  );
}

/**
 * Per-state predicate. Exported so `checkTransition` can validate a specific
 * target without re-deriving it.
 *
 * Note that `draft` is INVERTED: it holds when there is something holding the
 * corpus back, not when everything is in order. Every other state holds when its
 * own conditions are met. This is deliberate - `draft` is the absence of
 * readiness - but it means `PREDICATES.draft(f).holds === true` should be read as
 * "this corpus is blocked short of curating".
 */
export const PREDICATES: Record<
  DatasetLifecycleStatus,
  (facts: CorpusFacts) => { holds: boolean; blockers: string[] }
> = {
  draft: (facts) => {
    const blockers: string[] = [];
    if (!facts.isSetupComplete) blockers.push('dataset setup is not complete');
    if (facts.framesWithoutEncounter > 0) {
      blockers.push(`${facts.framesWithoutEncounter} frame(s) have no sample`);
    }
    // Nothing has been curated or annotated yet, so dedup has not been run.
    if (!facts.dedupEverRun && facts.annotatedCount === 0 && facts.totalEncounters > 0) {
      blockers.push('deduplication has not been run');
    }
    return { holds: blockers.length > 0, blockers };
  },

  curating: (facts) => {
    const blockers: string[] = [];
    if (!facts.isSetupComplete) blockers.push('dataset setup is not complete');
    if (facts.totalEncounters === 0) blockers.push('no samples have been created yet');
    if (!facts.dedupEverRun) blockers.push('deduplication has not been run');
    if (facts.annotatedCount > 0) blockers.push('annotation has already started');
    if (facts.blockingValidationFailures > 0) {
      blockers.push(`${facts.blockingValidationFailures} export check(s) failing`);
    }
    return { holds: blockers.length === 0, blockers };
  },

  annotating: (facts) => {
    const blockers: string[] = [];
    if (facts.annotatedCount === 0) blockers.push('no samples are annotated yet');
    if (pendingCountOf(facts) === 0 && facts.skippedCount === 0) {
      blockers.push('there is no outstanding annotation work');
    }
    return { holds: blockers.length === 0, blockers };
  },

  ready: (facts) => {
    // INTEGRITY GATE ONLY (Slice 7 §4.2).
    //
    // Everything below is *objectively wrong* — there is no defensible corpus in
    // which "3 samples are still pending" is fine. Corpus SIZE is deliberately
    // excluded: undershooting the intended target is a legitimate research outcome
    // (§44 forbids forcing a corpus to look complete), so the target is advisory
    // and reported by `describeTargetAttainment` instead of blocking here.
    const blockers: string[] = [];
    if (!facts.isSetupComplete) blockers.push('dataset setup is not complete');
    if (facts.annotatedCount === 0) blockers.push('no samples are annotated');
    const pending = pendingCountOf(facts);
    if (pending > 0) blockers.push(`${pending} sample(s) still pending`);
    if (facts.skippedCount > 0) blockers.push(`${facts.skippedCount} sample(s) skipped`);
    if (facts.blockingValidationFailures > 0) {
      blockers.push(`${facts.blockingValidationFailures} export check(s) failing`);
    }
    if (facts.framesWithoutEncounter > 0) {
      blockers.push(`${facts.framesWithoutEncounter} frame(s) have no sample`);
    }
    if (facts.curatedPlatformCount < 1) blockers.push('no platform has been verified');
    return { holds: blockers.length === 0, blockers };
  },

  exported: (facts) => {
    const blockers: string[] = [];
    if (!facts.hasExportedBefore) blockers.push('this corpus has not been exported yet');
    const ready = PREDICATES.ready(facts);
    if (!ready.holds) {
      blockers.push(...ready.blockers.map((b) => `not ready: ${b}`));
    }
    return { holds: blockers.length === 0, blockers };
  },
};
/**
 * Advisory reporting of how the corpus compares to its intended size.
 *
 * This NEVER blocks anything. It exists so the researcher (and the exported
 * manifest) can honestly record "we aimed for 150-200 and built 120" instead of
 * either silently shipping or being trapped by an unmeetable promise.
 */
export interface TargetAssessment {
  attainment: TargetAttainment;
  /** One sentence suitable for a tooltip, a warning row, or the manifest. */
  message: string;
  /** Progress toward the LOWER bound, 0-100. Capped. */
  progressPercent: number;
}

export function describeTargetAttainment(facts: CorpusFacts): TargetAssessment {
  const { annotatedCount, targetMin, targetMax } = facts;

  if (!targetMin || !targetMax) {
    return {
      attainment: 'unset',
      message: 'No corpus size target has been declared.',
      progressPercent: 0,
    };
  }

  const progressPercent =
    targetMin > 0 ? Math.min(100, Math.round((annotatedCount / targetMin) * 100)) : 100;

  if (annotatedCount < targetMin) {
    return {
      attainment: 'below',
      message: `${annotatedCount} of an intended ${targetMin}-${targetMax} samples. This is a smaller corpus than planned, which is a legitimate outcome - record it rather than padding the corpus.`,
      progressPercent,
    };
  }
  if (annotatedCount <= targetMax) {
    return {
      attainment: 'in-range',
      message: `${annotatedCount} samples, within the intended ${targetMin}-${targetMax}.`,
      progressPercent,
    };
  }
  return {
    attainment: 'above',
    message: `${annotatedCount} samples, above the intended maximum of ${targetMax}. The manifest records both the intended range and the attained count.`,
    progressPercent,
  };
}

/**
 * The authoritative derivation. First match wins in DERIVATION_ORDER, so the
 * status can never claim to be further along than the facts allow.
 *
 * `exported` is evaluated first but falls through when its predicate fails, which
 * is what makes an exported corpus automatically demote the moment a sample is
 * reopened.
 */
export function deriveLifecycle(facts: CorpusFacts): DatasetLifecycleStatus {
  for (const status of DERIVATION_ORDER) {
    if (PREDICATES[status](facts).holds) return status;
  }
  return 'draft';
}

export interface TransitionCheck {
  to: DatasetLifecycleStatus;
  allowed: boolean;
  /** Human sentence shown in the UI when blocked (§39). */
  reason?: string;
  /** What the researcher would have to do first (§39). */
  remedy?: string;
}

/**
 * Guarded promotion, always-open demotion.
 *
 * - same state  -> always allowed (no-op)
 * - demotion    -> always allowed; the researcher found a mistake and must be able to act
 * - promotion   -> validated against the target predicate
 */
export function checkTransition(
  from: DatasetLifecycleStatus,
  to: DatasetLifecycleStatus,
  facts: CorpusFacts
): TransitionCheck {
  if (to === from) return { to, allowed: true };

  if (RANK[to] < RANK[from]) {
    return {
      to,
      allowed: true,
      reason: `Reopening the dataset as ${LIFECYCLE_LABELS[to].toLowerCase()}.`,
    };
  }

  const { holds, blockers } = PREDICATES[to](facts);
  if (holds) return { to, allowed: true };

  const label = LIFECYCLE_LABELS[to].toLowerCase();
  return {
    to,
    allowed: false,
    reason: `Cannot mark the dataset ${label}: ${blockers.join('; ')}.`,
    remedy: buildRemedy(to, facts),
  };
}

function buildRemedy(to: DatasetLifecycleStatus, facts: CorpusFacts): string | undefined {
  switch (to) {
    case 'draft':
      return 'Continue dataset setup in Dataset settings.';
    case 'curating':
      return 'Import frames and run deduplication from the Sessions or Deduplicate view.';
    case 'annotating':
      return 'Accept at least one sample in the gallery and leave some still pending.';
    case 'ready':
      return 'Finish annotating every sample, resolve failing export checks, then review the pre-export checklist.';
    case 'exported':
      return facts.hasExportedBefore
        ? 'Resolve the outstanding checks so the corpus is Ready, then export again.'
        : 'Complete the dataset and export it once to reach this state.';
    default:
      return undefined;
  }
}

/** A short explanation of why the corpus is currently in its derived state. */
export function explainLifecycle(
  status: DatasetLifecycleStatus,
  facts: CorpusFacts
): string {
  const parts: string[] = [];
  if (!facts.isSetupComplete) parts.push('dataset setup is not complete');
  if (facts.framesWithoutEncounter > 0) {
    parts.push(`${facts.framesWithoutEncounter} frame(s) have no sample`);
  }
  if (facts.blockingValidationFailures > 0) {
    parts.push(`${facts.blockingValidationFailures} export check(s) failing`);
  }
  const pending = pendingCountOf(facts);
  if (pending > 0) parts.push(`${pending} sample(s) still pending`);
  if (facts.skippedCount > 0) parts.push(`${facts.skippedCount} sample(s) skipped`);
  if (facts.totalEncounters === 0) parts.push('no samples have been created yet');

  if (parts.length === 0) return LIFECYCLE_DESCRIPTIONS[status];
  return `${LIFECYCLE_DESCRIPTIONS[status]} Currently: ${parts.join('; ')}.`;
}
