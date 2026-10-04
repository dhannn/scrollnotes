import React, { useState, useEffect } from 'react';
import { DatasetInfo, DatasetLifecycleStatus } from '../types/schema';
import { X, Database, Check, Sliders, Target, Tag } from 'lucide-react';

interface DatasetSettingsModalProps {
  isOpen: boolean;
  datasetInfo: DatasetInfo;
  onSave: (updated: DatasetInfo) => void;
  onClose: () => void;
}

const LIFECYCLE_STATUSES: { id: DatasetLifecycleStatus; label: string; desc: string }[] = [
  { id: 'draft', label: 'Draft', desc: 'Initial setup and parameter planning' },
  { id: 'curating', label: 'Curating', desc: 'Filtering candidate frames and deduplicating' },
  { id: 'annotating', label: 'Annotating', desc: 'Active human ground-truth transcription' },
  { id: 'ready', label: 'Ready', desc: 'Curation complete and verified for benchmark use' },
  { id: 'exported', label: 'Exported', desc: 'Corpus packaged and exported for VLM experiments' },
];

export const DatasetSettingsModal: React.FC<DatasetSettingsModalProps> = ({
  isOpen,
  datasetInfo,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(datasetInfo.name);
  const [version, setVersion] = useState(datasetInfo.version);
  const [description, setDescription] = useState(datasetInfo.description);
  const [targetCount, setTargetCount] = useState(datasetInfo.targetCount);
  const [lifecycleStatus, setLifecycleStatus] = useState<DatasetLifecycleStatus>(
    datasetInfo.lifecycleStatus
  );
  const [sampleIdPrefix, setSampleIdPrefix] = useState(datasetInfo.sampleIdPrefix || 'ugc');

  useEffect(() => {
    setName(datasetInfo.name);
    setVersion(datasetInfo.version);
    setDescription(datasetInfo.description);
    setTargetCount(datasetInfo.targetCount);
    setLifecycleStatus(datasetInfo.lifecycleStatus);
    setSampleIdPrefix(datasetInfo.sampleIdPrefix || 'ugc');
  }, [datasetInfo, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...datasetInfo,
      name: name.trim() || 'Untitled Dataset',
      version: version.trim() || 'v0.1',
      description: description.trim(),
      targetCount: Math.max(1, targetCount),
      lifecycleStatus,
      sampleIdPrefix: sampleIdPrefix.trim() || 'ugc',
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={18} style={{ color: 'var(--accent-cyan)' }} />
            <h3 className="modal-title">Dataset Configuration & Lifecycle</h3>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* Dataset Name & Version */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">
                <span>Dataset Title</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Social Media UGC Benchmark"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <span>Version</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v0.1"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">
              <span>Purpose / Research Description</span>
            </label>
            <textarea
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the fieldwork scope and target model evaluation parameters..."
              rows={3}
            />
          </div>

          {/* Target Count & ID Prefix */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">
                <Target size={13} />
                <span>Target Sample Goal</span>
              </label>
              <input
                type="number"
                className="form-input"
                value={targetCount}
                onChange={(e) => setTargetCount(parseInt(e.target.value) || 200)}
                min={1}
                max={10000}
              />
              <span className="form-helper">Benchmark target (e.g. 200 samples)</span>
            </div>

            <div className="form-group">
              <label className="form-label">
                <Tag size={13} />
                <span>Sample ID Prefix</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={sampleIdPrefix}
                onChange={(e) => setSampleIdPrefix(e.target.value)}
                placeholder="ugc"
              />
              <span className="form-helper">Yields {sampleIdPrefix}-000001, {sampleIdPrefix}-000002...</span>
            </div>
          </div>

          {/* Lifecycle Status */}
          <div className="form-group">
            <label className="form-label">
              <Sliders size={13} />
              <span>Dataset Lifecycle Status</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.4rem', marginTop: '0.2rem' }}>
              {LIFECYCLE_STATUSES.map((status) => (
                <button
                  type="button"
                  key={status.id}
                  className={`platform-pill ${lifecycleStatus === status.id ? 'selected' : ''}`}
                  onClick={() => setLifecycleStatus(status.id)}
                  title={status.desc}
                  style={{ fontSize: '0.72rem', padding: '0.5rem 0.2rem' }}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </div>

          {/* Footer Controls */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              <Check size={14} />
              <span>Save Configuration</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
