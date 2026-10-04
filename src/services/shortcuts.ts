/**
 * Shortcut registry (Slice 7 §7)
 * ----------------------------
 * AGENTS §18 makes keyboard navigation a first-class feature and requires the UI
 * to display shortcut hints. Before this module those lived in five independent
 * `window.addEventListener('keydown', ...)` calls across AnnotationCockpit,
 * GroundTruthForm, OCRPanel and DeduplicationReview, while KeyboardShortcutsModal
 * hardcoded its own independent list. The docs and the bindings could therefore
 * disagree with each other, and `Esc` was bound in three places.
 *
 * This module is DATA ONLY (no React, no DOM) so the Node verification suite can
 * assert chord normalisation, focus-suppression and uniqueness without a browser.
 * The single listener lives in `useShortcuts`; `KeyboardShortcutsModal` renders
 * straight from the registry, so a documented hint is always a real binding.
 */

export type GalleryViewName = 'gallery' | 'cockpit' | 'dedup' | 'sessions';

/** Which view is active, plus the conditions that make a shortcut live. */
export interface ShortcutContext {
  view: GalleryViewName;
  /** A modal, drawer or the setup wizard is open. */
  modalOpen: boolean;
  hasActiveSample: boolean;
  hasNext: boolean;
  hasPrev: boolean;
  /** At least one sample still needs annotation. */
  hasUnannotated: boolean;
  hasNextUnannotated: boolean;
  hasPrevUnannotated: boolean;
}

export type ShortcutGroup =
  | 'navigation'
  | 'curation'
  | 'annotation'
  | 'ocr'
  | 'dedup'
  | 'dataset';

export interface ShortcutDef {
  id: string;
  /** e.g. ['Ctrl+Enter']. Ctrl and Cmd are treated as equivalent modifiers. */
  chords?: string[];
  /** A single unmodified key. Suppressed in text fields and while a modal is open. */
  bareKey?: string;
  /** Restricts the shortcut to specific views. Undefined means every view. */
  views?: GalleryViewName[];
  /** Extra condition for the bare key to fire. */
  when?: (ctx: ShortcutContext) => boolean;
  description: string;
  group: ShortcutGroup;
  /** Wired in App, not here — this module must stay React-free. */
  handler: () => void;
}

export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  'navigation',
  'curation',
  'annotation',
  'ocr',
  'dedup',
  'dataset',
];

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroup, string> = {
  navigation: 'Navigation',
  curation: 'Curation',
  annotation: 'Annotation',
  ocr: 'OCR',
  dedup: 'Deduplication',
  dataset: 'Dataset',
};

/** Human-readable key name for the hint chips. */
function prettyKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Split "Ctrl+Shift+Enter" into its normalised parts. */
function parseChord(chord: string): { mods: Set<string>; key: string } {
  const parts = chord.split('+').map((p) => p.trim());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  return { mods, key: key.toLowerCase() };
}

/**
 * Normalised identity of a keyboard event, e.g. `mod+shift+enter`.
 *
 * Cmd and Ctrl collapse to a single `mod` token so one binding serves macOS and
 * Windows. This is why the old modal could not stop hardcoding `Ctrl`.
 */
export function normaliseEvent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('mod');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return [...mods, e.key.toLowerCase()].join('+');
}

/** Every registered chord, normalised the same way an event is. */
export function normaliseChord(chord: string): string {
  const { mods, key } = parseChord(chord);
  const wanted: string[] = [];
  if (mods.has('mod') || mods.has('ctrl') || mods.has('cmd')) wanted.push('mod');
  if (mods.has('alt')) wanted.push('alt');
  if (mods.has('shift')) wanted.push('shift');
  return [...wanted, key].join('+');
}

function matchesChord(chord: string, normalised: string): boolean {
  return normaliseChord(chord) === normalised;
}

/** True when the event target is a text-entry surface, where bare keys must not fire. */
export function isTextEntryTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Decide whether a shortcut fires, and return it if so.
 *
 * The ordering matters: a modal suppresses bare keys but NOT chords, so Ctrl+Enter
 * still saves while the shortcuts dialog is open. This replaces the previous
 * situation where Esc was bound in three components simultaneously.
 */
export function matchShortcut(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  target: { tagName?: string; isContentEditable?: boolean } | null,
  ctx: ShortcutContext,
  defs: ShortcutDef[]
): ShortcutDef | undefined {
  const normalised = normaliseEvent(event);
  const isBareKey = normalised === event.key.toLowerCase();
  const typing = isTextEntryTarget(target);

  // Chord pass first: chords are explicit and work even while typing.
  for (const def of defs) {
    if (!def.chords) continue;
    if (def.views && !def.views.includes(ctx.view)) continue;
    if (def.chords.some((c) => matchesChord(c, normalised))) return def;
  }

  // Bare-key pass: suppressed while typing or while a modal owns the keyboard, and
  // never when a modifier is held (that would be a chord by definition).
  if (!isBareKey || typing || ctx.modalOpen) return undefined;

  for (const def of defs) {
    if (!def.bareKey) continue;
    if (def.views && !def.views.includes(ctx.view)) continue;
    if (def.bareKey.toLowerCase() !== event.key.toLowerCase()) continue;
    if (def.when && !def.when(ctx)) return undefined;
    return def;
  }
  return undefined;
}

/** Renders a chord as hint chips, e.g. ['Ctrl', 'Shift', 'Enter']. */
export function prettyChord(chord: string): string[] {
  return chord.split('+').map(prettyKey);
}

/**
 * Chords claimed by more than one shortcut within the same view.
 *
 * Two shortcuts sharing a chord is not a runtime error — the first match wins — but
 * it makes the documented hints ambiguous, so it is asserted in the test suite
 * rather than left to be discovered by a researcher.
 */
export function findChordConflicts(defs: ShortcutDef[]): string[] {
  const byView = new Map<string, string[]>();
  for (const def of defs) {
    for (const chord of def.chords ?? []) {
      const views = def.views ?? ['gallery', 'cockpit', 'dedup', 'sessions'];
      for (const view of views) {
        const key = `${view}:${normaliseChord(chord)}`;
        byView.set(key, [...(byView.get(key) ?? []), def.id]);
      }
    }
  }
  return [...byView.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => `${key} claimed by ${ids.join(' & ')}`);
}
