import React, { useState, useEffect, useRef } from 'react';
import {
  EncounterSample,
  Platform,
  EncounterStatus,
  DensityLevel,
  SampleMetadata,
  GroundTruthItem,
  GroundTruthItemRole,
  OcrArtifact,
  OcrInsertMode,
  OcrStatus,
} from '../types/schema';
import { OCRPanel, previewSnippet } from './OCRPanel';
import { QualityFlagPicker } from './QualityFlagPicker';
import { toggleQualityFlag } from '../services/qualityFlags';
import type { QualityFlag } from '../types/schema';
import {
  GROUND_TRUTH_ITEM_ROLES,
  ITEM_ROLE_DEFINITIONS,
  ITEM_ROLE_LABELS,
  normalizeRole,
} from '../types/schema';
import { applyOcrInsert } from '../services/ocrInsert';
import {
  CheckCircle,
  Save,
  ArrowRight,
  ArrowLeft,
  XCircle,
  SkipForward,
  Type,
  Code,
  User,
  Eye,
  Info,
  Layers,
  Flag,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface GroundTruthFormProps {
  encounter: EncounterSample;
  hasNext: boolean;
  hasPrev: boolean;
  ocrArtifact: OcrArtifact | null;
  ocrStatus: OcrStatus;
  onRunOcr: (frameId: string) => void;
  onSaveAndNext: (
    sampleId: string,
    fields: {
      platform: Platform;
      items: GroundTruthItem[];
      metadata: SampleMetadata;
    }
  ) => void;
  onSetStatus: (sampleId: string, status: EncounterStatus, advance: boolean) => void;
  onGoNext: () => void;
  onGoPrev: () => void;
}

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'x', label: 'X (Twitter)' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'threads', label: 'Threads' },
  { id: 'other', label: 'Other' },
];

const ITEM_ROLES: { id: GroundTruthItemRole; label: string }[] = GROUND_TRUTH_ITEM_ROLES.map((id) => ({
  id,
  label: ITEM_ROLE_LABELS[id],
}));

const DENSITIES: DensityLevel[] = ['low', 'medium', 'high'];

export const GroundTruthForm: React.FC<GroundTruthFormProps> = ({
  encounter,
  hasNext,
  hasPrev,
  ocrArtifact,
  ocrStatus,
  onRunOcr,
  onSaveAndNext,
  onSetStatus,
  onGoNext,
  onGoPrev,
}) => {
  const [platform, setPlatform] = useState<Platform>(encounter.platform || 'other');
  const [items, setItems] = useState<GroundTruthItem[]>(
    encounter.items && encounter.items.length > 0
      ? encounter.items
      : [
          {
            id: `item-${encounter.sampleId}-1`,
            role: 'post',
            orderIndex: 0,
            content: '',
            author: '',
            mediaDescription: '',
            hasMedia: true,
            hasAuthor: true,
          },
        ]
  );
  const [isMonospace, setIsMonospace] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('saved');
  const [ocrCollapsed, setOcrCollapsed] = useState<boolean>(true);

  // Frame-Level Metadata states
  const [textDensity, setTextDensity] = useState<DensityLevel>(encounter.metadata?.textDensity || 'medium');
  const [visualDensity, setVisualDensity] = useState<DensityLevel>(encounter.metadata?.visualDensity || 'medium');
  const [isFlaggedForReview, setIsFlaggedForReview] = useState<boolean>(
    encounter.metadata?.isFlaggedForReview ?? false
  );
  // Slice 7 §6 — data quality flags (AGENTS §25). Previously write-only: fully
  // plumbed to export, but no UI could set them.
  const [qualityFlags, setQualityFlags] = useState<QualityFlag[]>(
    encounter.metadata?.qualityFlags ?? []
  );

  const toggleFlag = (flag: QualityFlag) => {
    setQualityFlags((prev) => toggleQualityFlag(prev, flag));
    setSaveStatus('idle');
  };

  const firstInputRef = useRef<HTMLTextAreaElement>(null);
  const firstAuthorRef = useRef<HTMLInputElement>(null);

  const ocrRunning =
    ocrStatus.phase === 'running' && ocrStatus.frameId === encounter.frameId;

  // Auto-expand the OCR panel while OCR is running so progress stays visible.
  useEffect(() => {
    if (ocrRunning) setOcrCollapsed(false);
  }, [ocrRunning]);

  // Sync state when active encounter changes
  useEffect(() => {
    setPlatform(encounter.platform || 'other');
    setItems(
      encounter.items && encounter.items.length > 0
        ? encounter.items
        : [
            {
              id: `item-${encounter.sampleId}-1`,
              role: 'post',
              orderIndex: 0,
              content: '',
              author: '',
              mediaDescription: '',
              hasMedia: true,
              hasAuthor: true,
            },
          ]
    );

    setTextDensity(encounter.metadata?.textDensity || 'medium');
    setVisualDensity(encounter.metadata?.visualDensity || 'medium');
    setIsFlaggedForReview(encounter.metadata?.isFlaggedForReview ?? false);
    setQualityFlags(encounter.metadata?.qualityFlags ?? []);

    setSaveStatus('saved');

    setTimeout(() => {
      // Author comes first in the form; fall back to the content textarea when the item has no author field.
      (firstAuthorRef.current ?? firstInputRef.current)?.focus();
    }, 50);
  }, [encounter.sampleId, encounter.items, encounter.platform, encounter.metadata]);

  // Update item field in stack
  const updateItemField = (
    index: number,
    field: keyof GroundTruthItem,
    value: any
  ) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setSaveStatus('idle');
  };

  // Add new UGC Item block in stack
  const handleAddItem = () => {
    const nextIndex = items.length;
    const newItem: GroundTruthItem = {
      id: `item-${encounter.sampleId}-${Date.now()}`,
      role: nextIndex === 0 ? 'post' : 'reply',
      orderIndex: nextIndex,
      content: '',
      author: '',
      mediaDescription: '',
      hasMedia: false, // Default secondary items (replies/comments) to text-only unless toggled
      hasAuthor: true,
    };
    setItems((prev) => [...prev, newItem]);
    setSaveStatus('idle');

    setTimeout(() => {
      const authors = document.querySelectorAll<HTMLInputElement>('input[data-item-author]');
      const textareas = document.querySelectorAll<HTMLTextAreaElement>('.item-content-textarea');
      if (newItem.hasAuthor && authors.length === textareas.length) {
        authors[authors.length - 1].focus();
        return;
      }
      if (textareas.length > 0) {
        textareas[textareas.length - 1].focus();
      }
    }, 60);
  };

  // Remove UGC Item block from stack
  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSaveStatus('idle');
  };

  /**
   * Writes OCR text into a content field. The caller (OCRPanel) has already
   * enforced the guard: 'replace' for empty fields, or an explicit researcher
   * choice of replace/append for fields containing human text. OCR never writes
   * silently — this handler only materialises a decision already made.
   */
  const handleInsertOcr = (text: string, targetItemId: string, mode: OcrInsertMode) => {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === targetItemId);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = {
        ...next[index],
        content: applyOcrInsert(next[index].content, text, mode),
      };
      return next;
    });
    setSaveStatus('idle');
  };

  const handleSaveAndNext = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveStatus('saved');
    onSaveAndNext(encounter.sampleId, {
      platform,
      items,
      metadata: {
        textDensity: items.length > 1 ? 'high' : textDensity,
        visualDensity,
        isFlaggedForReview,
        // Slice 7 §6 — flags ride along in the existing metadata write, so they
        // cannot survive locally but fail to persist.
        qualityFlags,
      },
    });
  };

  // Slice 7 §7 — these used to be a private window listener each. They now subscribe to
  // events emitted by the central shortcut registry in App.tsx, so there is exactly one
  // keyboard listener in the application.
  useEffect(() => {
    const onAddItem = () => handleAddItem();
    window.addEventListener('scrollnotes:add-item', onAddItem);
    return () => window.removeEventListener('scrollnotes:add-item', onAddItem);
  }, [items.length]);

  useEffect(() => {
    const onToggleMono = () => setIsMonospace((v) => !v);
    window.addEventListener('scrollnotes:toggle-monospace', onToggleMono);
    return () => window.removeEventListener('scrollnotes:toggle-monospace', onToggleMono);
  }, []);

  useEffect(() => {
    const onToggleFlag = (e: Event) => {
      const flag = (e as CustomEvent<QualityFlag>).detail;
      if (flag) toggleFlag(flag);
    };
    window.addEventListener('scrollnotes:toggle-flag', onToggleFlag);
    return () => window.removeEventListener('scrollnotes:toggle-flag', onToggleFlag);
  }, [qualityFlags]);

  return (
    <div className="ground-truth-panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title-group">
          <CheckCircle size={18} style={{ color: 'var(--accent-emerald)' }} />
          <span className="panel-title">Field Note & Ground Truth</span>
          <span className="multi-item-counter-badge">
            {items.length} {items.length === 1 ? 'UGC Item' : 'UGC Items'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Check size={12} /> {saveStatus === 'saved' ? 'Saved locally' : 'Editing'}
          </span>
          <div className={`status-pill ${encounter.status}`}>
            {encounter.status.toUpperCase()}
          </div>
        </div>
      </div>

      {/* OCR Extract — collapsible preprocessing evidence */}
      <div className={`ocr-collapsible-wrap ${ocrCollapsed ? 'is-collapsed' : ''}`}>
        <button
          type="button"
          className="ocr-collapsible-toggle"
          onClick={() => setOcrCollapsed((prev) => !prev)}
          title={ocrCollapsed ? 'Expand OCR extract' : 'Collapse OCR extract'}
        >
          {ocrCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          <span>
            {ocrRunning
              ? `OCR — ${ocrStatus.progressMessage || 'Working…'}`
              : ocrArtifact
                ? `OCR Extract (${ocrArtifact.text.trim().length} chars)`
                : 'OCR Extract — preprocessing evidence, not ground truth'}
          </span>
          {ocrCollapsed && ocrArtifact && (
            <span className="ocr-collapsed-preview">
              {previewSnippet(ocrArtifact.text)}
            </span>
          )}
        </button>

        {/* Always mounted so Alt+O / Alt+I shortcuts stay live while collapsed. */}
        <OCRPanel
          frameId={encounter.frameId}
          ocrArtifact={ocrArtifact}
          ocrStatus={ocrStatus}
          items={items}
          onRunOcr={onRunOcr}
          onInsertOcr={handleInsertOcr}
        />
      </div>

      {/* Form Fields */}
      <form className="form-scroll-area" onSubmit={handleSaveAndNext}>
        {/* Platform Selector */}
        <div className="form-group">
          <div className="form-label-row">
            <label className="form-label">
              <span>Platform</span>
            </label>
            <span className="form-helper">Sample-level property</span>
          </div>
          <div className="platform-selector-grid">
            {PLATFORMS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`platform-pill ${platform === p.id ? 'selected' : ''}`}
                onClick={() => {
                  setPlatform(p.id);
                  setSaveStatus('idle');
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Multi-Item Stack Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-sky)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Layers size={14} /> Visible UGC Items in Frame ({items.length})
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.72rem', padding: '2px 8px' }}
            onClick={handleAddItem}
            title="Add another UGC post/reply visible in this frame (Alt+N)"
          >
            <Plus size={13} />
            <span>Add UGC Item</span>
            <span className="shortcut-hint" style={{ marginLeft: '2px' }}>Alt+N</span>
          </button>
        </div>

        {/* Stack of UGC Item Blocks */}
        <div className="ugc-items-stack">
          {items.map((item, index) => (
            <div key={item.id || index} className="ugc-item-card">
              {/* Item Card Header */}
              <div className="ugc-item-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="ugc-item-index-badge">#{index + 1}</span>
                  <select
                    className="form-input ugc-role-select"
                    value={normalizeRole(item.role)}
                    onChange={(e) =>
                      updateItemField(index, 'role', e.target.value as GroundTruthItemRole)
                    }
                  >
                    {ITEM_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <span className="form-helper" style={{ fontSize: '0.68rem' }}>
                    {ITEM_ROLE_DEFINITIONS[normalizeRole(item.role)]}
                  </span>
                </div>

                {/* UGC Item-Level Attribute Chips (hasMedia, hasAuthor) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    className={`meta-chip ${item.hasMedia ? 'active' : ''}`}
                    style={{ fontSize: '0.68rem', padding: '1px 5px' }}
                    onClick={() => updateItemField(index, 'hasMedia', !item.hasMedia)}
                    title="Toggle whether this specific UGC item contains visual media/image"
                  >
                    📷 media
                  </button>
                  <button
                    type="button"
                    className={`meta-chip ${item.hasAuthor ? 'active' : ''}`}
                    style={{ fontSize: '0.68rem', padding: '1px 5px' }}
                    onClick={() => updateItemField(index, 'hasAuthor', !item.hasAuthor)}
                    title="Toggle whether author handle/creator is visible for this item"
                  >
                    👤 author
                  </button>

                  {index === 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                      onClick={() => setIsMonospace(!isMonospace)}
                      title="Toggle monospace font for exact transcriptions"
                    >
                      <Code size={12} />
                      <span>{isMonospace ? 'Sans' : 'Mono'}</span>
                    </button>
                  )}
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm ugc-item-delete-btn"
                      onClick={() => handleRemoveItem(index)}
                      title="Remove this UGC item"
                    >
                      <Trash2 size={13} style={{ color: 'var(--status-rejected-text)' }} />
                    </button>
                  )}
                </div>
              </div>

              {/* Item Author Handle */}
              {item.hasAuthor && (
                <div className="form-group" style={{ marginTop: '0.4rem' }}>
                  <div className="form-label-row">
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>
                      <User size={12} />
                      <span>Author / Handle</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.68rem', padding: '1px 5px' }}
                      onClick={() => updateItemField(index, 'author', 'unknown')}
                    >
                      Set "unknown"
                    </button>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    ref={index === 0 ? firstAuthorRef : undefined}
                    data-item-author
                    placeholder="e.g. @username or Name"
                    value={item.author}
                    onChange={(e) => updateItemField(index, 'author', e.target.value)}
                  />
                </div>
              )}

              {/* Item Verbatim Content */}
              {platform === 'reddit' && (
                <div className="form-helper" style={{ fontSize: '0.7rem', marginTop: '0.5rem' }}>
                  Reddit: content = post title, then the visible body text, separated by a line break.
                </div>
              )}
              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <div className="form-label-row">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>
                    <Type size={12} />
                    <span>Verbatim UGC Text</span>
                  </label>
                  <span className="form-helper" style={{ fontSize: '0.68rem' }}>Exact transcription</span>
                </div>
                <textarea
                  ref={index === 0 ? firstInputRef : undefined}
                  className={`form-textarea item-content-textarea ${isMonospace ? 'is-mono' : ''}`}
                  placeholder={`Transcribe exact content for item #${index + 1}...`}
                  value={item.content}
                  onChange={(e) => updateItemField(index, 'content', e.target.value)}
                  rows={items.length > 1 ? 3 : 4}
                />
              </div>

              {/* Item Salient Media Description (shown if item hasMedia is active) */}
              {item.hasMedia && (
                <div className="form-group" style={{ marginTop: '0.4rem' }}>
                  <div className="form-label-row">
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>
                      <Eye size={12} />
                      <span>Salient Visual Description (Item #{index + 1})</span>
                    </label>
                  </div>
                  <textarea
                    className="form-textarea"
                    placeholder="Visual description of salient media artifacts for this item..."
                    value={item.mediaDescription}
                    onChange={(e) => updateItemField(index, 'mediaDescription', e.target.value)}
                    rows={2}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Frame-Level Metadata Section */}
        <div className="form-group" style={{ background: 'var(--bg-core)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginTop: '0.4rem' }}>
          <div className="form-label-row" style={{ marginBottom: '0.5rem' }}>
            <label className="form-label" style={{ color: 'var(--accent-sky)' }}>
              <Layers size={13} />
              <span>Frame-Level Metadata</span>
            </label>
            <button
              type="button"
              className={`btn btn-sm ${isFlaggedForReview ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                color: isFlaggedForReview ? '#fff' : 'var(--status-pending-text)',
                borderColor: isFlaggedForReview ? undefined : 'var(--status-pending-border)',
              }}
              onClick={() => {
                setIsFlaggedForReview(!isFlaggedForReview);
                setSaveStatus('idle');
              }}
              title="Flag this sample for researcher follow-up review"
            >
              <Flag size={12} />
              <span>{isFlaggedForReview ? 'Flagged for Review' : 'Flag for Review'}</span>
            </button>
          </div>

          {/* Density Controls & Feature Flags */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '3px' }}>
                Frame Text Density:
              </span>
              <div style={{ display: 'flex', gap: '3px' }}>
                {DENSITIES.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`meta-chip ${textDensity === d ? 'active' : ''}`}
                    onClick={() => {
                      setTextDensity(d);
                      setSaveStatus('idle');
                    }}
                    style={{ flex: 1, textTransform: 'capitalize', justifyContent: 'center' }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'block', marginBottom: '3px' }}>
                Frame Visual Density:
              </span>
              <div style={{ display: 'flex', gap: '3px' }}>
                {DENSITIES.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`meta-chip ${visualDensity === d ? 'active' : ''}`}
                    onClick={() => {
                      setVisualDensity(d);
                      setSaveStatus('idle');
                    }}
                    style={{ flex: 1, textTransform: 'capitalize', justifyContent: 'center' }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Slice 7 §6 — data quality flags (AGENTS §25) */}
          <div style={{ marginTop: '0.85rem' }}>
            <QualityFlagPicker flags={qualityFlags} onToggle={toggleFlag} />
          </div>

          {/* Frame Feature toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.85rem' }}>
            <Info size={12} />
            <span>hasMedia and hasAuthor are set per UGC item. Density &amp; Flags apply to the frame.</span>
          </div>
        </div>
      </form>

      {/* Footer & Actions */}
      <div className="panel-footer">
        <div className="primary-action-row">
          <button
            type="button"
            className="btn btn-save-next"
            onClick={() => handleSaveAndNext()}
          >
            <Save size={16} />
            <span>Save & Next ({items.length} {items.length === 1 ? 'Item' : 'Items'})</span>
            <span className="shortcut-hint">Ctrl + Enter</span>
          </button>
        </div>

        <div className="secondary-action-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onGoPrev}
            disabled={!hasPrev}
            title="Previous Frame (Left Arrow)"
          >
            <ArrowLeft size={13} />
            <span>Prev</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onGoNext}
            disabled={!hasNext}
            title="Next Frame (Right Arrow)"
          >
            <ArrowRight size={13} />
            <span>Next</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onSetStatus(encounter.sampleId, 'skipped', true)}
            title="Skip Frame (S)"
          >
            <SkipForward size={13} />
            <span>Skip</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onSetStatus(encounter.sampleId, 'rejected', true)}
            style={{ color: 'var(--status-rejected-text)' }}
            title="Reject Frame (R)"
          >
            <XCircle size={13} />
            <span>Reject</span>
          </button>
        </div>
      </div>
    </div>
  );
};
