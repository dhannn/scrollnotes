import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { DatasetLifecycleStatus, SessionStats } from '../types/schema';
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_DESCRIPTIONS,
} from '../domain/lifecycle';
import type { TargetAssessment } from '../domain/lifecycle';
import type { GalleryViewName } from '../services/shortcuts';

interface DatasetLifecycleBarProps {
  status: DatasetLifecycleStatus;
  explanation: string;
  target: TargetAssessment;
  stats: SessionStats;
  /** Which view the machine suggests next, or null when the corpus is settled. */
  suggestedAction: { label: string; view: GalleryViewName } | null;
  onNavigate: () => void;
}

/**
 * Persistent progress + lifecycle strip (Slice 7 §8)
 * -------------------------------------------------
 * Answers "where am I in building this dataset?" (§27) from every view, and
 * explains *why* the corpus is in its current state rather than just asserting it.
 *
 * The target readout is deliberately advisory: it shows progress toward the lower
 * bound of the intended range and never presents an unmet target as a failure (§4.2).
 */
export const DatasetLifecycleBar: React.FC<DatasetLifecycleBarProps> = ({
  status,
  explanation,
  target,
  stats,
  suggestedAction,
  onNavigate,
}) => {
  const annotated = stats.annotated;
  const targetMin = Math.max(1, target.progressPercent > 0 ? annotated : 1);
  const percent = Math.min(100, Math.round((annotated / targetMin) * 100));
  const isBelowTarget = target.attainment === 'below';

  return (
    <div className="lifecycle-bar">
      <div className="lifecycle-bar-left">
        <span
          className={`lifecycle-badge ${status}`}
          title={explanation}
        >
          {LIFECYCLE_LABELS[status].toUpperCase()}
        </span>
        <span className="lifecycle-bar-progress" title={target.message}>
          <strong>{annotated}</strong>
          <span className="lifecycle-bar-sep">/</span>
          <span className="lifecycle-bar-target">
            {target.attainment === 'unset' ? '—' : targetMin}
          </span>
          <span className="lifecycle-bar-label">samples</span>
        </span>
        <div
          className="lifecycle-bar-track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Annotation progress toward intended corpus size"
          title={target.message}
        >
          <div className={`lifecycle-bar-fill ${isBelowTarget ? 'advisory' : ''}`} style={{ width: `${percent}%` }} />
        </div>
        {isBelowTarget && (
          <span
            className="lifecycle-bar-note"
            title={target.message}
          >
            <AlertTriangle size={11} />
            <span>below intended range — advisory only</span>
          </span>
        )}
      </div>

      {suggestedAction && (
        <button
          type="button"
          className="lifecycle-bar-cta"
          onClick={onNavigate}
          title={LIFECYCLE_DESCRIPTIONS[status]}
        >
          <span>{suggestedAction.label}</span>
          <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
};