import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  SkipForward,
  Save,
  XCircle,
} from 'lucide-react';
import type { ShortcutDef } from '../services/shortcuts';

/**
 * Touch action bar (Slice 7 §10.5)
 * ------------------------------
 * The keyboard shortcuts are unusable without a hardware keyboard, which is the
 * single largest conflict between this app's design (§18) and a phone. Rather
 * than fake a virtual modifier keypad — a large, confusing surface for a
 * marginal gain — this bar exposes only the irreducible actions as tap targets.
 *
 * Rendered FROM the shortcut registry by id, so it can never offer an action the
 * desktop map lacks; a missing id simply drops its button. Visibility is handled
 * entirely in CSS under `@media (pointer: coarse)`, so no JS media query is
 * needed and there is no hydration-style flash on desktop.
 */

const ACTION_IDS = ['prev', 'skip', 'reject', 'next', 'save-and-next'] as const;

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  prev: ArrowLeft,
  skip: SkipForward,
  reject: XCircle,
  next: ArrowRight,
  'save-and-next': Save,
};

const LABELS: Record<string, string> = {
  prev: 'Prev',
  skip: 'Skip',
  reject: 'Reject',
  next: 'Next',
  'save-and-next': 'Save & Next',
};

const VARIANTS: Record<string, string> = {
  prev: 'btn-secondary',
  skip: 'btn-secondary',
  reject: 'btn-secondary',
  next: 'btn-secondary',
  'save-and-next': 'btn-save-next',
};

interface TouchActionBarProps {
  shortcuts: ShortcutDef[];
  disabled: Partial<Record<string, boolean>>;
}

export const TouchActionBar: React.FC<TouchActionBarProps> = ({ shortcuts, disabled }) => {
  const byId = new Map(shortcuts.map((s) => [s.id, s]));
  const actions = ACTION_IDS.filter((id) => byId.has(id));

  // If the registry carries none of these, rendering an empty bar is worse than
  // rendering nothing.
  if (actions.length === 0) return null;

  return (
    <div className="touch-action-bar" role="toolbar" aria-label="Annotation actions">
      {actions.map((id) => {
        const def = byId.get(id)!;
        const Icon = ICONS[id];
        const isDisabled = disabled[id] === true;
        return (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${VARIANTS[id] ?? 'btn-secondary'}`}
            onClick={def.handler}
            disabled={isDisabled}
            title={def.description}
            aria-label={def.description}
          >
            {Icon && <Icon size={15} />}
            <span>{LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );
};