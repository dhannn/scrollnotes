import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  deriveLifecycle,
  checkTransition,
  explainLifecycle,
  describeTargetAttainment,
  PREDICATES,
} from '../domain/lifecycle';
import type { CorpusFacts, TargetAssessment } from '../domain/lifecycle';
import type {
  DatasetInfo,
  DatasetLifecycleStatus,
  DedupRecord,
  EncounterSample,
  ExportCheck,
  FrameRecord,
} from '../types/schema';

/**
 * Export checks that must NOT gate the lifecycle.
 *
 * `has-samples` fails whenever nothing is annotated yet — which is the *normal*
 * state during curation — so counting it made the `curating` predicate
 * unreachable and pinned every mid-curation corpus to DRAFT. `target-attainment`
 * is advisory by design (§4.2).
 */
const NON_INTEGRITY_CHECKS = new Set(['has-samples', 'target-attainment']);

interface UseDatasetLifecycleInput {
  dataset: DatasetInfo;
  encounters: EncounterSample[];
  frames: Map<string, FrameRecord>;
  dedupRecords: Map<string, DedupRecord>;
  /** The live §24 checklist; only `severity: 'fail'` rows gate the lifecycle. */
  validationChecks: ExportCheck[];
  /** Persists the derived status so the badge, manifest and settings agree (§4.5). */
  persistDataset: (next: DatasetInfo) => void | Promise<void>;
}

/**
 * Dataset lifecycle (Slice 7 §4)
 * ------------------------------
 * Turns live session state into a `CorpusFacts` snapshot, derives the status the
 * corpus is actually in, and writes that derived value back to storage.
 *
 * Persisting the derived status is the point: the header badge, the settings panel
 * and the exported manifest all read `dataset.lifecycleStatus`, so if the UI only
 * ever shows the derived value, they cannot drift apart. The researcher never
 * types a status; `reopenDataset` is the only writer and it can only move backwards.
 */
export function useDatasetLifecycle(input: UseDatasetLifecycleInput) {
  const { dataset, encounters, frames, dedupRecords, validationChecks, persistDataset } = input;

  const facts: CorpusFacts = useMemo(() => {
    const annotatedCount = encounters.filter((e) => e.status === 'annotated').length;
    const rejectedCount = encounters.filter((e) => e.status === 'rejected').length;
    const skippedCount = encounters.filter((e) => e.status === 'skipped').length;

    // A frame with no encounter is a provenance hole (§21): it was captured but never
    // accounted for, so the corpus is not yet internally coherent.
    const encounterFrameIds = new Set(encounters.map((e) => e.frameId));
    const framesWithoutEncounter = [...frames.keys()].filter(
      (id) => !encounterFrameIds.has(id)
    ).length;

    const suppressedDuplicates = [...dedupRecords.values()].filter(
      (r) => r.role === 'duplicate'
    ).length;

    // Platforms are only "verified" once a sample is actually annotated with one
    // (§14) — the 'other' default on a pending sample proves nothing.
    const curatedPlatformCount = new Set(
      encounters.filter((e) => e.status === 'annotated' && e.platform !== 'other').map((e) => e.platform)
    ).size;

    return {
      totalEncounters: encounters.length,
      annotatedCount,
      rejectedCount,
      skippedCount,
      suppressedDuplicates,
      framesWithoutEncounter,
      dedupEverRun: dedupRecords.size > 0,
      ocrArtifactCount: 0,
      targetMin: dataset.targetMin ?? 150,
      targetMax: dataset.targetMax ?? 200,
      // Only INTEGRITY failures gate the lifecycle. `has-samples` fails whenever nothing is
      // annotated yet — the normal state during curation — so counting it made the
      // `curating` predicate unreachable and pinned every mid-curation corpus to DRAFT.
      // `target-attainment` is advisory by design and must never gate either.
      blockingValidationFailures: validationChecks.filter(
        (c) => c.severity === 'fail' && !NON_INTEGRITY_CHECKS.has(c.id)
      ).length,
      curatedPlatformCount,
      hasExportedBefore: dataset.hasExportedBefore === true,
      isSetupComplete: dataset.isSetupComplete === true,
    };
  }, [dataset, encounters, frames, dedupRecords, validationChecks]);

  const status = useMemo(() => deriveLifecycle(facts), [facts]);
  const explanation = useMemo(() => explainLifecycle(status, facts), [status, facts]);
  const target: TargetAssessment = useMemo(
    () => describeTargetAttainment(facts),
    [facts]
  );

  // Which view the machine currently wants the researcher in (§4.4). Advisory: the
  // UI uses it to surface the next action, never to trap them.
  const suggestedView = useMemo(() => {
    if (!dataset.isSetupComplete) return 'setup';
    if (status === 'draft') return encounters.length === 0 ? 'sessions' : 'gallery';
    if (status === 'curating') return 'dedup';
    if (status === 'annotating') return 'cockpit';
    return 'gallery';
  }, [status, encounters.length, dataset.isSetupComplete]);

  /** Record that a corpus bundle was produced, so `exported` survives a reload. */
  const markExported = useCallback(async () => {
    await persistDataset({
      ...dataset,
      hasExportedBefore: true,
      updatedAt: new Date().toISOString(),
    });
  }, [dataset, persistDataset]);

  /**
   * Walk the dataset backwards. This is the ONLY manual status writer, and it can
   * only demote (§4.3) — a researcher who discovers a mistake must always be able to
   * act, but nobody gets to declare a corpus finished.
   */
  const reopenDataset = useCallback(
    async (to: DatasetLifecycleStatus) => {
      const decision = checkTransition(status, to, facts);
      if (!decision.allowed) return decision;
      await persistDataset({
        ...dataset,
        lifecycleStatus: to,
        updatedAt: new Date().toISOString(),
      });
      return decision;
    },
    [status, facts, dataset, persistDataset]
  );

  // Auto-persist the derived status (§4.5). Guarded so the very first render and
  // every unrelated state change do not trigger a write.
  const lastPersisted = useRef<string | null>(null);
  useEffect(() => {
    if (!dataset.isSetupComplete) return;
    if (dataset.lifecycleStatus === status) return;
    if (lastPersisted.current === status) return;
    lastPersisted.current = status;
    void persistDataset({
      ...dataset,
      lifecycleStatus: status,
      updatedAt: new Date().toISOString(),
    });
  }, [status, dataset, persistDataset]);

  return {
    status,
    facts,
    explanation,
    target,
    suggestedView,
    markExported,
    reopenDataset,
    /** Everything that currently stands between the corpus and `ready`. */
    readyBlockers: PREDICATES.ready(facts).blockers,
  };
}