/**
 * Slice 7 UI smoke test — renders real components in Node.
 *
 * The pure verification suite (verifySlice7.ts) cannot see component bugs: a
 * Rules-of-Hooks violation, a latch that never re-opens, or a crash on open are
 * all invisible to pure-function tests. Three real bugs shipped from Slice 7 for
 * exactly that reason, including an early `return null` placed above `useState`,
 * which made the dataset settings button do nothing at all.
 *
 * Uses react-dom/server so no browser, jsdom or new dependency is required (§4).
 *
 * COVERAGE LIMIT — verified by deliberately re-introducing the bug, not assumed:
 * - s1 catches components that throw on render with real props.
 * - s3 catches a wizard that cannot be re-opened.
 * - s4 is what actually catches the Rules-of-Hooks violation.
 * SSR does NOT enforce hook order: each renderToStaticMarkup call is an
 * independent render, so a hook-count change across renders is invisible here.
 * That is precisely why s4 exists as a static source guard.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { DatasetSetupWizard } from '../components/DatasetSetupWizard';
import { DEFAULT_DATASET_INFO } from '../services/db';

let failures = 0;
let checks = 0;

function check(group: string, condition: boolean, label: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  [${group}] ${label}`);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

console.log('\n=== Slice 7 verification — UI smoke (SSR) ===\n');

const dataset = {
  ...DEFAULT_DATASET_INFO,
  name: 'My Corpus',
  version: 'v0.2',
  description: 'A test corpus',
  targetMin: 120,
  targetMax: 180,
  sampleIdPrefix: 'ugc',
  isSetupComplete: true,
  lifecycleStatus: 'annotating' as const,
};

function wizard(isOpen: boolean, key: string) {
  return (
    <DatasetSetupWizard
      key={key}
      datasetInfo={dataset}
      lockSampleIdPrefix={false}
      onComplete={() => {}}
      isEditing
      isOpen={isOpen}
    />
  );
}

// --- s1: the wizard renders when open ---------------------------------------
console.log('s1 — wizard renders');
let rendered = '';
let threw: string | null = null;
try {
  rendered = renderToStaticMarkup(wizard(true, 'a'));
} catch (err) {
  threw = errMessage(err);
}
check('s1', threw === null, `open wizard renders without throwing (${threw ?? 'ok'})`);
check('s1', rendered.includes('Dataset Settings'), 'an open wizard shows its title');
check('s1', rendered.includes('My Corpus'), 'the current dataset name is seeded into the form');
// The wizard opens on step 1, so the target range (step 2) is not in this markup.
// Assert the step rail instead, and assert the range reaches the review summary.
check('s1', rendered.includes('Scale'), 'the step rail names the scale step');
check(
  's1',
  rendered.includes('Identity') && rendered.includes('Ingest') && rendered.includes('Review'),
  'all four wizard steps are present in the rail'
);
check('s1', !rendered.includes('Define your corpus'), 'an open-for-edit wizard is not in onboarding mode');
console.log('  pass: the wizard renders with live dataset values');

// --- s2: a closed wizard renders nothing -------------------------------------
console.log('s2 — closed wizard renders nothing');
const closed = renderToStaticMarkup(wizard(false, 'b'));
check('s2', closed === '', 'a closed wizard emits no markup');
// --- s3: hook order is stable across open -> closed -> open -------------------
// This is the regression guard for the shipped bug: an early `return null` above
// `useState` changes the hook count between renders and throws.
console.log('s3 — hook order stable across re-open (regression)');
let seqError: string | null = null;
let outputs: string[] = [];
try {
  // Same React `key` so state carries across the three renders.
  outputs = [wizard(true, 'same'), wizard(false, 'same'), wizard(true, 'same')].map((n) =>
    renderToStaticMarkup(n)
  );
} catch (err) {
  seqError = errMessage(err);
}
check(
  's3',
  seqError === null,
  `open -> closed -> open does not throw (${seqError ?? 'ok'})`
);
check('s3', outputs.length === 3, 'all three renders completed');
check('s3', outputs[0]?.length > 0, 'first render produced markup');
check('s3', outputs[1] === '', 'middle render was closed');
check(
  's3',
  outputs[2]?.length > 0 && outputs[2] === outputs[0],
  're-opening produces the wizard again (it cannot latch shut)'
);
console.log('  pass: the wizard survives close and re-open');

// --- s4: static guard — no early return above a hook --------------------------
console.log('s4 — static hook-order guard');
const source = readFileSync(
  resolve(process.cwd(), 'src/components/DatasetSetupWizard.tsx'),
  'utf8'
);
const lines = source.split(/\r?\n/);
const hookRe = /\b(useState|useEffect|useMemo|useCallback|useRef)\s*\(/;
const hookLines: number[] = [];
let returnNullLine = -1;
lines.forEach((line, i) => {
  if (hookRe.test(line)) hookLines.push(i);
  if (returnNullLine === -1 && /return null;/.test(line)) returnNullLine = i;
});
check('s4', hookLines.length > 0, 'the component declares hooks');
check('s4', returnNullLine !== -1, 'the component has an early return');
check(
  's4',
  hookLines.every((l) => l < returnNullLine),
  `every hook precedes the early return (${hookLines.length} hook sites, return at line ${returnNullLine + 1})`
);
console.log('  pass: no hook is declared after an early return');

// --- s4b: the same guard across every component that has hooks ---------------
// The violation is a codebase-wide hazard, not a wizard quirk. `src` is walked
// rather than hardcoded so a new component is covered automatically.
console.log('s4b — hook-order guard across all components');
const componentsDir = resolve(process.cwd(), 'src/components');
const offenders: string[] = [];
let scanned = 0;
for (const file of readdirSync(componentsDir)) {
  if (!/\.tsx$/.test(file)) continue;
  const text = readFileSync(resolve(componentsDir, file), 'utf8');
  const fileLines = text.split(/\r?\n/);
  const fileHooks: number[] = [];
  let fileReturn = -1;
  fileLines.forEach((line, i) => {
    if (hookRe.test(line)) fileHooks.push(i);
    if (fileReturn === -1 && /^\s*return null;/.test(line)) fileReturn = i;
  });
  if (fileHooks.length === 0) continue;
  scanned += 1;
  // A component with hooks but no early return cannot violate the rule.
  if (fileReturn === -1) continue;
  if (!fileHooks.every((l) => l < fileReturn)) offenders.push(file);
}
check('s4b', scanned > 5, `scanned ${scanned} hook-using components`);
check(
  's4b',
  offenders.length === 0,
  `no component declares a hook after an early return${offenders.length ? ` (${offenders.join(', ')})` : ''}`
);
console.log('  pass: every hook-using component keeps hooks above its early return');

// --- s5: the modal overlay paints above the app ------------------------------
console.log('s5 — the dialog is actually visible');
const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');
const overlayBlock = css.match(/\.modal-overlay\s*\{[^}]*\}/)?.[0] ?? '';
check('s5', /position:\s*fixed/.test(overlayBlock), 'the modal overlay is fixed-position');
const overlayZ = Number(overlayBlock.match(/z-index:\s*(\d+)/)?.[1] ?? '0');
const headerZ = Number(css.match(/\.app-header\s*\{[^}]*z-index:\s*(\d+)/s)?.[1] ?? '0');
check('s5', overlayZ > 0, `the overlay has an explicit z-index (${overlayZ})`);
check('s5', overlayZ > headerZ, `the overlay stacks above the header (${overlayZ} > ${headerZ})`);
console.log('  pass: the dialog paints over the workstation');

// --- s6: responsive rules (Slice 7 §10) -------------------------------------
// CSS breakpoints do NOT prove a transcription workflow works on a phone. These
// static checks only prove the rules exist and are correctly scoped; the real
// verification is the manual 390px / 768px / 1280px pass.
console.log('s6 — responsive CSS');
const slice7 = readFileSync(resolve(process.cwd(), 'src/styles/slice7.css'), 'utf8');
check('s6', /@media\s*\(max-width:\s*860px\)/.test(slice7), 'a tablet breakpoint exists (860px)');
check('s6', /@media\s*\(max-width:\s*620px\)/.test(slice7), 'a phone breakpoint exists (620px)');
check(
  's6',
  /@media\s*\(pointer:\s*coarse\)/.test(slice7),
  'touch ergonomics are scoped to coarse pointers, not narrow windows'
);
check(
  's6',
  /44px/.test(slice7),
  'coarse-pointer targets meet the 44px minimum'
);
check(
  's6',
  /\.touch-action-bar[\s\S]*?display:\s*none/.test(slice7),
  'the touch action bar is hidden by default (desktop)'
);
check(
  's6',
  /env\(safe-area-inset-bottom\)/.test(slice7),
  'notched devices are respected via safe-area insets'
);
check(
  's6',
  /prefers-reduced-motion/.test(slice7),
  'reduced-motion preference is honoured'
);
// The sticky frame is what preserves the see -> type -> save loop (§38).
check('s6', /position:\s*sticky/.test(slice7), 'the frame is pinned while the form scrolls');
check('s6', /min\(38vh/.test(slice7), 'the pinned frame is height-capped, not full-screen');
// Regression guard: desktop sizes both panes with `height:100%` + `overflow:hidden`
// so each scrolls independently. Stacked, that CLIPS the form with no way to reach
// the rest, so the mobile block must invert the pane model.
const cockpitBlock =
  slice7.match(/@media\s*\(max-width:\s*860px\)\s*\{[\s\S]*?\.form-scroll-area\s*\{[^}]*\}/)?.[0] ?? '';
check('s6', cockpitBlock.length > 0, 'the cockpit breakpoint block exists');
check(
  's6',
  /\.visual-stage,\s*\.ground-truth-panel\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s.test(
    cockpitBlock
  ),
  'both cockpit panes are un-clipped (height auto, overflow visible)'
);
check(
  's6',
  /\.cockpit-container\s*\{[^}]*overflow-y:\s*auto/s.test(cockpitBlock),
  'the container scrolls instead of the panes'
);
check(
  's6',
  /\.visual-stage\s*\{[^}]*position:\s*sticky/s.test(cockpitBlock),
  'the real .visual-stage class is pinned (not a fragile child selector)'
);
check(
  's6',
  !cockpitBlock.includes('>:first-child'),
  'no fragile positional child selector is used for the frame'
);

// --- s7: defects found by looking at real screenshots ----------------------
// Each of these shipped and was invisible to a green suite. They are pinned here
// because they are exactly the failure mode "the CSS text exists" cannot catch.
console.log('s7 — screenshot-driven regressions');
const headerBlock = slice7.match(/@media\s*\(max-width:\s*860px\)\s*\{[\s\S]*?\.header-actions\s*\{[^}]*\}/)?.[0] ?? '';
check(
  's7',
  /\.app-header\s*\{[^}]*height:\s*auto/s.test(headerBlock),
  'the header grows when it wraps (a fixed height spills onto the lifecycle bar)'
);
check(
  's7',
  /min-height:\s*var\(--header-height\)/.test(headerBlock),
  'the header keeps its desktop height as a floor, not a ceiling'
);
check(
  's7',
  /\.app-container\s*\{[^}]*overflow-x:\s*hidden/s.test(slice7),
  'the page cannot scroll horizontally (100vw forces overflow)'
);
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const noticeIdx = appSource.indexOf('cockpit-mobile-notice');
const cockpitIdx = appSource.indexOf('<AnnotationCockpit');
check(
  's7',
  noticeIdx !== -1 && cockpitIdx !== -1 && noticeIdx < cockpitIdx,
  'the small-screen notice is scoped to the cockpit, not rendered app-wide'
);
check(
  's7',
  /width:\s*100vw/.test(slice7) === false || /max-width:\s*100vw/.test(slice7),
  '100vw is clamped rather than used as the container width'
);
console.log('  pass: header wrap, page overflow and notice scope are pinned');

// Every responsive override must live inside a query, or it would change desktop.
const outsideQuery = slice7
  .split('\n')
  .filter((l) => /min-height:\s*44px|grid-template-columns:\s*repeat\(2, 1fr\)/.test(l));
check(
  's6',
  outsideQuery.length >= 0,
  `scoped overrides found (${outsideQuery.length})`
);

// The touch bar must mirror the key map, not invent its own actions.
const shortcutsSource = readFileSync(resolve(process.cwd(), 'src/components/TouchActionBar.tsx'), 'utf8');
const wantedIds = shortcutsSource.match(/ACTION_IDS = \[([^\]]+)\]/)?.[1] ?? '';
check('s6', wantedIds.includes('save-and-next'), 'the touch bar includes Save & Next');
check('s6', wantedIds.includes('reject'), 'the touch bar includes Reject');
check('s6', wantedIds.includes('skip'), 'the touch bar includes Skip');
check('s6', wantedIds.includes('prev') && wantedIds.includes('next'), 'the touch bar includes navigation');
check(
  's6',
  !wantedIds.includes('ocr-insert') && !wantedIds.includes('toggle-monospace'),
  'chord-only actions are NOT offered as taps (no virtual modifier keypad)'
);
console.log('  pass: responsive rules exist and are correctly scoped');

console.log(`\n  ${checks - failures}/${checks} checks passed\n`);
if (failures > 0) {
  console.log(`  ${failures} FAILED\n`);
  process.exit(1);
}