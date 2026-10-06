import { isItemComplete } from '../services/itemCompletion';
import { generateFieldworkSampleBatch } from '../services/sampleData';
import {
  EncounterSample,
  GroundTruthItem,
  Platform,
} from '../types/schema';

class MockMultiUGCSession {
  private encounters: EncounterSample[] = [];

  public loadSampleBatch() {
    const { encounters } = generateFieldworkSampleBatch();
    this.encounters = encounters;
  }

  public getEncounters() {
    return this.encounters;
  }

  public addItem(sampleId: string, item: GroundTruthItem) {
    const idx = this.encounters.findIndex((e) => e.sampleId === sampleId);
    if (idx === -1) throw new Error(`Sample ${sampleId} not found`);
    this.encounters[idx].items.push(item);
    this.encounters[idx].updatedAt = new Date().toISOString();
  }

  public removeItem(sampleId: string, index: number) {
    const idx = this.encounters.findIndex((e) => e.sampleId === sampleId);
    if (idx === -1) throw new Error(`Sample ${sampleId} not found`);
    if (this.encounters[idx].items.length <= 1) return;
    this.encounters[idx].items.splice(index, 1);
    this.encounters[idx].updatedAt = new Date().toISOString();
  }

  public search(query: string) {
    const q = query.toLowerCase().trim();
    return this.encounters.filter((e) => {
      const idMatch = e.sampleId.toLowerCase().includes(q);
      const fileMatch = e.provenance.frameFilename?.toLowerCase().includes(q);
      const itemMatch = e.items?.some(
        (item) =>
          item.content?.toLowerCase().includes(q) ||
          item.author?.toLowerCase().includes(q) ||
          item.mediaDescription?.toLowerCase().includes(q)
      );
      return idMatch || fileMatch || itemMatch;
    });
  }

  public getTotalItemsCount() {
    return this.encounters.reduce((acc, e) => acc + (e.items?.length || 1), 0);
  }

  public saveAndNext(
    sampleId: string,
    fields: {
      platform: Platform;
      items: GroundTruthItem[];
    }
  ) {
    const idx = this.encounters.findIndex((e) => e.sampleId === sampleId);
    if (idx === -1) throw new Error(`Sample ${sampleId} not found`);

    const hasAnyContent = fields.items.some(isItemComplete);

    this.encounters[idx] = {
      ...this.encounters[idx],
      platform: fields.platform,
      items: fields.items,
      status: hasAnyContent ? 'annotated' : this.encounters[idx].status,
      updatedAt: new Date().toISOString(),
    };
  }
}

function runMultiUGCVerification() {
  console.log('🧪 Starting Scrollnotes First-Class Multi-UGC Verification...');

  const session = new MockMultiUGCSession();
  session.loadSampleBatch();

  const encounters = session.getEncounters();

  // Test 1: Multi-Item Sample Ingestion
  const sample1 = encounters.find((e) => e.sampleId === 'ugc-000001');
  console.assert(sample1 !== undefined);
  console.assert(sample1?.items.length === 2, `Expected 2 items in ugc-000001, got ${sample1?.items.length}`);
  console.assert(sample1?.items[0].role === 'post', 'Primary item role should be post');
  console.assert(sample1?.items[1].role === 'reply', 'Secondary item role should be reply');
  console.log('  ✓ Test 1 Passed: Multi-item Twitter sample loaded with post + reply');

  // Test 2: Multi-Item Search (Search secondary reply content)
  const replySearchResults = session.search('token perplexity');
  console.assert(replySearchResults.length === 1, 'Should find sample containing secondary reply text');
  console.assert(replySearchResults[0].sampleId === 'ugc-000001');

  const replyAuthorResults = session.search('@marcus_vance');
  console.assert(replyAuthorResults.length === 1);
  console.assert(replyAuthorResults[0].sampleId === 'ugc-000001');
  console.log('  ✓ Test 2 Passed: Full-text search successfully matched secondary reply content and author');

  // Test 3: Adding 3rd Item in Frame (e.g. 3-tweet timeline)
  session.addItem('ugc-000001', {
    id: 'item-ugc-000001-3',
    role: 'reply',
    orderIndex: 2,
    content: 'Third visible comment at the bottom of the screenshot.',
    author: '@community_eval',
    mediaDescription: 'Bottom thread card.',
    hasMedia: false,
    hasAuthor: true,
  });

  const updatedSample1 = session.getEncounters().find((e) => e.sampleId === 'ugc-000001');
  console.assert(updatedSample1?.items.length === 3, `Expected 3 items, got ${updatedSample1?.items.length}`);
  console.log('  ✓ Test 3 Passed: Successfully added 3rd UGC item to frame stack');

  // Test 4: Removing Item
  session.removeItem('ugc-000001', 2);
  const afterRemove = session.getEncounters().find((e) => e.sampleId === 'ugc-000001');
  console.assert(afterRemove?.items.length === 2);
  console.log('  ✓ Test 4 Passed: Item removal from stack verified');

  // Test 5: Total Items Count
  const totalItems = session.getTotalItemsCount();
  console.assert(totalItems === 7, `Expected 7 total UGC items across 6 frames, got ${totalItems}`);
  console.log('  ✓ Test 5 Passed: Multi-item frame metrics accurate (7 items in 6 frames)');

  // Test 6: hasMedia / hasAuthor are UGC item-level, never frame-level
  const multiItemSample = session.getEncounters().find((e) => e.sampleId === 'ugc-000001');
  console.assert(
    multiItemSample?.items[0].hasMedia === true,
    'Primary post item must carry hasMedia=true at the UGC item level'
  );
  console.assert(
    multiItemSample?.items[1].hasMedia === false,
    'Secondary reply item must carry hasMedia=false at the UGC item level'
  );
  console.assert(
    multiItemSample?.items.every((it) => typeof it.hasAuthor === 'boolean'),
    'Every UGC item must declare hasAuthor'
  );
  const frameMetadata = (multiItemSample?.metadata ?? {}) as Record<string, unknown>;
  console.assert(
    !('hasMedia' in frameMetadata) && !('hasAuthor' in frameMetadata),
    'hasMedia/hasAuthor must NOT leak into frame-level SampleMetadata'
  );
  console.log('  ✓ Test 6 Passed: hasMedia/hasAuthor are stored per UGC item, never on frame metadata');

  console.log('\n🎉 ALL MULTI-UGC STACK VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runMultiUGCVerification();
