import React, { useState, useEffect } from 'react';
import {
  ScanText,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  GroundTruthItem,
  OcrArtifact,
  OcrInsertMode,
  OcrStatus,
} from '../types/schema';
import { needsOcrInsertConfirmation } from '../services/ocrInsert';

interface OCRPanelProps {
  frameId: string;
  ocrArtifact: OcrArtifact | null;
  ocrStatus: OcrStatus;
  items: GroundTruthItem[];
  onRunOcr: (frameId: string) => void;
  onInsertOcr: (text: string, targetItemId: string, mode: OcrInsertMode) => void;
}

export function previewSnippet(text: string, max = 140): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single || '(empty result)';
}

export const OCRPanel: React.FC<OCRPanelProps> = ({
  frameId,
  ocrArtifact,
  ocrStatus,
  items,
  onRunOcr,
  onInsertOcr,
}) => {
  const [targetItemId, setTargetItemId] = useState<string | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const running = ocrStatus.phase === 'running' && ocrStatus.frameId === frameId;
  const failed = ocrStatus.phase === 'error' && ocrStatus.frameId === frameId;

  const primaryItem = items[0];
  const targetItem = items.find((item) => item.id === targetItemId) ?? primaryItem ?? null;
  const targetNeedsConfirmation = needsOcrInsertConfirmation(targetItem?.content);


  const handleCopy = async () => {
    if (!ocrArtifact) return;
    try {
      await navigator.clipboard.writeText(ocrArtifact.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const handleRun = () => {
    setGuardOpen(false);
    onRunOcr(frameId);
  };

  const handleInsert = () => {
    if (!ocrArtifact || !targetItem) return;
    // Golden rule: never silently overwrite existing human annotation.
    if (!targetNeedsConfirmation) {
      onInsertOcr(ocrArtifact.text, targetItem.id, 'replace');
      setGuardOpen(false);
    } else {
      setGuardOpen(true);
    }
  };

  const handleGuard = (mode: OcrInsertMode) => {
    if (!ocrArtifact || !targetItem) return;
    onInsertOcr(ocrArtifact.text, targetItem.id, mode);
    setGuardOpen(false);
  };

  // Reset per-frame guard state when the active frame changes.
  useEffect(() => {
    setGuardOpen(false);
    setTargetItemId(null);
  }, [frameId]);

  // Slice 7 §7 — Alt+I / Alt+O are declared once in the central registry in App.tsx
  // and arrive here as events, so there is exactly one keyboard listener in the app.
  useEffect(() => {
    const onInsert = () => {
      if (!ocrArtifact || !targetItem) return;
      if (!needsOcrInsertConfirmation(targetItem.content)) {
        onInsertOcr(ocrArtifact.text, targetItem.id, 'replace');
      } else {
        setGuardOpen(true);
      }
    };
    window.addEventListener('scrollnotes:ocr-insert', onInsert);
    return () => window.removeEventListener('scrollnotes:ocr-insert', onInsert);
  }, [frameId, ocrArtifact, targetItem, onInsertOcr]);


  return (
    <div className="ocr-panel">
      <div className="ocr-panel-body">
        {running && (
            <div className="ocr-progress">
              <div className="ocr-progress-label">
                <span>{ocrStatus.progressMessage || 'Working…'}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {Math.round((ocrStatus.progress ?? 0) * 100)}%
                </span>
              </div>
              <div className="ocr-progress-track">
                <div
                  className="ocr-progress-fill"
                  style={{ width: `${Math.round((ocrStatus.progress ?? 0) * 100)}%` }}
                />
              </div>
              <p className="ocr-hint">
                The OCR engine is downloaded once and cached; all recognition runs locally
                and nothing is uploaded.
              </p>
            </div>
          )}

          {!running && failed && (
            <div className="ocr-error">
              <AlertTriangle size={14} />
              <div>
                <div style={{ fontWeight: 600 }}>OCR could not run on this frame.</div>
                <div className="ocr-hint">
                  {ocrStatus.error || 'Unknown error.'} You can retry, or annotate
                  manually — nothing was changed.
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: '0.5rem' }}
                  onClick={handleRun}
                >
                  <RefreshCw size={13} />
                  <span>Retry OCR</span>
                </button>
              </div>
            </div>
          )}

          {!running && !failed && !ocrArtifact && (
            <div className="ocr-empty">
              <p className="ocr-empty-title">No OCR trace for this frame yet.</p>
              <p className="ocr-hint">
                Generate one to use as an optional starting point for transcription.
              </p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleRun}>
                <ScanText size={14} />
                <span>Run OCR</span>
              </button>
              <p className="ocr-hint">
                First run downloads the Tesseract engine once (cached). Images never leave
                this machine.
              </p>
            </div>
          )}

          {!running && !failed && ocrArtifact && (
            <>
              <div className="ocr-provenance">
                <span>
                  {ocrArtifact.engine} · {ocrArtifact.language}
                  {typeof ocrArtifact.confidence === 'number'
                    ? ` · conf ${ocrArtifact.confidence.toFixed(1)}`
                    : ''}
                  {ocrArtifact.engineVersion ? ` · v${ocrArtifact.engineVersion}` : ''}
                </span>
                <span>{new Date(ocrArtifact.generatedAt).toLocaleString()}</span>
              </div>

              <pre className="ocr-text-viewer">{ocrArtifact.text}</pre>

              {items.length > 0 && (
                <div className="ocr-insert-row">
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                    Insert into:
                  </span>
                  <div className="ocr-target-chips">
                    {items.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`meta-chip ${targetItem?.id === item.id ? 'active' : ''}`}
                        onClick={() => {
                          setTargetItemId(item.id);
                          setGuardOpen(false);
                        }}
                        title={`Insert OCR into item #${index + 1}`}
                      >
                        #{index + 1} {item.role}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="ocr-insert-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleInsert}
                  disabled={!targetItem}
                  title="Insert into Content (Alt+I)"
                >
                  <span>Insert into Content</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopy}
                  title="Copy OCR text"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleRun}
                  title="Re-run OCR (Alt+O)"
                >
                  <RefreshCw size={13} />
                  <span>Re-run</span>
                </button>
              </div>

              {guardOpen && targetItem && (
                <div className="ocr-guard">
                  <div className="ocr-guard-message">
                    <AlertTriangle size={14} />
                    <span>
                      Item #{items.findIndex((entry) => entry.id === targetItem.id) + 1}{' '}
                      already contains human ground truth. OCR must not overwrite it
                      silently.
                    </span>
                  </div>
                  <div className="ocr-guard-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleGuard('append')}
                      title="Keep existing text and add OCR after it"
                    >
                      Append
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleGuard('replace')}
                      title="Replace the field with the OCR text"
                      style={{ color: 'var(--status-rejected-text)' }}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setGuardOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
};
