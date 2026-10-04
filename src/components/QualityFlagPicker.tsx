import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { QUALITY_FLAG_LABELS } from '../types/schema';
import { QUALITY_FLAG_ORDER } from '../services/qualityFlags';
import type { QualityFlag } from '../types/schema';

/**
 * Quality flag picker (Slice 7 §6)
 * ------------------------------
 * AGENTS §25 requires the researcher to be able to flag unusual samples and
 * requires those flags to survive export. Until now the qualityFlags field was
 * fully plumbed to nnotations.jsonl and the manifest, but no UI could write it,
 * making the whole feature unreachable.
 *
 * Keys 1-8 toggle the corresponding flag and each chip displays its digit, so the
 * shortcut is discoverable rather than hidden (§18). Flags ride along in the
 * existing metadata write, so there is no new persistence path and no way for a
 * flag to survive locally but vanish from IndexedDB.
 */


interface QualityFlagPickerProps {
  flags: QualityFlag[];
  onToggle: (flag: QualityFlag) => void;
}

export const QualityFlagPicker: React.FC<QualityFlagPickerProps> = ({ flags, onToggle }) => {
  const active = new Set(flags);

  return (
    <div className="quality-flag-picker">
      <div className="quality-flag-header">
        <AlertTriangle size={12} />
        <span>Data quality flags</span>
        {flags.length > 0 && (
          <span className="quality-flag-count">{flags.length} applied</span>
        )}
      </div>

      <div className="quality-flag-grid" role="group" aria-label="Data quality flags">
        {QUALITY_FLAG_ORDER.map((flag, i) => {
          const isActive = active.has(flag);
          return (
            <button
              key={flag}
              type="button"
              className={`flag-chip ${isActive ? 'active' : ''}`}
              onClick={() => onToggle(flag)}
              aria-pressed={isActive}
              title={
                isActive
                  ? `Remove "${QUALITY_FLAG_LABELS[flag]}" (key ${i + 1})`
                  : `Flag as "${QUALITY_FLAG_LABELS[flag]}" (key ${i + 1})`
              }
            >
              <span className="flag-chip-key">{i + 1}</span>
              <span className="flag-chip-label">{QUALITY_FLAG_LABELS[flag]}</span>
            </button>
          );
        })}
      </div>

      <p className="quality-flag-note">
        Flags describe the <em>artifact</em>, never the person depicted. They survive
        export so later error analysis can filter them out.
      </p>
    </div>
  );
};
