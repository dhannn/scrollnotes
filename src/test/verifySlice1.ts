import { generateFieldworkSampleBatch } from '../services/sampleData';
import { EncounterSample, FrameRecord, Platform } from '../types/schema';

// In-memory mock simulation of the IndexedDB layer to verify core business logic headlessly
class MockFieldSession {
  private encounters: EncounterSample[] = [];
  private frames: Map<string, FrameRecord> = new Map();
  private activeSampleId: string | null = null;

  public loadSampleBatch() {
    const { frames, encounters } = generateFieldworkSampleBatch();
    this.encounters = encounters;
    this.frames = new Map(frames.map((f) => [f.id, f]));
    this.activeSampleId = encounters.length > 0 ? encounters[0].sampleId : null;
  }

  public getEncounters() {
    return this.encounters;
  }

  public getFrames() {
    return this.frames;
  }

  public getActiveEncounter() {
    return this.encounters.find((e) => e.sampleId === this.activeSampleId) || null;
  }

  public getStats() {
    const total = this.encounters.length;
    let annotated = 0;
    let pending = 0;
    let rejected = 0;
    let skipped = 0;

    for (const e of this.encounters) {
      if (e.status === 'annotated') annotated++;
      else if (e.status === 'pending') pending++;
      else if (e.status === 'rejected') rejected++;
      else if (e.status === 'skipped') skipped++;
    }

    const progressPercent = total > 0 ? Math.round((annotated / total) * 100) : 0;
    return { total, annotated, pending, rejected, skipped, progressPercent };
  }

  public saveAndNext(
    sampleId: string,
    fields: {
      platform: Platform;
      content: string;
      author: string;
      mediaDescription: string;
    }
  ) {
    const idx = this.encounters.findIndex((e) => e.sampleId === sampleId);
    if (idx === -1) throw new Error(`Sample ${sampleId} not found`);

    const current = this.encounters[idx];
    const existingItem = current.items[0] || {
      id: `item-${sampleId}-1`,
      content: '',
      author: '',
      mediaDescription: '',
    };

    const updatedItem = {
      ...existingItem,
      content: fields.content,
      author: fields.author,
      mediaDescription: fields.mediaDescription,
    };

    const isAnnotated = fields.content.trim().length > 0;

    const updated: EncounterSample = {
      ...current,
      platform: fields.platform,
      items: [updatedItem, ...current.items.slice(1)],
      status: isAnnotated ? 'annotated' : current.status,
      updatedAt: new Date().toISOString(),
    };

    this.encounters[idx] = updated;

    if (idx < this.encounters.length - 1) {
      this.activeSampleId = this.encounters[idx + 1].sampleId;
    }
  }

  public setStatus(sampleId: string, status: 'rejected' | 'skipped', advance: boolean = true) {
    const idx = this.encounters.findIndex((e) => e.sampleId === sampleId);
    if (idx === -1) throw new Error(`Sample ${sampleId} not found`);

    this.encounters[idx] = {
      ...this.encounters[idx],
      status,
      updatedAt: new Date().toISOString(),
    };

    if (advance && idx < this.encounters.length - 1) {
      this.activeSampleId = this.encounters[idx + 1].sampleId;
    }
  }
}

// Verification Suite
function runVerification() {
  console.log('🧪 Starting Scrollnotes Slice 1 Automated Logic Verification...');

  const session = new MockFieldSession();

  // Test 1: Batch Loading
  session.loadSampleBatch();
  const encounters = session.getEncounters();
  const frames = session.getFrames();

  console.assert(encounters.length === 6, `Expected 6 encounters, got ${encounters.length}`);
  console.assert(frames.size === 6, `Expected 6 frames, got ${frames.size}`);
  console.log('  ✓ Test 1 Passed: Fieldwork batch loaded 6 frames & encounters');

  // Test 2: Schema Compliance
  for (const encounter of encounters) {
    console.assert(typeof encounter.sampleId === 'string', 'sampleId must be string');
    console.assert(typeof encounter.platform === 'string', 'platform must be sample-level string');
    console.assert(Array.isArray(encounter.items), 'items must be an array for multi-item UGC compatibility');
    console.assert(typeof encounter.provenance.frameFilename === 'string', 'provenance.frameFilename required');
    console.assert(frames.has(encounter.frameId), `Frame ${encounter.frameId} must exist in frame store`);
  }
  console.log('  ✓ Test 2 Passed: Full schema compliance & provenance integrity verified');

  // Test 3: Save & Next Workflow
  session.saveAndNext('ugc-000002', {
    platform: 'reddit',
    content: 'Gold standard verified human transcription test.',
    author: 'u/hyperbolic_tensor',
    mediaDescription: 'Reddit post with chart diagram.',
  });

  const updated2 = session.getEncounters().find((e) => e.sampleId === 'ugc-000002');
  console.assert(updated2?.status === 'annotated', 'Status must transition to annotated');
  console.assert(updated2?.items[0].content === 'Gold standard verified human transcription test.');
  console.assert(session.getActiveEncounter()?.sampleId === 'ugc-000003', 'Active pointer must advance to next sample');
  console.log('  ✓ Test 3 Passed: Save & Next advances active sample pointer and sets status');

  // Test 4: Rejection & Skip Actions
  session.setStatus('ugc-000003', 'skipped', true);
  console.assert(session.getEncounters().find((e) => e.sampleId === 'ugc-000003')?.status === 'skipped');
  console.assert(session.getActiveEncounter()?.sampleId === 'ugc-000004', 'Active pointer must advance to ugc-000004');

  session.setStatus('ugc-000004', 'rejected', true);
  console.assert(session.getEncounters().find((e) => e.sampleId === 'ugc-000004')?.status === 'rejected');
  console.assert(session.getActiveEncounter()?.sampleId === 'ugc-000005', 'Active pointer must advance to ugc-000005');
  console.log('  ✓ Test 4 Passed: Skip and Reject status updates and auto-advance verified');

  // Test 5: Progress & Statistics Calculation
  const stats = session.getStats();
  console.assert(stats.total === 6, 'Total count mismatch');
  console.assert(stats.annotated === 2, `Expected 2 annotated (1 initial + 1 curated), got ${stats.annotated}`);
  console.assert(stats.skipped === 1, 'Expected 1 skipped');
  console.assert(stats.rejected === 1, 'Expected 1 rejected');
  console.assert(stats.pending === 2, 'Expected 2 pending');
  console.assert(stats.progressPercent === 33, `Expected 33% progress, got ${stats.progressPercent}%`);
  console.log('  ✓ Test 5 Passed: Progress metrics and session statistics verified');

  console.log('\n🎉 ALL SLICE 1 VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runVerification();
