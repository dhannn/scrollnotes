/**
 * Slice 7 verification - Dataset lifecycle, shortcut registry, navigation.
 *
 * Runs in Node against the PURE core only (no DOM, no IndexedDB). The focus is
 * research integrity: the lifecycle must never be able to represent an
 * impossible state, and the shortcut registry must never disagree with itself.
 */
import {
  deriveLifecycle,
  checkTransition,
  describeTargetAttainment,
  PREDICATES,
  LIFECYCLE_ORDER,
} from '../domain/lifecycle';
import type { CorpusFacts } from '../domain/lifecycle';
import { migrateDatasetInfo, DEFAULT_DATASET_INFO } from '../services/db';
import {
  QUALITY_FLAG_ORDER,
  qualityFlagForDigit,
  toggleQualityFlag,
} from '../services/qualityFlags';
import { QUALITY_FLAG_LABELS } from '../types/schema';
import type { QualityFlag } from '../types/schema';
import {
  matchShortcut,
  normaliseEvent,
  normaliseChord,
  isTextEntryTarget,
  findChordConflicts,
  prettyChord,
} from '../services/shortcuts';
import type { ShortcutDef, ShortcutContext } from '../services/shortcuts';

let failures = 0;
let checks = 0;

function check(group: string, condition: boolean, label: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  [${group}] ${label}`);
  }
}

/** A fully-curated corpus against which incomplete variants are compared. */
function readyFacts(overrides: Partial<CorpusFacts> = {}): CorpusFacts {
  return {
    totalEncounters: 10,
    annotatedCount: 10,
    rejectedCount: 0,
    skippedCount: 0,
    suppressedDuplicates: 4,
    framesWithoutEncounter: 0,
    dedupEverRun: true,
    ocrArtifactCount: 10,
    targetMin: 10,
    targetMax: 12,
    blockingValidationFailures: 0,
    curatedPlatformCount: 2,
    hasExportedBefore: false,
    isSetupComplete: true,
    ...overrides,
  };
}

console.log('\n=== Slice 7 verification — dataset lifecycle ===\n');

// --- t1: derivation -----------------------------------------------------------
console.log('t1 — derivation');
check(
  't1',
  deriveLifecycle(readyFacts({ isSetupComplete: false })) === 'draft',
  'an un-onboarded dataset is draft regardless of other facts'
);
check(
  't1',
  deriveLifecycle(readyFacts({ totalEncounters: 0, annotatedCount: 0 })) === 'draft',
  'an empty corpus is never curating/annotating'
);
check(
  't1',
  deriveLifecycle(readyFacts({ hasExportedBefore: true })) === 'exported',
  'a validated corpus that has been exported is exported'
);
check(
  't1',
  deriveLifecycle(readyFacts()) === 'ready',
  'a validated, unexported corpus is ready'
);
check(
  't1',
  deriveLifecycle(
    readyFacts({ hasExportedBefore: false, annotatedCount: 4, totalEncounters: 10 })
  ) === 'annotating',
  'outstanding work derives to annotating'
);
check(
  't1',
  deriveLifecycle(
    readyFacts({
      annotatedCount: 0,
      totalEncounters: 8,
      dedupEverRun: true,
      blockingValidationFailures: 0,
    })
  ) === 'curating',
  'un-annotated frames after a dedup pass derive to curating'
);
console.log('  pass: lifecycle status is derived from corpus facts');
// --- t2: impossible states are unreachable ------------------------------------
console.log('t2 — impossible states are unreachable');
const allFacts: CorpusFacts[] = [
  readyFacts({ isSetupComplete: false, hasExportedBefore: true }),
  readyFacts({ totalEncounters: 0, annotatedCount: 0, hasExportedBefore: true }),
  readyFacts({ blockingValidationFailures: 3, hasExportedBefore: true }),
  readyFacts({ skippedCount: 2, annotatedCount: 8, hasExportedBefore: true }),
  readyFacts({ framesWithoutEncounter: 4, hasExportedBefore: true }),
  readyFacts({ curatedPlatformCount: 0, hasExportedBefore: true }),
];
check(
  't2',
  allFacts.every((f) => deriveLifecycle(f) !== 'exported'),
  'no combination of facts derives to exported while anything is unresolved'
);
check(
  't2',
  allFacts.every((f) => !PREDICATES.ready(f).holds),
  'the ready predicate rejects every incomplete corpus above'
);
check(
  't2',
  PREDICATES.draft(readyFacts()).holds === false,
  'a fully curated corpus does not hold the inverted draft predicate'
);
check(
  't2',
  PREDICATES.exported(readyFacts({ hasExportedBefore: false })).holds === false,
  'exported requires a prior successful export'
);
console.log('  pass: unresolved corpora can never claim a finished state');

// --- t3: automatic demotion ---------------------------------------------------
console.log('t3 — automatic demotion');
check(
  't3',
  deriveLifecycle(readyFacts({ hasExportedBefore: true, annotatedCount: 9, totalEncounters: 10 })) ===
    'annotating',
  'reopening one sample demotes an exported corpus back to annotating'
);
const exportedThenBroken = deriveLifecycle(
  readyFacts({ hasExportedBefore: true, blockingValidationFailures: 1 })
);
check(
  't3',
  exportedThenBroken !== 'exported' && exportedThenBroken !== 'ready',
  'a failing export check demotes an exported corpus'
);
console.log('  pass: exported demotes automatically when facts regress');

// --- t4: guarded promotion ----------------------------------------------------
console.log('t4 — guarded promotion');
const blocked = checkTransition('draft', 'ready', readyFacts({ annotatedCount: 3, totalEncounters: 10 }));
check('t4', blocked.allowed === false, 'promotion to ready is blocked while samples are pending');
check('t4', Boolean(blocked.reason), 'a blocked promotion explains why (§39)');
check('t4', Boolean(blocked.remedy), 'a blocked promotion explains what to do next (§39)');
check(
  't4',
  checkTransition('draft', 'exported', readyFacts({ hasExportedBefore: false })).allowed === false,
  'promotion to exported is blocked before an export has happened'
);
check(
  't4',
  checkTransition('annotating', 'ready', readyFacts({ blockingValidationFailures: 2 })).allowed ===
    false,
  'failing export checks block ready'
);
check(
  't4',
  checkTransition('annotating', 'ready', readyFacts()).allowed === true,
  'a fully validated corpus may be promoted to ready'
);
console.log('  pass: promotion is validated against the corpus facts');

// --- t5: demotion is always allowed ------------------------------------------
console.log('t5 — demotion is always allowed');
const brokenCorpus = readyFacts({
  blockingValidationFailures: 5,
  annotatedCount: 0,
  totalEncounters: 0,
});
let demotionChecks = 0;
for (const from of LIFECYCLE_ORDER) {
  for (const to of LIFECYCLE_ORDER) {
    if (LIFECYCLE_ORDER.indexOf(to) < LIFECYCLE_ORDER.indexOf(from)) {
      demotionChecks += 1;
      check(
        't5',
        checkTransition(from, to, brokenCorpus).allowed === true,
        `demotion ${from} -> ${to} is always permitted`
      );
    }
  }
}
check('t5', demotionChecks === 10, 'every demotion edge was exercised');
check(
  't5',
  checkTransition('ready', 'ready', brokenCorpus).allowed === true,
  'a same-state no-op is always permitted'
);
console.log('  pass: the researcher can always walk a dataset backwards');

check(
  't4',
  checkTransition('annotating', 'ready', readyFacts({ blockingValidationFailures: 2 })).allowed ===
    false,
  'failing export checks block ready'
);
console.log('t6 — corpus size target never blocks');
const undershot = readyFacts({ annotatedCount: 2, totalEncounters: 2, targetMin: 150, targetMax: 200 });
check(
  't6',
  PREDICATES.ready(undershot).holds,
  'a corpus far below its intended target is still Ready if it is internally sound'
);
check(
  't6',
  deriveLifecycle(undershot) === 'ready',
  'undershooting the target does not block the derived lifecycle'
);
check(
  't6',
  checkTransition('annotating', 'ready', undershot).allowed === true,
  'promotion to ready is permitted despite missing the target'
);
check(
  't6',
  PREDICATES.ready(undershot).blockers.length === 0,
  'no blocker mentions corpus size'
);
const overshot = readyFacts({ annotatedCount: 500, totalEncounters: 500, targetMin: 150, targetMax: 200 });
check(
  't6',
  PREDICATES.ready(overshot).holds,
  'exceeding the intended maximum is also non-blocking'
);
const assessment = describeTargetAttainment(undershot);
check('t6', assessment.attainment === 'below', 'undershoot is reported as advisory information');
check('t6', assessment.message.includes('legitimate'), 'the advisory message frames undershoot as legitimate');
check(
  't6',
  describeTargetAttainment(readyFacts()).attainment === 'in-range',
  'an in-range corpus reports in-range'
);
check(
  't6',
  describeTargetAttainment(overshot).attainment === 'above',
  'an overshoot reports above'
);
console.log('  pass: size ambition informs but never blocks');

// --- t7: setup gating and migration (Slice 7 §5) ---------------------------
console.log('t7 — setup gating and migration');
check(
  't7',
  DEFAULT_DATASET_INFO.isSetupComplete === false,
  'a fresh dataset is NOT setup-complete, so onboarding cannot be skipped'
);
check(
  't7',
  DEFAULT_DATASET_INFO.lifecycleStatus === 'draft',
  'a fresh dataset is no longer born claiming to be mid-annotation'
);
check(
  't7',
  deriveLifecycle(readyFacts({ isSetupComplete: false })) === 'draft',
  'an un-onboarded corpus derives to draft however complete its facts look'
);

const legacy = {
  id: 'default',
  name: 'Old Corpus',
  version: 'v0.1',
  description: '',
  targetCount: 200,
  lifecycleStatus: 'annotating' as const,
  sampleIdPrefix: 'ugc',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const migrated = migrateDatasetInfo(legacy);
check('t7', migrated.targetMin === 160, 'legacy targetCount 200 migrates to a 160-200 band');
check('t7', migrated.targetMax === 200, 'the legacy target becomes the upper bound');
check('t7', migrated.isSetupComplete === false, 'legacy datasets are re-onboarded exactly once');
check(
  't7',
  migrateDatasetInfo(migrated).isSetupComplete === false,
  'migration is idempotent and never marks setup complete by itself'
);
check(
  't7',
  migrateDatasetInfo({ ...migrated, isSetupComplete: true }).isSetupComplete === true,
  'a completed setup survives migration unchanged'
);
check(
  't7',
  migrateDatasetInfo({ ...legacy, targetCount: 5 }).targetMin <= 5,
  'small legacy targets never produce an inverted range'
);
const inverted = migrateDatasetInfo({
  ...migrated,
  targetMin: 300,
  targetMax: 100,
  isSetupComplete: true,
});
check(
  't7',
  inverted.targetMin <= inverted.targetMax,
  'an inverted target range is normalised instead of being trusted'
);
console.log('  pass: onboarding is enforced and legacy datasets migrate cleanly');

// --- t8: export demotion + reopen (§4.3, §4.5) --------------------------
console.log('t8 — exported survives reload, reopen always works');
const exported = readyFacts({ hasExportedBefore: true });
check('t8', deriveLifecycle(exported) === 'exported', 'a validated, exported corpus derives to exported');
check(
  't8',
  deriveLifecycle({ ...exported, annotatedCount: 9, totalEncounters: 10 }) !== 'exported',
  'reopening one sample immediately drops the corpus out of exported'
);
check(
  't8',
  checkTransition('exported', 'annotating', { ...exported, blockingValidationFailures: 3 }).allowed,
  'a researcher who spots a problem can always reopen an exported corpus'
);
check(
  't8',
  checkTransition('exported', 'exported', exported).allowed,
  're-deriving the same status is a no-op, not a transition'
);
check(
  't8',
  checkTransition('ready', 'exported', exported).allowed,
  'promoting to exported succeeds once a prior export is recorded'
);
check(
  't8',
  checkTransition('ready', 'exported', { ...exported, hasExportedBefore: false }).allowed === false,
  'a corpus that was never exported cannot simply declare itself exported'
);
console.log('  pass: export state is recorded and always reopenable');

// --- t9: quality flags (Slice 7 §6, AGENTS §25) --------------------------
console.log('t9 — quality flags are settable, keyed and reversible');
check('t9', QUALITY_FLAG_ORDER.length === 8, 'all eight §25 flags are offered');
check(
  't9',
  QUALITY_FLAG_ORDER.every((f) => typeof QUALITY_FLAG_LABELS[f] === 'string'),
  'every offered flag has a human label to display'
);
check(
  't9',
  new Set(QUALITY_FLAG_ORDER).size === QUALITY_FLAG_ORDER.length,
  'the flag order contains no duplicates'
);

// The digit hint rendered on each chip must be a real binding.
for (let i = 1; i <= QUALITY_FLAG_ORDER.length; i++) {
  check(
    't9',
    qualityFlagForDigit(i) === QUALITY_FLAG_ORDER[i - 1],
    `key ${i} maps to the flag shown on chip ${i}`
  );
}
check('t9', qualityFlagForDigit(0) === undefined, 'key 0 is not a flag');
check(
  't9',
  qualityFlagForDigit(QUALITY_FLAG_ORDER.length + 1) === undefined,
  'digits beyond the flag count are inert'
);
check('t9', qualityFlagForDigit(1.5) === undefined, 'non-integer keys are inert');

let flags = toggleQualityFlag([], 'ui-heavy');
check('t9', flags.length === 1 && flags[0] === 'ui-heavy', 'a flag can be applied');
flags = toggleQualityFlag(flags, 'ambiguous-author');
check('t9', flags.length === 2, 'a second flag can be applied alongside the first');
check(
  't9',
  flags.includes('ui-heavy') && flags.includes('ambiguous-author'),
  'applying a flag never clears the others'
);
flags = toggleQualityFlag(flags, 'ui-heavy');
check('t9', flags.length === 1 && flags[0] === 'ambiguous-author', 'a flag can be removed again');

const original: QualityFlag[] = ['ui-heavy'];
const toggled = toggleQualityFlag(original, 'ui-heavy');
check(
  't9',
  original.length === 1 && original[0] === 'ui-heavy',
  'toggling never mutates the input array in place'
);
check('t9', toggled.length === 0, 'while returning a new array');
console.log('  pass: flags are keyed, reversible, and immutable');

// --- t10: shortcut registry (Slice 7 §7) ---------------------------------
console.log('t10 — shortcut registry');

function key(
  k: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}
) {
  return {
    key: k,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  };
}

const baseCtx: ShortcutContext = {
  view: 'cockpit',
  modalOpen: false,
  hasActiveSample: true,
  hasNext: true,
  hasPrev: true,
  hasUnannotated: true,
  hasNextUnannotated: true,
  hasPrevUnannotated: true,
};

const testDefs: ShortcutDef[] = [
  {
    id: 'save',
    chords: ['Ctrl+Enter'],
    views: ['cockpit'],
    description: 'Save & next',
    group: 'annotation',
    handler: () => {},
  },
  {
    id: 'reject',
    bareKey: 'R',
    description: 'Reject',
    group: 'curation',
    handler: () => {},
  },
  {
    id: 'jump',
    bareKey: 'J',
    description: 'Next unannotated',
    group: 'navigation',
    when: (c) => c.hasNextUnannotated,
    handler: () => {},
  },
];

// Ctrl and Cmd are the same modifier, so one binding serves both platforms.
check(
  't10',
  matchShortcut(key('Enter', { ctrl: true }), null, baseCtx, testDefs)?.id === 'save',
  'Ctrl+Enter matches the save binding'
);
check(
  't10',
  matchShortcut(key('Enter', { meta: true }), null, baseCtx, testDefs)?.id === 'save',
  'Cmd+Enter matches the SAME save binding (macOS)'
);
check(
  't10',
  normaliseEvent(key('Enter', { ctrl: true })) === normaliseEvent(key('Enter', { meta: true })),
  'Ctrl and Cmd normalise identically'
);
check(
  't10',
  normaliseChord('Cmd+Enter') === normaliseChord('Ctrl+Enter'),
  'chord definitions normalise Ctrl/Cmd alike'
);
check(
  't10',
  matchShortcut(key('Enter', { ctrl: true }), null, { ...baseCtx, view: 'gallery' }, testDefs) ===
    undefined,
  'a view-scoped chord does not fire outside its view'
);
check(
  't10',
  matchShortcut(key('Enter', { ctrl: true }), null, { ...baseCtx, modalOpen: true }, testDefs)?.id ===
    'save',
  'chords still fire while a modal is open'
);
check(
  't10',
  matchShortcut(key('r'), null, baseCtx, testDefs)?.id === 'reject',
  'a bare key fires when nothing is focused'
);
check(
  't10',
  matchShortcut(key('r'), { tagName: 'TEXTAREA' }, baseCtx, testDefs) === undefined,
  'a bare key is suppressed inside a textarea'
);
check(
  't10',
  matchShortcut(key('r'), { tagName: 'DIV', isContentEditable: true }, baseCtx, testDefs) === undefined,
  'a bare key is suppressed inside a contenteditable'
);
check(
  't10',
  matchShortcut(key('r'), null, { ...baseCtx, modalOpen: true }, testDefs) === undefined,
  'a bare key is suppressed while a modal is open (the old triple-Esc bug)'
);
check(
  't10',
  matchShortcut(key('j'), null, { ...baseCtx, hasNextUnannotated: false }, testDefs) === undefined,
  'a disabled shortcut does not fire'
);
check(
  't10',
  matchShortcut(key('q'), null, baseCtx, testDefs) === undefined,
  'an unbound key does nothing'
);
check(
  't10',
  findChordConflicts(testDefs).length === 0,
  'no two shortcuts claim the same chord in the same view'
);
check(
  't10',
  isTextEntryTarget(null) === false,
  'a null target is not a text field'
);
check('t10', prettyChord('Ctrl+Enter').join('') === 'CtrlEnter', 'chords render as hint chips');
console.log('  pass: one registry, normalised chords, focus and modal suppression');

// --- t11: curation is reachable (regression: lifecycle stuck on DRAFT) -----
console.log('t11 — curation is reachable');
// Reproduces the shipped bug: `has-samples` fails whenever nothing is annotated,
// which is the NORMAL state during curation. Counting it blocked `curating`.
const curatingFacts = readyFacts({
  annotatedCount: 0,
  totalEncounters: 8,
  dedupEverRun: true,
  blockingValidationFailures: 0,
});
check(
  't11',
  deriveLifecycle(curatingFacts) === 'curating',
  'frames deduped but not yet annotated derive to curating, not draft'
);
check(
  't11',
  deriveLifecycle(readyFacts({ totalEncounters: 0, annotatedCount: 0 })) === 'draft',
  'a corpus with no frames at all is still draft'
);
check(
  't11',
  deriveLifecycle(readyFacts({ totalEncounters: 8, annotatedCount: 0, dedupEverRun: false })) ===
    'draft',
  'frames imported but not yet deduplicated are still draft'
);
check(
  't11',
  deriveLifecycle(readyFacts({ annotatedCount: 3, totalEncounters: 8 })) === 'annotating',
  'the first annotation advances the corpus to annotating'
);
console.log('  pass: a corpus progresses draft -> curating -> annotating');

console.log(`\n  ${checks - failures}/${checks} checks passed\n`);
if (failures > 0) {
  console.log(`  ${failures} FAILED\n`);
  process.exit(1);
}

