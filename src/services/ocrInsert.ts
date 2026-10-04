import type { OcrInsertMode } from '../types/schema';

/**
 * OCR → ground-truth insertion rules (Slice 3).
 *
 * These are the *only* place the overwrite policy is expressed, so the
 * components and the verification suite exercise the exact same code.
 *
 * Golden rule (AGENTS §46): OCR must never silently overwrite human
 * annotation. An empty field is fair game (one action); a non-empty field
 * requires an explicit researcher decision.
 */

/** True when the field already holds human text and a confirmation is required. */
export function needsOcrInsertConfirmation(existing: string | undefined): boolean {
  return (existing ?? '').trim().length > 0;
}

/**
 * Materialise an explicit decision. `mode` must not be supplied for an empty
 * field (pass `needsOcrInsertConfirmation` first) — `replace` is the default
 * there, and `append` onto a non-empty field preserves the original text.
 */
export function applyOcrInsert(
  existing: string | undefined,
  ocrText: string,
  mode: OcrInsertMode
): string {
  const current = existing ?? '';
  if (mode === 'append' && current.trim().length > 0) {
    return `${current}\n${ocrText}`;
  }
  return ocrText;
}
