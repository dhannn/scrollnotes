import type { FrameRecord, RecordingRecord, SamplingConfig, ExtractionRun } from '../types/schema';

/**
 * Frame Sampling Service (Slice 5)
 * ----------------------------------
 * Extracts candidate frames from a screen recording on an explicit sampling grid.
 *
 * Structure mirrors services/ocr.ts and services/deduplication.ts:
 *   - a PURE core (no DOM) that is unit-testable in Node, and
 *   - a BROWSER adapter that decodes video and delegates to the core.
 *
 * Isolated behind `extractFrames(file, options)` so a CLI/Python extractor can
 * replace it later without touching the UI (AGENTS section 32).
 *
 * THIS SERVICE NEVER TOUCHES GROUND TRUTH. Frames and provenance only.
 */

/** A recording may be sampled only at coarse intervals - this is a scroll sampler. */
export const MIN_INTERVAL_SECONDS = 0.1;

export type SamplingOptions = {
  intervalSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
};

export interface SamplingGrid {
  timestampsMs: number[];
  /** true when maxFrames clipped the grid - NEVER silent. */
  truncated: boolean;
  warning?: string;
}

export interface ExtractionProgress {
  processed: number;
  total: number;
  timestampMs: number;
}

export interface ExtractFramesOptions extends SamplingOptions {
  recordingId: string;
  outputFormat: 'image/png' | 'image/jpeg';
  quality: number;
  maxFrames: number;
  onProgress?: (progress: ExtractionProgress) => void;
  signal?: AbortSignal;
}

export interface ExtractFramesResult {
  frames: FrameRecord[];
  /** Parallel to frames - the timestamps actually captured. */
  timestampsMs: number[];
  warnings: string[];
  cancelled: boolean;
}

// ===========================================================================
// Pure core (DOM-free - unit testable in Node)
// ===========================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** "08:43" style clock, used in provenance messages. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Deterministic, collision-free frame filename for a recording.
 * Matches the AGENTS section 6 convention: rec-0001_0128400.jpg
 */
export function buildFrameFilename(recordingId: string, timestampMs: number): string {
  const ms = Math.max(0, Math.round(timestampMs));
  return `${recordingId}_${String(ms).padStart(7, '0')}.jpg`;
}

/** Sequential, human-readable recording id: rec-0001, rec-0002, ... */
export function deriveRecordingId(existingCount: number): string {
  return `rec-${String(Math.max(0, existingCount) + 1).padStart(4, '0')}`;
}

export function deriveRunId(existingCount: number, sequence = 0): string {
  const suffix = Date.now().toString(36).slice(-4);
  // The sequence breaks ties when two runs start inside the same millisecond,
  // which happens routinely during a bulk extraction batch.
  return `run-${String(Math.max(0, existingCount) + 1).padStart(4, '0')}-${suffix}-${sequence}`;
}

/** Frame ids carry a random suffix so two runs over one recording never collide. */
export function deriveFrameId(): string {
  return `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Estimate byte size from a data URL (base64 payload is about 3/4 of the length). */
export function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl.length;
  return Math.round(((dataUrl.length - commaIndex - 1) * 3) / 4);
}


/**
 * Build the sampling grid for a recording.
 * - `endSeconds` is clamped to the recording duration when a duration is known.
 * - `maxFrames` truncates the grid but ALWAYS reports it via `truncated`/`warning`,
 *   because a silently shortened corpus is a provenance lie.
 */
export function computeSamplingGrid(
  durationMs: number | undefined,
  options: SamplingOptions,
  maxFrames: number = 1200
): SamplingGrid {
  const intervalSeconds = Math.max(
    MIN_INTERVAL_SECONDS,
    Number.isFinite(options.intervalSeconds) ? options.intervalSeconds : 1
  );
  const intervalMs = Math.round(intervalSeconds * 1000);

  const startMs = Math.max(0, Math.round((options.startSeconds ?? 0) * 1000));

  let endMs: number | undefined;
  if (typeof options.endSeconds === 'number' && Number.isFinite(options.endSeconds)) {
    endMs = Math.round(options.endSeconds * 1000);
  }
  // An explicitly requested window is always capped by the real duration.
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
    endMs = endMs === undefined ? durationMs : Math.min(endMs, durationMs);
  }

  if (endMs !== undefined && startMs >= endMs) {
    return {
      timestampsMs: [],
      truncated: false,
      warning:
        'Start time is at or after the end time, so no frames were sampled. Adjust the sampling window.',
    };
  }

  const timestampsMs: number[] = [];
  let truncated = false;
  for (let t = startMs; endMs === undefined ? true : t < endMs; t += intervalMs) {
    if (timestampsMs.length >= maxFrames) {
      truncated = true;
      break;
    }
    timestampsMs.push(t);
  }

  let warning: string | undefined;
  if (timestampsMs.length === 0) {
    warning =
      typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs <= 0
        ? 'This recording reports no duration, so a sampling grid cannot be built. Enter start and end times manually, or import pre-extracted frames instead.'
        : 'No frames were sampled. Check the interval and sampling window.';
  } else if (truncated) {
    const firstMs = timestampsMs[0];
    const lastMs = timestampsMs[timestampsMs.length - 1];
    warning = `Interval would produce more than ${maxFrames} frames; capped at ${maxFrames} (${formatClock(
      firstMs
    )}-${formatClock(lastMs)} sampled). Narrow the start/end window, or raise the interval, to cover the full session.`;
  }

  return { timestampsMs, truncated, ...(warning ? { warning } : {}) };
}

/**
 * Validate and normalise a sampling configuration, clamping every field into a
 * safe range. Returns warnings for anything that was adjusted.
 */
export function normaliseSamplingConfig(config: SamplingConfig): {
  config: SamplingConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  const requestedInterval = config.intervalSeconds;

  const intervalSeconds = Number.isFinite(requestedInterval)
    ? clamp(requestedInterval, MIN_INTERVAL_SECONDS, 600)
    : 1;
  if (intervalSeconds !== requestedInterval) {
    warnings.push(
      `Sampling interval was clamped to ${intervalSeconds}s (allowed range ${MIN_INTERVAL_SECONDS}s-600s).`
    );
  }

  const startSeconds = Number.isFinite(config.startSeconds) ? Math.max(0, config.startSeconds) : 0;

  let endSeconds = config.endSeconds;
  if (endSeconds !== undefined && (!Number.isFinite(endSeconds) || endSeconds <= 0)) {
    warnings.push('End time was ignored because it was not a positive number.');
    endSeconds = undefined;
  }
  if (endSeconds !== undefined && endSeconds <= startSeconds) {
    warnings.push('End time was ignored because it is at or before the start time.');
    endSeconds = undefined;
  }

  const maxFrames = Number.isFinite(config.maxFrames)
    ? clamp(Math.floor(config.maxFrames), 1, 20000)
    : 1200;

  const quality =
    config.outputFormat === 'image/jpeg'
      ? clamp(Number.isFinite(config.quality) ? config.quality : 0.92, 0.1, 1)
      : config.quality;

  return {
    config: {
      intervalSeconds,
      startSeconds,
      ...(endSeconds !== undefined ? { endSeconds } : {}),
      outputFormat: config.outputFormat === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      quality,
      maxFrames,
    },
    warnings,
  };
}

/**
 * Create a `running` ExtractionRun describing the attempt, before any frame is
 * captured. Persisting this up front means an interrupted run is still auditable.
 */
export function planExtraction(input: {
  runId: string;
  recording: RecordingRecord;
  sampling: SamplingConfig;
}): { run: ExtractionRun; warnings: string[] } {
  const { config, warnings } = normaliseSamplingConfig(input.sampling);
  const grid = computeSamplingGrid(input.recording.durationMs, config, config.maxFrames);
  if (grid.warning) warnings.push(grid.warning);

  return {
    run: {
      runId: input.runId,
      recordingId: input.recording.recordingId,
      sampling: config,
      timestampsMs: grid.timestampsMs,
      frameIds: [],
      frameCount: 0,
      startedAt: new Date().toISOString(),
      status: 'running',
      ...(warnings.length ? { warnings } : {}),
    },
    warnings,
  };
}

// ===========================================================================
// Browser adapter
// ===========================================================================

/** Human-readable decode failure (AGENTS section 39) - never a raw DOMException. */
export const DECODE_ERROR_MESSAGE =
  'This video could not be decoded in your browser. Either export it as H.264 MP4, or extract frames externally and drop the images in - provenance fields stay editable either way.';

export function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
    };
    video.onloadedmetadata = () => {
      cleanup();
      resolve(video);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(DECODE_ERROR_MESSAGE));
    };
    video.src = url;
    video.load();
  });
}

/**
 * Probe duration and intrinsic size. `durationMs` is OMITTED (never guessed)
 * when the browser reports an unusable value such as NaN/Infinity (streamed WebM).
 */
export async function probeRecording(
  file: File
): Promise<{ durationMs?: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideoElement(url);
    const raw = video.duration;
    const usable = Number.isFinite(raw) && raw > 0 ? raw : undefined;
    return {
      ...(usable ? { durationMs: Math.round(usable * 1000) } : {}),
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Seek and wait for the decoder to settle on the new frame. */
export function seekTo(
  video: HTMLVideoElement,
  timeSec: number,
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      // A slow keyframe seek is non-fatal: the captured frame may be slightly
      // off, and dedup absorbs visually identical neighbours anyway.
      resolve();
    }, timeoutMs);

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(DECODE_ERROR_MESSAGE));
    };

    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    }

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    // The +1ms nudge avoids landing on the previous frame at an exact boundary.
    video.currentTime = Math.max(0, timeSec + 0.001);
  });
}


/**
 * Extract frames from a recording at the given sampling options.
 *
 * Each captured frame carries full provenance: recordingId, timestampMs and a
 * deterministic filename. Individual frame failures are collected as warnings so
 * one bad seek cannot destroy an otherwise good run.
 */
export async function extractFrames(
  file: File,
  options: ExtractFramesOptions
): Promise<ExtractFramesResult> {
  const { config, warnings } = normaliseSamplingConfig({
    intervalSeconds: options.intervalSeconds,
    startSeconds: options.startSeconds ?? 0,
    ...(options.endSeconds !== undefined ? { endSeconds: options.endSeconds } : {}),
    outputFormat: options.outputFormat,
    quality: options.quality,
    maxFrames: options.maxFrames,
  });

  const url = URL.createObjectURL(file);
  const frames: FrameRecord[] = [];
  const timestampsMs: number[] = [];
  let cancelled = false;

  try {
    const video = await loadVideoElement(url);
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;

    const grid = computeSamplingGrid(
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000)
        : undefined,
      config,
      config.maxFrames
    );
    if (grid.warning) warnings.push(grid.warning);

    if (grid.timestampsMs.length === 0) {
      return { frames, timestampsMs, warnings, cancelled };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width || 1920;
    canvas.height = height || 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(
        'The browser could not provide a 2D canvas, which frame extraction requires. Try Chrome, Edge, or Firefox, or import pre-extracted frames instead.'
      );
    }

    const now = new Date().toISOString();
    let skipped = 0;

    for (let index = 0; index < grid.timestampsMs.length; index++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }

      const timestampMs = grid.timestampsMs[index];
      options.onProgress?.({ processed: index, total: grid.timestampsMs.length, timestampMs });

      try {
        await seekTo(video, timestampMs / 1000);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL(config.outputFormat, config.quality);
        frames.push({
          id: deriveFrameId(),
          filename: buildFrameFilename(options.recordingId, timestampMs),
          dataUrl,
          mimeType: config.outputFormat,
          width: canvas.width,
          height: canvas.height,
          sizeBytes: estimateDataUrlBytes(dataUrl),
          importedAt: now,
        });
        timestampsMs.push(timestampMs);
      } catch {
        // Skip this frame, keep going - one bad seek must not lose the session.
        skipped += 1;
      }
    }

    if (skipped > 0) {
      warnings.push(
        `${skipped} frame${skipped === 1 ? '' : 's'} could not be captured and ${
          skipped === 1 ? 'was' : 'were'
        } skipped. Every other frame was saved.`
      );
    }

    options.onProgress?.({
      processed: timestampsMs.length,
      total: grid.timestampsMs.length,
      timestampMs: timestampsMs[timestampsMs.length - 1] ?? 0,
    });

    return { frames, timestampsMs, warnings, cancelled };
  } catch (error) {
    if (error instanceof Error && error.message === DECODE_ERROR_MESSAGE) {
      throw error;
    }
    throw new Error(`This recording could not be read in your browser. ${DECODE_ERROR_MESSAGE}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}