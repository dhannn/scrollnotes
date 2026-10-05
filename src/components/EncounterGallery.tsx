import React, { useState } from 'react';
import {
  EncounterSample,
  FrameRecord,
  SessionStats,
  Platform,
  UGCType,
  DedupRecord,
  DedupFilterOption,
} from '../types/schema';
import { StatusFilterOption, SortOption } from '../hooks/useFieldSession';
import { EncounterCard } from './EncounterCard';
import { Dropzone } from './Dropzone';
import {
  Search,
  Filter,
  Play,
  X,
  Flag,
  ArrowUpDown,
  Layers,
  PieChart,
  Fingerprint,
  EyeOff,
  ScanText,
  ChevronDown,
} from 'lucide-react';

interface EncounterGalleryProps {
  encounters: EncounterSample[];
  frames: Map<string, FrameRecord>;
  activeSampleId: string | null;
  searchQuery: string;
  statusFilter: StatusFilterOption;
  platformFilter: 'all' | Platform;
  ugcTypeFilter: 'all' | UGCType;
  sortOption: SortOption;
  dedupFilter: DedupFilterOption;
  hideSuppressedDuplicates: boolean;
  dedupRecords: Map<string, DedupRecord>;
  isOcrRunning: boolean;
  ocrArtifactCount: number;
  stats: SessionStats;
  onSearchChange: (q: string) => void;
  onStatusFilterChange: (status: StatusFilterOption) => void;
  onPlatformFilterChange: (platform: 'all' | Platform) => void;
  onUgcTypeFilterChange: (ugcType: 'all' | UGCType) => void;
  onSortChange: (sort: SortOption) => void;
  onDedupFilterChange: (filter: DedupFilterOption) => void;
  onHideSuppressedChange: (hide: boolean) => void;
  onRunOcrBatch: () => void;
  onSelectSample: (sampleId: string) => void;
  onOpenDeduplicate: () => void;
  onStartAnnotation: () => void;
  onFilesSelected: (files: File[]) => void;
  onLoadSampleBatch: () => void;
  /** Recording-first ingestion: opens the Field Sessions view. */
  onImportRecording: () => void;
}

const PLATFORMS: { id: 'all' | Platform; label: string }[] = [
  { id: 'all', label: 'All Platforms' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'x', label: 'X' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'threads', label: 'Threads' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'other', label: 'Other' },
];

const UGC_TYPES: { id: 'all' | UGCType; label: string }[] = [
  { id: 'all', label: 'All Types' },
  { id: 'original-post', label: 'Post' },
  { id: 'comment', label: 'Comment' },
  { id: 'reply', label: 'Reply' },
  { id: 'story-reel', label: 'Story/Reel' },
  { id: 'quoted-post', label: 'Quote' },
  { id: 'standalone', label: 'Standalone' },
];

export const EncounterGallery: React.FC<EncounterGalleryProps> = ({
  encounters,
  frames,
  activeSampleId,
  searchQuery,
  statusFilter,
  platformFilter,
  ugcTypeFilter,
  sortOption,
  dedupFilter,
  hideSuppressedDuplicates,
  dedupRecords,
  isOcrRunning,
  ocrArtifactCount,
  stats,
  onSearchChange,
  onStatusFilterChange,
  onPlatformFilterChange,
  onUgcTypeFilterChange,
  onSortChange,
  onDedupFilterChange,
  onHideSuppressedChange,
  onRunOcrBatch,
  onSelectSample,
  onOpenDeduplicate,
  onStartAnnotation,
  onFilesSelected,
  onLoadSampleBatch,
  onImportRecording,
}) => {
  /**
   * Mobile filter disclosure (Slice 7 §10). Declared ABOVE the empty-corpus early
   * return on purpose: the static hook-order guard requires every hook to sit above
   * an early return, and this component has one.
   *
   * On a phone the five filter groups stack into ~24 pills and push the actual
   * frame grid off-screen (measured: the grid began at ~91% of viewport height in
   * screenshots/mobile-390-gallery-populated.png). Rather than shrink them, the
   * toolbar collapses: only search/sort/actions stay, and the groups hide behind
   * this disclosure. Desktop is unaffected — CSS decides, not this state.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * How many filters are set to a NON-default value. Drives the "Filters (2)"
   * badge so hidden state is still visible without opening the panel — hiding the
   * groups must not silently hide the fact that the view is filtered.
   */
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (platformFilter !== 'all' ? 1 : 0) +
    (ugcTypeFilter !== 'all' ? 1 : 0) +
    (dedupFilter !== 'all' ? 1 : 0) +
    (hideSuppressedDuplicates ? 1 : 0);

  if (stats.total === 0) {
    return (
      <div style={{ padding: '2rem', height: '100%', overflowY: 'auto' }}>
        <Dropzone
          onFilesSelected={onFilesSelected}
          onLoadSampleBatch={onLoadSampleBatch}
          onImportRecording={onImportRecording}
        />
      </div>
    );
  }

  return (
    <div className="gallery-container">
      {/* Search & Top Toolbar */}
      <div className="gallery-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.85rem' }}>
        {/* Row 1: Search Bar & Primary Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          {/* Search Input */}
          <div className="search-bar-wrap" style={{ flex: '1', minWidth: '260px', maxWidth: '480px' }}>
            <Search size={15} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search text across all items, authors, sample IDs, filenames..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {searchQuery && (
              <button
                className="btn btn-ghost btn-icon btn-sm search-clear-btn"
                onClick={() => onSearchChange('')}
                title="Clear Search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Sort Dropdown & Action CTA */}
          <div className="gallery-actions-row" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <ArrowUpDown size={14} style={{ color: 'var(--text-dim)' }} />
              <select
                className="form-input"
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', width: 'auto' }}
                value={sortOption}
                onChange={(e) => onSortChange(e.target.value as SortOption)}
              >
                <option value="default">Sort: Import Sequence</option>
                <option value="sample-id">Sort: Sample ID</option>
                <option value="platform">Sort: Platform</option>
                <option value="status">Sort: Status</option>
                <option value="newest">Sort: Recently Modified</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Layers size={14} style={{ color: 'var(--text-dim)' }} />
              <select
                className="form-input"
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', width: 'auto' }}
                value={ugcTypeFilter}
                onChange={(e) => onUgcTypeFilterChange(e.target.value as 'all' | UGCType)}
              >
                {UGC_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile filter disclosure. Hidden on desktop by CSS, where the
                groups below stay permanently expanded. */}
            <button
              className="gallery-filter-toggle"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="gallery-filter-groups"
            >
              <Filter size={15} />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="gallery-filter-count">{activeFilterCount}</span>
              )}
              <ChevronDown
                size={14}
                className={filtersOpen ? 'gallery-filter-caret open' : 'gallery-filter-caret'}
              />
            </button>

            <button className="btn btn-primary btn-sm" onClick={onStartAnnotation}>
              <Play size={14} />
              <span>Annotate Session</span>
            </button>

            <button
              className="btn btn-ghost btn-sm"
              onClick={onRunOcrBatch}
              disabled={isOcrRunning}
              title={
                isOcrRunning
                  ? 'OCR is running on this session…'
                  : `Generate OCR traces for the ${Math.max(0, stats.total - ocrArtifactCount)} frame(s) that have none`
              }
            >
              <ScanText size={14} />
              <span>
                {isOcrRunning ? 'OCR running…' : 'OCR all frames'}
              </span>
            </button>

            <button
              className="btn btn-ghost btn-sm"
              onClick={onOpenDeduplicate}
              title="Review near-duplicate frames"
            >
              <Fingerprint size={14} />
              <span>Deduplicate</span>
            </button>
          </div>
        </div>

        {/* Row 2: Status, Platform & Dedup filter pills.
            Collapsible on phones — see §10 gallery chrome budget. On desktop CSS
            keeps this permanently expanded and ignores `data-open`. */}
        <div
          className="gallery-filter-groups"
          id="gallery-filter-groups"
          data-open={filtersOpen ? 'true' : 'false'}
        >

        {/* Status & Platform Filter Pills */}
        <div className="gallery-filter-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Status Filter Group */}
          <div className="filter-group">
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Filter size={13} /> Status:
            </span>
            <button
              className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('all')}
            >
              <span>All</span>
              <span className="filter-count">{stats.total}</span>
            </button>
            <button
              className={`filter-btn ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('pending')}
            >
              <span>Pending</span>
              <span className="filter-count" style={{ color: 'var(--status-pending-text)' }}>
                {stats.pending}
              </span>
            </button>
            <button
              className={`filter-btn ${statusFilter === 'annotated' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('annotated')}
            >
              <span>Curated</span>
              <span className="filter-count" style={{ color: 'var(--status-annotated-text)' }}>
                {stats.annotated}
              </span>
            </button>
            <button
              className={`filter-btn ${statusFilter === 'multi-item' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('multi-item')}
              title="Filter to frames containing 2 or more UGC items (e.g. Twitter/Reddit threads)"
            >
              <Layers size={11} />
              <span>Multi-Item</span>
            </button>
            <button
              className={`filter-btn ${statusFilter === 'skipped' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('skipped')}
            >
              <span>Skipped</span>
              <span className="filter-count">{stats.skipped}</span>
            </button>
            <button
              className={`filter-btn ${statusFilter === 'rejected' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('rejected')}
            >
              <span>Rejected</span>
              <span className="filter-count">{stats.rejected}</span>
            </button>
            <button
              className={`filter-btn ${statusFilter === 'flagged' ? 'active' : ''}`}
              onClick={() => onStatusFilterChange('flagged')}
              style={{
                borderColor: statusFilter === 'flagged' ? 'var(--accent-rose)' : undefined,
                color: statusFilter === 'flagged' ? '#fff' : 'var(--status-rejected-text)',
              }}
            >
              <Flag size={11} />
              <span>Flagged</span>
              <span className="filter-count" style={{ color: 'var(--status-rejected-text)' }}>
                {stats.flagged}
              </span>
            </button>
          </div>

          {/* Platform Filter Group */}
          <div className="filter-group">
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Platform:</span>
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {PLATFORMS.map((p) => {
                const count = p.id === 'all' ? stats.total : stats.platformCounts[p.id] || 0;
                if (p.id !== 'all' && count === 0) return null;
                return (
                  <button
                    key={p.id}
                    className={`platform-pill ${platformFilter === p.id ? 'selected' : ''}`}
                    onClick={() => onPlatformFilterChange(p.id)}
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                  >
                    <span>{p.label}</span>
                    <span style={{ opacity: 0.65, marginLeft: '3px' }}>({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Deduplication Filter Group */}
          <div className="filter-group">
            <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Fingerprint size={13} /> Dedup:
            </span>
            {(['all', 'unique', 'representative', 'duplicate'] as const).map((option) => (
              <button
                key={option}
                className={`filter-btn ${dedupFilter === option ? 'active' : ''}`}
                onClick={() => onDedupFilterChange(option)}
                title={
                  option === 'all'
                    ? 'Show all frames regardless of deduplication role'
                    : `Show only ${option} frames`
                }
              >
                <span style={{ textTransform: 'capitalize' }}>{option === 'all' ? 'All' : option}</span>
              </button>
            ))}
            <button
              className={`filter-btn ${hideSuppressedDuplicates ? 'active' : ''}`}
              onClick={() => onHideSuppressedChange(!hideSuppressedDuplicates)}
              title="Hide frames suppressed as near-duplicates (reversible in the Deduplicate view)"
            >
              <EyeOff size={11} />
              <span>Hide suppressed</span>
            </button>
          </div>
        </div>
        </div>

        {/* Row 3: Platform & Multi-Item Summary Strip.
            `.distribution-strip` is hidden on phones — it restates platform
            counts a third time (§36 dashboard overload); the platform pills
            already carry them. */}
        <div className="distribution-strip">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            <PieChart size={13} />
            <span>Fieldwork Distribution ({stats.totalItems} Total UGC Items in {stats.total} Frames):</span>
          </div>
          <div className="distribution-badges">
            {Object.entries(stats.platformCounts).map(([plat, count]) => {
              if (count === 0) return null;
              return (
                <span key={plat} className="distribution-chip">
                  <span className="dist-plat-name">{plat}:</span>
                  <strong className="dist-plat-val">{count}</strong>
                </span>
              );
            })}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            Showing <strong>{encounters.length}</strong> candidate frames
          </div>
        </div>
      </div>

      {/* Grid of Frames */}
      <div className="gallery-grid-scroll">
        {encounters.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>
              No matching candidate frames found
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              Try adjusting your search query or relaxing your filters.
            </p>
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '1rem' }}
              onClick={() => {
                onSearchChange('');
                onStatusFilterChange('all');
                onPlatformFilterChange('all');
                onUgcTypeFilterChange('all');
                onDedupFilterChange('all');
                onHideSuppressedChange(false);
              }}
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="gallery-grid">
            {encounters.map((encounter) => {
              const dedupRecord = dedupRecords.get(encounter.frameId);
              return (
                <EncounterCard
                  key={encounter.sampleId}
                  encounter={encounter}
                  frame={frames.get(encounter.frameId)}
                  dedupRole={dedupRecord?.role}
                  dedupOf={dedupRecord?.representativeFrameId}
                  isActive={encounter.sampleId === activeSampleId}
                  onSelect={onSelectSample}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
