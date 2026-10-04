# Plan — Slice 7: Dataset Lifecycle, Quality Flags, Shortcut Registry

> **Goal:** make the dataset the *first-class object* of the application. A new
> researcher opens Scrollnotes and is walked through defining their corpus before
> touching a single frame. From then on the dataset's lifecycle state is **derived
> and enforced by the machine**, never hand-selected by a human who can put it in
> an impossible state.

Scope agreed with the researcher:

- **(A) Dataset setup / onboarding as the first step in the user flow.**
- **(B) Lifecycle as an automated state machine** that adapts to context and
  prevents human error and self-contradictory manifests.
- **(C) Quality-flag annotation UI** (§25 — type exists, no UI).
- **(D) Centralized shortcut registry** (single source of truth).
- **(E) Progress: jump-to-next-unannotated.**

---

## 1. Problem statement — what is broken today

| # | Problem | Evidence | Consequence |
|---|---|---|---|
| P1 | Lifecycle is a free-text choice | `DatasetSettingsModal.tsx:160-174` renders 5 pills, any click persists | `exported` on a 0-sample dataset; `draft` on a finished one |
| P2 | Default dataset is born mid-annotation | `db.ts:80` → `lifecycleStatus: 'annotating'` | Manifests lie on first run |
| P3 | No setup flow | `getDatasetInfo()` (`db.ts:180-185`) silently writes the default; nothing prompts | Researcher never names their corpus or sets a target |
| P4 | Settings modal is buried | Reachable only from `Header` | Feels like an afterthought |
| P5 | Quality flags are write-only | `SampleMetadata.qualityFlags` + `QUALITY_FLAG_LABELS` + export support exist; no component writes them | §25 unusable |
| P6 | Shortcuts are duplicated and can drift | Handlers in `AnnotationCockpit`, `GroundTruthForm`, `OCRPanel`, `DeduplicationReview`; `KeyboardShortcutsModal` hardcodes its own list | Docs can disagree with reality; `Esc` bound in ≥3 places |
| P7 | No skip-to-next-unannotated | `goToNext` walks the raw list | At 200 samples most navigation is wasted |

---

## 2. Decision record

### 2.1 Lifecycle becomes a **derived** state, not a stored one

The researcher asked for automation "to prevent human errors/discrepancies". The
cleanest way to guarantee no impossible state is to stop letting the human write
it. Therefore:

- `DatasetLifecycleStatus` is **computed** from corpus facts.
- `isSetupComplete` is a **separate persisted boolean**, written exactly once by
  the setup wizard. This is the only new persisted field.

**Rejected:** a transition table with guarded edges (`draft → curating → …`).
Rejected because it still permits the researcher to *lie* — clicking "Ready" on
an unvalidated corpus is exactly the discrepancy we are eliminating. The machine
must be able to say **no**.

**Rejected:** forbidding manual override entirely. A researcher must be able to
demote (e.g. `exported → annotating`) when they discover an error. Demotion is
always allowed; promotion is always validated.

### 2.2 Backwards compatibility of the persisted shape

`DatasetInfo.lifecycleStatus` already exists and is already in `manifest.json`.
We **keep the field** and keep writing it — but it is now written as the *derived*
value on every save, so old readers and existing exports remain correct. A
migration in `db.ts` rewrites `'annotating'` → `'draft'` and `isSetupComplete:
false` for any pre-Slice-7 stored dataset. Existing installs are not corrupted;
they are simply re-onboarded once.

### 2.3 Setup wizard is a modal stack, not a router

`react-router` is not installed and adding it for a 3-step wizard would be a
dependency for navigation the app does not otherwise need (§4: don't add deps
because they're fashionable). A single `DatasetSetupWizard` component owning its
own step index is simpler and keeps the app's single-view architecture intact.

### 2.4 No new dependencies

Everything here is plain TS/React. The shortcut registry replaces the need for a
command-palette library entirely.

---

## 3. Architecture

```text
src/
├── domain/                        ← NEW. Pure, no React, no IndexedDB.
│   └── lifecycle.ts                deriveLifecycle(), guards, explanations
├── services/
│   ├── db.ts                      + isSetupComplete, migration, writeDerivedStatus
│   ├── export.ts                  + derived status in manifest (no shape change)
│   └── shortcuts.ts               ← NEW. Declarative registry (data only)
├── hooks/
│   ├── useShortcuts.ts            ← NEW. One global keydown listener
---

## 4. (B) The lifecycle state machine

### 4.1 Inputs — "corpus facts"

`deriveLifecycle()` is a pure function of these, all already available:

```ts
export interface CorpusFacts {
  totalEncounters: number;
  annotatedCount: number;
  rejectedCount: number;
  skippedCount: number;
  suppressedDuplicates: number;
  framesWithoutEncounter: number;   // provenance holes
  dedupEverRun: boolean;
  ocrArtifactCount: number;
  targetCount: number;
  /** Any failed check from exportValidation (§24). */
  blockingValidationFailures: number;
  /** Distinct platforms the researcher has verified. */
  curatedPlatformCount: number;
  hasExportedBefore: boolean;
  isSetupComplete: boolean;
}
```

### 4.2 States and their **predicates** (not transitions)

```ts
draft      := !isSetupComplete
             OR (no dedup run AND no encounters annotated)
             OR framesWithoutEncounter > 0

curating   := isSetupComplete
             AND encounters exist
             AND dedupEverRun
             AND annotatedCount === 0
             AND no blocking failures

annotating := annotatedCount > 0
             AND (pendingCount > 0 OR skippedCount > 0)

ready      := isSetupComplete
             AND blockingValidationFailures === 0
             AND pendingCount === 0
             AND skippedCount === 0
             AND annotatedCount >= Math.min(1, targetCount)
             AND curatedPlatformCount >= 1

exported   := hasExportedBefore AND ready
```

Precedence is **top-to-bottom, first match wins**, so the state can never claim
to be further along than the facts allow. `exported` is evaluated first and falls
through when `ready` does not hold, which means an exported corpus automatically
demotes the moment a sample is reopened.

### 4.3 Guarded promotion, always-open demotion

```ts
export interface TransitionCheck {
  to: DatasetLifecycleStatus;
  allowed: boolean;
  /** Human sentence shown in the UI when blocked. */
  reason?: string;
  /** What the researcher would have to do first. */
  remedy?: string;
}

export function checkTransition(
  from: DatasetLifecycleStatus,
  to: DatasetLifecycleStatus,
  facts: CorpusFacts
): TransitionCheck
```

- `to === from` → always allowed.
- Rank increase (`RANK[to] > RANK[from]`) → validated against `PREDICATES[to]`.
- Rank decrease → **always allowed** (researcher discovered a mistake).
- A blocked attempt returns `allowed: false` with a specific sentence, e.g.
  *"Cannot mark Ready — 14 samples are still pending and 3 frames have no
  ground truth."* This satisfies §39 (errors must explain what to do next).

### 4.4 Context adaptation (`LifecycleGate`)

The machine drives *what the researcher can do*, not just a badge:

| Derived state | Gallery | Dedup | Cockpit | Sessions | Export |
|---|---|---|---|---|---|
| `draft` (setup done, no frames) | blocked → wizard | blocked | blocked | **primary CTA** | blocked |
| `draft` (no setup) | blocked → wizard | blocked | blocked | blocked | blocked |
| `curating` | available | **primary CTA** | allowed (preview) | available | discouraged (warn, allow) |
| `annotating` | available | available | **primary CTA** | available | discouraged if failures |
| `ready` | available | available | allowed | available | **primary CTA** |
| `exported` | available | available | available | available | **primary CTA** |

Blocked panels render the *reason* and a button that performs the remedy
(e.g. "Go to Dedup" / "Resume Setup"), never a dead end (§39).

### 4.5 Persisted derived status

`useDatasetLifecycle` recomputes on every corpus change and, when the derived
value differs from `datasetInfo.lifecycleStatus`, persists it silently. This means
**the Header badge, the manifest, and the settings modal can never disagree** —
the single source of truth problem that produced P1 and P2.

`DatasetSettingsModal` keeps a status control but it is now a **read-only display
plus a demote button** ("Reopen dataset"), rather than five free pills.

---

## 5. (A) Onboarding — dataset setup first

`db.ts` must stop silently fabricating a dataset. New behaviour:

```ts
export const DEFAULT_DATASET_INFO: DatasetInfo = {
  ...
  lifecycleStatus: 'draft',   // was 'annotating' (P2)
  isSetupComplete: false,     // NEW
};
```

`useFieldSession` returns `isSetupComplete`. `App` renders `DatasetSetupWizard`
instead of the gallery whenever it is `false`.

### Wizard steps

1. **Identity** — name, version, description ("what will this corpus be used to
   evaluate?"). Pre-fills the existing sensible default so the researcher can
   accept with Enter, but **requires an explicit continue**.
2. **Scale & sampling** — target sample count, sample ID prefix (live preview of
   the resulting IDs, since the prefix is immutable once samples exist).
3. **Ingest plan** — choose the entry route: import a recording (→ Sessions) or
   drop images. Copy explaining recordings are provenance containers, not
   platform categories (§5).
4. **Review** — summary card, then **"Create corpus"**. This is the only place
   `isSetupComplete` is set to `true`.

Steps are skippable-after-setup: the wizard reopens from the Header as
"Dataset settings" for edits, but re-opening never re-triggers the blocking gate.

### Guard on ID prefix

If any sample already exists, the prefix field is disabled with the explanation
that changing it would break sample-ID stability (§21). This is a discrepancy the
tool should prevent rather than warn about.
│   ├── useDatasetLifecycle.ts     ← NEW. Corpus facts → lifecycle, auto-persist
│   └── useFieldSession.ts         + lifecycle wiring, nextUnannotatedIndex
├── components/
│   ├── DatasetSetupWizard.tsx     ← NEW. First-run onboarding (P3)
│   ├── DatasetLifecycleBar.tsx    ← NEW. Persistent header strip (P4, §27)
│   ├── LifecycleGate.tsx          ← NEW. Context-adaptive blocking + explanation
│   ├── QualityFlagPicker.tsx      ← NEW. (C)
│   └── KeyboardShortcutsModal.tsx  REWRITTEN to render from registry (D)
└── styles/
    └── slice7.css                 ← NEW
```
## 6. (C) Quality-flag UI

`QualityFlagPicker` — chip row inside `GroundTruthForm`, below metadata:

- Renders all 8 flags from `QUALITY_FLAG_LABELS` as toggle chips.
- Keys `1`–`8` toggle the corresponding flag when the cockpit is focused; the
  chips display their digit so the shortcut is discoverable.
- Fully keyboard-operable, `aria-pressed` on each chip.
- Selecting `multiple-ugc-items` is offered as a one-click "add second UGC item"
  affordance (§7) rather than making the researcher flip a flag then hunt for the
  add button.

**Gallery badge:** `EncounterCard` shows a small warning glyph with the flag count
when `metadata.qualityFlags.length > 0`, and the `flagged` status filter
(already present in `StatusFilterOption`) continues to select them.

Autosave: flags ride along in the existing `updateEncounter` metadata write, so
there is no new persistence path and no risk of a flag surviving locally but not
in IndexedDB.

---

## 7. (D) Shortcut registry

```ts
// services/shortcuts.ts — data only, zero React
export interface ShortcutContext {
  view: GalleryView;
  isInputFocused: boolean;
  hasActiveSample: boolean;
  hasNext: boolean;
  hasPrev: boolean;
  hasUnannotated: boolean;
  modalOpen: boolean;
}

export interface ShortcutDef {
  id: string;
  /** e.g. ['Ctrl+Enter'] */
  chords: string[];
  /** Single-key shortcuts must declare when they are live. */
  bareKey?: { key: string; when?: (ctx: ShortcutContext) => boolean };
  description: string;
  group: 'navigation' | 'curation' | 'annotation' | 'ocr' | 'dataset' | 'global';
  handler: () => void;             // wired in App, not in the registry module
}
```

- `useShortcuts(defs)` installs **exactly one** `keydown` listener for the app.
- Chord matching normalises `Cmd`/`Ctrl` and `e.key` case, so `Cmd+Enter` on macOS
  and `Ctrl+Enter` on Windows both hit the same id (the modal currently hardcodes
  `Ctrl`).
- Bare keys (A/R/D/S/J/K/1-8) are suppressed when `isInputFocused` — replacing the
  ad-hoc `target.tagName === 'INPUT'` checks.
- Bare keys are suppressed when `modalOpen`, which fixes the current `Esc`
  triple-binding.
- `KeyboardShortcutsModal` **renders from the registry**, grouped, so the
  documented list can never drift from the bindings (§18 "display shortcut hints").

### Migration mapping for existing behaviour

| Existing | New id | Note |
|---|---|---|
| `Ctrl/Cmd+Enter` | `save-and-next` | unchanged |
| `→` / `←` | `next` / `prev` | unchanged |
| `S` skip, `R` reject | `skip` / `reject` | unchanged |
| `Alt+I` OCR insert, `Alt+O` run OCR | `ocr-insert` / `ocr-run` | unchanged |
| `Ctrl+M` mono | `toggle-monospace` | unchanged |
| — | `accept` (`A`), `duplicate` (`D`) | §11 asks for these; currently missing |
| — | `next-unannotated` (`J`), `prev-unannotated` (`K`) | **new** (E) |
| — | `show-shortcuts` (`?`) | **new**; shortcuts modal is currently undiscoverable |

---

## 8. (E) Progress + skip-to-next-unannotated

`useFieldSession` gains:

```ts
const nextUnannotatedIndex: number | null;  // first encounter that is not 'annotated'
const prevUnannotatedIndex: number | null;
const unannotatedCount: number;
```

`J`/`K` move between them, wrapping, and are inert when the list is complete
(the shortcut registry's `when` predicate handles the disabled state).

Plus `DatasetLifecycleBar` in the `Header`: a persistent thin strip with
`annotated / target`, a progress bar, and the derived lifecycle badge with a
tooltip explaining *why* it is in that state (§15, §27). This replaces the orphan
`lifecycle-badge` span and makes progress visible from every view.

---

## 9. Verification

New `src/test/verifySlice7.ts`, wired as `npm run verify:slice7` and into
`verify`. Follows the existing hand-rolled `check()` harness.

| Group | Assertions |
|---|---|
| lifecycle | empty corpus → `draft`; never `exported`/`ready` without setup; exported demotes to `annotating` when a sample is reopened; `ready` blocked while any sample is pending |
| transitions | promotion to `ready` blocked with a non-empty `reason` + `remedy`; demotion always allowed; same-state no-op allowed; export validation failures block `ready` |
| setup | `isSetupComplete=false` forces `draft` regardless of other facts; a `draft` corpus cannot enter the cockpit |
| prefix guard | prefix change rejected once samples exist |
| shortcuts | `Cmd+Enter` and `Ctrl+Enter` match the same id; bare keys suppressed in inputs and while a modal is open; every registry `chord` is unique; `A`/`D` reachable in the gallery |
| flags | toggling a flag persists through `updateEncounter`; flags survive into `annotations.jsonl` and the manifest counts |
| next-unannotated | `nextUnannotatedIndex` skips annotated/rejected/skipped; `null` when the corpus is complete |

---

## 10. Responsive / mobile support

> **GATING: This is the LAST item in the slice and requires explicit researcher
> approval after sections 1–9 are complete and working.** It is listed last
> deliberately: retrofitting a keyboard-first, two-column workstation onto small
> screens touches nearly every layout rule, and doing it early would distort the
> desktop layout that sections 1–9 are building against.
>
> Do not begin this section until the researcher says so.

### 10.1 Current state

The entire stylesheet is desktop-only:

| File | `@media` queries | Smallest breakpoint |
|---|---|---|
| `index.css` (1192 lines) | 1 (`:716`) | 1140px |
| `slices34.css` (597 lines) | 1 (`:587`) | 1140px |
| `slice5.css` (389 lines) | 1 (`:16`) | 960px |
| `slice6.css` (211 lines) | 0 | — |

Fixed-width and desktop-assuming declarations that will not reflow:

- `.cockpit-container` — `grid-template-columns: 1fr 520px` (§12's two-column
  layout: large frame + ground truth). Below ~1100px this leaves the image ~600px
  and the form 440px, which is unusable on a phone.
- `.platform-selector-grid` — `repeat(4, 1fr)`, eight platform pills in four
  columns (§14).
- `.export-format-row` — `repeat(3, 1fr)` (ZIP / JSONL / CSV).
- Modals (`.modal-dialog`) — max-widths around 580px+ with no small-screen variant.

### 10.2 The honest tension

The cockpit is built around three assumptions that mobile breaks:

1. **Keyboard-first (§18).** A/B/D/S/J/K, `Ctrl+Enter`, `Alt+I` are meaningless
   without a hardware keyboard. This is the single largest conflict — not a CSS
   problem, and not solvable by one.
2. **Simultaneous image + form (§12/§13.1).** The whole point of the layout is
   seeing the frame and typing the transcription at the same time. Stacked, you
   scroll between them — directly contrary to "preserve researcher attention" (§38).
3. **Volume (§1, §2).** 200–1000+ samples, hours per session.

So the goal is **not** "the annotation cockpit is fully usable on a phone." That
would compromise the desktop workstation that is the product. The goal is:

> Desktop remains the primary, fully-optimised annotation surface. Small screens
> get a coherent, non-broken, *legitimate* subset — setup, curation, review,
> quality-flagging, and export — plus read-and-correct annotation. Heavy
> transcription stays on desktop, and the UI says so rather than pretending.

This is a scope decision and is flagged for researcher confirmation.

### 10.3 Proposed breakpoints

| Range | Layout |
|---|---|
| ≥ 1141px | Current two-column cockpit (unchanged) |
| 861–1140px | Existing narrow two-column; tighten paddings |
| 621–860px | **Tablet**: cockpit stacks vertically; image becomes a fixed-height sticky banner that stays visible while the form scrolls below (mitigates tension #2 — never scroll back up to see the frame) |
| ≤ 620px | **Mobile**: single column, bottom-anchored `Save & Next` bar, drawer-style nav, modals become full-screen sheets |

### 10.4 Concrete work

1. **`src/styles/slice7-responsive.css`** — new file, breakpoint blocks only.
   Do not reflow the existing four stylesheets in place; that makes the desktop
   regression risk unmanageable.
2. **`.cockpit-container`** — collapse to one column at 860px; make
   `.image-viewer` `position: sticky; top: 0` with a capped height
   (e.g. `min(38vh, 320px)`) so the frame persists above the scrolling form.
3. **`.platform-selector-grid`** — 4 cols → 2 cols → 4 cols wrapping (keeps pills
   large enough to tap; §36 warns against tiny form controls).
4. **`.modal-dialog`** — below 620px, full-screen sheets with a sticky footer
   action row; `.shortcut-list` already stacks cleanly.
5. **`Header` / `DatasetLifecycleBar`** — nav collapses into a hamburger + drawer;
   the progress strip stays visible (it is the §15 "where am I" answer).
6. **Touch targets** — bump `.platform-pill`, `.flag-chip`, gallery action
   buttons to ≥ 44px on coarse pointers only, via `@media (pointer: coarse)`, so
   desktop density (§36) is unaffected.
7. **`viewport` meta + safe-area insets** — `viewport-fit=cover` plus
   `env(safe-area-inset-bottom)` on the sticky action bar for notched devices.
8. **`.gallery-grid`** — already `auto-fill minmax(240px, 1fr)`; lower to
   `minmax(150px, 1fr)` under 620px.

### 10.5 Keyboard-first on touch

Explicitly in scope, explicitly limited:

- Add a **visible on-screen shortcut bar** in the cockpit on coarse-pointer
  devices, carrying only the irreducible actions as tap targets:
  **Skip · Reject · Prev · Next · Save & Next**. These are already
  `ShortcutDef` entries from §7, so the registry becomes the single source for
  the touch UI too.
- `Ctrl+Enter` gains an in-app equivalent that always exists: the `Save & Next`
  button is already a real submit button, so no new binding is needed.
- `Alt+I` (OCR insert) becomes a normally-sized button in `OCRPanel` on mobile.
- **Do not** attempt a virtual keybind layer. A touch keyboard cannot produce
  `Ctrl+Enter`/`Alt+I`, and a custom on-screen modifier keypad would be a large,
  confusing surface for a marginal use case.
- `Escape` closes sheets/drawers — the one binding that is both natural and
  cheap on touch.

### 10.6 Verification

No device lab is available, so verification is by construction plus static checks:

| Group | Assertions |
|---|---|
| static | No fixed `px` column width survives below 620px; every `.modal-dialog` has a small-screen variant; `viewport` meta present in `index.html` |
| touch targets | every interactive chip/pill declares a coarse-pointer size ≥ 44px |
| shortcut parity | the touch action bar renders from the registry, so it cannot list an action the keyboard map lacks |
| manual | checklist for researcher: 390px (iPhone), 768px (tablet), 1280px — setup wizard, gallery, cockpit, dedup, export each usable without horizontal scroll |

The manual checklist is the honest part: CSS breakpoints do not prove a
transcription workflow works on a phone, and that is precisely the finding
section 11.2 predicts.

### 10.7 Explicit non-goals

- No native/PWA install, offline service worker, or web app manifest (unrequested
  scope creep; §4).
- No touch-optimised *bulk* curation gestures (swipe-to-reject) — a destructive
  gesture is too risky against real research data (§17, §35).
- No attempt to make 1000-sample bulk curation viable on a phone.
- No rewriting of the existing desktop stylesheets beyond additive breakpoint
  overrides.

---

## 11. Overall non-goals

- Multi-item **visual bounding-box** editing (a research-integrity decision that
  deserves its own slice).
- Command palette. The registry makes it trivial later, but it is not needed yet
  and §42 marks it "if useful".
- `react-router`, `zod`, `papaparse` — none are needed by this slice (§4).
- Any network, telemetry, or cloud persistence (§35).
- AI-assisted annotation of any kind (§46).

---

## 12. Build order

| # | Work | Gate |
|---|---|---|
| 1 | §4 — `domain/lifecycle.ts` + `checkTransition` + `verifySlice7` lifecycle group | pure, no UI risk |
| 2 | §5 — wizard + `isSetupComplete` + db migration | — |
| 3 | §4.4/§4.5 — `useDatasetLifecycle`, wizard-as-settings, `DatasetLifecycleBar` | — |
| 4 | §6 — quality-flag UI + gallery badge + flagged filter | — |
| 5 | §7 — shortcut registry + rewrite component handlers + modal | — |
| 6 | §8 — next-unannotated + progress CTA | — |
| 7 | §9 — full `verify` run green | researcher review |
| 8 | §10 — responsive/mobile | **explicit researcher approval required** |

Sections 1–9 are delivered together for review. Section 10 is a separate,
explicitly-approved follow-on.

---

## 13. As-built notes (deviations from the plan above)

Recorded so the next person does not have to reverse-engineer these.

### 13.1 Target is a RANGE and is ADVISORY

After discussion, `DatasetInfo.targetCount: number` became `targetMin` /
`targetMax`, and **corpus size no longer gates anything**. Only *integrity* gates
`ready`: pending samples, skipped samples, failing §24 checks, provenance holes,
and at least one verified platform. Undershooting the intended range is a
legitimate research outcome, so it is reported by `describeTargetAttainment()`,
warns in the §24 checklist, and is recorded in `manifest.annotation.targetRange`
/ `targetAttained`. Legacy `targetCount: N` migrates to `0.8N … N`.

Rationale: a strict `>= target` rule was redundant with the existing
`canExport` + `annotationComplete` gate while adding a second place to get stuck.

### 13.2 Lifecycle status is derived, and persisted on change

`useDatasetLifecycle` recomputes `CorpusFacts` from live state and writes the
derived value back to IndexedDB. Because the header badge, the settings panel and
the manifest all read `dataset.lifecycleStatus`, persisting only the derived value
is what makes them structurally incapable of disagreeing.

### 13.3 No `LifecycleGate` blocking component

The plan described a gate that *blocks* views. It was built as an advisory CTA in
`DatasetLifecycleBar` instead. Everything stays reachable; the machine states
where you are and what it recommends. The only blocking gate is the setup wizard,
which is unavoidable and correct (§ nothing exists before it).

### 13.4 Shortcut registry specifics

- `services/shortcuts.ts` is data + pure matching; `useShortcuts` installs the one
  listener. Component-local listeners became a small event bus
  (`scrollnotes:add-item`, `:toggle-monospace`, `:toggle-flag`, `:ocr-insert`).
- `keydown` listeners went from **5 → 2**: one global, one retained inside
  `DeduplicationReview` because its keys drive a cursor that only exists there.
  Arrow keys are scoped to `gallery`/`cockpit` in the registry so the two do not
  double-fire.
- `D` was NOT bound globally: `D` already means "mark duplicate" in the dedup
  view and binding it app-wide would have broken that. `A` (accept) was added; `D`
  stays view-scoped.
- `findChordConflicts()` asserts no two shortcuts claim a chord in the same view.
- Cmd and Ctrl normalise to a single `mod` token, so one binding serves macOS and
  Windows (the old modal hardcoded `Ctrl`).

### 13.5 Bugs found and fixed during the slice

- Default dataset was born `lifecycleStatus: 'annotating'` (`db.ts`) — every
  first-run manifest lied about a zero-sample corpus (§24 violation).
- `draft` was an inverted predicate, so *every* corpus derived to `draft`.
- `exported` was unreachable: `ready` was evaluated first and always matched.
- The annotation save payload silently dropped `qualityFlags`.
- The gallery `flagged` filter only checked `isFlaggedForReview`, making §25 flags
  unreachable even once a UI existed.
- Quality-flag state was not reset when navigating between samples.
- `Esc` was bound in three components simultaneously.
- Slices 1–6 use `console.assert`, which **does not fail the run**; only slice 7
  uses the `check()` harness with `process.exit(1)`. Three stale slice-2
  assertions had been silently failing. Worth hardening.
---

