import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Keyboard size={18} style={{ color: 'var(--accent-sky)' }} />
            <h3 className="modal-title">Fieldwork Keyboard Shortcuts</h3>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="shortcut-list">
            <div className="shortcut-row">
              <span className="shortcut-desc">Save ground truth & advance to next sample</span>
              <div className="shortcut-keys">
                <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Navigate to next frame</span>
              <div className="shortcut-keys">
                <span className="kbd">→</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Navigate to previous frame</span>
              <div className="shortcut-keys">
                <span className="kbd">←</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Skip candidate frame</span>
              <div className="shortcut-keys">
                <span className="kbd">S</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Reject candidate frame</span>
              <div className="shortcut-keys">
                <span className="kbd">R</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Toggle verbatim Monospace transcription font</span>
              <div className="shortcut-keys">
                <span className="kbd">Ctrl</span> + <span className="kbd">M</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">
                Cancel a running frame extraction (extracted frames are kept)
              </span>
              <div className="shortcut-keys">
                <span className="kbd">Esc</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Insert current OCR into the targeted content field</span>
              <div className="shortcut-keys">
                <span className="kbd">Alt</span> + <span className="kbd">I</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Run / re-run OCR for the active frame</span>
              <div className="shortcut-keys">
                <span className="kbd">Alt</span> + <span className="kbd">O</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">In Deduplicate view: sets / duplicate / restore frame</span>
              <div className="shortcut-keys">
                <span className="kbd">Enter</span> / <span className="kbd">D</span> / <span className="kbd">U</span>
              </div>
            </div>

            <div className="shortcut-row">
              <span className="shortcut-desc">Close dialog</span>
              <div className="shortcut-keys">
                <span className="kbd">Esc</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
