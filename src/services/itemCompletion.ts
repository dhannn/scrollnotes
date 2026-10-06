/**
 * Shared definition of a "complete" UGC item / frame (single source of truth for
 * saveAndNext, export validation and the multi-UGC verifier).
 *
 * An item is complete when it carries transcribed content, OR it is a media item
 * whose salient media has been described by the researcher (a media-only frame).
 * An author alone is never enough.
 */
export interface CompletableItem {
  content?: string;
  hasMedia?: boolean;
  mediaDescription?: string;
}

export function isItemComplete(item: CompletableItem): boolean {
  const content = (item.content ?? '').trim();
  if (content !== '') return true;
  return !!item.hasMedia && (item.mediaDescription ?? '').trim() !== '';
}

export function hasCompleteItem(items: readonly CompletableItem[] | undefined | null): boolean {
  return !!items && items.some(isItemComplete);
}
