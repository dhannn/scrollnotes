import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  EncounterSample,
  FrameRecord,
  DatasetInfo,
  OcrArtifact,
  DedupRecord,
  DedupConfig,
  RecordingRecord,
  ExtractionRun,
} from '../types/schema';

interface ScrollnotesDB extends DBSchema {
  frames: {
    key: string;
    value: FrameRecord;
    indexes: { 'by-imported': string };
  };
  encounters: {
    key: string;
    value: EncounterSample;
    indexes: {
      'by-frame': string;
      'by-status': string;
      'by-platform': string;
    };
  };
  dataset_info: {
    key: string;
    value: DatasetInfo;
  };
  // Slice 3 — OCR artifacts (keyed by frameId; separate from ground truth)
  ocr_artifacts: {
    key: string;
    value: OcrArtifact;
  };
  // Slice 4 — per-frame deduplication decision (keyed by frameId)
  dedup: {
    key: string;
    value: DedupRecord;
  };
  // Slice 4 — global deduplication configuration
  dedup_config: {
    key: string;
    value: DedupConfig;
  };
  // Slice 5 — source recordings (provenance containers, NOT platform categories)
  recordings: {
    key: string;
    value: RecordingRecord;
    indexes: { 'by-imported': string };
  };
  // Slice 5 — one sampling attempt per run (reproducibility for the manifest)
  extraction_runs: {
    key: string;
    value: ExtractionRun;
    indexes: { 'by-recording': string };
  };
}

const DB_NAME = 'scrollnotes_db_v1';
const DB_VERSION = 3;

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  id: 'default',
  algorithm: 'phash',
  threshold: 8,
  hashSize: 8,
};


let dbPromise: Promise<IDBPDatabase<ScrollnotesDB>> | null = null;

export const DEFAULT_DATASET_INFO: DatasetInfo = {
  id: 'default',
  name: 'Social Media UGC Benchmark',
  version: 'v0.1',
  description: 'Research fieldwork corpus for evaluating multimodal VLM performance on visual user-generated social media content.',
  targetMin: 150,
  targetMax: 200,
  // Slice 7: a fresh dataset is a DRAFT with setup incomplete. The previous default
  // of 'annotating' made every first-run manifest claim mid-annotation on a corpus
  // with zero samples, which violated AGENTS §24.
  lifecycleStatus: 'draft',
  sampleIdPrefix: 'ugc',
  isSetupComplete: false,
  hasExportedBefore: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Bring a persisted DatasetInfo up to the Slice 7 shape.
 *
 * Pure and idempotent. Two migrations run here:
 * 1. `targetCount` -> `targetMin`/`targetMax`, defaulting the band to 80-100% of
 *    the original single target (the heuristic proposed in plan_slice7.md).
 * 2. Pre-Slice-7 datasets are re-onboarded once: `isSetupComplete` defaults to
 *    false and the fabricated 'annotating' status is reset to 'draft'. Existing
 *    samples are NOT touched - the researcher simply walks the wizard once.
 */
/**
 * A dataset record as it may exist on disk: pre-Slice-7 records are missing
 * `targetMin`/`targetMax` and the setup flags entirely, so the input is widened
 * to accept them rather than forcing a cast at every call site.
 */
export type PersistedDatasetInfo = Omit<DatasetInfo, 'targetMin' | 'targetMax'> &
  Partial<Pick<DatasetInfo, 'targetMin' | 'targetMax'>>;

export function migrateDatasetInfo(info: PersistedDatasetInfo): DatasetInfo {
  const legacyTarget =
    typeof info.targetCount === 'number' && info.targetCount > 0 ? info.targetCount : null;

  const targetMin =
    typeof info.targetMin === 'number' && info.targetMin > 0
      ? info.targetMin
      : legacyTarget !== null
        ? Math.max(1, Math.round(legacyTarget * 0.8))
        : DEFAULT_DATASET_INFO.targetMin;
  const targetMax =
    typeof info.targetMax === 'number' && info.targetMax > 0
      ? info.targetMax
      : legacyTarget !== null
        ? legacyTarget
        : DEFAULT_DATASET_INFO.targetMax;

  return {
    ...info,
    targetMin: Math.min(targetMin, targetMax),
    targetMax: Math.max(targetMin, targetMax),
    lifecycleStatus: info.lifecycleStatus ?? 'draft',
    isSetupComplete: info.isSetupComplete ?? false,
    hasExportedBefore: info.hasExportedBefore ?? false,
  };
}

export async function getDB(): Promise<IDBPDatabase<ScrollnotesDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ScrollnotesDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('frames')) {
          const frameStore = db.createObjectStore('frames', { keyPath: 'id' });
          frameStore.createIndex('by-imported', 'importedAt');
        }

        if (!db.objectStoreNames.contains('encounters')) {
          const encounterStore = db.createObjectStore('encounters', { keyPath: 'sampleId' });
          encounterStore.createIndex('by-frame', 'frameId');
          encounterStore.createIndex('by-status', 'status');
          encounterStore.createIndex('by-platform', 'platform');
        }

        if (!db.objectStoreNames.contains('dataset_info')) {
          db.createObjectStore('dataset_info', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('ocr_artifacts')) {
          db.createObjectStore('ocr_artifacts', { keyPath: 'frameId' });
        }

        if (!db.objectStoreNames.contains('dedup')) {
          db.createObjectStore('dedup', { keyPath: 'frameId' });
        }

        if (!db.objectStoreNames.contains('dedup_config')) {
          db.createObjectStore('dedup_config', { keyPath: 'id' });
        }

        // Slice 5 — additive stores only; existing stores are never rewritten,
        // so sessions created under v1/v2 survive this upgrade intact.
        if (!db.objectStoreNames.contains('recordings')) {
          const recordingStore = db.createObjectStore('recordings', { keyPath: 'recordingId' });
          recordingStore.createIndex('by-imported', 'importedAt');
        }

        if (!db.objectStoreNames.contains('extraction_runs')) {
          const runStore = db.createObjectStore('extraction_runs', { keyPath: 'runId' });
          runStore.createIndex('by-recording', 'recordingId');
        }
      },
    });
  }
  return dbPromise;
}

// Frame operations
export async function saveFrame(frame: FrameRecord): Promise<void> {
  const db = await getDB();
  await db.put('frames', frame);
}

export async function getFrame(id: string): Promise<FrameRecord | undefined> {
  const db = await getDB();
  return db.get('frames', id);
}

export async function getAllFrames(): Promise<FrameRecord[]> {
  const db = await getDB();
  return db.getAll('frames');
}

export async function deleteFrame(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('frames', id);
}

// Encounter operations
export async function saveEncounter(encounter: EncounterSample): Promise<void> {
  const db = await getDB();
  await db.put('encounters', encounter);
}

export async function getEncounter(sampleId: string): Promise<EncounterSample | undefined> {
  const db = await getDB();
  return db.get('encounters', sampleId);
}

export async function getAllEncounters(): Promise<EncounterSample[]> {
  const db = await getDB();
  return db.getAll('encounters');
}

export async function deleteEncounter(sampleId: string): Promise<void> {
  const db = await getDB();
  await db.delete('encounters', sampleId);
}

// Dataset Info
export async function getDatasetInfo(): Promise<DatasetInfo> {
  const db = await getDB();
  const info = await db.get('dataset_info', 'default');
  if (!info) {
    await db.put('dataset_info', DEFAULT_DATASET_INFO);
    return DEFAULT_DATASET_INFO;
  }
  // Slice 7: migrate pre-Slice-7 datasets on read. Existing samples are never
  // touched; the researcher is simply asked to walk the setup wizard once.
  const migrated = migrateDatasetInfo(info);
  if (migrated.targetMin !== info.targetMin || migrated.isSetupComplete !== info.isSetupComplete) {
    await db.put('dataset_info', migrated);
  }
  return migrated;
}

export async function saveDatasetInfo(info: DatasetInfo): Promise<void> {
  const db = await getDB();
  await db.put('dataset_info', { ...info, id: 'default', updatedAt: new Date().toISOString() });
}

// ============================================================================
// OCR artifact operations (Slice 3) — kept strictly separate from ground truth.
// ============================================================================
export async function saveOcrArtifact(artifact: OcrArtifact): Promise<void> {
  const db = await getDB();
  await db.put('ocr_artifacts', artifact);
}

export async function getOcrArtifact(frameId: string): Promise<OcrArtifact | undefined> {
  const db = await getDB();
  return db.get('ocr_artifacts', frameId);
}

export async function getAllOcrArtifacts(): Promise<OcrArtifact[]> {
  const db = await getDB();
  return db.getAll('ocr_artifacts');
}

export async function deleteOcrArtifact(frameId: string): Promise<void> {
  const db = await getDB();
  await db.delete('ocr_artifacts', frameId);
}

// ============================================================================
// Deduplication operations (Slice 4) — reversible decisions, never destructive.
// ============================================================================
export async function saveDedupRecord(record: DedupRecord): Promise<void> {
  const db = await getDB();
  await db.put('dedup', record);
}

export async function getAllDedupRecords(): Promise<DedupRecord[]> {
  const db = await getDB();
  return db.getAll('dedup');
}

export async function deleteDedupRecord(frameId: string): Promise<void> {
  const db = await getDB();
  await db.delete('dedup', frameId);
}

export async function getDedupConfig(): Promise<DedupConfig> {
  const db = await getDB();
  const config = await db.get('dedup_config', 'default');
  if (!config) {
    await db.put('dedup_config', DEFAULT_DEDUP_CONFIG);
    return DEFAULT_DEDUP_CONFIG;
  }
  return config;
}

export async function saveDedupConfig(config: DedupConfig): Promise<void> {
  const db = await getDB();
  await db.put('dedup_config', { ...config, id: 'default' });
}

// ============================================================================
// Source recording operations (Slice 5)
// A recording is a provenance container. Deleting one NEVER cascades to its
// derived frames — reversibility outranks tidiness (AGENTS §17).
// ============================================================================
export async function saveRecording(recording: RecordingRecord): Promise<void> {
  const db = await getDB();
  await db.put('recordings', recording);
}

export async function getRecording(
  recordingId: string
): Promise<RecordingRecord | undefined> {
  const db = await getDB();
  return db.get('recordings', recordingId);
}

export async function getAllRecordings(): Promise<RecordingRecord[]> {
  const db = await getDB();
  return db.getAll('recordings');
}

/** Removes recording METADATA ONLY. Derived frames and encounters are untouched. */
export async function deleteRecording(recordingId: string): Promise<void> {
  const db = await getDB();
  await db.delete('recordings', recordingId);
}

// ---------------------------------------------------------------------------
// Extraction run operations (Slice 5)
// ---------------------------------------------------------------------------
export async function saveExtractionRun(run: ExtractionRun): Promise<void> {
  const db = await getDB();
  await db.put('extraction_runs', run);
}

export async function getExtractionRun(runId: string): Promise<ExtractionRun | undefined> {
  const db = await getDB();
  return db.get('extraction_runs', runId);
}

export async function getAllExtractionRuns(): Promise<ExtractionRun[]> {
  const db = await getDB();
  return db.getAll('extraction_runs');
}

export async function getLatestRunForRecording(
  recordingId: string
): Promise<ExtractionRun | undefined> {
  const db = await getDB();
  const runs = await db.getAllFromIndex('extraction_runs', 'by-recording', recordingId);
  return runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
}

// Clear all data
export async function clearEntireDatabase(): Promise<void> {
  const db = await getDB();
  await db.clear('frames');
  await db.clear('encounters');
  await db.clear('ocr_artifacts');
  await db.clear('dedup');
  await db.clear('dedup_config');
  await db.clear('recordings');
  await db.clear('extraction_runs');
}

/**
 * Metadata-only frame listing. Iterates with a cursor and drops `dataUrl` from
 * each record immediately, so the (large) base64 payloads are never all held in
 * memory at once. Read-only: the stored records are not touched.
 */
export async function getAllFrameMetas(): Promise<FrameRecord[]> {
  const db = await getDB();
  const metas: FrameRecord[] = [];
  let cursor = await db.transaction('frames').store.openCursor();
  while (cursor) {
    metas.push({ ...cursor.value, dataUrl: '' });
    cursor = await cursor.continue();
  }
  return metas;
}
