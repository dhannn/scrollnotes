import React, { useRef, useState } from 'react';
import { Video, FileVideo, Trash2, Play, X, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { ExtractionRun, ExtractionStatus, RecordingRecord, SamplingConfig } from '../types/schema';
import { formatClock, MIN_INTERVAL_SECONDS } from '../services/frameSampling';

interface RecordingImporterProps {
  recordings: RecordingRecord[];
  extractionRuns: Map<string, ExtractionRun>;
  extractionStatus: ExtractionStatus;
  samplingConfig: SamplingConfig;
  onImportRecording: (file: File) => Promise<RecordingRecord>;
  /** Bulk import (Slice 8): imports many recordings, reporting partial failures. */
  onImportRecordings: (
    files: File[]
  ) => Promise<{
    imported: { recording: RecordingRecord; file: File }[];
    failures: { filename: string; message: string }[];
  }>;
  /** Bulk extraction: runs one recording at a time, reporting per-recording failures. */
  onRunBulkExtraction: (
    entries: { recording: RecordingRecord; file: File }[],
    onProgress?: (done: number, total: number, current: RecordingRecord) => void
  ) => Promise<{ completed: number; failures: { filename: string; message: string }[]; cancelled: boolean }>;
  onSetSamplingConfig: (patch: Partial<SamplingConfig>) => void;
  onPreviewGrid: (recording: RecordingRecord) => { timestampsMs: number[]; truncated: boolean; warning?: string };
  onRunExtraction: (recording: RecordingRecord, file: File) => Promise<unknown>;
  onCancelExtraction: () => void;
  onRemoveRecording: (recordingId: string) => Promise<void>;
  /** Called after a successful run so the app can move to the gallery. */
  onExtractionComplete: () => void;
  onFilesSelected: (files: File[]) => void;
}

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,video/*';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Field Sessions (Slice 5)
 * ----------------------
 * A recording is the FIRST-CLASS unit of ingestion. Loose frame import is a
 * demoted fallback for recordings the browser cannot decode.
 */
export const RecordingImporter: React.FC<RecordingImporterProps> = ({
  recordings,
  extractionRuns,
  extractionStatus,
  samplingConfig,
  onImportRecording,
  onImportRecordings,
  onRunBulkExtraction,
  onSetSamplingConfig,
  onPreviewGrid,
  onRunExtraction,
  onCancelExtraction,
  onRemoveRecording,
  onExtractionComplete,
  onFilesSelected,
}) => {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /** Local handle on the imported File so a later Extract can reuse it. */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<RecordingRecord | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  /**
   * Bulk import state (Slice 8).
   *
   * `pendingFiles` keeps the File handle for every just-imported recording. A
   * `RecordingRecord` only stores metadata, so without holding the File there is
   * nothing to extract from after a reload — the researcher would have to
   * re-select every file. Cleared on extraction so memory is not held forever.
   */
  const [pendingFiles, setPendingFiles] = useState<Map<string, File>>(new Map());
  const [failedImports, setFailedImports] = useState<{ filename: string; message: string }[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  /** Non-null while a bulk extraction batch is running. */
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const isRunning = ['probing', 'extracting', 'persisting'].includes(extractionStatus.phase);

  const handleVideoPicked = async (file: File) => {
    setImportError(null);
    setSelectedFile(file);
    try {
      const recording = await onImportRecording(file);
      setSelectedRecording(recording);
    } catch (error) {
      setSelectedFile(null);
      setSelectedRecording(null);
      setImportError(
        error instanceof Error
          ? error.message
          : 'This recording could not be read in your browser.'
      );
    }
  };

  /**
   * Import several recordings in one action.
   *
   * A partial failure is surfaced per filename and never blocks the successes —
   * dropping nine good sessions because one .mov is undecodable would be worse
   * than the failure itself.
   */
  const handleVideosPicked = async (files: File[]) => {
    if (files.length === 0) return;
    setImportError(null);
    setFailedImports([]);
    setIsImporting(true);

    try {
      const { imported, failures } = await onImportRecordings(files);
      setFailedImports(failures);

      if (imported.length > 0) {
        // Select the first so the Extract panel is immediately actionable, and
        // remember every (recording, File) pair for bulk extraction. The pairs
        // come from the hook, so no index or filename guessing is needed here.
        const first = imported[0];
        setSelectedRecording(first.recording);
        setSelectedFile(first.file);
        setPendingFiles((prev) => {
          const next = new Map(prev);
          imported.forEach(({ recording, file }) => next.set(recording.recordingId, file));
          return next;
        });
      } else if (failures.length > 0) {
        // Every file failed. The per-file list below already names each one, so
        // do NOT also show the generic message here — the researcher should never
        // be told "a video failed" without being told WHICH video.
        setImportError(null);
      }
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : 'These recordings could not be read in your browser.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleVideoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    // One file keeps the single-recording path so existing behaviour (and the
    // per-file error message) is unchanged for the common case.
    if (files.length === 1) void handleVideoPicked(files[0]);
    else void handleVideosPicked(files);
    // Reset so re-picking the same file still fires a change event.
    e.target.value = '';
  };

  const handleExtract = async () => {
    if (!selectedRecording || !selectedFile) return;
    const result = (await onRunExtraction(selectedRecording, selectedFile)) as
      | { warnings?: string[]; error?: string }
      | undefined;
    if (result && !result.error) {
      onExtractionComplete();
    }
  };

  /**
   * Extract every pending recording, one after another.
   *
   * The button is only enabled when the researcher has File handles in memory —
   * after a reload the recordings are still listed, but their source files are
   * gone, so the action is unavailable rather than silently failing.
   */
  const handleExtractAll = async () => {
    const entries = [...pendingFiles.entries()].map(([recordingId, file]) => ({
      recording: recordings.find((r) => r.recordingId === recordingId)!,
      file,
    }));

    const usable = entries.filter((e) => e.recording);
    if (usable.length === 0) return;

    setFailedImports([]);
    const { failures, cancelled } = await onRunBulkExtraction(usable, (done, total) =>
      setBatchProgress({ done, total })
    );
    setBatchProgress(null);
    setFailedImports(failures);

    // Release the File handles; a completed batch must not pin them in memory.
    setPendingFiles(new Map());

    // Navigate only on real completion — a cancelled batch is a deliberate stop,
    // and yanking the researcher away would hide what they just did.
    if (!cancelled && failures.length === 0) onExtractionComplete();
  };

  const grid = selectedRecording ? onPreviewGrid(selectedRecording) : null;
  const progressPercent =
    extractionStatus.total > 0
      ? Math.round((extractionStatus.processed / extractionStatus.total) * 100)
      : 0;

  // ---- RENDER -------------------------------------------------------------

  return (
    <div className="sessions-view">
      {/* ------------------------------------------------------------------ */}
      {/* Left: registered field sessions                                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="sessions-list-panel">
        <header className="sessions-panel-header">
          <h2 className="sessions-panel-title">Field Sessions</h2>
          <p className="sessions-panel-subtitle">
            A recording is a provenance container. It may contain any mix of platforms —
            platform is verified per sample, never per recording.
          </p>
        </header>

        {recordings.length === 0 ? (
          <div className="sessions-empty">
            <Video size={26} />
            <p>No field sessions imported yet.</p>
            <p className="sessions-empty-hint">
              Import a screen recording to sample frames with full provenance.
            </p>
          </div>
        ) : (
          <ul className="sessions-list">
            {recordings.map((recording) => {
              const runs = [...extractionRuns.values()]
                .filter((run) => run.recordingId === recording.recordingId)
                .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
              const latest = runs[0];
              const isSelected = selectedRecording?.recordingId === recording.recordingId;
              const isActive = extractionStatus.recordingId === recording.recordingId;

              return (
                <li
                  key={recording.recordingId}
                  className={`session-card ${isSelected ? 'is-selected' : ''} ${
                    isActive ? 'is-active' : ''
                  }`}
                  onClick={() => {
                    setSelectedRecording(recording);
                    setImportError(null);
                  }}
                >
                  <div className="session-card-head">
                    <span className="session-card-id">{recording.recordingId}</span>
                    <span className="session-card-name" title={recording.filename}>
                      {recording.filename}
                    </span>
                  </div>
                  <div className="session-card-meta">
                    <span>
                      {recording.durationMs
                        ? formatClock(recording.durationMs)
                        : 'duration unknown'}
                    </span>
                    <span>·</span>
                    <span>{formatBytes(recording.sizeBytes)}</span>
                    {latest && (
                      <>
                        <span>·</span>
                        <span
                          className={`session-run-status is-${latest.status}`}
                          title={latest.error || latest.warnings?.join('\n') || undefined}
                        >
                          {latest.frameCount} frames ({latest.status})
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    className="session-card-remove"
                    title="Remove session metadata (frames are kept)"
                    aria-label={`Remove ${recording.recordingId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRemoveRecording(recording.recordingId);
                      if (selectedRecording?.recordingId === recording.recordingId) {
                        setSelectedRecording(null);
                        setSelectedFile(null);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Right: import + sampling controls                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="sampling-panel">
        <header className="sessions-panel-header">
          <h2 className="sessions-panel-title">Import Recording</h2>
          <p className="sessions-panel-subtitle">
            Screen-record yourself browsing feeds, then sample it. Frames are stored locally
            and never uploaded.
          </p>
        </header>

        <input
          type="file"
          ref={videoInputRef}
          onChange={handleVideoInput}
          // `multiple` is what makes multi-select work; without it the picker
          // allows exactly one file, which is the reported bug.
          multiple
          accept={VIDEO_ACCEPT}
          style={{ display: 'none' }}
        />
        <input
          type="file"
          ref={imageInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFilesSelected(Array.from(e.target.files));
            }
            e.target.value = '';
          }}
          multiple
          accept="image/png, image/jpeg, image/jpg, image/webp"
          style={{ display: 'none' }}
        />

        <button
          className="btn btn-primary sessions-import-btn"
          onClick={() => videoInputRef.current?.click()}
          disabled={isRunning || isImporting}
        >
          <FileVideo size={16} />
          <span>
            {isImporting ? 'Importing recordings…' : 'Select screen recordings…'}
          </span>
        </button>

        {/* Bulk extraction. Disabled when no File handles are in memory — after a
            reload the recordings persist but their sources do not, so re-select
            them rather than silently extracting nothing. */}
        {pendingFiles.size > 1 && !batchProgress && (
          <button
            className="btn btn-secondary sessions-extract-all-btn"
            onClick={() => void handleExtractAll()}
            disabled={isRunning || isImporting}
          >
            <Play size={16} />
            <span>
              Extract frames from all {pendingFiles.size} recordings
            </span>
          </button>
        )}

        {batchProgress && (
          <div className="extraction-progress" role="status">
            <div className="extraction-progress-head">
              <Loader2 size={14} className="spin" />
              <span>
                Extracting recording {batchProgress.done} of {batchProgress.total}…
              </span>
            </div>
            <div className="extraction-progress-track">
              <div
                className="extraction-progress-fill"
                style={{
                  width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%`,
                }}
              />
            </div>
            <button className="btn btn-secondary" onClick={onCancelExtraction}>
              <X size={14} />
              <span>Cancel — keep frames extracted so far</span>
            </button>
          </div>
        )}

        {/* Per-file failures. Never silent, never fatal to the successes. */}
        {failedImports.length > 0 && (
          <div className="sessions-warning" role="status">
            <AlertTriangle size={14} />
            <div>
              <p>
                {failedImports.length} recording
                {failedImports.length === 1 ? '' : 's'} could not be imported:
              </p>
              <ul className="sessions-warning-list">
                {failedImports.map((f) => (
                  <li key={f.filename}>
                    <strong>{f.filename}</strong> — {f.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {importError && (
          <div className="sessions-error" role="alert">
            <AlertTriangle size={14} />
            <span>{importError}</span>
          </div>
        )}

        {/* ---- Sampling controls ---- */}
        <div className="sampling-controls">
          <div className="sampling-row">
            <label htmlFor="sampling-interval">Sampling interval</label>
            <div className="sampling-input-wrap">
              <input
                id="sampling-interval"
                type="number"
                min={MIN_INTERVAL_SECONDS}
                step={0.1}
                value={samplingConfig.intervalSeconds}
                disabled={isRunning}
                onChange={(e) =>
                  onSetSamplingConfig({ intervalSeconds: Number(e.target.value) })
                }
              />
              <span className="sampling-unit">s</span>
            </div>
          </div>

          <div className="sampling-row">
            <label htmlFor="sampling-start">Start</label>
            <div className="sampling-input-wrap">
              <input
                id="sampling-start"
                type="number"
                min={0}
                step={1}
                value={samplingConfig.startSeconds}
                disabled={isRunning}
                onChange={(e) =>
                  onSetSamplingConfig({ startSeconds: Number(e.target.value) })
                }
              />
              <span className="sampling-unit">s</span>
            </div>
          </div>

          <div className="sampling-row">
            <label htmlFor="sampling-end">End</label>
            <div className="sampling-input-wrap">
              <input
                id="sampling-end"
                type="number"
                min={0}
                step={1}
                placeholder="auto"
                value={samplingConfig.endSeconds ?? ''}
                disabled={isRunning}
                onChange={(e) => {
                  const raw = e.target.value;
                  onSetSamplingConfig({
                    endSeconds: raw === '' ? undefined : Number(raw),
                  });
                }}
              />
              <span className="sampling-unit">s</span>
            </div>
          </div>

          <div className="sampling-row">
            <label htmlFor="sampling-max">Max frames</label>
            <div className="sampling-input-wrap">
              <input
                id="sampling-max"
                type="number"
                min={1}
                step={50}
                value={samplingConfig.maxFrames}
                disabled={isRunning}
                onChange={(e) =>
                  onSetSamplingConfig({ maxFrames: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="sampling-row">
            <label htmlFor="sampling-format">Format</label>
            <select
              id="sampling-format"
              value={samplingConfig.outputFormat}
              disabled={isRunning}
              onChange={(e) =>
                onSetSamplingConfig({
                  outputFormat: e.target.value as 'image/png' | 'image/jpeg',
                })
              }
            >
              <option value="image/png">PNG (lossless)</option>
              <option value="image/jpeg">JPEG (smaller)</option>
            </select>
          </div>
        </div>

        {/* ---- Estimate ---- */}
        <div className="sampling-estimate">
          {selectedRecording ? (
            grid && grid.timestampsMs.length > 0 ? (
              <span className={grid.truncated ? 'is-truncated' : ''}>
                Estimated frames: <strong>{grid.timestampsMs.length}</strong>
                {selectedRecording.durationMs
                  ? ` from ${formatClock(
                      selectedRecording.durationMs
                    )} of footage`
                  : ''}
              </span>
            ) : (
              <span className="is-warning">
                No frames would be sampled with these settings.
              </span>
            )
          ) : (
            <span className="sampling-estimate-hint">
              Select a recording to preview the sampling grid.
            </span>
          )}
        </div>

        {grid?.warning && (
          <div className="sessions-warning" role="status">
            <AlertTriangle size={14} />
            <span>{grid.warning}</span>
          </div>
        )}

        {/* ---- Extract / progress ---- */}
        {!isRunning ? (
          <button
            className="btn btn-primary sessions-extract-btn"
            onClick={() => void handleExtract()}
            disabled={!selectedRecording || !selectedFile || !grid || grid.timestampsMs.length === 0}
          >
            <Play size={16} />
            <span>Extract Frames</span>
          </button>
        ) : (
          <div className="extraction-progress">
            <div className="extraction-progress-head">
              <Loader2 size={14} className="spin" />
              <span>
                {extractionStatus.phase === 'probing'
                  ? 'Reading recording…'
                  : extractionStatus.phase === 'persisting'
                  ? 'Saving frames…'
                  : `Extracting ${extractionStatus.processed} / ${extractionStatus.total}`}
              </span>
              <span className="extraction-progress-percent">{progressPercent}%</span>
            </div>
            <div className="extraction-progress-track">
              <div
                className="extraction-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <button className="btn btn-secondary" onClick={onCancelExtraction}>
              <X size={14} />
              <span>Cancel — keep extracted frames</span>
            </button>
          </div>
        )}

        {extractionStatus.phase === 'done' && (
          <div className="sessions-success">
            <CheckCircle2 size={14} />
            <span>
              Extracted {extractionStatus.processed} frame
              {extractionStatus.processed === 1 ? '' : 's'}. Curation is the next step.
            </span>
          </div>
        )}

        {extractionStatus.phase === 'cancelled' && (
          <div className="sessions-warning">
            <AlertTriangle size={14} />
            <span>
              Extraction cancelled. {extractionStatus.processed} frame
              {extractionStatus.processed === 1 ? '' : 's'} captured so far were kept.
            </span>
          </div>
        )}

        {extractionStatus.warnings.length > 0 && extractionStatus.phase !== 'extracting' && (
          <ul className="sessions-warning-list">
            {extractionStatus.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        )}

        {/* ---- Demoted fallback: pre-extracted frames ---- */}
        <div className="sessions-fallback">
          <div className="sessions-fallback-rule" />
          <p className="sessions-fallback-label">
            Pre-extracted frames <em>(no recording provenance)</em>
          </p>
          <p className="sessions-fallback-hint">
            Fallback for recordings your browser cannot decode. Samples imported this way
            carry no recording id or timestamp.
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => imageInputRef.current?.click()}
            disabled={isRunning}
          >
            <span>Select frame images…</span>
          </button>
        </div>
      </section>
    </div>
  );
};