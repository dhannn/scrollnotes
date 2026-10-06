import type { FrameRecord, FrameHash, HashAlgorithm, DuplicateGroup } from '../types/schema';

/**
 * Deduplication Service (Slice 4)
 * --------------------------------
 * Conservative, reversible perceptual-hash near-duplicate detection.
 *
 * The hash math is a PURE core (no DOM) so it is unit-testable in Node; the
 * browser adapter only decodes an image to pixels and delegates to the core.
 */

export interface SimilarityResult {
  frameId: string;
  similarTo: string;
  distance: number;
}

export interface HashOptions {
  algorithm?: HashAlgorithm;
  /** 8 → 64-bit hash */
  hashSize?: number;
}

export interface CompareOptions extends HashOptions {
  threshold?: number;
}

export interface DeduplicationStrategy {
  compare(frames: FrameRecord[], options?: CompareOptions): Promise<SimilarityResult[]>;
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

function grayscale(rgba: ArrayLike<number>, width: number, height: number): Float64Array {
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4] || 0;
    const g = rgba[i * 4 + 1] || 0;
    const b = rgba[i * 4 + 2] || 0;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/** Box-average downscale — robust to high-resolution inputs. */
function downscaleBox(
  src: Float64Array,
  sw: number,
  sh: number,
  tw: number,
  th: number
): Float64Array {
  const out = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * sh) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * sh) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * sw) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * sw) / tw));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const rowOffset = y * sw;
        for (let x = x0; x < x1; x++) {
          sum += src[rowOffset + x];
          count++;
        }
      }
      out[ty * tw + tx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

function dct1d(input: Float64Array): Float64Array {
  const n = input.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i] * Math.cos((Math.PI * (2 * i + 1) * k) / (2 * n));
    }
    out[k] = sum;
  }
  return out;
}

function dct2d(src: Float64Array, w: number, h: number): Float64Array {
  const rows = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    rows.set(dct1d(src.subarray(y * w, (y + 1) * w)), y * w);
  }
  const out = new Float64Array(w * h);
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = rows[y * w + x];
    const transformed = dct1d(col);
    for (let y = 0; y < h; y++) out[y * w + x] = transformed[y];
  }
  return out;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return values.length > 0 ? sum / values.length : 0;
}

function bitsToHex(bits: number[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) nibble = (nibble << 1) | (bits[i + j] ?? 0);
    hex += nibble.toString(16);
  }
  return hex;
}

/** Compute a perceptual hash from raw RGBA pixel data (pure, no DOM). */
export function hashPixels(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: HashOptions = {}
): string {
  const algorithm = options.algorithm ?? 'phash';
  const hashSize = options.hashSize ?? 8;
  if (width <= 0 || height <= 0) return '';

  const gray = grayscale(rgba, width, height);
  const bits: number[] = [];

  if (algorithm === 'ahash') {
    const small = downscaleBox(gray, width, height, hashSize, hashSize);
    const mean = average(small);
    for (let i = 0; i < small.length; i++) bits.push(small[i] >= mean ? 1 : 0);
  } else if (algorithm === 'dhash') {
    const small = downscaleBox(gray, width, height, hashSize + 1, hashSize);
    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) {
        const left = small[y * (hashSize + 1) + x];
        const right = small[y * (hashSize + 1) + x + 1];
        bits.push(left > right ? 1 : 0);
      }
    }
  } else {
    const sample = Math.max(32, hashSize * 4);
    const small = downscaleBox(gray, width, height, sample, sample);
    const coeffs = dct2d(small, sample, sample);
    const picked: number[] = [];
    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) picked.push(coeffs[y * sample + x]);
    }
    const median = medianOf(picked);
    for (let i = 0; i < picked.length; i++) bits.push(picked[i] > median ? 1 : 0);
  }

  return bitsToHex(bits);
}

/** Hamming distance between two equal-length hex hashes. */
export function hammingDistance(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < len; i++) {
    let x = (parseInt(a[i] ?? '0', 16) || 0) ^ (parseInt(b[i] ?? '0', 16) || 0);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/**
 * Group hashes whose pairwise Hamming distance is <= threshold (union-find, so
 * chained similarity collapses into one group). Only groups with 2+ members are
 * returned; distinct frames remain distinct (conservative).
 */
export function groupBySimilarity(
  hashes: { frameId: string; hash: string }[],
  threshold: number
): DuplicateGroup[] {
  const n = hashes.length;
  const parent = hashes.map((_, i) => i);

  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hammingDistance(hashes[i].hash, hashes[j].hash) <= threshold) union(i, j);
    }
  }

  const grouped = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const bucket = grouped.get(root);
    if (bucket) bucket.push(i);
    else grouped.set(root, [i]);
  }

  const groups: DuplicateGroup[] = [];
  let counter = 0;
  for (const idxs of grouped.values()) {
    if (idxs.length < 2) continue;
    let maxDistance = 0;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        maxDistance = Math.max(
          maxDistance,
          hammingDistance(hashes[idxs[a]].hash, hashes[idxs[b]].hash)
        );
      }
    }
    counter++;
    const frameIds = idxs.map((k) => hashes[k].frameId);
    groups.push({
      groupId: `dup-${String(counter).padStart(4, '0')}`,
      frameIds,
      representativeFrameId: frameIds[0],
      maxDistance,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Browser adapter
// ---------------------------------------------------------------------------

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Frame image could not be decoded for hashing.'));
    img.src = src;
  });
}

async function framePixels(
  frame: FrameRecord
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const img = await loadImageElement(frame.dataUrl);
  const width = img.naturalWidth || frame.width || 256;
  const height = img.naturalHeight || frame.height || 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for perceptual hashing.');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  img.src = '';
  return { data, width, height };
}

/** Decode a frame and compute its perceptual hash. */
export async function computeFrameHash(
  frame: FrameRecord,
  options: HashOptions = {}
): Promise<FrameHash> {
  const algorithm = options.algorithm ?? 'phash';
  const hashSize = options.hashSize ?? 8;
  const { data, width, height } = await framePixels(frame);
  return {
    frameId: frame.id,
    hash: hashPixels(data, width, height, { algorithm, hashSize }),
    algorithm,
    hashSize,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Replaceable deduplication strategy (AGENTS §31). The heuristic lives behind
 * this interface so an embedding-based strategy can be substituted later.
 */
export class PerceptualHashStrategy implements DeduplicationStrategy {
  async compare(frames: FrameRecord[], options: CompareOptions = {}): Promise<SimilarityResult[]> {
    const threshold = options.threshold ?? 8;
    const hashed = await Promise.all(
      frames.map((frame) =>
        computeFrameHash(frame, { algorithm: options.algorithm, hashSize: options.hashSize })
      )
    );

    const results: SimilarityResult[] = [];
    for (let i = 0; i < hashed.length; i++) {
      for (let j = i + 1; j < hashed.length; j++) {
        const distance = hammingDistance(hashed[i].hash, hashed[j].hash);
        if (distance <= threshold) {
          results.push({ frameId: hashed[i].frameId, similarTo: hashed[j].frameId, distance });
          results.push({ frameId: hashed[j].frameId, similarTo: hashed[i].frameId, distance });
        }
      }
    }
    return results;
  }
}

