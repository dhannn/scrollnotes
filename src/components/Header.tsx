import React from 'react';
import {
  Compass,
  LayoutGrid,
  Edit3,
  Sparkles,
  Trash2,
  Keyboard,
  Video,
  SlidersHorizontal,
  Target,
  Fingerprint,
  Package,
} from 'lucide-react';
import { SessionStats, DatasetInfo } from '../types/schema';
import { GalleryView } from '../hooks/useFieldSession';

interface HeaderProps {
  stats: SessionStats;
  datasetInfo: DatasetInfo;
  currentView: GalleryView;
  dedupSuppressedCount: number;
  recordingCount: number;
  onViewChange: (view: GalleryView) => void;
  onOpenDatasetSettings: () => void;
  onLoadSampleBatch: () => void;
  onClearSession: () => void;
  onOpenShortcuts: () => void;
  onTriggerUpload: () => void;
  /** Annotated samples that would ship right now (Slice 6). */
  exportableCount: number;
  /** Number of samples failing the pre-export checks. */
  exportBlockers: number;
  onOpenExport: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  datasetInfo,
  currentView,
  dedupSuppressedCount,
  recordingCount,
  onViewChange,
  onOpenDatasetSettings,
  onLoadSampleBatch,
  onClearSession,
  onOpenShortcuts,
  onTriggerUpload,
  exportableCount,
  exportBlockers,
  onOpenExport,
}) => {
  return (
    <header className="app-header">
      {/* Brand & Dataset Info */}
      <div className="brand-section">
        <Compass className="brand-logo-icon" />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="brand-title">Scrollnotes</span>
            <span className="brand-badge" title="Dataset Version">
              {datasetInfo.version}
            </span>
            <span
              className={`lifecycle-badge ${datasetInfo.lifecycleStatus}`}
              title="Dataset Lifecycle State"
            >
              {datasetInfo.lifecycleStatus.toUpperCase()}
            </span>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            onClick={onOpenDatasetSettings}
            title="Click to edit dataset parameters"
          >
            <span>{datasetInfo.name}</span>
            <SlidersHorizontal size={11} style={{ opacity: 0.7 }} />
          </div>
        </div>
      </div>

      {/* Progress & Target Benchmark Widget */}
      {stats.total > 0 && (
        <div className="header-stats">
          <div
            className="progress-widget"
            title={`${stats.annotated} of ${datasetInfo.targetMin ?? 150}-${datasetInfo.targetMax ?? 200} intended samples annotated`}
            onClick={onOpenDatasetSettings}
            style={{ cursor: 'pointer' }}
          >
            <Target size={13} style={{ color: 'var(--accent-sky)' }} />
            <span className="progress-text">
              Intended: <strong>{stats.annotated}</strong> / {datasetInfo.targetMin ?? 150}
            </span>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${stats.targetProgressPercent}%` }}
              />
            </div>
            <span className="progress-text" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              {stats.targetProgressPercent}%
            </span>
          </div>
        </div>
      )}

      {/* View Switcher & Action Tools */}
      <div className="header-actions">
        {/* Field Sessions is ALWAYS reachable — it is the primary ingestion
            path, including on a completely empty workspace. */}
        <div className="view-tabs">
          <button
            className={`view-tab ${currentView === 'sessions' ? 'active' : ''}`}
            onClick={() => onViewChange('sessions')}
            title="Field Sessions (Import a screen recording and sample frames)"
            aria-label="Field Sessions"
          >
            <Video size={15} />
            <span>Sessions</span>
            {recordingCount > 0 && (
              <span className="view-tab-badge" title={`${recordingCount} field sessions`}>
                {recordingCount}
              </span>
            )}
          </button>
        </div>

        {stats.total > 0 && (
          <div className="view-tabs">
            <button
              className={`view-tab ${currentView === 'gallery' ? 'active' : ''}`}
              onClick={() => onViewChange('gallery')}
              title="Gallery View (All Candidate Frames)"
              aria-label="Gallery"
            >
              <LayoutGrid size={15} />
              <span>Gallery</span>
            </button>
            <button
              className={`view-tab ${currentView === 'cockpit' ? 'active' : ''}`}
              onClick={() => onViewChange('cockpit')}
              title="Annotation Cockpit (Ground Truth Transcription)"
              aria-label="Annotate"
            >
              <Edit3 size={15} />
              <span>Annotate</span>
            </button>
            <button
              className={`view-tab ${currentView === 'dedup' ? 'active' : ''}`}
              onClick={() => onViewChange('dedup')}
              title="Near-Duplicate Review (Perceptual Deduplication)"
              aria-label="Deduplicate"
            >
              <Fingerprint size={15} />
              <span>Deduplicate</span>
              {dedupSuppressedCount > 0 && (
                <span className="view-tab-badge" title={`${dedupSuppressedCount} suppressed duplicates`}>
                  {dedupSuppressedCount}
                </span>
              )}
            </button>
          </div>
        )}

        <button
          className="btn btn-secondary btn-sm"
          onClick={onTriggerUpload}
          title="Import a screen recording (field session)"
          aria-label="Import Session"
        >
          <Video size={14} />
          <span>Import Session</span>
        </button>

        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onOpenDatasetSettings}
          title="Dataset Configuration & Goals"
          aria-label="Dataset Configuration & Goals"
        >
          <SlidersHorizontal size={16} />
        </button>

        {/* Export Corpus is a first-class action: it is how a field session becomes a
        reproducible benchmark dataset. */}
        {stats.total > 0 && (
          <button
            className={`btn btn-sm ${exportBlockers > 0 ? 'btn-secondary' : 'btn-accent-emerald'}`}
            onClick={onOpenExport}
            aria-label="Export Corpus"
            title={
              exportBlockers > 0
                ? `Export blocked by ${exportBlockers} issue(s). Open to review.`
                : `Export ${exportableCount} annotated sample(s) as a benchmark dataset`
            }
          >
            <Package size={14} />
            <span>Export</span>
            <span className="view-tab-badge" title={`${exportableCount} samples ready to export`}>
              {exportableCount}
            </span>
          </button>
        )}

        {stats.total === 0 && (
          <button
            className="btn btn-primary btn-sm"
            onClick={onLoadSampleBatch}
            title="Load Pre-configured Fieldwork Mock Frames"
            aria-label="Load Sample Batch"
          >
            <Sparkles size={14} />
            <span>Load Sample Batch</span>
          </button>
        )}

        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts (?)"
          aria-label="Keyboard Shortcuts"
        >
          <Keyboard size={16} />
        </button>

        {stats.total > 0 && (
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => {
              if (window.confirm('Clear all current frames and annotations from local storage?')) {
                onClearSession();
              }
            }}
            title="Reset Field Session"
          >
            <Trash2 size={16} style={{ color: 'var(--text-dim)' }} />
          </button>
        )}
      </div>
    </header>
  );
};
