/**
 * Slice 6 verification - Corpus Export
 *
 * Runs in Node against the PURE core only (no DOM). Covers the JSONL/manifest contract,
 * the hard separation between ground truth and OCR, provenance survival, the validation
 * severity rules, and the hand-rolled ZIP writer's structural correctness.
 */
import {
  selectExportableSamples,
  buildAnnotationRecord,
  buildOcrRecord,
  buildAnnotationsJsonl,
  buildOcrJsonl,
  buildAnnotationsCsv,
  buildExportBundle,
  buildFilenameStem,
  imagePathForSample,
  bundleToZipEntries,
} from '../services/export';
import { validateForExport, summariseQualityFlags } from '../services/exportValidation';
import { createZip, crc32, dataUrlToBytes, extensionForMime } from '../services/zip';
import { createEncounterForFrame } from '../services/encounters';
import { DEFAULT_DATASET_INFO, DEFAULT_DEDUP_CONFIG } from '../services/db';
import { DEFAULT_SAMPLING_CONFIG, SCHEMA_VERSION } from '../types/schema';
import type {
  DatasetInfo,
  EncounterSample,
  FrameRecord,
  OcrArtifact,
  DedupRecord,
  ExtractionRun,
  RecordingRecord,
  ExportedAnnotation,
  ExportedOcrRecord,
} from '../types/schema';

let assertionFailures = 0;
const originalAssert = console.assert.bind(console);
console.assert = (condition: any, ...args: any[]) => {
  if (!condition) assertionFailures += 1;
  originalAssert(condition, ...args);
};

/** A 1x1 transparent PNG. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeDataset(overrides: Partial<DatasetInfo> = {}): DatasetInfo {
  return { ...DEFAULT_DATASET_INFO, ...overrides };
}

function makeFrame(id: string, overrides: Partial<FrameRecord> = {}): FrameRecord {
  return {
    id,
    filename: `${id}.png`,
    dataUrl: PNG_DATA_URL,
    mimeType: 'image/png',
    width: 1,
    height: 1,
    sizeBytes: 68,
    importedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

/** An encounter that is ready to export: annotated, with content and verified platform. */
function makeAnnotated(
  counter: number,
  overrides: Partial<EncounterSample> = {}
): EncounterSample {
  const frame = makeFrame(`frame-${counter}`);
  const base = createEncounterForFrame(frame, {
    counter,
    sampleIdPrefix: 'ugc',
    recordingId: 'rec-0001',
    timestampMs: counter * 1000,
  });
  const withContent: EncounterSample = {
    ...base,
    status: 'annotated',
    platform: 'instagram',
    items: base.items.map((item) => ({
      ...item,
      content: `transcribed content ${counter}`,
      author: '@someone',
      mediaDescription: 'A screenshot of a post.',
    })),
  };
  return { ...withContent, ...overrides };
}

function makeOcr(frameId: string, text: string): OcrArtifact {
  return {
    frameId,
    engine: 'tesseract',
    text,
    language: 'eng',
    engineVersion: '5.3.0',
    wrapperVersion: '7.0.0',
    confidence: 87.5,
    generatedAt: '2026-10-04T01:00:00.000Z',
  };
}
/** Minimal ZIP reader used to verify the writer against the format, not against itself. */
function readZipEntries(
  bytes: Uint8Array
): { path: string; bytes: Uint8Array; crc: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // Locate the end-of-central-directory record by scanning back from the tail.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record');

  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries: { path: string; bytes: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('bad central header');
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    // Walk the local header to find where the payload actually starts.
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({ path, bytes: bytes.subarray(dataStart, dataStart + compressedSize), crc });

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function check(id: string, condition: boolean, message: string): boolean {
  console.assert(condition, `${id}: ${message}`);
  return condition;
}

function runSlice6Verification() {
  console.log('\n=== SLICE 6 VERIFICATION: Corpus Export ===\n');

  // ---------------------------------------------------------------------
  // Test 1: only annotated samples ship
  // ---------------------------------------------------------------------
  const dataset = makeDataset();
  const annotated = [makeAnnotated(1), makeAnnotated(2)];
  const pending = makeAnnotated(3, { status: 'pending' });
  const rejected = makeAnnotated(4, { status: 'rejected' });
  const skipped = makeAnnotated(5, { status: 'skipped' });
  const encounters = [annotated[0], pending, rejected, annotated[1], skipped];

  const selected = selectExportableSamples(encounters);
  check('t1', selected.length === 2, 'only the 2 annotated samples are exportable');
  check(
    't1',
    selected.every((s) => s.status === 'annotated'),
    'no pending/rejected/skipped sample leaks into the export'
  );
  check(
    't1',
    selected[0].sampleId === 'ugc-000001' && selected[1].sampleId === 'ugc-000002',
    'export order is by sample id'
  );
  console.log('  pass: only annotated samples are selected, ordered by sample id');
// ---------------------------------------------------------------------
  // Test 2: ground truth round trips through JSONL with provenance intact
  // ---------------------------------------------------------------------
  const record = buildAnnotationRecord(
    annotated[0],
    dataset,
    imagePathForSample('ugc-000001', 'image/png')
  );
  const jsonl = buildAnnotationsJsonl([record]);
  const parsed = JSON.parse(jsonl.trim()) as ExportedAnnotation;
  check('t2', jsonl.endsWith('\n'), 'JSONL ends with a trailing newline');
  check('t2', jsonl.split('\n').filter(Boolean).length === 1, 'one sample per line');
  check('t2', parsed.sampleId === 'ugc-000001', 'sample id survives export');
  check('t2', parsed.items[0].content === 'transcribed content 1', 'ground truth content survives');
  check('t2', parsed.provenance.recordingId === 'rec-0001', 'recordingId survives export');
  check('t2', parsed.provenance.sourceTimestampMs === 1000, 'source timestamp survives export');
  check('t2', parsed.provenance.frameFilename === 'frame-1.png', 'frame filename survives export');
  check('t2', parsed.image === 'images/ugc-000001.png', 'image path points inside the bundle');
  console.log('  pass: ground truth + provenance survive a JSONL round trip');

  // ---------------------------------------------------------------------
  // Test 3: OCR text is preserved byte-for-byte and kept out of annotations
  // ---------------------------------------------------------------------
  const messyOcrText = '  holy shit i just\r\nrealized...  \n\n\ttrailing spaces   ';
  const artifact = makeOcr('frame-1', messyOcrText);
  const ocrRecord = buildOcrRecord(annotated[0], artifact);
  const ocrParsed = JSON.parse(buildOcrJsonl([ocrRecord]).trim()) as ExportedOcrRecord;
  check(
    't3',
    ocrParsed.text === messyOcrText,
    'OCR text is byte-identical: no trimming or whitespace normalisation'
  );
  check('t3', ocrParsed.engine === 'tesseract', 'OCR engine recorded');
  check('t3', ocrParsed.generatedAt === artifact.generatedAt, 'OCR provenance survives');
  check('t3', !('text' in parsed), 'annotations.jsonl carries NO ocr field');
  check(
    't3',
    !JSON.stringify(parsed).includes('holy shit'),
    'OCR text never leaks into the annotation record'
  );
  console.log('  pass: OCR text is verbatim, keeps provenance, stays separate from ground truth');

  // ---------------------------------------------------------------------
  // Test 4: quality flags survive export (AGENTS section 25)
  // ---------------------------------------------------------------------
  const flagged = makeAnnotated(6, {
    metadata: {
      textDensity: 'high',
      visualDensity: 'low',
      qualityFlags: ['ui-heavy', 'ambiguous-author'],
    },
  });
  const flaggedRecord = buildAnnotationRecord(flagged, dataset, 'images/ugc-000006.png');
  check(
    't4',
    flaggedRecord.metadata?.qualityFlags?.includes('ui-heavy') === true,
    'quality flags survive into annotations.jsonl'
  );
  check(
    't4',
    summariseQualityFlags([flagged])['ui-heavy'] === 1,
    'quality flags are summarised for the manifest'
  );
  console.log('  pass: quality flags survive export and are counted');

  // ---------------------------------------------------------------------
  // Test 5: CSV quoting survives commas, quotes and newlines
  // ---------------------------------------------------------------------
  const nasty = makeAnnotated(7, {
    items: [
      {
        id: 'item-1',
        role: 'post',
        orderIndex: 0,
        content: 'He said "hello", then\nleft\tthe building',
        author: '@a,b',
        mediaDescription: '',
        hasMedia: false,
        hasAuthor: true,
      },
    ],
  });
  const csv = buildAnnotationsCsv([
    buildAnnotationRecord(nasty, dataset, 'images/ugc-000007.png'),
  ]);
  check('t5', csv.split('\n').length >= 2, 'CSV has a header plus a data row');
  check('t5', csv.startsWith('sampleId,platform,image'), 'CSV header is present');
  check('t5', csv.includes('"He said ""hello"", then'), 'embedded quotes are doubled');
  check('t5', csv.includes('"@a,b"'), 'embedded commas force quoting');
  console.log('  pass: CSV quoting survives commas, quotes and newlines');
// ---------------------------------------------------------------------
  // Test 6: full bundle assembles with images + the four text files
  // ---------------------------------------------------------------------
  const recording: RecordingRecord = {
    recordingId: 'rec-0001',
    filename: 'session_01.mp4',
    researcherLabel: 'mixed browsing',
    importedAt: '2026-10-04T00:00:00.000Z',
  };
  const run: ExtractionRun = {
    runId: 'run-0001',
    recordingId: 'rec-0001',
    sampling: DEFAULT_SAMPLING_CONFIG,
    timestampsMs: [1000, 2000],
    frameIds: ['frame-1', 'frame-2'],
    frameCount: 2,
    startedAt: '2026-10-04T00:05:00.000Z',
    completedAt: '2026-10-04T00:06:00.000Z',
    status: 'done',
  };
  const ocrArtifacts = new Map<string, OcrArtifact>([
    ['frame-1', artifact],
  ]);

  const bundle = buildExportBundle({
    dataset,
    encounters: [annotated[0], annotated[1], pending, rejected],
    frames: new Map([
      ['frame-1', makeFrame('frame-1')],
      ['frame-2', makeFrame('frame-2')],
      ['frame-3', makeFrame('frame-3')],
      ['frame-4', makeFrame('frame-4')],
    ]),
    ocrArtifacts,
    dedupConfig: { ...DEFAULT_DEDUP_CONFIG, lastRunAt: '2026-10-04T02:00:00.000Z' },
    dedupRecords: new Map<string, DedupRecord>(),
    recordings: [recording],
    extractionRuns: [run],
    exportedAt: '2026-10-04T03:00:00.000Z',
  });

  check('t6', bundle.annotations.length === 2, 'only the 2 annotated samples ship');
  check('t6', bundle.images.length === 2, 'each shipped sample contributes one image');
  check('t6', bundle.ocrRecords.length === 1, 'OCR exports only for frames that shipped');
  check(
    't6',
    bundle.textFiles.map((f) => f.path).join(',') ===
      'annotations.jsonl,ocr.jsonl,manifest.json,README.md',
    'the bundle contains exactly the four expected text files'
  );
  check('t6', bundle.imageErrors.length === 0, 'no image errors for healthy frames');
  check(
    't6',
    bundle.filenameStem.includes('2026-10-04'),
    'filename stem carries the export date'
  );

  // The manifest must describe what shipped, and every image it references must exist.
  const manifest = JSON.parse(
    new TextDecoder().decode(bundle.textFiles.find((f) => f.path === 'manifest.json')!.bytes)
  );
  check('t6', manifest.schemaVersion === SCHEMA_VERSION, 'manifest carries the schema version');
  check('t6', manifest.sampleCount === 2, 'manifest sampleCount matches what shipped');
  check('t6', manifest.imageCount === 2, 'manifest imageCount matches the images written');
  check('t6', manifest.ocrRecordCount === 1, 'manifest ocrRecordCount matches ocr.jsonl');
  check('t6', manifest.generator === 'scrollnotes', 'manifest identifies its generator');
  check(
    't6',
    manifest.sourceRecordings.length === 1 &&
      manifest.sourceRecordings[0].recordingId === 'rec-0001',
    'the contributing recording is listed as provenance'
  );
  check(
    't6',
    !('platform' in manifest.sourceRecordings[0]),
    'a recording carries no platform field: it is provenance, not a category'
  );
  check(
    't6',
    manifest.deduplication.method === DEFAULT_DEDUP_CONFIG.algorithm &&
      manifest.deduplication.threshold === DEFAULT_DEDUP_CONFIG.threshold,
    'deduplication settings are reported verbatim'
  );
  check(
    't6',
    manifest.samplingSettings?.[0]?.intervalSeconds === DEFAULT_SAMPLING_CONFIG.intervalSeconds,
    'sampling settings are reported verbatim for reproducibility'
  );
  check(
    't6',
    manifest.platformCounts.instagram === 2,
    'platform distribution is reported at the sample level'
  );
  check(
    't6',
    manifest.annotation.annotationComplete === false,
    'a corpus with pending candidates is explicitly NOT complete'
  );
  check(
    't6',
    manifest.validation.canExport === true,
    'the manifest carries the validation outcome'
  );

  const bundlePaths = new Set(bundle.images.map((i) => i.path));
  const allImagesReferenced = bundle.annotations.every((a) => bundlePaths.has(a.image));
  check('t6', allImagesReferenced, 'every annotation points at an image present in the bundle');
  console.log('  pass: bundle, manifest and provenance all agree with each other');
// ---------------------------------------------------------------------
  // Test 7: validation severity rules (fail blocks, warn does not)
  // ---------------------------------------------------------------------
  const healthy = validateForExport({
    encounters: [annotated[0], annotated[1]],
    frameIds: new Set(['frame-1', 'frame-2']),
    ocrFrameIds: new Set(['frame-1', 'frame-2']),
    dataset,
    extractionRuns: [run],
  });
  check('t7', healthy.canExport, 'a healthy corpus passes validation');
  check('t7', healthy.counts.exportable === 2, 'exportable count is reported');
  check(
    't7',
    healthy.checks.every((c) => c.severity !== 'fail'),
    'no failures in a healthy corpus'
  );

  // A missing frame image is corruption: it must BLOCK export.
  const missingFrame = validateForExport({
    encounters: [annotated[0]],
    frameIds: new Set<string>(),
    ocrFrameIds: new Set(['frame-1']),
    dataset,
  });
  check('t7', !missingFrame.canExport, 'a missing frame image blocks export');
  check(
    't7',
    missingFrame.checks.find((c) => c.id === 'frames-present')?.severity === 'fail',
    'the missing frame is reported as a failure'
  );
  check(
    't7',
    missingFrame.checks.find((c) => c.id === 'frames-present')?.sampleIds?.includes('ugc-000001') ===
      true,
    'the failure names the affected sample so it is actionable'
  );

  // Empty ground truth is corruption too.
  const emptyTruth = validateForExport({
    encounters: [makeAnnotated(9, { items: [] })],
    frameIds: new Set(['frame-9']),
    ocrFrameIds: new Set(),
    dataset,
  });
  check('t7', !emptyTruth.canExport, 'a sample with no UGC items blocks export');

  // Missing recording provenance is a WARNING, not a failure: importing pre-extracted
  // frames is a documented path, so it must not make the corpus unexportable.
  const importedDirectly = makeAnnotated(10, {
    provenance: {
      frameFilename: 'shot.png',
      importedAt: '2026-10-04T00:00:00.000Z',
    },
  });
  const noRecording = validateForExport({
    encounters: [importedDirectly],
    frameIds: new Set(['frame-10']),
    ocrFrameIds: new Set(),
    dataset,
  });
  check('t7', noRecording.canExport, 'a corpus without recording provenance still exports');
  check(
    't7',
    noRecording.checks.find((c) => c.id === 'provenance-recording')?.severity === 'warn',
    'missing recording provenance is a warning, not a failure'
  );
  check(
    't7',
    noRecording.counts.withRecordingProvenance === 0,
    'the count of recording-backed samples is reported honestly'
  );

  // A pending corpus must be flagged as incomplete, not silently shipped as complete.
  const withPending = validateForExport({
    encounters: [annotated[0], pending],
    frameIds: new Set(['frame-1', 'frame-3']),
    ocrFrameIds: new Set(['frame-1']),
    dataset,
  });
  check(
    't7',
    withPending.checks.find((c) => c.id === 'curation-complete')?.severity === 'warn',
    'pending candidates raise a warning'
  );
  check('t7', withPending.counts.pending === 1, 'pending candidates are counted');

  // An unverified platform warns.
  const unverified = validateForExport({
    encounters: [makeAnnotated(11, { platform: 'other' })],
    frameIds: new Set(['frame-11']),
    ocrFrameIds: new Set(),
    dataset,
  });
  check(
    't7',
    unverified.checks.find((c) => c.id === 'platform-verified')?.severity === 'warn',
    'an unverified platform warns'
  );

  // A sample still marked as a suppressed duplicate warns about ambiguity.
  const ambiguousDup = validateForExport({
    encounters: [annotated[0]],
    frameIds: new Set(['frame-1']),
    ocrFrameIds: new Set(),
    dataset,
    dedupRecords: new Map<string, DedupRecord>([
      [
        'frame-1',
        {
          frameId: 'frame-1',
          hash: 'ff',
          algorithm: 'phash',
          hashSize: 8,
          groupId: 'grp-1',
          role: 'duplicate',
          representativeFrameId: 'frame-9',
          overridden: false,
          computedAt: '2026-10-04T02:00:00.000Z',
        },
      ],
    ]),
  });
  check(
    't7',
    ambiguousDup.checks.find((c) => c.id === 'dedup-resolved')?.severity === 'warn',
    'an unresolved duplicate decision warns'
  );

  // Nothing annotated at all is a hard failure.
  const empty = validateForExport({
    encounters: [pending],
    frameIds: new Set(['frame-3']),
    ocrFrameIds: new Set(),
    dataset,
  });
  check('t7', !empty.canExport, 'a corpus with no annotated samples cannot be exported');
  console.log('  pass: failures block, warnings inform, and both name the affected samples');

  // ---------------------------------------------------------------------
  // Test 8: a frame that cannot be decoded is reported, not silently dropped
  // ---------------------------------------------------------------------
  const brokenBundle = buildExportBundle({
    dataset,
    encounters: [annotated[0]],
    frames: new Map([['frame-1', makeFrame('frame-1', { dataUrl: 'not-a-data-url' })]]),
    ocrArtifacts: new Map(),
    dedupConfig: DEFAULT_DEDUP_CONFIG,
    dedupRecords: new Map(),
    recordings: [],
    extractionRuns: [],
    exportedAt: '2026-10-04T03:00:00.000Z',
  });
  check(
    't8',
    brokenBundle.imageErrors.length === 1 &&
      brokenBundle.imageErrors[0].sampleId === 'ugc-000001',
    'an undecodable frame is reported against its sample id'
  );
  check('t8', brokenBundle.annotations.length === 0, 'no annotation points at a missing image');
  check(
    't8',
    brokenBundle.manifest.sampleCount === 0,
    'the manifest does not claim samples it could not write'
  );
  console.log('  pass: undecodable images are surfaced, never silently skipped');
// ---------------------------------------------------------------------
  // Test 9: the ZIP writer produces a structurally valid archive
  // ---------------------------------------------------------------------
  const zipEntries = bundleToZipEntries(bundle);
  const zipBytes = createZip(zipEntries, new Date('2026-10-04T03:00:00.000Z'));
  const readBack = readZipEntries(zipBytes);

  check('t9', readBack.length === zipEntries.length, 'every entry survives the round trip');
  check(
    't9',
    readBack.map((e) => e.path).join(',') === zipEntries.map((e) => e.path).join(','),
    'entry order is preserved'
  );
  check(
    't9',
    zipBytes.length > 0 && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b,
    'the archive starts with the PK local-file-header signature'
  );

  // Every payload must be byte-identical AND carry a correct CRC.
  let payloadsIntact = true;
  let crcsCorrect = true;
  for (let i = 0; i < readBack.length; i++) {
    const original = zipEntries[i].bytes;
    const restored = readBack[i].bytes;
    if (restored.length !== original.length) {
      payloadsIntact = false;
      continue;
    }
    for (let j = 0; j < original.length; j++) {
      if (original[j] !== restored[j]) {
        payloadsIntact = false;
        break;
      }
    }
    if (readBack[i].crc !== crc32(original)) crcsCorrect = false;
  }
  check('t9', payloadsIntact, 'every payload round trips byte-for-byte through the archive');
  check('t9', crcsCorrect, 'every stored CRC matches crc32() of the payload');

  // The exported JSONL inside the archive must still parse after zipping.
  const annotationsEntry = readBack.find((e) => e.path === 'annotations.jsonl');
  const zippedLines = new TextDecoder()
    .decode(annotationsEntry!.bytes)
    .split('\n')
    .filter(Boolean);
  check('t9', zippedLines.length === 2, 'zipped annotations.jsonl holds one line per sample');
  check(
    't9',
    zippedLines.every((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    }),
    'every zipped JSONL line is valid JSON'
  );

  // Determinism: the same inputs and timestamp produce identical bytes.
  const zipBytesAgain = createZip(zipEntries, new Date('2026-10-04T03:00:00.000Z'));
  check(
    't9',
    zipBytesAgain.length === zipBytes.length &&
      zipBytesAgain.every((b, i) => b === zipBytes[i]),
    'the ZIP writer is deterministic for a fixed timestamp'
  );
  console.log('  pass: archive is spec-valid, CRCs correct, payloads byte-identical');

  // ---------------------------------------------------------------------
  // Test 10: data URL decoding and extension mapping
  // ---------------------------------------------------------------------
  const pngBytes = dataUrlToBytes(PNG_DATA_URL);
  check('t10', pngBytes !== null, 'a base64 PNG data URL decodes');
  check(
    't10',
    pngBytes![0] === 0x89 && pngBytes![1] === 0x50,
    'decoded bytes carry the PNG magic number'
  );
  const svgText = '<svg></svg>';
  const svgBytes = dataUrlToBytes(
    `data:image/svg+xml,${encodeURIComponent(svgText)}`
  );
  check(
    't10',
    svgBytes !== null && new TextDecoder().decode(svgBytes) === svgText,
    'a percent-encoded SVG data URL round trips to the original text'
  );
  check('t10', dataUrlToBytes('garbage') === null, 'an unparseable data URL returns null');
  check('t10', extensionForMime('image/jpeg') === 'jpg', 'jpeg maps to .jpg');
  check('t10', extensionForMime('image/png') === 'png', 'png maps to .png');
  check('t10', extensionForMime('image/svg+xml') === 'svg', 'svg maps to .svg');
  check('t10', extensionForMime(undefined) === 'png', 'an unknown mime falls back safely');
  console.log('  pass: data URL decoding and extension mapping are correct');

  // ---------------------------------------------------------------------
  // Test 11: export is stable and idempotent across runs
  // ---------------------------------------------------------------------
  const secondBundle = buildExportBundle({
    dataset,
    encounters: [annotated[0], annotated[1], pending, rejected],
    frames: new Map([
      ['frame-1', makeFrame('frame-1')],
      ['frame-2', makeFrame('frame-2')],
      ['frame-3', makeFrame('frame-3')],
      ['frame-4', makeFrame('frame-4')],
    ]),
    ocrArtifacts,
    dedupConfig: { ...DEFAULT_DEDUP_CONFIG, lastRunAt: '2026-10-04T02:00:00.000Z' },
    dedupRecords: new Map<string, DedupRecord>(),
    recordings: [recording],
    extractionRuns: [run],
    exportedAt: '2026-10-04T03:00:00.000Z',
  });
  check(
    't11',
    secondBundle.annotations.map((a) => a.sampleId).join(',') ===
      bundle.annotations.map((a) => a.sampleId).join(','),
    'sample ids are stable across repeated exports'
  );
  check(
    't11',
    new Set(secondBundle.annotations.map((a) => a.sampleId)).size ===
      secondBundle.annotations.length,
    'exported sample ids are unique'
  );
  check(
    't11',
    buildFilenameStem(dataset, '2026-10-04T03:00:00.000Z') ===
      buildFilenameStem(dataset, '2026-10-04T03:00:00.000Z'),
    'filename generation is deterministic'
  );
  console.log('  pass: repeated exports are stable and ids remain unique');

  console.log(`\n  Schema version under test: ${SCHEMA_VERSION}`);
  console.log(
    assertionFailures === 0
      ? '\n=== SLICE 6 VERIFICATION PASSED ===\n'
      : `\n=== SLICE 6 VERIFICATION FAILED (${assertionFailures} assertion(s)) ===\n`
  );
}

runSlice6Verification();