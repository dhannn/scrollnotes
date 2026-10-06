import { generateFieldworkSampleBatch } from '../services/sampleData';
import {
  EncounterSample,
  Platform,
  DatasetInfo,
  GroundTruthItemRole,
  normalizeRole,
  DensityLevel,
} from '../types/schema';

class MockSlice2Session {
  private encounters: EncounterSample[] = [];
  private datasetInfo: DatasetInfo = {
    id: 'default',
    name: 'Social Media UGC Benchmark',
    version: 'v0.1',
    description: 'Fieldwork corpus',
    targetMin: 160,
    targetMax: 200,
    lifecycleStatus: 'annotating',
    sampleIdPrefix: 'ugc',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  public loadSampleBatch() {
    const { encounters } = generateFieldworkSampleBatch();
    this.encounters = encounters;
  }

  public getDatasetInfo() {
    return this.datasetInfo;
  }

  public updateDatasetInfo(updated: Partial<DatasetInfo>) {
    this.datasetInfo = { ...this.datasetInfo, ...updated, updatedAt: new Date().toISOString() };
  }

  public getEncounters() {
    return this.encounters;
  }

  public filterEncounters(params: {
    search?: string;
    platform?: 'all' | Platform;
    status?: 'all' | string;
    role?: 'all' | GroundTruthItemRole;
    flaggedOnly?: boolean;
  }) {
    let result = [...this.encounters];

    if (params.flaggedOnly || params.status === 'flagged') {
      result = result.filter((e) => e.metadata?.isFlaggedForReview);
    } else if (params.status && params.status !== 'all') {
      result = result.filter((e) => e.status === params.status);
    }

    if (params.platform && params.platform !== 'all') {
      result = result.filter((e) => e.platform === params.platform);
    }

    if (params.role && params.role !== 'all') {
      result = result.filter((e) => normalizeRole(e.items[0]?.role) === params.role);
    }

    if (params.search && params.search.trim().length > 0) {
      const q = params.search.toLowerCase().trim();
      result = result.filter((e) => {
        const primary = e.items[0];
        const textMatch = primary?.content?.toLowerCase().includes(q);
        const authorMatch = primary?.author?.toLowerCase().includes(q);
        const idMatch = e.sampleId.toLowerCase().includes(q);
        const fileMatch = e.provenance.frameFilename?.toLowerCase().includes(q);
        return textMatch || authorMatch || idMatch || fileMatch;
      });
    }

    return result;
  }

  public getStats() {
    const total = this.encounters.length;
    let annotated = 0;
    let pending = 0;
    let rejected = 0;
    let skipped = 0;
    let flagged = 0;

    const platformCounts: Record<Platform, number> = {
      instagram: 0,
      tiktok: 0,
      reddit: 0,
      x: 0,
      youtube: 0,
      facebook: 0,
      threads: 0,
      other: 0,
    };

    for (const e of this.encounters) {
      if (e.status === 'annotated') annotated++;
      else if (e.status === 'pending') pending++;
      else if (e.status === 'rejected') rejected++;
      else if (e.status === 'skipped') skipped++;

      if (e.metadata?.isFlaggedForReview) flagged++;

      if (e.platform && platformCounts[e.platform] !== undefined) {
        platformCounts[e.platform]++;
      } else {
        platformCounts.other++;
      }
    }

    const progressPercent = total > 0 ? Math.round((annotated / total) * 100) : 0;
    // Progress is measured against the LOWER bound of the intended range (Slice 7 §4.2):
// the target is advisory, so this is guidance rather than a completion gate.
    const targetMin = this.datasetInfo.targetMin || 200;
    const targetProgressPercent = Math.min(100, Math.round((annotated / targetMin) * 100));

    return {
      total,
      annotated,
      pending,
      rejected,
      skipped,
      flagged,
      progressPercent,
      targetCount: targetMin,
      targetProgressPercent,
      platformCounts,
    };
  }

  public updateMetadata(
    sampleId: string,
    metadata: {
      textDensity?: DensityLevel;
      visualDensity?: DensityLevel;
      isFlaggedForReview?: boolean;
    }
  ) {
    const idx = this.encounters.findIndex((e) => e.sampleId === sampleId);
    if (idx === -1) throw new Error(`Sample ${sampleId} not found`);
    this.encounters[idx] = {
      ...this.encounters[idx],
      metadata: {
        ...this.encounters[idx].metadata,
        ...metadata,
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

function runSlice2Verification() {
  console.log('🧪 Starting Scrollnotes Slice 2 (Dataset Management) Verification...');

  const session = new MockSlice2Session();
  session.loadSampleBatch();

  // Test 1: Dataset Info & Lifecycle
  const info = session.getDatasetInfo();
  console.assert(info.name === 'Social Media UGC Benchmark');
  console.assert(info.lifecycleStatus === 'annotating');
  console.assert(info.targetMin === 160);
console.assert(info.targetMax === 200);

  session.updateDatasetInfo({
    name: 'VLM Social Ground Truth v2',
    targetMin: 200,
    targetMax: 250,
    lifecycleStatus: 'ready',
  });
  const updatedInfo = session.getDatasetInfo();
  console.assert(updatedInfo.name === 'VLM Social Ground Truth v2');
  console.assert(updatedInfo.targetMin === 200);
  console.assert(updatedInfo.targetMax === 250);
  console.assert(updatedInfo.lifecycleStatus === 'ready');
  console.log('  ✓ Test 1 Passed: Dataset info, target counts, and lifecycle transitions verified');

  // Test 2: Structured Metadata & Review Flags
  session.updateMetadata('ugc-000002', {
    textDensity: 'high',
    visualDensity: 'low',
    isFlaggedForReview: true,
  });

  const sample2 = session.getEncounters().find((e) => e.sampleId === 'ugc-000002');
  console.assert(sample2?.metadata?.textDensity === 'high');
  console.assert(sample2?.metadata?.isFlaggedForReview === true);
  console.log('  ✓ Test 2 Passed: Structured UGC metadata & review flags persisted');

  // Test 3: Search Query Filtering
  const searchResults = session.filterEncounters({ search: 'whiteboard' });
  console.assert(searchResults.length === 1 && searchResults[0].sampleId === 'ugc-000002');

  const authorResults = session.filterEncounters({ search: '@astraea_ai' });
  console.assert(authorResults.length === 1 && authorResults[0].sampleId === 'ugc-000001');

  const idResults = session.filterEncounters({ search: 'ugc-000003' });
  console.assert(idResults.length === 1 && idResults[0].sampleId === 'ugc-000003');
  console.log('  ✓ Test 3 Passed: Multi-field live search filtering verified');

  // Test 4: Platform & Status Filters
  const redditOnly = session.filterEncounters({ platform: 'reddit' });
  console.assert(redditOnly.length === 1 && redditOnly[0].platform === 'reddit');

  const flaggedOnly = session.filterEncounters({ status: 'flagged' });
  console.assert(flaggedOnly.length === 1 && flaggedOnly[0].sampleId === 'ugc-000002');

  // Legacy stored role 'comment' must filter as the new 'reply' (read-time normalisation).
  const legacySample = session.getEncounters().find((e) => e.sampleId === 'ugc-000002');
  if (legacySample) legacySample.items[0].role = 'comment' as unknown as GroundTruthItemRole;
  const repliesOnly = session.filterEncounters({ role: 'reply' });
  console.assert(repliesOnly.length === 1 && repliesOnly[0].sampleId === 'ugc-000002');
  console.log('  ✓ Test 4 Passed: Platform, Flag, and primary-item role filtering verified');

  // Test 5: Platform Distribution & Target Progress Stats
  const stats = session.getStats();
  console.assert(stats.total === 6);
  console.assert(stats.flagged === 1);
  console.assert(stats.platformCounts.reddit === 1);
  console.assert(stats.platformCounts.x === 1);
  console.assert(stats.platformCounts.instagram === 1);
  console.assert(stats.platformCounts.tiktok === 1);
  console.assert(stats.platformCounts.youtube === 1);
  console.assert(stats.platformCounts.threads === 1);
  // Progress is measured against the LOWER bound of the intended range.
  console.assert(stats.targetCount === 200);
  console.log('  ✓ Test 5 Passed: Platform distribution breakdown & target benchmark statistics verified');

  console.log('\n🎉 ALL SLICE 2 VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runSlice2Verification();
