import React from 'react';
import {
  EncounterSample,
  FrameRecord,
  DedupRole,
} from '../types/schema';
import { CheckCircle2, Clock, XCircle, SkipForward, Flag, FileText, Image as ImageIcon, Layers, Crown, AlertTriangle } from 'lucide-react';
import { ITEM_ROLE_LABELS, normalizeRole, QUALITY_FLAG_LABELS } from '../types/schema';
import { useFrameThumb } from '../hooks/useFrameThumb';

interface EncounterCardProps {
  encounter: EncounterSample;
  frame?: FrameRecord;
  dedupRole?: DedupRole;
  dedupOf?: string;
  isActive: boolean;
  onSelect: (sampleId: string) => void;
}

export const EncounterCard: React.FC<EncounterCardProps> = ({
  encounter,
  frame,
  dedupRole,
  dedupOf,
  isActive,
  onSelect,
}) => {
  const thumbSrc = useFrameThumb(frame?.id);
  const primaryItem = encounter.items[0];
  const hasText = primaryItem?.content && primaryItem.content.trim().length > 0;
  const isFlagged = encounter.metadata?.isFlaggedForReview;
  // Slice 7 §6 — quality-flag summary for the card badge (§25). Derived, never persisted
  // at frame level, per §14.
  const qualityFlags = encounter.metadata?.qualityFlags ?? [];
  const qualityFlagCount = qualityFlags.length;
  const qualityFlagNames = qualityFlags.map((f) => QUALITY_FLAG_LABELS[f] ?? f);
  const itemCount = encounter.items?.length || 1;
  const secondaryItemsCount = itemCount - 1;
  // hasMedia is a UGC item-level property: a frame is media-bearing if ANY item has media.
  const hasAnyMedia = encounter.items?.some((item) => item.hasMedia) ?? false;

  const renderStatusBadge = () => {
    switch (encounter.status) {
      case 'annotated':
        return (
          <div className="card-status-badge status-pill annotated">
            <CheckCircle2 size={12} />
            <span>Curated</span>
          </div>
        );
      case 'rejected':
        return (
          <div className="card-status-badge status-pill rejected">
            <XCircle size={12} />
            <span>Rejected</span>
          </div>
        );
      case 'skipped':
        return (
          <div className="card-status-badge status-pill skipped">
            <SkipForward size={12} />
            <span>Skipped</span>
          </div>
        );
      case 'pending':
      default:
        return (
          <div className="card-status-badge status-pill pending">
            <Clock size={12} />
            <span>Pending</span>
          </div>
        );
    }
  };

  return (
    <div
      className={`encounter-card ${isActive ? 'is-active' : ''} ${isFlagged ? 'is-flagged' : ''} ${
        dedupRole === 'duplicate' ? 'is-suppressed' : ''
      }`}
      onClick={() => onSelect(encounter.sampleId)}
    >
      <div className="card-image-wrap">
        {frame && thumbSrc ? (
          <img
            src={thumbSrc}
            alt={encounter.sampleId}
            className="card-image"
            loading="lazy"
          />
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            {frame ? 'Loading…' : 'No image data'}
          </div>
        )}

        <div className="card-platform-tag">
          {encounter.platform}
        </div>

        {renderStatusBadge()}

        {dedupRole === 'duplicate' && (
          <div className="card-dedup-badge dup" title="Suppressed as a near-duplicate — restorable in the Deduplicate view">
            <span>Duplicate{dedupOf ? ` of ${dedupOf}` : ''}</span>
          </div>
        )}

        {dedupRole === 'representative' && (
          <div className="card-dedup-badge rep" title="Representative of a duplicate group">
            <Crown size={11} />
            <span>Rep</span>
          </div>
        )}


        {isFlagged && (
          <div className="card-flag-badge" title="Flagged for researcher review">
            <Flag size={11} />
            <span>Flagged</span>
          </div>
        )}

        {/* Slice 7 §6 — data quality flags (§25). The badge shows a count rather
            than the flags themselves so the card stays scannable; the tooltip names
            them. */}
        {qualityFlagCount > 0 && (
          <div
            className="card-quality-badge"
            title={`Data quality flags: ${qualityFlagNames.join(', ')}`}
          >
            <AlertTriangle size={11} />
            <span>{qualityFlagCount}</span>
          </div>
        )}

        {itemCount > 1 && (
          <div className="card-multi-item-tag" title={`${itemCount} distinct UGC items transcribed in this frame`}>
            <Layers size={11} />
            <span>{itemCount} UGC Items</span>
          </div>
        )}
      </div>

      <div className="card-details">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-sample-id">{encounter.sampleId}</span>
          <span className="card-ugc-type-pill">
            {ITEM_ROLE_LABELS[normalizeRole(primaryItem?.role)]}
          </span>
        </div>

        <p className="card-preview-text">
          {hasText ? primaryItem.content : <em style={{ color: 'var(--text-dim)' }}>No ground-truth transcription yet...</em>}
        </p>

        {secondaryItemsCount > 0 && (
          <div className="card-secondary-preview">
            <span>+{secondaryItemsCount} more visible {secondaryItemsCount === 1 ? 'item' : 'items'} (e.g. {ITEM_ROLE_LABELS[normalizeRole(encounter.items[1]?.role)].toLowerCase()})</span>
          </div>
        )}

        <div className="card-meta-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {hasAnyMedia && (
              <span title="Contains visual media" style={{ display: 'inline-flex' }}>
                <ImageIcon size={12} />
              </span>
            )}
            {(itemCount > 1 || encounter.metadata?.textDensity === 'high') && (
              <span title="Text-dense or multi-item feed frame" style={{ display: 'inline-flex' }}>
                <FileText size={12} />
              </span>
            )}
            <span>{encounter.provenance.frameFilename || 'frame'}</span>
          </div>
          <span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
        </div>
      </div>
    </div>
  );
};
