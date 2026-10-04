import { useEffect } from 'react';
import { matchShortcut } from '../services/shortcuts';
import type { ShortcutContext, ShortcutDef } from '../services/shortcuts';

/**
 * The ONE global keyboard listener (Slice 7 §7).
 *
 * Before this hook, five components each installed their own `keydown` listener on
 * `window`, which meant `Esc` was bound in three places and the documented
 * shortcut list in KeyboardShortcutsModal was hand-written and free to drift from
 * the real bindings. Now every shortcut is a `ShortcutDef`, the listener is
 * installed once here, and the modal renders from the same array.
 */
export function useShortcuts(defs: ShortcutDef[], ctx: ShortcutContext): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Never hijack a browser/OS chord the researcher may need.
      if (e.key === 'Tab' || e.key === 'F5' || e.key === 'F12') return;

      const match = matchShortcut(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        },
        e.target as HTMLElement | null,
        ctx,
        defs
      );

      if (!match) return;
      e.preventDefault();
      match.handler();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [defs, ctx]);
}