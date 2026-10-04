import React from 'react';
import { X, Keyboard } from 'lucide-react';
import {
  SHORTCUT_GROUP_ORDER,
  SHORTCUT_GROUP_LABELS,
  prettyChord,
} from '../services/shortcuts';
import type { ShortcutDef, ShortcutGroup } from '../services/shortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Slice 7 §7 — the live registry, so documented hints cannot drift from bindings. */
  shortcuts: ShortcutDef[];
}

/**
 * Renders straight from the shortcut registry.
 *
 * This used to hardcode its own list while four components each held private
 * listeners, so the reference could disagree with what the app actually did. Now a
 * hint shown here is by construction the same `ShortcutDef` the single global
 * listener matches against (§18).
 */
export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  shortcuts,
}) => {
  if (!isOpen) return null;

  const grouped = SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    defs: shortcuts.filter((d) => d.group === group),
  })).filter((g) => g.defs.length > 0) as {
    group: ShortcutGroup;
    defs: ShortcutDef[];
  }[];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Keyboard size={18} style={{ color: 'var(--accent-sky)' }} />
            <h3 className="modal-title">Keyboard Shortcuts</h3>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p className="form-helper" style={{ marginBottom: '0.9rem' }}>
            Shortcut letters are ignored while you are typing in a text field, and while a
            dialog is open. On macOS, use <kbd className="kbd">Cmd</kbd> wherever{' '}
            <kbd className="kbd">Ctrl</kbd> is shown.
          </p>

          {grouped.map(({ group, defs }) => (
            <div key={group} style={{ marginBottom: '1.1rem' }}>
              <h4
                className="form-label"
                style={{ color: 'var(--text-dim)', marginBottom: '0.4rem' }}
              >
                {SHORTCUT_GROUP_LABELS[group]}
              </h4>
              <div className="shortcut-list">
                {defs.map((def) => (
                  <div className="shortcut-row" key={def.id}>
                    <span className="shortcut-desc">{def.description}</span>
                    <div className="shortcut-keys">
                      {def.chords
                        ? def.chords.map((chord) => (
                            <span key={chord} style={{ display: 'inline-flex', gap: '3px' }}>
                              {prettyChord(chord).map((k) => (
                                <span className="kbd" key={k}>
                                  {k}
                                </span>
                              ))}
                            </span>
                          ))
                        : def.bareKey && (
                            <span className="kbd">{def.bareKey === ' ' ? 'Space' : def.bareKey.toUpperCase()}</span>
                          )}
                      {def.views && (
                        <span className="kbd" style={{ opacity: 0.55 }} title="Only in these views">
                          {def.views.join(' / ')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
