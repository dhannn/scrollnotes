import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  EncounterSample,
  FrameRecord,
  SessionStats,
  Platform,
  EncounterStatus,
  DatasetInfo,
  UGCType,
  SampleMetadata,
  GroundTruthItem,
  OcrArtifact,
  OcrStatus,
  DedupRecord,
  DedupConfig,
  DedupStatus,
  DedupStats,
  DedupFilterOption,
  HashAlgorithm,
  RecordingRecord,
  ExtractionRun,
  ExtractionStatus,
  SamplingConfig,
  DEFAULT_SAMPLING_CONFIG,
} from '../types/schema';
import {
  getAllEncounters,
  getAllFrames,
  saveEncounter,
  saveFrame,
  getDatasetInfo,
  saveDatasetInfo,
  clearEntireDatabase,
  getAllOcrArtifacts,
  saveOcrArtifact,
  getAllDedupRecords,
  saveDedupRecord,
  getDedupConfig,
  saveDedupConfig,
  getAllRecordings,
  saveRecording,
  deleteRecording,
  getAllExtractionRuns,
  saveExtractionRun,
  DEFAULT_DATASET_INFO,
  DEFAULT_DEDUP_CONFIG,
} from '../services/db';
import { generateFieldworkSampleBatch } from '../services/sampleData';
import { runOcr, buildOcrArtifact, terminateOcrWorker } from '../services/ocr';
import { computeFrameHash, groupBySimilarity } from '../services/deduplication';
import { createEncounterForFrame } from '../services/encounters';
import {
  extractFrames,
  probeRecording,
  planExtraction,
  normaliseSamplingConfig,
  computeSamplingGrid,
  deriveRecordingId,
  deriveRunId,
  deriveFrameId,
  DECODE_ERROR_MESSAGE,
} from '../services/frameSampling';

export type StatusFilterOption = 'all' | EncounterStatus | 'flagged' | 'multi-item';
export type SortOption = 'default' | 'sample-id' | 'platform' | 'status' | 'newest';
export type GalleryView = 'gallery' | 'cockpit' | 'dedup' | 'sessions';

/** Translate raw Tesseract worker status strings into human-readable progress. */
function humaniseOcrStatus(status: string): string {
  switch (status) {
    case 'loading tesseract core':
      return 'Loading OCR engine…';
    case 'initializing tesseract':
      return 'Initialising engine…';
    case 'loading language traineddata':
      return 'Loading language data…';
    case 'initializing api':
      return 'Preparing recogniser…';
    case 'recognizing text':
      return 'Reading text from frame…';
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Working…';
  }
}

/** Find the current representative of a duplicate group, if any. */
function findGroupRepresentative(
  records: Map<string, DedupRecord>,
  groupId?: string
): string | undefined {
  if (!groupId) return undefined;
  for (const record of records.values()) {
    if (record.groupId === groupId && record.role === 'representative') {
      return record.frameId;
    }
  }
  return undefined;
}


export function useFieldSession() {
  const [encounters, setEncounters] = useState<EncounterSample[]>([]);
  const [frames, setFrames] = useState<Map<string, FrameRecord>>(new Map());
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo>(DEFAULT_DATASET_INFO);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentView, setCurrentView] = useState<GalleryView>('gallery');

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all');
  const [ugcTypeFilter, setUgcTypeFilter] = useState<'all' | UGCType>('all');
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const [dedupFilter, setDedupFilter] = useState<DedupFilterOption>('all');
  const [hideSuppressedDuplicates, setHideSuppressedDuplicates] = useState<boolean>(false);

  // Slice 3 — OCR preprocessing state (kept separate from ground truth)
  const [ocrArtifacts, setOcrArtifacts] = useState<Map<string, OcrArtifact>>(new Map());
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>({ frameId: null, phase: 'idle' });

  // Slice 4 — Deduplication state (reversible decisions)
  const [dedupRecords, setDedupRecords] = useState<Map<string, DedupRecord>>(new Map());
  const [dedupConfig, setDedupConfig] = useState<DedupConfig>(DEFAULT_DEDUP_CONFIG);
  const [dedupStatus, setDedupStatus] = useState<DedupStatus>({
    phase: 'idle',
    processed: 0,
    total: 0,
  });

  // Slice 5 — Field sessions (recordings are provenance containers, never platforms)
  const [recordings, setRecordings] = useState<Map<string, RecordingRecord>>(new Map());
  const [extractionRuns, setExtractionRuns] = useState<Map<string, ExtractionRun>>(new Map());
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>({
    recordingId: null,
    phase: 'idle',
    processed: 0,
    total: 0,
    warnings: [],
  });
  /** In-flight cancellation handle for the current extraction run. */
  const extractionAbortRef = useRef<AbortController | null>(null);

  const [samplingConfig, setSamplingConfigState] =
    useState<SamplingConfig>(DEFAULT_SAMPLING_CONFIG);

  // Load initial data from IndexedDB
  const refreshFromDB = useCallback(async () => {
    try {
      setIsLoading(true);
      const [
        savedEncounters,
        savedFrames,
        savedInfo,
        savedOcr,
        savedDedup,
        savedDedupConfig,
        savedRecordings,
        savedRuns,
      ] = await Promise.all([
        getAllEncounters(),
        getAllFrames(),
        getDatasetInfo(),
        getAllOcrArtifacts(),
        getAllDedupRecords(),
        getDedupConfig(),
        getAllRecordings(),
        getAllExtractionRuns(),
      ]);

      const frameMap = new Map<string, FrameRecord>();
      savedFrames.forEach((f) => frameMap.set(f.id, f));

      const ocrMap = new Map<string, OcrArtifact>();
      savedOcr.forEach((artifact) => ocrMap.set(artifact.frameId, artifact));

      const dedupMap = new Map<string, DedupRecord>();
      savedDedup.forEach((record) => dedupMap.set(record.frameId, record));

      const recordingMap = new Map<string, RecordingRecord>();
      savedRecordings.forEach((rec) => recordingMap.set(rec.recordingId, rec));

      const runMap = new Map<string, ExtractionRun>();
      savedRuns.forEach((run) => runMap.set(run.runId, run));

      setEncounters(savedEncounters);
      setFrames(frameMap);
      setDatasetInfo(savedInfo);
      setOcrArtifacts(ocrMap);
      setDedupRecords(dedupMap);
      setDedupConfig(savedDedupConfig);
      setRecordings(recordingMap);
      setExtractionRuns(runMap);

      if (savedEncounters.length > 0 && !activeSampleId) {
        setActiveSampleId(savedEncounters[0].sampleId);
      }
    } catch (err) {
      console.error('Failed to load field session from DB:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeSampleId]);

  useEffect(() => {
    refreshFromDB();
  }, [refreshFromDB]);

  // Field sessions (Slice 5) — newest first
  const recordingList = useMemo(
    () => [...recordings.values()].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1)),
    [recordings]
  );

  // Active sample & frame
  const activeEncounter = useMemo(() => {
    if (!activeSampleId) return null;
    return encounters.find((e) => e.sampleId === activeSampleId) || null;
  }, [encounters, activeSampleId]);

  const activeFrame = useMemo(() => {
    if (!activeEncounter) return null;
    return frames.get(activeEncounter.frameId) || null;
  }, [activeEncounter, frames]);

  // Session Statistics & Platform Distribution
  const stats: SessionStats = useMemo(() => {
    const total = encounters.length;
    let annotated = 0;
    let pending = 0;
    let rejected = 0;
    let skipped = 0;
    let flagged = 0;
    let totalItems = 0;

    const platformCounts: Record<Platform, number> = {
      instagram: 0,
      tiktok: 0,
      reddit: 0,
      x: 0,
      youtube: 0,
      facebook: 0,
      threads: 0,
      other: 0,
    };

    for (const e of encounters) {
      if (e.status === 'annotated') annotated++;
      else if (e.status === 'pending') pending++;
      else if (e.status === 'rejected') rejected++;
      else if (e.status === 'skipped') skipped++;

      if (e.metadata?.isFlaggedForReview) flagged++;

      totalItems += e.items?.length || 1;

      if (e.platform && platformCounts[e.platform] !== undefined) {
        platformCounts[e.platform]++;
      } else {
        platformCounts.other++;
      }
    }

    const progressPercent = total > 0 ? Math.round((annotated / total) * 100) : 0;
    const targetCount = datasetInfo.targetCount || 200;
    const targetProgressPercent = Math.min(100, Math.round((annotated / targetCount) * 100));

    return {
      total,
      totalItems,
      annotated,
      pending,
      rejected,
      skipped,
      flagged,
      progressPercent,
      targetCount,
      targetProgressPercent,
      platformCounts,
    };
  }, [encounters, datasetInfo.targetCount]);

  // Filtered & Sorted encounters for gallery
  const filteredEncounters = useMemo(() => {
    let result = [...encounters];

    // Status filter
    if (statusFilter === 'flagged') {
      result = result.filter((e) => e.metadata?.isFlaggedForReview);
    } else if (statusFilter === 'multi-item') {
      result = result.filter((e) => e.items && e.items.length > 1);
    } else if (statusFilter !== 'all') {
      result = result.filter((e) => e.status === statusFilter);
    }

    // Platform filter
    if (platformFilter !== 'all') {
      result = result.filter((e) => e.platform === platformFilter);
    }

    // UGC Type filter
    if (ugcTypeFilter !== 'all') {
      result = result.filter((e) => e.metadata?.ugcType === ugcTypeFilter);
    }

    // Deduplication filters (Slice 4) — reversible; suppressed frames stay recoverable
    if (hideSuppressedDuplicates) {
      result = result.filter((e) => dedupRecords.get(e.frameId)?.role !== 'duplicate');
    }
    if (dedupFilter !== 'all') {
      result = result.filter(
        (e) => (dedupRecords.get(e.frameId)?.role ?? 'unique') === dedupFilter
      );
    }

    // Full-Text Multi-Item Search
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((e) => {
        const idMatch = e.sampleId.toLowerCase().includes(q);
        const fileMatch = e.provenance.frameFilename?.toLowerCase().includes(q);
        const itemMatch = e.items?.some(
          (item) =>
            item.content?.toLowerCase().includes(q) ||
            item.author?.toLowerCase().includes(q) ||
            item.mediaDescription?.toLowerCase().includes(q)
        );
        return idMatch || fileMatch || itemMatch;
      });
    }

    // Sorting
    switch (sortOption) {
      case 'sample-id':
        result.sort((a, b) => a.sampleId.localeCompare(b.sampleId));
        break;
      case 'platform':
        result.sort((a, b) => a.platform.localeCompare(b.platform));
        break;
      case 'status':
        result.sort((a, b) => a.status.localeCompare(b.status));
        break;
      case 'newest':
        result.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        break;
      case 'default':
      default:
        break;
    }

    return result;
  }, [
    encounters,
    statusFilter,
    platformFilter,
    ugcTypeFilter,
    searchQuery,
    sortOption,
    dedupRecords,
    dedupFilter,
    hideSuppressedDuplicates,
  ]);

  // Navigation indices
  const activeIndex = useMemo(() => {
    if (!activeSampleId) return -1;
    return encounters.findIndex((e) => e.sampleId === activeSampleId);
  }, [encounters, activeSampleId]);

  const hasNext = activeIndex >= 0 && activeIndex < encounters.length - 1;
  const hasPrev = activeIndex > 0;

  const goToNext = useCallback(() => {
    if (activeIndex >= 0 && activeIndex < encounters.length - 1) {
      setActiveSampleId(encounters[activeIndex + 1].sampleId);
    }
  }, [activeIndex, encounters]);

  const goToPrev = useCallback(() => {
    if (activeIndex > 0) {
      setActiveSampleId(encounters[activeIndex - 1].sampleId);
    }
  }, [activeIndex, encounters]);

  const openSampleInCockpit = useCallback((sampleId: string) => {
    setActiveSampleId(sampleId);
    setCurrentView('cockpit');
  }, []);

  // Update encounter in state & IndexedDB
  const updateEncounter = useCallback(
    async (updated: EncounterSample) => {
      const timestamped = {
        ...updated,
        updatedAt: new Date().toISOString(),
      };

      setEncounters((prev) =>
        prev.map((e) => (e.sampleId === timestamped.sampleId ? timestamped : e))
      );

      await saveEncounter(timestamped);
    },
    []
  );

  // Update Dataset Info
  const updateDatasetMetadata = useCallback(async (updated: DatasetInfo) => {
    setDatasetInfo(updated);
    await saveDatasetInfo(updated);
  }, []);

  // Save & Next Action with First-Class Multi-Item Support
  const saveAndNext = useCallback(
    async (
      sampleId: string,
      fields: {
        platform: Platform;
        items: GroundTruthItem[];
        metadata?: SampleMetadata;
      }
    ) => {
      const current = encounters.find((e) => e.sampleId === sampleId);
      if (!current) return;

      const hasAnyContent = fields.items.some((it) => it.content.trim().length > 0);

      const updatedEncounter: EncounterSample = {
        ...current,
        platform: fields.platform,
        items: fields.items,
        status: hasAnyContent ? 'annotated' : current.status,
        metadata: {
          ...current.metadata,
          ...fields.metadata,
          textDensity: fields.items.length > 1 ? 'high' : current.metadata?.textDensity,
        },
        updatedAt: new Date().toISOString(),
      };

      await updateEncounter(updatedEncounter);

      const idx = encounters.findIndex((e) => e.sampleId === sampleId);
      if (idx >= 0 && idx < encounters.length - 1) {
        setActiveSampleId(encounters[idx + 1].sampleId);
      }
    },
    [encounters, updateEncounter]
  );

  // Quick mark status
  const setSampleStatus = useCallback(
    async (sampleId: string, status: EncounterStatus, advance: boolean = true) => {
      const current = encounters.find((e) => e.sampleId === sampleId);
      if (!current) return;

      const updatedEncounter: EncounterSample = {
        ...current,
        status,
        updatedAt: new Date().toISOString(),
      };

      await updateEncounter(updatedEncounter);

      if (advance) {
        const idx = encounters.findIndex((e) => e.sampleId === sampleId);
        if (idx >= 0 && idx < encounters.length - 1) {
          setActiveSampleId(encounters[idx + 1].sampleId);
        }
      }
    },
    [encounters, updateEncounter]
  );

  // Ingest Image Files (secondary path — pre-extracted frames, no recording provenance)
  const ingestImageFiles = useCallback(
    async (files: File[]) => {
      const now = new Date().toISOString();
      const newFrames: FrameRecord[] = [];
      const newEncounters: EncounterSample[] = [];
      const prefix = datasetInfo.sampleIdPrefix || 'ugc';

      let currentCounter = encounters.length + 1;

      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const frameRecord: FrameRecord = {
          id: deriveFrameId(),
          filename: file.name,
          dataUrl,
          mimeType: file.type,
          sizeBytes: file.size,
          importedAt: now,
        };

        // Shared factory — identical shape to recording-extracted frames.
        // No recordingId / timestampMs: loose frames never fabricate provenance.
        const encounterRecord = createEncounterForFrame(frameRecord, {
          counter: currentCounter,
          sampleIdPrefix: prefix,
        });
        currentCounter++;

        await saveFrame(frameRecord);
        await saveEncounter(encounterRecord);

        newFrames.push(frameRecord);
        newEncounters.push(encounterRecord);
      }

      setFrames((prev) => {
        const next = new Map(prev);
        newFrames.forEach((f) => next.set(f.id, f));
        return next;
      });

      setEncounters((prev) => [...prev, ...newEncounters]);

      if (!activeSampleId && newEncounters.length > 0) {
        setActiveSampleId(newEncounters[0].sampleId);
      }
    },
    [encounters.length, activeSampleId, datasetInfo.sampleIdPrefix]
  );

  // ==========================================================================
  // Slice 5 — Field sessions: recording import + frame sampling
  // ==========================================================================

  /** Probe a recording and register it. Duration is OMITTED when unreadable. */
  const importRecordingFile = useCallback(
    async (file: File): Promise<RecordingRecord> => {
      setExtractionStatus((prev) => ({ ...prev, phase: 'probing' }));

      let probe: { durationMs?: number; width: number; height: number };
      try {
        probe = await probeRecording(file);
      } catch {
        // Never surface a raw DOMException to the researcher (AGENTS §39).
        throw new Error(DECODE_ERROR_MESSAGE);
      }

      const recording: RecordingRecord = {
        recordingId: deriveRecordingId(recordings.size),
        filename: file.name,
        ...(probe.durationMs ? { durationMs: probe.durationMs } : {}),
        sizeBytes: file.size,
        importedAt: new Date().toISOString(),
      };

      await saveRecording(recording);
      setRecordings((prev) => {
        const next = new Map(prev);
        next.set(recording.recordingId, recording);
        return next;
      });

      setExtractionStatus({
        recordingId: recording.recordingId,
        phase: 'idle',
        processed: 0,
        total: 0,
        warnings: [],
      });

      return recording;
    },
    [recordings.size]
  );

  const setSamplingConfig = useCallback((patch: Partial<SamplingConfig>) => {
    setSamplingConfigState((prev) => {
      // Never let the UI hold an out-of-range configuration.
      const { config } = normaliseSamplingConfig({ ...prev, ...patch });
      return config;
    });
  }, []);

  /** Preview the sampling grid WITHOUT extracting anything. */
  const previewSamplingGrid = useCallback(
    (recording: RecordingRecord, config?: SamplingConfig) => {
      const effective = config ?? samplingConfig;
      const { config: normalised } = normaliseSamplingConfig(effective);
      return computeSamplingGrid(recording.durationMs, normalised, normalised.maxFrames);
    },
    [samplingConfig]
  );

  const cancelExtraction = useCallback(() => {
    extractionAbortRef.current?.abort();
  }, []);

  /**
   * Extract candidate frames from a recording.
   *
   * Each frame is persisted AS IT ARRIVES, so a cancelled or interrupted run
   * leaves usable data on disk. Every extracted frame carries recordingId +
   * timestampMs provenance; ground truth is never touched.
   */
  const runFrameExtraction = useCallback(
    async (recording: RecordingRecord, file: File, config?: SamplingConfig) => {
      const requested = config ?? samplingConfig;
      const { config: normalised, warnings: configWarnings } = normaliseSamplingConfig(requested);

      const controller = new AbortController();
      extractionAbortRef.current = controller;

      const runId = deriveRunId(extractionRuns.size);
      const { run } = planExtraction({ runId, recording, sampling: normalised });

      // Persist the run up front so an interrupted extraction is still auditable.
      await saveExtractionRun(run);
      setExtractionRuns((prev) => {
        const next = new Map(prev);
        next.set(run.runId, run);
        return next;
      });

      setExtractionStatus({
        recordingId: recording.recordingId,
        phase: 'extracting',
        processed: 0,
        total: run.timestampsMs.length,
        warnings: configWarnings,
      });

      const collectedWarnings = [...configWarnings];

      try {
        const result = await extractFrames(file, {
          recordingId: recording.recordingId,
          intervalSeconds: normalised.intervalSeconds,
          startSeconds: normalised.startSeconds,
          ...(normalised.endSeconds !== undefined
            ? { endSeconds: normalised.endSeconds }
            : {}),
          outputFormat: normalised.outputFormat,
          quality: normalised.quality,
          maxFrames: normalised.maxFrames,
          signal: controller.signal,
          onProgress: (progress) => {
            setExtractionStatus((prev) => ({
              ...prev,
              processed: progress.processed,
              total: progress.total,
            }));
          },
        });

        collectedWarnings.push(...result.warnings);
        setExtractionStatus((prev) => ({ ...prev, phase: 'persisting' }));

        const prefix = datasetInfo.sampleIdPrefix || 'ugc';
        let counter = encounters.length + 1;
        const newFrames: FrameRecord[] = [];
        const newEncounters: EncounterSample[] = [];

        for (let i = 0; i < result.frames.length; i++) {
          const frame = result.frames[i];
          const timestampMs = result.timestampsMs[i];

          const encounterRecord = createEncounterForFrame(frame, {
            counter,
            sampleIdPrefix: prefix,
            recordingId: recording.recordingId,
            timestampMs,
          });
          counter++;

          // Persist immediately — an interrupted run must not lose captured work.
          await saveFrame(frame);
          await saveEncounter(encounterRecord);

          newFrames.push(frame);
          newEncounters.push(encounterRecord);

          setExtractionStatus((prev) => ({ ...prev, processed: i + 1 }));
        }

        setFrames((prev) => {
          const next = new Map(prev);
          newFrames.forEach((f) => next.set(f.id, f));
          return next;
        });
        setEncounters((prev) => [...prev, ...newEncounters]);

        const finalRun: ExtractionRun = {
          ...run,
          frameIds: newFrames.map((f) => f.id),
          timestampsMs: result.timestampsMs,
          frameCount: newFrames.length,
          completedAt: new Date().toISOString(),
          status: result.cancelled ? 'cancelled' : 'done',
          ...(collectedWarnings.length ? { warnings: collectedWarnings } : {}),
        };
        await saveExtractionRun(finalRun);
        setExtractionRuns((prev) => {
          const next = new Map(prev);
          next.set(finalRun.runId, finalRun);
          return next;
        });

        setExtractionStatus({
          recordingId: recording.recordingId,
          phase: result.cancelled ? 'cancelled' : 'done',
          processed: newFrames.length,
          total: result.timestampsMs.length,
          warnings: collectedWarnings,
        });

        if (!activeSampleId && newEncounters.length > 0) {
          setActiveSampleId(newEncounters[0].sampleId);
        }

        return { run: finalRun, warnings: collectedWarnings };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Frame extraction failed unexpectedly.';
        const failedRun: ExtractionRun = {
          ...run,
          completedAt: new Date().toISOString(),
          status: 'error',
          error: message,
          ...(collectedWarnings.length ? { warnings: collectedWarnings } : {}),
        };
        await saveExtractionRun(failedRun);
        setExtractionRuns((prev) => {
          const next = new Map(prev);
          next.set(failedRun.runId, failedRun);
          return next;
        });
        setExtractionStatus((prev) => ({ ...prev, phase: 'error', error: message }));
        return { run: failedRun, warnings: collectedWarnings, error: message };
      } finally {
        extractionAbortRef.current = null;
      }
    },
    [
      samplingConfig,
      extractionRuns.size,
      encounters.length,
      datasetInfo.sampleIdPrefix,
      activeSampleId,
    ]
  );

  /**
   * Remove recording METADATA ONLY. Derived frames and encounters are deliberately
   * left intact so an accidental removal is always recoverable (AGENTS §17).
   */
  const removeRecording = useCallback(async (recordingId: string) => {
    await deleteRecording(recordingId);
    setRecordings((prev) => {
      const next = new Map(prev);
      next.delete(recordingId);
      return next;
    });
  }, []);

  // Load Built-in Fieldwork Batch
  const loadSampleBatch = useCallback(async () => {
    // Replace the whole working session (frames, encounters, OCR, dedup).
    await clearEntireDatabase();

    const { frames: sampleFrames, encounters: sampleEncounters } =
      generateFieldworkSampleBatch();

    for (const f of sampleFrames) {
      await saveFrame(f);
    }
    for (const e of sampleEncounters) {
      await saveEncounter(e);
    }

    const frameMap = new Map<string, FrameRecord>();
    sampleFrames.forEach((f) => frameMap.set(f.id, f));

    setFrames(frameMap);
    setEncounters(sampleEncounters);
    setActiveSampleId(sampleEncounters[0].sampleId);
    setOcrArtifacts(new Map());
    setOcrStatus({ frameId: null, phase: 'idle' });
    setDedupRecords(new Map());
    setDedupConfig(DEFAULT_DEDUP_CONFIG);
    setDedupStatus({ phase: 'idle', processed: 0, total: 0 });
    setRecordings(new Map());
    setExtractionRuns(new Map());
    setExtractionStatus({
      recordingId: null,
      phase: 'idle',
      processed: 0,
      total: 0,
      warnings: [],
    });
    setSamplingConfigState(DEFAULT_SAMPLING_CONFIG);
  }, []);

  // Clear All Field Data
  const clearSession = useCallback(async () => {
    await clearEntireDatabase();
    await terminateOcrWorker();
    setEncounters([]);
    setFrames(new Map());
    setActiveSampleId(null);
    setOcrArtifacts(new Map());
    setOcrStatus({ frameId: null, phase: 'idle' });
    setDedupRecords(new Map());
    setDedupConfig(DEFAULT_DEDUP_CONFIG);
    setDedupStatus({ phase: 'idle', processed: 0, total: 0 });
    setDedupFilter('all');
    setHideSuppressedDuplicates(false);
    setRecordings(new Map());
    setExtractionRuns(new Map());
    setExtractionStatus({
      recordingId: null,
      phase: 'idle',
      processed: 0,
      total: 0,
      warnings: [],
    });
    setSamplingConfigState(DEFAULT_SAMPLING_CONFIG);
  }, []);

  // ---------------------------------------------------------------------------
  // Slice 3 — OCR actions (preprocessing evidence; never overwrites ground truth)
  // ---------------------------------------------------------------------------
  const getOcrArtifact = useCallback(
    (frameId: string | null | undefined): OcrArtifact | null =>
      frameId ? ocrArtifacts.get(frameId) ?? null : null,
    [ocrArtifacts]
  );

  const hasOcrForFrame = useCallback(
    (frameId: string | null | undefined): boolean =>
      frameId ? ocrArtifacts.has(frameId) : false,
    [ocrArtifacts]
  );

  const runOcrForFrame = useCallback(
    async (frameId: string): Promise<OcrArtifact | null> => {
      const frame = frames.get(frameId);
      if (!frame) {
        setOcrStatus({
          frameId,
          phase: 'error',
          error: 'Frame not found in this field session.',
        });
        return null;
      }

      setOcrStatus({
        frameId,
        phase: 'running',
        progress: 0,
        progressMessage: 'Starting OCR engine…',
      });

      try {
        const result = await runOcr(frame, {
          onProgress: (p) =>
            setOcrStatus({
              frameId,
              phase: 'running',
              progress: p.progress,
              progressMessage: humaniseOcrStatus(p.status),
            }),
        });
        const artifact = buildOcrArtifact(frameId, result);
        await saveOcrArtifact(artifact);
        setOcrArtifacts((prev) => {
          const next = new Map(prev);
          next.set(frameId, artifact);
          return next;
        });
        setOcrStatus({ frameId, phase: 'done', progress: 1 });
        return artifact;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'OCR failed for an unknown reason.';
        setOcrStatus({ frameId, phase: 'error', error: message });
        return null;
      }
    },
    [frames]
  );

  /**
   * Generate OCR traces for every frame that doesn't have one yet (AGENTS §8.3).
   * Runs sequentially so a single Tesseract worker is reused; per-frame errors
   * are caught inside runOcrForFrame, so one bad frame never aborts the batch.
   */
  const runOcrBatch = useCallback(async (): Promise<void> => {
    const pending = Array.from(frames.values()).filter((frame) => !ocrArtifacts.has(frame.id));
    if (pending.length === 0) return;
    for (const frame of pending) {
      await runOcrForFrame(frame.id);
    }
    setOcrStatus({ frameId: null, phase: 'idle' });
  }, [frames, ocrArtifacts, runOcrForFrame]);

  // ---------------------------------------------------------------------------
  // Slice 4 — Deduplication statistics (derived, never persisted)
  // ---------------------------------------------------------------------------
  const dedupStats: DedupStats = useMemo(() => {
    let representatives = 0;
    let duplicates = 0;
    let unique = 0;
    const groupIds = new Set<string>();

    for (const record of dedupRecords.values()) {
      if (record.role === 'representative') representatives++;
      else if (record.role === 'duplicate') duplicates++;
      else unique++;
      if (record.role !== 'unique' && record.groupId) groupIds.add(record.groupId);
    }

    return {
      hashed: dedupRecords.size,
      groups: groupIds.size,
      representatives,
      duplicates,
      unique,
      suppressedSavings: duplicates,
    };
  }, [dedupRecords]);

  const persistDedupRecord = useCallback(async (record: DedupRecord) => {
    await saveDedupRecord(record);
    setDedupRecords((prev) => {
      const next = new Map(prev);
      next.set(record.frameId, record);
      return next;
    });
  }, []);

  /**
   * Hash every frame and group near-duplicates. Researcher overrides survive a
   * re-scan, and no source frame is ever removed.
   */
  const runDeduplication = useCallback(async () => {
    const frameList = Array.from(frames.values());
    if (frameList.length === 0) return;

    setDedupStatus({ phase: 'hashing', processed: 0, total: frameList.length });

    try {
      const { algorithm, hashSize, threshold } = dedupConfig;
      const now = new Date().toISOString();
      const hashes: { frameId: string; hash: string }[] = [];
      const nextRecords = new Map<string, DedupRecord>();

      for (let i = 0; i < frameList.length; i++) {
        const frame = frameList[i];
        const previous = dedupRecords.get(frame.id);
        const { hash } = await computeFrameHash(frame, { algorithm, hashSize });

        const record: DedupRecord = {
          frameId: frame.id,
          hash,
          algorithm,
          hashSize,
          role: previous?.overridden && previous.role ? previous.role : 'unique',
          overridden: previous?.overridden ?? false,
          computedAt: now,
        };
        if (previous?.overridden && previous.groupId) record.groupId = previous.groupId;
        if (previous?.overridden && previous.representativeFrameId) {
          record.representativeFrameId = previous.representativeFrameId;
        }

        hashes.push({ frameId: frame.id, hash });
        nextRecords.set(frame.id, record);
        // Throttle progress: one state write per frame re-renders the whole app.
        if (i % 5 === 0 || i === frameList.length - 1) {
          setDedupStatus({ phase: 'hashing', processed: i + 1, total: frameList.length });
        }
      }

      setDedupStatus({ phase: 'grouping', processed: frameList.length, total: frameList.length });
      const groups = groupBySimilarity(hashes, threshold);

      for (const group of groups) {
        group.frameIds.forEach((frameId, index) => {
          const record = nextRecords.get(frameId);
          if (!record || record.overridden) return;
          record.groupId = group.groupId;
          if (index === 0) {
            record.role = 'representative';
            delete record.representativeFrameId;
          } else {
            record.role = 'duplicate';
            record.representativeFrameId = group.representativeFrameId;
          }
        });
      }

      for (const record of nextRecords.values()) {
        await saveDedupRecord(record);
      }
      const nextConfig: DedupConfig = { ...dedupConfig, lastRunAt: now };
      await saveDedupConfig(nextConfig);

      setDedupRecords(nextRecords);
      setDedupConfig(nextConfig);
      setDedupStatus({ phase: 'done', processed: frameList.length, total: frameList.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deduplication failed.';
      setDedupStatus({ phase: 'error', processed: 0, total: 0, error: message });
    }
  }, [frames, dedupConfig, dedupRecords]);

  const setRepresentative = useCallback(
    async (frameId: string) => {
      const target = dedupRecords.get(frameId);
      if (!target) return;
      const updated = new Map(dedupRecords);

      if (target.groupId) {
        for (const [id, record] of updated) {
          if (id === frameId || record.groupId !== target.groupId) continue;
          const reassigned: DedupRecord = {
            frameId: record.frameId,
            hash: record.hash,
            algorithm: record.algorithm,
            hashSize: record.hashSize,
            groupId: record.groupId,
            role: 'duplicate',
            representativeFrameId: frameId,
            overridden: false,
            computedAt: record.computedAt,
          };
          updated.set(id, reassigned);
          await saveDedupRecord(reassigned);
        }
      }

      const representative: DedupRecord = {
        frameId: target.frameId,
        hash: target.hash,
        algorithm: target.algorithm,
        hashSize: target.hashSize,
        role: 'representative',
        overridden: true,
        computedAt: target.computedAt,
      };
      if (target.groupId) representative.groupId = target.groupId;
      updated.set(frameId, representative);
      await saveDedupRecord(representative);

      setDedupRecords(updated);
    },
    [dedupRecords]
  );

  const markDuplicate = useCallback(
    async (frameId: string, representativeFrameId?: string) => {
      const target = dedupRecords.get(frameId);
      if (!target) return;
      const representative =
        representativeFrameId ??
        target.representativeFrameId ??
        findGroupRepresentative(dedupRecords, target.groupId);

      const record: DedupRecord = {
        frameId: target.frameId,
        hash: target.hash,
        algorithm: target.algorithm,
        hashSize: target.hashSize,
        role: 'duplicate',
        overridden: true,
        computedAt: target.computedAt,
      };
      if (target.groupId) record.groupId = target.groupId;
      if (representative) record.representativeFrameId = representative;

      await persistDedupRecord(record);
    },
    [dedupRecords, persistDedupRecord]
  );

  /** Restore a suppressed frame — keeps it as a standalone candidate. */
  const restoreFrame = useCallback(
    async (frameId: string) => {
      const target = dedupRecords.get(frameId);
      if (!target) return;
      const record: DedupRecord = {
        frameId: target.frameId,
        hash: target.hash,
        algorithm: target.algorithm,
        hashSize: target.hashSize,
        role: 'unique',
        overridden: true,
        computedAt: target.computedAt,
      };
      await persistDedupRecord(record);
    },
    [dedupRecords, persistDedupRecord]
  );

  const setDedupThreshold = useCallback(
    async (threshold: number) => {
      const next: DedupConfig = { ...dedupConfig, threshold };
      setDedupConfig(next);
      await saveDedupConfig(next);
    },
    [dedupConfig]
  );

  const setDedupAlgorithm = useCallback(
    async (algorithm: HashAlgorithm) => {
      const next: DedupConfig = { ...dedupConfig, algorithm };
      setDedupConfig(next);
      await saveDedupConfig(next);
    },
    [dedupConfig]
  );

  return {
    encounters,
    filteredEncounters,
    frames,
    datasetInfo,
    activeEncounter,
    activeFrame,
    activeSampleId,
    activeIndex,
    hasNext,
    hasPrev,
    stats,
    isLoading,
    currentView,
    searchQuery,
    statusFilter,
    platformFilter,
    ugcTypeFilter,
    sortOption,
    dedupFilter,
    hideSuppressedDuplicates,
    setSearchQuery,
    setStatusFilter,
    setPlatformFilter,
    setUgcTypeFilter,
    setSortOption,
    setDedupFilter,
    setHideSuppressedDuplicates,
    setCurrentView,
    setActiveSampleId,
    openSampleInCockpit,
    goToNext,
    goToPrev,
    updateEncounter,
    updateDatasetMetadata,
    saveAndNext,
    setSampleStatus,
    ingestImageFiles,
    loadSampleBatch,
    clearSession,
    // OCR (Slice 3)
    ocrArtifacts,
    ocrStatus,
    getOcrArtifact,
    hasOcrForFrame,
    runOcrForFrame,
    runOcrBatch,
    // Deduplication (Slice 4)
    dedupRecords,
    dedupConfig,
    dedupStatus,
    dedupStats,
    runDeduplication,
    setRepresentative,
    markDuplicate,
    restoreFrame,
    setDedupThreshold,
    setDedupAlgorithm,
    // Field sessions (Slice 5)
    recordings,
    recordingList,
    extractionRuns,
    extractionStatus,
    samplingConfig,
    importRecordingFile,
    setSamplingConfig,
    previewSamplingGrid,
    runFrameExtraction,
    cancelExtraction,
    removeRecording,
  };
}
