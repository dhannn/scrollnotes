import { getFrame } from './db';
import type { FrameRecord } from '../types/schema';

/**
 * On-demand frame pixels. React state holds metadata-only FrameRecords
 * (`dataUrl: ''`); the base64 payload lives only in IndexedDB (unchanged) and in
 * the two small bounded caches below.
 */

const FULL_CACHE_MAX = 5;
const THUMB_CACHE_MAX = 400;
const THUMB_WIDTH = 360;

const fullCache = new Map<string, string>(); // insertion order = LRU order
const thumbCache = new Map<string, string>();
const thumbWaiters = new Map<string, Promise<string | undefined>>();
let thumbQueue: Promise<unknown> = Promise.resolve();

/** A copy of the record without its image payload, safe to keep in React state. */
export function stripFrame(frame: FrameRecord): FrameRecord {
  return { ...frame, dataUrl: '' };
}

/** Full-size data URL for a frame (small LRU), or undefined if it is not stored. */
export async function getFrameDataUrl(frameId: string): Promise<string | undefined> {
  const hit = fullCache.get(frameId);
  if (hit !== undefined) {
    fullCache.delete(frameId);
    fullCache.set(frameId, hit);
    return hit;
  }
  const record = await getFrame(frameId);
  if (!record || !record.dataUrl) return undefined;
  fullCache.set(frameId, record.dataUrl);
  while (fullCache.size > FULL_CACHE_MAX) {
    const oldest = fullCache.keys().next().value;
    if (oldest === undefined) break;
    fullCache.delete(oldest);
  }
  return record.dataUrl;
}

/** Warm the LRU for likely-next frames; failures are ignored. */
export function prefetchFrames(frameIds: string[]): void {
  for (const id of frameIds) void getFrameDataUrl(id).catch(() => undefined);
}

/** Return a copy of the frame with its dataUrl filled in (not cached beyond the LRU). */
export async function hydrateFrame(frame: FrameRecord): Promise<FrameRecord> {
  if (frame.dataUrl) return frame;
  const dataUrl = await getFrameDataUrl(frame.id);
  return { ...frame, dataUrl: dataUrl ?? '' };
}

/** Drop all cached pixels (after clearing the session / loading a new batch). */
export function clearFrameImageCaches(): void {
  fullCache.clear();
  thumbCache.clear();
}

function renderThumb(dataUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, THUMB_WIDTH / (img.naturalWidth || THUMB_WIDTH));
      const w = Math.max(1, Math.round((img.naturalWidth || THUMB_WIDTH) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || THUMB_WIDTH) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      let out: string | undefined;
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        out = canvas.toDataURL('image/jpeg', 0.72);
      }
      canvas.width = 0;
      canvas.height = 0;
      img.src = '';
      resolve(out);
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

/**
 * Small downscaled preview for cards/lists. Generated one at a time (serial
 * queue) straight from IndexedDB, bounded cache; never touches the full LRU.
 */
export function getFrameThumb(frameId: string): Promise<string | undefined> {
  const cached = thumbCache.get(frameId);
  if (cached) return Promise.resolve(cached);
  const pending = thumbWaiters.get(frameId);
  if (pending) return pending;

  const job = thumbQueue.then(async () => {
    try {
      const record = await getFrame(frameId);
      if (!record?.dataUrl) return undefined;
      const thumb = await renderThumb(record.dataUrl);
      if (thumb) {
        thumbCache.set(frameId, thumb);
        while (thumbCache.size > THUMB_CACHE_MAX) {
          const oldest = thumbCache.keys().next().value;
          if (oldest === undefined) break;
          thumbCache.delete(oldest);
        }
      }
      return thumb;
    } catch {
      return undefined;
    } finally {
      thumbWaiters.delete(frameId);
    }
  });
  thumbQueue = job;
  thumbWaiters.set(frameId, job);
  return job;
}
