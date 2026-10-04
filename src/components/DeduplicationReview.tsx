import React, { useEffect, useMemo, useState } from 'react';
import {
  Fingerprint,
  Play,
  RefreshCw,
  Crown,
  Undo2,
  Settings2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import {
  EncounterSample,
  FrameRecord,
  DedupRecord,
  DedupConfig,
  DedupStatus,
  DedupStats,
  DuplicateGroup,
  HashAlgorithm,
} from '../types/schema';
import { hammingDistance } from '../services/deduplication';

interface DeduplicationReviewProps {
  encounters: EncounterSample[];
  frames: Map<string, FrameRecord>;
  dedupRecords: Map<string, DedupRecord>;
  dedupConfig: DedupConfig;
  dedupStatus: DedupStatus;
  dedupStats: DedupStats;
  onRunDeduplication: () => void;
  onSetThreshold: (threshold: number) => void;
  onSetAlgorithm: (algorithm: HashAlgorithm) => void;
  onSetRepresentative: (frameId: string) => void;
  onMarkDuplicate: (frameId: string, representativeFrameId?: string) => void;
  onRestoreFrame: (frameId: string) => void;
  onSelectSample: (sampleId: string) => void;
}

const ALGORITHMS: { id: HashAlgorithm; label: string; desc: string }[] = [
  { id: 'phash', label: 'pHash', desc: 'DCT perceptual hash (default, robust)' },
  { id: 'dhash', label: 'dHash', desc: 'Difference hash (fast, edge-sensitive)' },
  { id: 'ahash', label: 'aHash', desc: 'Average hash (cheap, coarse)' },
];

function groupDisplayOrder(group: DuplicateGroup, records: Map<string, DedupRecord>): string[] {
  const rank = (frameId: string) => {
    const role = records.get(frameId)?.role;
    return role === 'representative' ? 0 : role === 'duplicate' ? 1 : 2;
  };
  return [...group.frameIds].sort((a, b) => rank(a) - rank(b));
}

function distanceToRep(
  frameId: string,
  repId: string,
  records: Map<string, DedupRecord>
): number | null {
  const a = records.get(frameId)?.hash;
  const b = records.get(repId)?.hash;
  if (!a || !b) return null;
  return hammingDistance(a, b);
}

export const DeduplicationReview: React.FC<DeduplicationReviewProps> = ({
  encounters,
  frames,
  dedupRecords,
  dedupConfig,
  dedupStatus,
  dedupStats,
  onRunDeduplication,
  onSetThreshold,
  onSetAlgorithm,
  onSetRepresentative,
  onMarkDuplicate,
  onRestoreFrame,
  onSelectSample,
}) => {
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [cursor, setCursor] = useState<{ group: number; frame: number } | null>(null);

  const frameToSample = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of encounters) map.set(encounter.frameId, encounter.sampleId);
    return map;
  }, [encounters]);

  const groups = useMemo<DuplicateGroup[]>(() => {
    const byGroup = new Map<string, string[]>();
    const repByGroup = new Map<string, string>();
    for (const record of dedupRecords.values()) {
      if (!record.groupId) continue;
      const list = byGroup.get(record.groupId) ?? [];
      list.push(record.frameId);
      byGroup.set(record.groupId, list);
      if (record.role === 'representative') repByGroup.set(record.groupId, record.frameId);
    }

    const result: DuplicateGroup[] = [];
    for (const [groupId, frameIds] of byGroup) {
      let maxDistance = 0;
      for (let a = 0; a < frameIds.length; a++) {
        for (let b = a + 1; b < frameIds.length; b++) {
          const ha = dedupRecords.get(frameIds[a])?.hash;
          const hb = dedupRecords.get(frameIds[b])?.hash;
          if (ha && hb) maxDistance = Math.max(maxDistance, hammingDistance(ha, hb));
        }
      }
      result.push({
        groupId,
        frameIds,
        representativeFrameId: repByGroup.get(groupId) ?? frameIds[0],
        maxDistance,
      });
    }
    return result.sort((a, b) => a.groupId.localeCompare(b.groupId));
  }, [dedupRecords]);

  const configStale =
    dedupRecords.size > 0 &&
    [...dedupRecords.values()].some((record) => record.algorithm !== dedupConfig.algorithm);

  const busy = dedupStatus.phase === 'hashing' || dedupStatus.phase === 'grouping';
  const progressPct =
    dedupStatus.total > 0 ? Math.round((dedupStatus.processed / dedupStatus.total) * 100) : 0;

  // View-scoped keyboard: groups/frames navigation, representative/duplicate/restore.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (isInput || e.metaKey || e.ctrlKey || e.altKey) return;
      if (groups.length === 0) return;

      const current = cursor ?? { group: 0, frame: 0 };
      const ordered = groupDisplayOrder(groups[current.group], dedupRecords);
      const frameId = ordered[current.frame];
      const setCursorGroup = (group: number) =>
        setCursor({
          group: Math.max(0, Math.min(groups.length - 1, group)),
          frame: 0,
        });

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursorGroup(current.group + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const nextFrame =
          e.key === 'ArrowRight'
            ? Math.min(ordered.length - 1, current.frame + 1)
            : Math.max(0, current.frame - 1);
        setCursor({ group: current.group, frame: nextFrame });
      } else if (e.key === 'Enter' && frameId) {
        e.preventDefault();
        onSetRepresentative(frameId);
      } else if ((e.key === 'd' || e.key === 'D') && frameId) {
        e.preventDefault();
        onMarkDuplicate(frameId, groups[current.group].representativeFrameId);
      } else if ((e.key === 'u' || e.key === 'U') && frameId) {
        e.preventDefault();
        onRestoreFrame(frameId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [groups, cursor, dedupRecords, onSetRepresentative, onMarkDuplicate, onRestoreFrame]);

  return (
    <div className="dedup-container">
      {/* Toolbar */}
      <div className="dedup-toolbar">
        <div className="dedup-toolbar-title">
          <Fingerprint size={16} className="dedup-toolbar-icon" />
          <h2>Near-Duplicate Review</h2>
          <span className="dedup-toolbar-sub">
            {encounters.length} candidate frames · {dedupStats.hashed} scanned ·{' '}
            {dedupStats.groups} groups · {dedupStats.duplicates} suppressed
          </span>
        </div>

        <div className="dedup-toolbar-actions">
          <div className="dedup-config-summary" title="Current similarity configuration">
            <span>
              {dedupConfig.algorithm} · Δ≤{dedupConfig.threshold}
            </span>
            {configStale && <span className="dedup-stale">stale — rescan</span>}
            {dedupConfig.lastRunAt && (
              <span title={new Date(dedupConfig.lastRunAt).toLocaleString()}>
                scanned {new Date(dedupConfig.lastRunAt).toLocaleDateString()}
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSettingsOpen((prev) => !prev)}
            title="Deduplication settings"
          >
            <Settings2 size={14} />
            <span>Settings</span>
            {settingsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onRunDeduplication}
            disabled={busy || encounters.length === 0}
            title="Hash all frames and group near-duplicates"
          >
            {dedupRecords.size > 0 ? <RefreshCw size={14} /> : <Play size={14} />}
            <span>{dedupRecords.size > 0 ? 'Rescan' : 'Find Duplicates'}</span>
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="dedup-settings">
          <div className="dedup-setting-row">
            <span className="dedup-setting-label">Hash algorithm:</span>
            <div className="dedup-setting-chips">
              {ALGORITHMS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`meta-chip ${dedupConfig.algorithm === option.id ? 'active' : ''}`}
                  onClick={() => onSetAlgorithm(option.id)}
                  title={`${option.desc}. Requires a rescan.`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="dedup-setting-row">
            <span className="dedup-setting-label">Similarity threshold Δ ≤ {dedupConfig.threshold}:</span>
            <input
              type="range"
              min={0}
              max={16}
              step={1}
              value={dedupConfig.threshold}
              onChange={(e) => onSetThreshold(Number(e.target.value))}
              className="dedup-threshold-slider"
              title="Maximum hamming distance inside a group"
            />
            <span className="dedup-setting-hint">
              Conservative: small values only group near-identical scrolling frames.
            </span>
          </div>

          <p className="dedup-setting-note">
            Deduplication never deletes frames. Every decision is reversible, and changing
            settings requires a fresh scan rather than silently mixing algorithms.
          </p>
        </div>
      )}

      {busy && (
        <div className="dedup-progress">
          <div className="dedup-progress-label">
            <span>{dedupStatus.phase === 'hashing' ? 'Hashing frames…' : 'Grouping…'}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{progressPct}%</span>
          </div>
          <div className="dedup-progress-track">
            <div className="dedup-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {dedupStatus.phase === 'error' && (
        <div className="dedup-error">
          <AlertTriangle size={14} />
          <span>
            {dedupStatus.error || 'Deduplication failed.'} No frames were changed; retry
            when ready.
          </span>
        </div>
      )}

      {/* Empty / no-groups states */}
      {!busy && dedupRecords.size === 0 && (
        <div className="dedup-empty">
          <Fingerprint size={28} />
          <h3>No similarity scan yet</h3>
          <p>
            Hashing every frame finds near-identical scrolling captures so you can review
            one representative per group. Nothing is deleted.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onRunDeduplication}
            disabled={encounters.length === 0}
          >
            <Play size={14} />
            <span>Find Duplicates</span>
          </button>
        </div>
      )}

      {!busy && dedupRecords.size > 0 && groups.length === 0 && (
        <div className="dedup-empty">
          <h3>No duplicates found</h3>
          <p>
            {dedupStats.hashed} frames scanned at Δ≤{dedupConfig.threshold} — the
            threshold may be too strict. Loosen it in Settings and rescan, or accept
            that every candidate is visually distinct.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRunDeduplication}>
            <RefreshCw size={14} />
            <span>Rescan</span>
          </button>
        </div>
      )}

      {/* Group strips */}
      <div className="dedup-group-list">
        {groups.map((group, groupIndex) => {
          const ordered = groupDisplayOrder(group, dedupRecords);
          const focusedFrame = cursor?.group === groupIndex ? ordered[cursor.frame] : null;
          return (
            <div
              key={group.groupId}
              className={`dedup-group ${cursor?.group === groupIndex ? 'is-focused' : ''}`}
            >
              <div className="dedup-group-header">
                <span className="dedup-group-title">
                  Group {groupIndex + 1} · {ordered.length} frames
                </span>
                <span className="dedup-group-meta">max Δ = {group.maxDistance}</span>
              </div>

              <div className="dedup-frame-strip">
                {ordered.map((frameId) => {
                  const record = dedupRecords.get(frameId);
                  const frame = frames.get(frameId);
                  const sampleId = frameToSample.get(frameId) ?? frameId;
                  const isRep = record?.role === 'representative';
                  const isDup = record?.role === 'duplicate';
                  const distance = distanceToRep(
                    frameId,
                    group.representativeFrameId,
                    dedupRecords
                  );
                  return (
                    <div
                      key={frameId}
                      className={`dedup-frame-card ${isRep ? 'is-rep' : ''} ${
                        isDup ? 'is-dup' : ''
                      } ${focusedFrame === frameId ? 'is-cursor' : ''}`}
                      onClick={() => {
                        const encounterSampleId = frameToSample.get(frameId);
                        if (encounterSampleId) onSelectSample(encounterSampleId);
                      }}
                      title={`Open ${sampleId} in the annotation cockpit`}
                    >
                      {frame ? (
                        <img
                          src={frame.dataUrl}
                          alt={sampleId}
                          className="dedup-frame-thumb"
                          loading="lazy"
                        />
                      ) : (
                        <div className="dedup-frame-missing">No image</div>
                      )}

                      <div className="dedup-frame-meta">
                        <span className="dedup-frame-id">{sampleId}</span>
                        <span className={`dedup-badge ${isRep ? 'rep' : isDup ? 'dup' : 'unique'}`}>
                          {isRep ? (
                            <>
                              <Crown size={11} />
                              <span>Rep</span>
                            </>
                          ) : isDup ? (
                            <span>{distance === null ? 'Duplicate' : `Dup Δ${distance}`}</span>
                          ) : (
                            <span>Unique</span>
                          )}
                        </span>
                      </div>

                      <div className="dedup-frame-actions">
                        {!isRep && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSetRepresentative(frameId);
                            }}
                            title="Set as representative (Enter)"
                          >
                            <Crown size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreFrame(frameId);
                          }}
                          title="Restore as unique (U)"
                        >
                          <Undo2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {groups.length > 0 && (
        <p className="dedup-keyboard-hint">
          Shortcuts: ↑/↓ groups · ←/→ frames · Enter = representative · D = duplicate · U =
          restore unique
        </p>
      )}
    </div>
  );
};


