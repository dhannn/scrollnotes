import type { QualityFlag } from '../types/schema';

/**
 * Quality-flag ordering and key mapping (Slice 7 §6)
 * ---------------------------------------------------
 * Kept in a plain service module rather than inside the React component so the
 * Node verification suite can assert the digit mapping without pulling in a
 * component tree, and so the picker chips and the `1`-`8` shortcuts can never
 * drift apart (§18: a displayed shortcut hint must be a real binding).
 *
 * Flags describe the ARTIFACT, never the person depicted (§25).
 */

/** Stable ordering so a digit always maps to the same flag within a session. */
export const QUALITY_FLAG_ORDER: QualityFlag[] = [
  'low-quality-frame',
  'partially-occluded',
  'ambiguous-author',
  'ambiguous-content',
  'multiple-ugc-items',
  'ui-heavy',
  'unusual-layout',
  'annotation-uncertain',
];

/** Maps a bare digit 1-8 to its flag, or undefined when out of range. */
export function qualityFlagForDigit(digit: number): QualityFlag | undefined {
  if (!Number.isInteger(digit) || digit < 1 || digit > QUALITY_FLAG_ORDER.length) {
    return undefined;
  }
  return QUALITY_FLAG_ORDER[digit - 1];
}

/** Toggle a flag in a list without mutating the input. */
export function toggleQualityFlag(
  flags: QualityFlag[],
  flag: QualityFlag
): QualityFlag[] {
  return flags.includes(flag) ? flags.filter((f) => f !== flag) : [...flags, flag];
}