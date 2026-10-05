/**
 * Slice 5 verification - Recording Import & Frame Sampling
 *
 * Runs in Node against the PURE core only (no DOM). Covers the sampling math,
 * provenance integrity, and the structural guarantee that extraction can never
 * seed ground truth.
 */
import {
  computeSamplingGrid,
  normaliseSamplingConfig,
  planExtraction,
  buildFrameFilename,
  deriveRecordingId,
  deriveRunId,
  deriveFrameId,
  estimateDataUrlBytes,
  formatClock,
  MIN_INTERVAL_SECONDS,
} from '../services/frameSampling';
import { createEncounterForFrame } from '../services/encounters';
import { DEFAULT_SAMPLING_CONFIG } from '../types/schema';
import type { FrameRecord, RecordingRecord } from '../types/schema';

let assertionFailures = 0;
const originalAssert = console.assert.bind(console);
console.assert = (condition: any, ...args: any[]) => {
  if (!condition) assertionFailures += 1;
  originalAssert(condition, ...args);
};

function makeRecording(overrides: Partial<RecordingRecord> = {}): RecordingRecord {
  return {
    recordingId: 'rec-0001',
    filename: 'session_01.mp4',
    durationMs: 600000,
    importedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeFrame(overrides: Partial<FrameRecord> = {}): FrameRecord {
  return {
    id: 'frame-abc',
    filename: 'rec-0001_0000000.jpg',
    dataUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
    width: 1920,
    height: 1080,
    sizeBytes: 3,
    importedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

function runSlice5Verification() {
  console.log('\n=== SLICE 5 VERIFICATION: Recording Import & Frame Sampling ===\n');

  // Test 1: grid spacing honours the interval and the start offset
  const grid = computeSamplingGrid(600000, { intervalSeconds: 1 }, 1200);
  console.assert(grid.timestampsMs.length === 600, '10 min at 1.0s yields 600 frames');
  console.assert(grid.timestampsMs[0] === 0, 'first timestamp is 0');
  console.assert(grid.timestampsMs[1] === 1000, 'grid steps by the interval');
  console.assert(grid.timestampsMs[599] === 599000, 'last timestamp inside duration');
  console.assert(grid.truncated === false, 'a 10 min session at 1.0s is not truncated');
  console.assert(grid.warning === undefined, 'no warning when nothing is clipped');
  console.log('  pass: grid spacing, start offset, and no spurious truncation');

  // Test 2: start offset and endSeconds clamping
  const offset = computeSamplingGrid(600000, { intervalSeconds: 2, startSeconds: 10 }, 1200);
  console.assert(offset.timestampsMs[0] === 10000, 'start offset respected');
  console.assert(offset.timestampsMs[1] === 12000, 'interval still 2s after offset');

  const clamped = computeSamplingGrid(
    60000,
    { intervalSeconds: 1, startSeconds: 0, endSeconds: 9999 },
    1200
  );
  console.assert(clamped.timestampsMs.length === 60, 'endSeconds clamped to real duration');
  console.assert(
    clamped.timestampsMs[clamped.timestampsMs.length - 1] === 59000,
    'grid stops at the duration'
  );

  const windowed = computeSamplingGrid(
    600000,
    { intervalSeconds: 1, startSeconds: 30, endSeconds: 35 },
    1200
  );
  console.assert(windowed.timestampsMs.length === 5, 'explicit window yields 5 frames');
  console.assert(windowed.timestampsMs[0] === 30000, 'window starts where requested');
  console.log('  pass: start offsets, end clamping, and explicit windows');

  // Test 3: maxFrames truncates but NEVER silently
  const capped = computeSamplingGrid(600000, { intervalSeconds: 0.1 }, 50);
  console.assert(capped.timestampsMs.length === 50, 'grid is capped at maxFrames');
  console.assert(capped.truncated === true, 'truncation is reported, not hidden');
  console.assert(typeof capped.warning === 'string' && capped.warning!.length > 0, 'warning present');
  console.assert(capped.warning!.includes('50'), 'warning names the cap');
  console.log('  pass: maxFrames truncates and always announces itself');

  // Test 4: degenerate windows are explained, not silently empty
  const inverted = computeSamplingGrid(60000, { intervalSeconds: 1, startSeconds: 50, endSeconds: 10 });
  console.assert(inverted.timestampsMs.length === 0, 'inverted window yields nothing');
  console.assert(typeof inverted.warning === 'string', 'inverted window explains itself');

  const unknownDuration = computeSamplingGrid(undefined, { intervalSeconds: 1, endSeconds: 5 }, 1200);
  console.assert(unknownDuration.timestampsMs.length === 5, 'unknown duration still uses endSeconds');
  console.log('  pass: degenerate windows and unknown durations are reported');

  // Test 5: interval clamping and warning
  const tiny = normaliseSamplingConfig({ ...DEFAULT_SAMPLING_CONFIG, intervalSeconds: 0.0001 });
  console.assert(tiny.config.intervalSeconds === MIN_INTERVAL_SECONDS, 'interval clamped to floor');
  console.assert(tiny.warnings.length === 1, 'clamping emits a warning');

  const badEnd = normaliseSamplingConfig({ ...DEFAULT_SAMPLING_CONFIG, startSeconds: 10, endSeconds: 5 });
  console.assert(badEnd.config.endSeconds === undefined, 'end <= start is dropped');
  console.assert(badEnd.warnings.length === 1, 'dropped end time is announced');
  console.log('  pass: config normalisation clamps and announces every adjustment');

  // Test 6: deterministic, collision-free provenance filenames
  console.assert(buildFrameFilename('rec-0001', 128400) === 'rec-0001_0128400.jpg', 'filename matches the documented convention');
  console.assert(buildFrameFilename('rec-0001', 128400) === buildFrameFilename('rec-0001', 128400), 'filenames are deterministic');
  const names = new Set(grid.timestampsMs.map((t) => buildFrameFilename('rec-0001', t)));
  console.assert(names.size === grid.timestampsMs.length, 'every frame filename is unique');
  console.log('  pass: deterministic, unique, convention-matching frame filenames');

  // Test 7: planExtraction records settings + grid before any frame is captured
  const planned = planExtraction({
    runId: 'run-0001-abcd',
    recording: makeRecording(),
    sampling: DEFAULT_SAMPLING_CONFIG,
  });
  console.assert(planned.run.status === 'running', 'a planned run starts as running');
  console.assert(planned.run.recordingId === 'rec-0001', 'run is bound to its recording');
  console.assert(planned.run.timestampsMs.length === 600, 'run pre-records the sampling grid');
  console.assert(planned.run.frameCount === 0, 'no frames claimed before capture');
  console.assert(planned.run.frameIds.length === 0, 'no frame ids claimed before capture');
  console.assert(planned.run.sampling.intervalSeconds === 1.0, 'sampling settings persisted on the run');
  console.assert(
    planned.run.timestampsMs.length ===
      computeSamplingGrid(600000, planned.run.sampling, planned.run.sampling.maxFrames).timestampsMs.length,
    'run grid matches the computed grid exactly'
  );
  console.log('  pass: a planned run is auditable before extraction starts');

  // Test 8: THE GOLDEN RULE - extraction cannot seed ground truth
  const encounter = createEncounterForFrame(
    makeFrame({ filename: buildFrameFilename('rec-0001', 128400) }),
    {
      recordingId: 'rec-0001',
      timestampMs: 128400,
      counter: 1,
      sampleIdPrefix: 'ugc',
    }
  );
  console.assert(encounter.platform === 'other', 'platform is NOT inferred from the recording');
  console.assert(encounter.status === 'pending', 'extracted frames start pending');
  console.assert(encounter.items.length === 1, 'one primary UGC item');
  console.assert(encounter.items[0].content === '', 'content starts EMPTY (ground truth is deliberate)');
  console.assert(encounter.items[0].author === '', 'author starts empty');
  console.assert(encounter.items[0].mediaDescription === '', 'media description starts empty');
  console.assert(encounter.metadata?.isFlaggedForReview === false, 'review flag defaults to false');
  console.log('  pass: extraction creates blank, unannotated, platform-agnostic samples');

  // Test 9: provenance survives a round-trip
  console.assert(encounter.provenance.recordingId === 'rec-0001', 'recordingId recorded');
  console.assert(encounter.provenance.timestampMs === 128400, 'timestampMs recorded');
  console.assert(encounter.provenance.frameFilename === 'rec-0001_0128400.jpg', 'frameFilename recorded');
  const roundTripped = JSON.parse(JSON.stringify(encounter));
  console.assert(roundTripped.provenance.recordingId === 'rec-0001', 'recordingId survives JSON');
  console.assert(roundTripped.provenance.timestampMs === 128400, 'timestampMs survives JSON');
  console.assert(typeof roundTripped.provenance.frameFilename === 'string', 'frameFilename survives JSON');
  console.log('  pass: recording + timestamp provenance survives persistence');

  // Test 10: loose frames carry NO invented provenance
  const loose = createEncounterForFrame(makeFrame({ filename: 'screenshot.png' }), {
    counter: 2,
    sampleIdPrefix: 'ugc',
  });
  console.assert(loose.provenance.recordingId === undefined, 'loose frames claim no recordingId');
  console.assert(loose.provenance.timestampMs === undefined, 'loose frames claim no timestampMs');
  console.assert(loose.provenance.frameFilename === 'screenshot.png', 'loose frames keep their own filename');
  console.log('  pass: pre-extracted frames never fabricate recording provenance');

  // Test 11: id helpers
  console.assert(deriveRecordingId(0) === 'rec-0001', 'first recording id');
  console.assert(deriveRecordingId(7) === 'rec-0008', 'recording ids increment');
  console.assert(deriveFrameId() !== deriveFrameId(), 'frame ids are unique');
  console.assert(estimateDataUrlBytes('data:image/png;base64,AAAA') === 3, 'data URL size estimated');
  console.assert(formatClock(523000) === '08:43', 'clock formatting matches the documented example');
  console.assert(formatClock(3661000) === '1:01:01', 'clock formatting handles hours');
  console.log('  pass: id derivation, size estimation, and clock formatting');

  // --- Slice 8: bulk-ingestion id integrity ---------------------------------
  // The bug these guard against was SILENT: recording ids came from
  // `recordings.size` and sample ids from `encounters.length + 1`. In a bulk loop
  // React has not re-rendered, so every iteration read the same stale count and
  // minted the SAME id. Recordings then overwrote each other in IndexedDB
  // (keyPath 'recordingId'), losing data with no error (AGENTS §21, §39).
  const bulkRecordingIds = Array.from({ length: 25 }, () => deriveRecordingId(0));
  console.assert(
    new Set(bulkRecordingIds).size === 1,
    'deriveRecordingId is a pure count->id function; it is the CALLER that must not reuse a stale count'
  );

  // The factory derives `sampleId` from prefix + counter ALONE, so the caller's
  // counter is the ONLY thing guaranteeing uniqueness. Reusing a counter therefore
  // produces duplicate ids — which is exactly why the hook allocates per frame
  // instead of computing one counter per recording.
  const frameA = makeFrame({ id: 'frame-a', filename: 'a.png' });
  const frameB = makeFrame({ id: 'frame-b', filename: 'b.png' });
  const recA = makeRecording({ recordingId: 'rec-0001', filename: 'a.mp4' });
  const recB = makeRecording({ recordingId: 'rec-0002', filename: 'b.mp4' });

  const dupA = createEncounterForFrame(frameA, { counter: 1, sampleIdPrefix: 'ugc', recordingId: recA.recordingId, timestampMs: 0 });
  const dupB = createEncounterForFrame(frameB, { counter: 1, sampleIdPrefix: 'ugc', recordingId: recB.recordingId, timestampMs: 0 });
  console.assert(
    dupA.sampleId === dupB.sampleId,
    'sample identity is derived from the counter alone, so a reused counter silently duplicates a sample'
  );

  // Allocating per frame (what the hook does) keeps ids unique across recordings.
  let seq = 0;
  const allocated = [
    createEncounterForFrame(frameA, { counter: ++seq, sampleIdPrefix: 'ugc', recordingId: recA.recordingId, timestampMs: 0 }),
    createEncounterForFrame(frameB, { counter: ++seq, sampleIdPrefix: 'ugc', recordingId: recB.recordingId, timestampMs: 0 }),
  ];
  console.assert(
    allocated[0].sampleId !== allocated[1].sampleId,
    'per-frame allocation keeps sample ids unique'
  );
  console.assert(
    allocated[0].provenance.recordingId !== allocated[1].provenance.recordingId,
    'provenance keeps each sample bound to its own recording'
  );
  console.log('  pass: bulk-ingestion sample identity guard (counters must be allocated per frame)');

  // Run ids must stay distinct when several runs start in the same millisecond.
  const runIds = [0, 1, 2, 3].map((seq) => deriveRunId(0, seq));
  console.assert(
    new Set(runIds).size === 4,
    'run ids collide when a batch starts several runs in one millisecond'
  );
  console.log('  pass: run ids stay unique within a batch');

  console.log('\nALL SLICE 5 VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runSlice5Verification();

if (assertionFailures > 0) {
  console.error(`\n${assertionFailures} assertion(s) FAILED.`);
  process.exit(1);
}