import React, { useRef, useState } from 'react';
import { Video, Image as ImageIcon, Sparkles } from 'lucide-react';

interface DropzoneProps {
  onFilesSelected: (files: File[]) => void;
  onLoadSampleBatch: () => void;
  /** Recording-first ingestion: opens the Field Sessions view. */
  onImportRecording: () => void;
  isCompact?: boolean;
}

/**
 * Empty-state ingestion panel.
 *
 * RECORDING-FIRST: importing a screen recording is the primary action, because a
 * recording is the provenance container (AGENTS §8.2). Dropping loose frame images
 * is a deliberately DEMOTED fallback - those samples carry no recordingId and no
 * timestamp, which is strictly weaker evidence.
 */
export const Dropzone: React.FC<DropzoneProps> = ({
  onFilesSelected,
  onLoadSampleBatch,
  onImportRecording,
  isCompact = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      if (filesArray.length > 0) {
        onFilesSelected(filesArray);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files).filter((f) =>
        f.type.startsWith('image/')
      );
      if (filesArray.length > 0) {
        onFilesSelected(filesArray);
      }
    }
    e.target.value = '';
  };

  if (isCompact) {
    return (
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleInputChange}
        multiple
        accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
        style={{ display: 'none' }}
      />
    );
  }

  return (
    <div
      className={`empty-state-card ${isDragOver ? 'is-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        borderColor: isDragOver ? 'var(--accent-sky)' : undefined,
        background: isDragOver ? 'var(--bg-surface-hover)' : undefined,
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleInputChange}
        multiple
        accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
        style={{ display: 'none' }}
      />

      <div className="empty-state-icon">
        <Video size={30} />
      </div>

      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>
          Import a Field Session
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto' }}>
          Screen-record yourself browsing feeds, then import the recording. Frames are
          sampled on your interval, and every sample keeps its recording and timestamp
          provenance.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button className="btn btn-primary" onClick={onImportRecording}>
          <Video size={16} />
          <span>Import a screen recording</span>
        </button>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
        Zero server upload • Frames and annotations stay in local browser IndexedDB
      </p>

      {/* ---- Demoted fallback: pre-extracted frames ---- */}
      <div className="empty-state-fallback">
        <div className="sessions-fallback-rule" />
        <p className="sessions-fallback-label">
          Pre-extracted frames <em>(no recording provenance)</em>
        </p>
        <p className="sessions-fallback-hint">
          Fallback for recordings your browser cannot decode.
        </p>
        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            justifyContent: 'center',
            marginTop: '0.4rem',
          }}
        >
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon size={14} />
            <span>Select frame images</span>
          </button>

          <button className="btn btn-ghost btn-sm" onClick={onLoadSampleBatch}>
            <Sparkles size={14} style={{ color: 'var(--accent-cyan)' }} />
            <span>Load Sample Batch</span>
          </button>
        </div>
      </div>
    </div>
  );
};