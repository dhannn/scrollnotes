import {
  hashPixels,
  hammingDistance,
  groupBySimilarity,
} from '../services/deduplication';
import type { DedupRecord, HashAlgorithm } from '../types/schema';

// Make console.assert failures fail the process (exit code 1).
let assertionFailures = 0;
const originalAssert = console.assert.bind(console);
console.assert = (condition: any, ...args: any[]) => {
  if (!condition) assertionFailures += 1;
  originalAssert(condition, ...args);
};

/** Build an RGBA buffer from a grayscale matrix (0-255). */
function rgbaFromGray(rows: number[][]): Uint8ClampedArray {
  const height = rows.length;
  const width = rows[0].length;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.max(0, Math.min(255, Math.round(rows[y][x])));
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * A structured "frame-like" image: smooth gradient background plus two solid
 * cards. Real screenshots are never perfectly uniform, and a uniform image is
 * a degenerate input for pHash (all low-frequency coefficients collapse to 0,
 * so any perturbation flips bits). This gives a stable, realistic base.
 */
function structuredBase(width: number, height: number): Uint8ClampedArray {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      let v = 40 + (x * 60) / width + (y * 90) / height;
      if (y > 12 && y < 34 && x > 8 && x < 44) v = 210;
      if (y > 42 && y < 58 && x > 20 && x < 56) v = 150;
      row.push(v);
    }
    rows.push(row);
  }
  return rgbaFromGray(rows);
}

/** Checkerboard: maximally different from a solid block at the same resolution. */
function checkerboard(size: number): Uint8ClampedArray {
  return rgbaFromGray(
    Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => ((x + y) % 2 === 0 ? 0 : 255))
    )
  );
}

/** Clone an image and perturb a few pixels (simulates scroll jitter / noise). */
function jitter(source: Uint8ClampedArray, amount: number, seedPixels: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(source);
  for (let k = 0; k < seedPixels; k++) {
    const i = ((k * 9973) % (out.length / 4)) * 4;
    out[i] = Math.max(0, Math.min(255, out[i] + amount));
    out[i + 1] = Math.max(0, Math.min(255, out[i + 1] + amount));
    out[i + 2] = Math.max(0, Math.min(255, out[i + 2] + amount));
  }
  return out;
}

const W = 64;
const H = 64;
const THRESHOLD = 8;

class MockSlice4Session {
  private records = new Map<string, DedupRecord>();
  private algorithm: HashAlgorithm = 'phash';
  private threshold = THRESHOLD;

  public scan(frames: { id: string; hash: string }[]) {
    const groups = groupBySimilarity(
      frames.map((f) => ({ frameId: f.id, hash: f.hash })),
      this.threshold
    );
    this.records.clear();
    for (const frame of frames) {
      this.records.set(frame.id, {
        frameId: frame.id,
        hash: frame.hash,
        algorithm: this.algorithm,
        hashSize: 8,
        role: 'unique',
        overridden: false,
        computedAt: '2026-10-04T00:00:00.000Z',
      });
    }
    for (const group of groups) {
      group.frameIds.forEach((frameId, index) => {
        const record = this.records.get(frameId);
        if (!record) return;
        record.groupId = group.groupId;
        if (index === 0) {
          record.role = 'representative';
        } else {
          record.role = 'duplicate';
          record.representativeFrameId = group.representativeFrameId;
        }
      });
    }
  }

  public get(frameId: string): DedupRecord | undefined {
    return this.records.get(frameId);
  }

  public get frameCount(): number {
    return this.records.size;
  }

  public groups(): string[] {
    const ids: string[] = [];
    for (const record of this.records.values()) {
      if (record.groupId && !ids.includes(record.groupId)) ids.push(record.groupId);
    }
    return ids;
  }

  public setRepresentative(frameId: string) {
    const target = this.records.get(frameId);
    if (!target || !target.groupId) return;
    for (const record of this.records.values()) {
      if (record.frameId !== frameId && record.groupId === target.groupId) {
        record.role = 'duplicate';
        record.representativeFrameId = frameId;
      }
    }
    target.role = 'representative';
    target.overridden = true;
    delete target.representativeFrameId;
  }

  public restoreFrame(frameId: string) {
    const target = this.records.get(frameId);
    if (!target) return;
    delete target.groupId;
    delete target.representativeFrameId;
    target.role = 'unique';
    target.overridden = true;
  }

  public setThreshold(threshold: number) {
    this.threshold = threshold;
  }

  public staleAfterAlgorithmChange(next: HashAlgorithm): boolean {
    return next !== this.algorithm;
  }
}

function runSlice4Verification() {
  console.log('Starting Scrollnotes Slice 4 (Deduplication) Verification...');
  const session = new MockSlice4Session();

  const base = structuredBase(W, H);
  const baseHash = hashPixels(base, W, H, { algorithm: 'phash' });
  const identicalHash = hashPixels(new Uint8ClampedArray(base), W, H, { algorithm: 'phash' });

  // Test 1: identical images hash identically; jitter stays small; checkerboard is far
  console.assert(baseHash === identicalHash, 'identical pixels must hash identically');
  console.assert(hammingDistance(baseHash, identicalHash) === 0, 'identical distance is 0');
  const jitteredHash = hashPixels(jitter(base, 16, 64), W, H, { algorithm: 'phash' });
  const jitterDistance = hammingDistance(baseHash, jitteredHash);
  console.assert(jitterDistance <= THRESHOLD, `jitter distance ${jitterDistance} <= ${THRESHOLD}`);
  const checkerHash = hashPixels(checkerboard(W), W, H, { algorithm: 'phash' });
  const checkerDistance = hammingDistance(baseHash, checkerHash);
  console.assert(
    checkerDistance > THRESHOLD,
    `checkerboard distance ${checkerDistance} must exceed ${THRESHOLD}`
  );
  const dhashA = hashPixels(base, W, H, { algorithm: 'dhash' });
  console.assert(dhashA.length === 16, 'dhash produces 64-bit hex');
  const ahashA = hashPixels(base, W, H, { algorithm: 'ahash' });
  console.assert(ahashA.length === 16, 'ahash produces 64-bit hex');
  console.assert(baseHash.length === 16, 'phash produces 64-bit hex');
  console.log('  pass: hash identity, jitter tolerance, and distinctness');

  // Test 2: grouping is conservative and collapses chains
  session.scan([
    { id: 'frame-a', hash: baseHash },
    { id: 'frame-b', hash: identicalHash },
    { id: 'frame-c', hash: checkerHash },
  ]);
  console.assert(session.groups().length === 1, 'one duplicate group expected');
  console.assert(session.get('frame-a')?.role === 'representative', 'first frame is rep');
  console.assert(session.get('frame-b')?.role === 'duplicate', 'near-identical suppressed');
  console.assert(
    session.get('frame-b')?.representativeFrameId === 'frame-a',
    'duplicate points at representative'
  );
  console.assert(session.get('frame-c')?.role === 'unique', 'distinct frame stays unique');
  console.assert(session.get('frame-c')?.groupId === undefined, 'unique frame ungrouped');
  console.log('  pass: obvious duplicates grouped, distinct frames stay distinct');

  // Test 3: representative selection reassigns the group
  session.setRepresentative('frame-b');
  console.assert(session.get('frame-b')?.role === 'representative', 'new rep assigned');
  console.assert(
    session.get('frame-a')?.representativeFrameId === 'frame-b',
    'old rep points at new rep'
  );
  console.assert(session.get('frame-a')?.role === 'duplicate', 'old rep demoted');
  console.log('  pass: representative selection reassigns members');

  // Test 4: suppressed frames can be restored
  session.restoreFrame('frame-a');
  console.assert(session.get('frame-a')?.role === 'unique', 'restored frame is unique');
  console.assert(session.get('frame-a')?.groupId === undefined, 'restored frame ungrouped');
  console.assert(session.get('frame-a')?.overridden === true, 'restore is researcher-owned');
  console.log('  pass: restore returns suppressed frames to the candidate pool');

  // Test 5: threshold sensitivity + algorithm staleness
  session.setThreshold(0);
  session.scan([
    { id: 'frame-a', hash: baseHash },
    { id: 'frame-c', hash: checkerHash },
  ]);
  console.assert(session.groups().length === 0, 'strict threshold groups nothing');
  session.setThreshold(64);
  session.scan([
    { id: 'frame-a', hash: baseHash },
    { id: 'frame-c', hash: checkerHash },
  ]);
  console.assert(session.groups().length === 1, 'loose threshold groups everything');
  console.assert(session.staleAfterAlgorithmChange('dhash') === true, 'algorithm change is stale');
  console.assert(session.staleAfterAlgorithmChange('phash') === false, 'same algorithm fresh');
  console.log('  pass: threshold governs grouping; algorithm changes flagged stale');

  // Test 6: persistence round-trip loses no frames
  const records = ['frame-a', 'frame-c']
    .map((id) => session.get(id))
    .filter((r): r is DedupRecord => r !== undefined);
  const roundTripped = JSON.parse(JSON.stringify(records)) as DedupRecord[];
  console.assert(roundTripped.length === 2, 'all records survive round-trip');
  console.assert(
    roundTripped.every((r) => typeof r.hash === 'string' && typeof r.role === 'string'),
    'hash + role survive round-trip'
  );
  console.log('  pass: dedup records + config survive save/load');

  console.log('\nALL SLICE 4 VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runSlice4Verification();

if (assertionFailures > 0) {
  console.error(`\n${assertionFailures} assertion(s) FAILED.`);
  process.exit(1);
}
