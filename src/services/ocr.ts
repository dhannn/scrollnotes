import { createWorker } from 'tesseract.js';
import tesseractPkg from 'tesseract.js/package.json';
import type { FrameRecord, OcrArtifact } from '../types/schema';

/**
 * OCR Service (Slice 3)
 * ----------------------
 * Isolated, replaceable preprocessing step. Produces an immutable {@link OcrArtifact}
 * for a frame. This module NEVER reads or writes human ground truth.
 *
 * Engine: Tesseract (via tesseract.js, WASM, runs entirely client-side).
 * The engine core + 'eng' traineddata are fetched once and cached by the browser.
 */

const WRAPPER_VERSION = (tesseractPkg as { version?: string }).version;

export interface OcrProgress {
  /** Raw engine status, e.g. 'loading tesseract core' | 'recognizing text'. */
  status: string;
  /** 0..1 for the current phase. */
  progress: number;
}

export interface OcrOptions {
  language?: string;
  onProgress?: (progress: OcrProgress) => void;
  /** Optional path overrides to run fully offline from locally-served assets. */
  paths?: { workerPath?: string; corePath?: string; langPath?: string };
}

export interface OcrResult {
  text: string;
  engine: 'tesseract';
  language: string;
  engineVersion?: string;
  wrapperVersion?: string;
  confidence?: number;
  generatedAt: string;
}

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

let workerPromise: Promise<TesseractWorker> | null = null;
let workerLanguage = 'eng';

/**
 * Lazily create and reuse a single worker (avoids re-initialising WASM per frame).
 * Recreates the worker only when the requested language changes.
 */
async function getWorker(
  language: string,
  options: OcrOptions
): Promise<TesseractWorker> {
  if (workerPromise && workerLanguage === language) {
    return workerPromise;
  }

  if (workerPromise) {
    const existing = await workerPromise;
    await existing.terminate();
    workerPromise = null;
  }

  workerLanguage = language;
  workerPromise = createWorker(language, undefined, {
    logger: (m: { status: string; progress: number }) =>
      options.onProgress?.({ status: m.status, progress: m.progress }),
    ...(options.paths || {}),
  });

  return workerPromise;
}

/** Terminate the shared worker (frees WASM memory). */
export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch {
      /* already gone */
    }
    workerPromise = null;
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Frame image could not be decoded.'));
    img.src = src;
  });
}

/**
 * The OCR engine consumes raster pixels. Non-raster frames (e.g. the built-in
 * SVG mock batch) are normalised to PNG through a canvas first.
 */
async function rasteriseFrame(frame: FrameRecord): Promise<string> {
  if (frame.mimeType && frame.mimeType !== 'image/svg+xml') {
    return frame.dataUrl;
  }

  const img = await loadImageElement(frame.dataUrl);
  const width = img.naturalWidth || frame.width || 1080;
  const height = img.naturalHeight || frame.height || 1440;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return frame.dataUrl;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/** Run OCR on a frame and return a structured, provenance-carrying result. */
export async function runOcr(frame: FrameRecord, options: OcrOptions = {}): Promise<OcrResult> {
  const language = options.language || 'eng';
  const worker = await getWorker(language, options);
  const image = await rasteriseFrame(frame);
  const { data } = await worker.recognize(image);

  return {
    text: data.text ?? '',
    engine: 'tesseract',
    language,
    engineVersion: data.version || undefined,
    wrapperVersion: WRAPPER_VERSION,
    confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    generatedAt: new Date().toISOString(),
  };
}

/** Pure artefact builder — no DOM, so it is unit testable. */
export function buildOcrArtifact(frameId: string, result: OcrResult): OcrArtifact {
  return {
    frameId,
    engine: result.engine,
    text: result.text,
    language: result.language,
    ...(result.engineVersion ? { engineVersion: result.engineVersion } : {}),
    ...(result.wrapperVersion ? { wrapperVersion: result.wrapperVersion } : {}),
    ...(typeof result.confidence === 'number' ? { confidence: result.confidence } : {}),
    generatedAt: result.generatedAt,
  };
}
