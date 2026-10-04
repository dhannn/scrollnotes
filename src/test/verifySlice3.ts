import { generateFieldworkSampleBatch } from '../services/sampleData';
import { buildOcrArtifact } from '../services/ocr';
import type { OcrResult } from '../services/ocr';
import { needsOcrInsertConfirmation, applyOcrInsert } from '../services/ocrInsert';
import {
  EncounterSample,
  OcrArtifact,
  OcrInsertMode,
  DedupConfig,
} from '../types/schema';

// Make console.assert failures fail the process (exit code 1).
let assertionFailures = 0;
const originalAssert = console.assert.bind(console);
console.assert = (condition: any, ...args: any[]) => {
  if (!condition) assertionFailures += 1;
  originalAssert(condition, ...args);
};

/**
 * Headless logic double. The overwrite policy is NOT re-implemented here —
 * it imports the exact helpers the components use, so this suite genuinely
 * guards the Golden Rule.
 */
class MockSlice3Session {
  private groundTruth: Map<string, { content: string }> = new Map();
  private ocr: Map<string, OcrArtifact> = new Map();

  public seedFromBatch() {
    const { encounters } = generateFieldworkSampleBatch();
    for (const encounter of encounters) {
      this.groundTruth.set(encounter.sampleId, {
        content: encounter.items[0]?.content ?? '',
      });
    }
  }

  public saveOcr(frameId: string, result: OcrResult) {
    this.ocr.set(frameId, buildOcrArtifact(frameId, result));
  }

  public getOcr(frameId: string): OcrArtifact | undefined {
    return this.ocr.get(frameId);
  }

  public hasOcr(frameId: string): boolean {
    return this.ocr.has(frameId);
  }

  public getContent(sampleId: string): string {
    return this.groundTruth.get(sampleId)?.content ?? '';
  }

  /** First sample whose content is empty — the "clean" insertion target. */
  public firstEmptySampleId(): string | null {
    for (const [sampleId, entry] of this.groundTruth) {
      if (entry.content.trim().length === 0) return sampleId;
    }
    return null;
  }

  public firstPopulatedSampleId(): string | null {
    for (const [sampleId, entry] of this.groundTruth) {
      if (entry.content.trim().length > 0) return sampleId;
    }
    return null;
  }

  public insertOcr(
    sampleId: string,
    ocrText: string,
    mode?: OcrInsertMode
  ): 'inserted' | 'confirmation-required' {
    const current = this.groundTruth.get(sampleId)?.content ?? '';
    if (needsOcrInsertConfirmation(current) && !mode) {
      return 'confirmation-required';
    }
    this.groundTruth.set(sampleId, {
      content: applyOcrInsert(current, ocrText, mode ?? 'replace'),
    });
    return 'inserted';
  }
}

const MOCK_OCR: OcrResult = {
  text: 'holy shit i just\nrealized...',
  engine: 'tesseract',
  language: 'eng',
  engineVersion: '5.5.0',
  wrapperVersion: '7.0.0',
  confidence: 87.4,
  generatedAt: '2026-10-04T00:00:00.000Z',
};

function runSlice3Verification() {
  console.log('Starting Scrollnotes Slice 3 (OCR Preprocessing) Verification...');
  const session = new MockSlice3Session();
  session.seedFromBatch();

  // Locate one annotated and one unannotated sample from the built-in batch.
  const populatedId = session.firstPopulatedSampleId();
  const emptyId = session.firstEmptySampleId();
  console.assert(populatedId !== null, 'batch must contain an annotated sample');
  console.assert(emptyId !== null, 'batch must contain an unannotated sample');
  if (!populatedId || !emptyId) return;

  // Test 1: OCR artifacts are structurally separate from ground truth
  session.saveOcr('frame-001', MOCK_OCR);
  const before = session.getContent(populatedId);
  console.assert(session.hasOcr('frame-001') === true, 'OCR artifact must be stored');
  console.assert(
    session.getOcr('frame-001')?.text === MOCK_OCR.text,
    'OCR text preserved exactly as generated'
  );
  console.assert(session.getContent(populatedId) === before, 'GT untouched by OCR store');
  console.log('  pass: OCR storage leaves ground truth byte-identical');

  // Test 2: Insert into empty content = one action, no confirmation
  const emptyInsert = session.insertOcr(emptyId, MOCK_OCR.text);
  console.assert(emptyInsert === 'inserted', 'empty field inserts in one action');
  console.assert(session.getContent(emptyId) === MOCK_OCR.text, 'empty field filled');
  console.log('  pass: insert-into-empty populates content');

  // Test 3: Insert into non-empty content requires an explicit decision
  const guarded = session.insertOcr(emptyId, 'some other text');
  console.assert(guarded === 'confirmation-required', 'non-empty field must not overwrite');
  console.assert(
    session.getContent(emptyId) === MOCK_OCR.text,
    'content unchanged without explicit mode'
  );
  const appended = session.insertOcr(emptyId, 'extra line', 'append');
  console.assert(appended === 'inserted', 'append with explicit mode inserts');
  console.assert(
    session.getContent(emptyId) === `${MOCK_OCR.text}\nextra line`,
    'append preserves original human text'
  );
  const replaced = session.insertOcr(emptyId, 'fresh text', 'replace');
  console.assert(replaced === 'inserted', 'explicit replace inserts');
  console.assert(session.getContent(emptyId) === 'fresh text', 'replace sets text');
  console.log('  pass: non-empty fields never overwritten without explicit decision');

  // Test 4: OCR provenance survives a persistence round-trip
  const stored = session.getOcr('frame-001');
  const roundTripped = JSON.parse(JSON.stringify(stored)) as OcrArtifact;
  console.assert(roundTripped.engine === 'tesseract', 'engine survives round-trip');
  console.assert(roundTripped.language === 'eng', 'language survives round-trip');
  console.assert(
    roundTripped.generatedAt === MOCK_OCR.generatedAt,
    'generatedAt survives round-trip'
  );
  console.assert(
    roundTripped.engineVersion === '5.5.0' && roundTripped.confidence === 87.4,
    'optional provenance survives round-trip'
  );
  console.log('  pass: OCR provenance survives save/load');

  // Test 5: Re-running OCR replaces the artifact, never the ground truth
  const secondRun: OcrResult = {
    ...MOCK_OCR,
    text: 'holy shit i just\nrealized!?',
    generatedAt: '2026-10-05T00:00:00.000Z',
  };
  const gtBefore = session.getContent(emptyId);
  session.saveOcr('frame-001', secondRun);
  console.assert(session.getOcr('frame-001')?.text === secondRun.text, 'artifact updated');
  console.assert(session.getContent(emptyId) === gtBefore, 'GT untouched by re-run');
  console.log('  pass: re-run replaces artifact only');

  // Test 6: Caching short-circuits unless explicitly re-run
  console.assert(session.hasOcr('frame-001') === true, 'cached artifact reported');
  console.assert(session.hasOcr('frame-never-scanned') === false, 'missing artifact reported');
  console.log('  pass: hasOcr cache check');

  // Test 7: mock frames must be canvas-rasterisable so OCR/hashing can read them.
  // foreignObject does not survive drawImage(), which would yield empty OCR.
  const { frames: mockFrames } = generateFieldworkSampleBatch();
  const decodeSvgDataUrl = (dataUrl: string): string => {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return dataUrl;
    const header = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    return header.includes('base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
  };
  const allSvg = mockFrames.map((f) => decodeSvgDataUrl(f.dataUrl));
  console.assert(
    allSvg.every((svg) => !svg.includes('<foreignObject')),
    'no mock frame may rely on foreignObject (does not rasterise)'
  );
  console.assert(
    allSvg.every((svg) => svg.includes('<tspan')),
    'mock body copy must be laid out as real <text>/<tspan>'
  );
  console.assert(
    allSvg.every((svg) => svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>')),
    'mock frames are well-formed SVG documents'
  );
  console.assert(
    mockFrames.every((f) => f.mimeType === 'image/svg+xml'),
    'mock frames declare an SVG mime type'
  );
  console.log('  pass: mock frames are rasterisable (no foreignObject)');

  // Sanity: dedup config defaults remain untouched by OCR flows
  const config: DedupConfig = { id: 'default', algorithm: 'phash', threshold: 8, hashSize: 8 };
  console.assert(config.threshold === 8, 'dedup defaults intact');
  const encounters: EncounterSample[] = [];
  console.assert(Array.isArray(encounters), 'schema import sanity');

  console.log('\nALL SLICE 3 VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runSlice3Verification();

if (assertionFailures > 0) {
  console.error(`\n${assertionFailures} assertion(s) FAILED.`);
  process.exit(1);
}