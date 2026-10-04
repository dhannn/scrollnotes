import React, { useState } from 'react';
import { X, Package, Check, AlertTriangle, XCircle, FileJson, Table, Archive } from 'lucide-react';
import type { ExportCheck, ExportFormat } from '../types/schema';

interface ExportDialogProps {
  isOpen: boolean;
  checks: ExportCheck[];
  canExport: boolean;
  sampleCount: number;
  onClose: () => void;
  onExport: (format: ExportFormat) => void;
  isExporting: boolean;
  /** "Preparing images 143 / 200" while the bundle is built. */
  progressLabel?: string;
  errorMessage?: string | null;
}

const FORMATS: { id: ExportFormat; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    id: 'zip',
    label: 'Benchmark ZIP',
    icon: <Archive size={14} />,
    hint: 'images + annotations.jsonl + ocr.jsonl + manifest.json + README',
  },
  { id: 'jsonl', label: 'JSONL', icon: <FileJson size={14} />, hint: 'annotations.jsonl only' },
  { id: 'csv', label: 'CSV', icon: <Table size={14} />, hint: 'spreadsheet view, first item only' },
];

function CheckIcon({ severity }: { severity: ExportCheck['severity'] }) {
  if (severity === 'pass') {
    return <Check size={13} style={{ color: 'var(--accent-emerald)' }} />;
  }
  if (severity === 'warn') {
    return <AlertTriangle size={13} style={{ color: 'var(--accent-amber)' }} />;
  }
  return <XCircle size={13} style={{ color: 'var(--accent-rose)' }} />;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  checks,
  canExport,
  sampleCount,
  onClose,
  onExport,
  isExporting,
  progressLabel,
  errorMessage,
}) => {
  const [format, setFormat] = useState<ExportFormat>('zip');

  if (!isOpen) return null;

  const failures = checks.filter((check) => check.severity === 'fail');
  const warnings = checks.filter((check) => check.severity === 'warn');

  return (
    <div className="modal-overlay" onClick={isExporting ? undefined : onClose}>
      <div className="modal-dialog export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Package size={18} style={{ color: 'var(--accent-cyan)' }} />
            <h3 className="modal-title">Export Corpus</h3>
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            disabled={isExporting}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body export-body">
          {/* Pre-export checklist (AGENTS section 24) */}
          <div className="export-checklist" role="status">
            {checks.map((check) => (
              <div key={check.id} className={`export-check ${check.severity}`}>
                <div className="export-check-head">
                  <CheckIcon severity={check.severity} />
                  <span className="export-check-label">{check.label}</span>
                </div>
                <p className="export-check-detail">{check.detail}</p>
                {check.sampleIds && check.sampleIds.length > 0 && (
                  <p className="export-check-ids">
                    {check.sampleIds.slice(0, 8).join(', ')}
                    {check.sampleIds.length > 8 && ` +${check.sampleIds.length - 8} more`}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Format selection */}
          <div className="form-group">
            <label className="form-label">
              <span>Export format</span>
            </label>
            <div className="export-format-row">
              {FORMATS.map((option) => (
                <button
                  key={option.id}
                  className={`export-format ${format === option.id ? 'selected' : ''}`}
                  onClick={() => setFormat(option.id)}
                  disabled={isExporting}
                  title={option.hint}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <span className="form-helper">
              {FORMATS.find((option) => option.id === format)?.hint}
            </span>
          </div>
// Bundle preview
          {format === 'zip' && (
            <div className="export-tree" aria-label="Bundle contents">
              <div className="export-tree-root">{sampleCount} sample(s)</div>
              <div className="export-tree-row">
                <span>images/</span>
                <span className="export-tree-count">{sampleCount} files</span>
              </div>
              <div className="export-tree-row">
                <span>annotations.jsonl</span>
                <span className="export-tree-note">ground truth</span>
              </div>
              <div className="export-tree-row">
                <span>ocr.jsonl</span>
                <span className="export-tree-note">machine evidence</span>
              </div>
              <div className="export-tree-row">
                <span>manifest.json</span>
                <span className="export-tree-note">provenance</span>
              </div>
              <div className="export-tree-row">
                <span>README.md</span>
                <span className="export-tree-note">how to load it</span>
              </div>
            </div>
          )}

          {isExporting && progressLabel && (
            <div className="export-progress">
              <div className="export-progress-track">
                <div className="export-progress-fill spin" />
              </div>
              <span className="export-progress-label">{progressLabel}</span>
            </div>
          )}

          {errorMessage && (
            <div className="export-error" role="alert">
              {errorMessage}
            </div>
          )}

          {!canExport && failures.length > 0 && (
            <div className="export-blocked">
              {failures.length} blocking issue{failures.length > 1 ? 's' : ''} must be fixed
              before this corpus can be exported.
            </div>
          )}

          {canExport && warnings.length > 0 && (
            <div className="export-note">
              {warnings.length} warning{warnings.length > 1 ? 's' : ''} will be recorded in
              manifest.json alongside the export.
            </div>
          )}
        </div>

        <div className="export-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onExport(format)}
            disabled={!canExport || isExporting || sampleCount === 0}
            title={
              canExport
                ? `Export ${sampleCount} annotated sample(s)`
                : 'Resolve the blocking issues first'
            }
          >
            <Package size={14} />
            <span>{isExporting ? 'Exporting...' : `Export ${sampleCount} sample(s)`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};