import { useState, useRef, useMemo } from 'react';
import { Info } from 'lucide-react';
import { useFieldSession, GalleryView } from './hooks/useFieldSession';
import { Header } from './components/Header';
import { EncounterGallery } from './components/EncounterGallery';
import { AnnotationCockpit } from './components/AnnotationCockpit';
import { DeduplicationReview } from './components/DeduplicationReview';
import { RecordingImporter } from './components/RecordingImporter';
import { DatasetSetupWizard } from './components/DatasetSetupWizard';
import type { SetupResult } from './components/DatasetSetupWizard';
import { DatasetLifecycleBar } from './components/DatasetLifecycleBar';
import { useDatasetLifecycle } from './hooks/useDatasetLifecycle';
import { useShortcuts } from './hooks/useShortcuts';
import type { ShortcutDef } from './services/shortcuts';
import { QUALITY_FLAG_ORDER } from './services/qualityFlags';
import { QUALITY_FLAG_LABELS } from './types/schema';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ExportDialog } from './components/ExportDialog';
import { useCorpusExport } from './hooks/useCorpusExport';

export function App() {
  const {
    filteredEncounters,
    encounters,
    frames,
    datasetInfo,
    activeEncounter,
    activeFrame,
    activeSampleId,
    activeIndex,
    hasNext,
    hasPrev,
    stats,
    isLoading,
    currentView,
    searchQuery,
    statusFilter,
    platformFilter,
    ugcTypeFilter,
    sortOption,
    dedupFilter,
    hideSuppressedDuplicates,
    setSearchQuery,
    setStatusFilter,
    setPlatformFilter,
    setUgcTypeFilter,
    setSortOption,
    setDedupFilter,
    setHideSuppressedDuplicates,
    setCurrentView,
    openSampleInCockpit,
    goToNext,
    goToPrev,
    nextUnannotatedIndex,
    prevUnannotatedIndex,
    unannotatedCount,
    goToNextUnannotated,
    goToPrevUnannotated,
    goToFirstUnannotated,
    updateDatasetMetadata,
    saveAndNext,
    setSampleStatus,
    ingestImageFiles,
    loadSampleBatch,
    clearSession,
    // OCR (Slice 3)
    ocrArtifacts,
    ocrStatus,
    getOcrArtifact,
    runOcrForFrame,
    runOcrBatch,
    // Deduplication (Slice 4)
    dedupRecords,
    dedupConfig,
    dedupStatus,
    dedupStats,
    runDeduplication,
    setRepresentative,
    markDuplicate,
    restoreFrame,
    setDedupThreshold,
    setDedupAlgorithm,
    // Field sessions (Slice 5)
    recordingList,
    extractionRuns,
    extractionStatus,
    samplingConfig,
    importRecordingFile,
    importRecordings,
    runBulkExtraction,
    setSamplingConfig,
    previewSamplingGrid,
    runFrameExtraction,
    cancelExtraction,
    removeRecording,
  } = useFieldSession();

  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const hiddenUploadInputRef = useRef<HTMLInputElement>(null);
  // Slice 7 §5 — the wizard doubles as the dataset settings editor. `isSetupComplete`
  // is the blocking gate; `isSetupWizardOpen` is the voluntary "edit" open.
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const {
    validation: exportValidation,
    exportableCount,
    isExporting,
    progressLabel: exportProgressLabel,
    errorMessage: exportError,
    runExport,
  } = useCorpusExport({
    dataset: datasetInfo,
    encounters,
    frames,
    ocrArtifacts,
    dedupConfig,
    dedupRecords,
    recordings: recordingList,
    extractionRuns: [...extractionRuns.values()],
    onExportSuccess: () => lifecycle.markExported(),
  });

  // Slice 7 §4 — lifecycle status is DERIVED from corpus facts and auto-persisted, so
  // the header badge, the manifest and the settings panel can never disagree.
  const lifecycle = useDatasetLifecycle({
    dataset: datasetInfo,
    encounters,
    frames,
    dedupRecords,
    validationChecks: exportValidation.checks,
    persistDataset: updateDatasetMetadata,
  });

  // The single next action the machine recommends, per §4.4.
  const SUGGESTED_ACTIONS: Record<string, { label: string; view: GalleryView }> = {
    setup: { label: 'Finish setup', view: 'sessions' },
    sessions: { label: 'Import frames', view: 'sessions' },
    gallery: { label: 'Review candidates', view: 'gallery' },
    dedup: { label: 'Review duplicates', view: 'dedup' },
    cockpit: { label: 'Continue annotating', view: 'cockpit' },
  };
  // The CTA navigates to a view; when annotation work remains we take the researcher
  // straight to the first outstanding sample rather than to a list they must scan.
  const suggestedAction =
    lifecycle.suggestedView === 'gallery' &&
    lifecycle.status !== 'draft' &&
    encounters.length > 0 &&
    lifecycle.facts.annotatedCount >= lifecycle.facts.totalEncounters
      ? null
      : SUGGESTED_ACTIONS[lifecycle.suggestedView] ?? null;

  const handleSuggestedAction = () => {
    if (!suggestedAction) return;
    if (suggestedAction.view === 'cockpit' && goToFirstUnannotated()) return;
    setCurrentView(suggestedAction.view);
  };

  const anyModalOpen =
    isShortcutsOpen || isExportOpen || isSetupWizardOpen || !datasetInfo.isSetupComplete;

  // Slice 7 §7 — every shortcut is data, wired here and nowhere else.
  const shortcuts = useMemo<ShortcutDef[]>(
    () => [
      {
        id: 'save-and-next',
        chords: ['Ctrl+Enter'],
        views: ['cockpit'],
        description: 'Save ground truth & advance to the next sample',
        group: 'annotation',
        handler: () => {
          const form = document.querySelector('form.form-scroll-area') as HTMLFormElement | null;
          form?.requestSubmit();
        },
      },
      {
        id: 'add-ugc-item',
        chords: ['Ctrl+Shift+Enter', 'Alt+N'],
        views: ['cockpit'],
        description: 'Add another UGC item visible in this frame',
        group: 'annotation',
        handler: () => window.dispatchEvent(new CustomEvent('scrollnotes:add-item')),
      },
      {
        id: 'toggle-monospace',
        chords: ['Ctrl+M'],
        views: ['cockpit'],
        description: 'Toggle verbatim monospace transcription font',
        group: 'annotation',
        handler: () => window.dispatchEvent(new CustomEvent('scrollnotes:toggle-monospace')),
      },
      {
        id: 'next',
        bareKey: 'ArrowRight',
        description: 'Next sample',
        group: 'navigation',
        // The Deduplicate view owns the arrow keys for its own group/frame cursor,
        // so they must not double-fire there.
        views: ['gallery', 'cockpit'],
        when: (c) => c.hasNext,
        handler: goToNext,
      },
      {
        id: 'prev',
        bareKey: 'ArrowLeft',
        description: 'Previous sample',
        group: 'navigation',
        views: ['gallery', 'cockpit'],
        when: (c) => c.hasPrev,
        handler: goToPrev,
      },
      {
        id: 'next-unannotated',
        bareKey: 'J',
        description: 'Jump to the next sample needing annotation',
        group: 'navigation',
        when: (c) => c.hasNextUnannotated,
        handler: goToNextUnannotated,
      },
      {
        id: 'prev-unannotated',
        bareKey: 'K',
        description: 'Jump to the previous sample needing annotation',
        group: 'navigation',
        when: (c) => c.hasPrevUnannotated,
        handler: goToPrevUnannotated,
      },
      {
        id: 'accept',
        bareKey: 'A',
        views: ['gallery', 'cockpit'],
        description: 'Accept this candidate into the corpus',
        group: 'curation',
        when: (c) => c.hasActiveSample,
        handler: () => {
          if (activeSampleId) setSampleStatus(activeSampleId, 'annotated', true);
        },
      },
      {
        id: 'reject',
        bareKey: 'R',
        views: ['gallery', 'cockpit'],
        description: 'Reject this candidate',
        group: 'curation',
        when: (c) => c.hasActiveSample,
        handler: () => {
          if (activeSampleId) setSampleStatus(activeSampleId, 'rejected', true);
        },
      },
      {
        id: 'skip',
        bareKey: 'S',
        views: ['gallery', 'cockpit'],
        description: 'Skip this candidate for now',
        group: 'curation',
        when: (c) => c.hasActiveSample,
        handler: () => {
          if (activeSampleId) setSampleStatus(activeSampleId, 'skipped', true);
        },
      },
      {
        id: 'ocr-insert',
        chords: ['Alt+I'],
        views: ['cockpit'],
        description: 'Insert the OCR extract into the targeted content field',
        group: 'ocr',
        handler: () => window.dispatchEvent(new CustomEvent('scrollnotes:ocr-insert')),
      },
      {
        id: 'ocr-run',
        chords: ['Alt+O'],
        views: ['cockpit'],
        description: 'Run or re-run OCR for the active frame',
        group: 'ocr',
        handler: () => activeFrame && runOcrForFrame(activeFrame.id),
      },
      {
        id: 'open-shortcuts',
        bareKey: '?',
        description: 'Show this shortcut reference',
        group: 'dataset',
        handler: () => setIsShortcutsOpen(true),
      },
      {
        id: 'open-export',
        chords: ['Ctrl+Shift+E'],
        description: 'Open the corpus export dialog',
        group: 'dataset',
        handler: () => setIsExportOpen(true),
      },
      ...QUALITY_FLAG_ORDER.map((flag, i) => ({
        id: `flag-${flag}`,
        bareKey: String(i + 1),
        views: ['cockpit'] as ShortcutDef['views'],
        description: `Toggle data quality flag: ${QUALITY_FLAG_LABELS[flag]}`,
        group: 'dataset' as const,
        handler: () => window.dispatchEvent(
          new CustomEvent('scrollnotes:toggle-flag', { detail: flag })
        ),
      })),
    ],
    [
      activeSampleId,
      activeFrame,
      goToNext,
      goToPrev,
      goToNextUnannotated,
      goToPrevUnannotated,
      runOcrForFrame,
      setSampleStatus,
    ]
  );

  useShortcuts(shortcuts, {
    view: currentView,
    modalOpen: anyModalOpen,
    hasActiveSample: activeSampleId !== null,
    hasNext,
    hasPrev,
    hasUnannotated: unannotatedCount > 0,
    hasNextUnannotated: nextUnannotatedIndex !== null && nextUnannotatedIndex !== activeIndex,
    hasPrevUnannotated: prevUnannotatedIndex !== null && prevUnannotatedIndex !== activeIndex,
  });

  const exportBlockers = exportValidation.checks.filter(
    (check) => check.severity === 'fail'
  ).length;

  // Recording-first ingestion: the primary action opens the Sessions view,
  // which owns video import and frame sampling.
  const handleTriggerUpload = () => {
    setCurrentView('sessions');
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      void ingestImageFiles(filesArray);
    }
    e.target.value = '';
  };

  // Slice 7 §5 — completing setup. This is the ONLY place `isSetupComplete` becomes
  // true. The lifecycle status itself is left at 'draft': it is DERIVED from corpus
  // facts (see domain/lifecycle.ts), so writing it here would reintroduce the very
  // discrepancy the machine is meant to prevent.
  const handleSetupComplete = async (result: SetupResult) => {
    await updateDatasetMetadata({
      ...datasetInfo,
      name: result.name,
      version: result.version,
      description: result.description,
      targetMin: result.targetMin,
      targetMax: result.targetMax,
      sampleIdPrefix: result.sampleIdPrefix,
      isSetupComplete: true,
      updatedAt: new Date().toISOString(),
    });
    setIsSetupWizardOpen(false);
    // Only ONBOARDING hands off to an ingest route. When re-editing an existing
    // corpus the researcher must stay where they were — saving a renamed dataset
    // must not yank them into the Sessions view.
    if (datasetInfo.isSetupComplete) return;
    // Import logic belongs to Sessions / the gallery dropzone, not to the wizard.
    setCurrentView(result.route === 'recording' ? 'sessions' : 'gallery');
  };

  if (isLoading) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--accent-sky)', fontSize: '0.95rem', fontFamily: 'var(--font-mono)' }}>
          Loading field session...
        </div>
      </div>
    );
  }

  // Slice 7 §5 — the dataset is the first thing a researcher defines. Until setup is
  // complete the workstation does not open at all: no gallery, no cockpit, no export.
  // This is the "first in the user flow" requirement, enforced rather than suggested.
  if (!datasetInfo.isSetupComplete) {
    return (
      <div className="app-container">
        <DatasetSetupWizard
          datasetInfo={datasetInfo}
          lockSampleIdPrefix={encounters.length > 0}
          onComplete={handleSetupComplete}
        />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Hidden file input for global upload button */}
      <input
        type="file"
        ref={hiddenUploadInputRef}
        onChange={handleFileInputChange}
        multiple
        accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
        style={{ display: 'none' }}
      />

      {/* Global Field Session Header */}
      <Header
        stats={stats}
        datasetInfo={datasetInfo}
        currentView={currentView}
        dedupSuppressedCount={dedupStats.duplicates}
        recordingCount={recordingList.length}
        onViewChange={(view: GalleryView) => setCurrentView(view)}
        // Slice 7 — the wizard supersedes the old settings modal, which is retained only
        // so the (now hidden) dataset parameter edit path stays reachable in history.
        onOpenDatasetSettings={() => setIsSetupWizardOpen(true)}
        onLoadSampleBatch={loadSampleBatch}
        onClearSession={clearSession}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onTriggerUpload={handleTriggerUpload}
        exportableCount={exportableCount}
        exportBlockers={exportBlockers}
        onOpenExport={() => setIsExportOpen(true)}
      />

      {/* Slice 7 §8 — persistent progress + derived lifecycle state */}
      <DatasetLifecycleBar
        status={lifecycle.status}
        explanation={lifecycle.explanation}
        target={lifecycle.target}
        stats={stats}
        suggestedAction={suggestedAction}
        onNavigate={handleSuggestedAction}
      />

      {/* Main View Area */}
      <main className="main-view-area">
        {currentView === 'sessions' ? (
          <RecordingImporter
            recordings={recordingList}
            extractionRuns={extractionRuns}
            extractionStatus={extractionStatus}
            samplingConfig={samplingConfig}
            onImportRecording={importRecordingFile}
            onImportRecordings={importRecordings}
            onRunBulkExtraction={runBulkExtraction}
            onSetSamplingConfig={setSamplingConfig}
            onPreviewGrid={previewSamplingGrid}
            onRunExtraction={runFrameExtraction}
            onCancelExtraction={cancelExtraction}
            onRemoveRecording={removeRecording}
            onExtractionComplete={() => setCurrentView('gallery')}
            onFilesSelected={(files) => void ingestImageFiles(files)}
          />
        ) : currentView === 'dedup' ? (
          <DeduplicationReview
            encounters={encounters}
            frames={frames}
            dedupRecords={dedupRecords}
            dedupConfig={dedupConfig}
            dedupStatus={dedupStatus}
            dedupStats={dedupStats}
            onRunDeduplication={runDeduplication}
            onSetThreshold={setDedupThreshold}
            onSetAlgorithm={setDedupAlgorithm}
            onSetRepresentative={setRepresentative}
            onMarkDuplicate={markDuplicate}
            onRestoreFrame={restoreFrame}
            onSelectSample={openSampleInCockpit}
            modalOpen={anyModalOpen}
          />
        ) : currentView === 'gallery' || encounters.length === 0 ? (
          <EncounterGallery
            encounters={filteredEncounters}
            frames={frames}
            activeSampleId={activeSampleId}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            platformFilter={platformFilter}
            ugcTypeFilter={ugcTypeFilter}
            sortOption={sortOption}
            dedupFilter={dedupFilter}
            hideSuppressedDuplicates={hideSuppressedDuplicates}
            dedupRecords={dedupRecords}
            isOcrRunning={ocrStatus.phase === 'running'}
            ocrArtifactCount={ocrArtifacts.size}
            stats={stats}
            onSearchChange={setSearchQuery}
            onStatusFilterChange={setStatusFilter}
            onPlatformFilterChange={setPlatformFilter}
            onUgcTypeFilterChange={setUgcTypeFilter}
            onSortChange={setSortOption}
            onDedupFilterChange={setDedupFilter}
            onHideSuppressedChange={setHideSuppressedDuplicates}
            onRunOcrBatch={runOcrBatch}
            onSelectSample={openSampleInCockpit}
            onOpenDeduplicate={() => setCurrentView('dedup')}
            onStartAnnotation={() => {
              if (encounters.length > 0) {
                setCurrentView('cockpit');
              }
            }}
            onFilesSelected={ingestImageFiles}
            onLoadSampleBatch={loadSampleBatch}
            onImportRecording={() => setCurrentView('sessions')}
          />
        ) : (
          <>
            {/* Slice 7 §10.2 — say plainly that heavy transcription is a desktop task
                rather than letting a phone-sized cockpit imply otherwise. Scoped to the
                cockpit; it previously leaked onto the gallery. */}
            <div className="cockpit-mobile-notice">
              <Info size={12} />
              <span>
                Small-screen layout: you can set up, curate, flag and export here.
                Detailed transcription is fastest on a desktop with a keyboard.
              </span>
            </div>
            <AnnotationCockpit
              encounter={activeEncounter}
              frame={activeFrame}
              totalEncounters={encounters.length}
              currentIndex={activeIndex}
              hasNext={hasNext}
              hasPrev={hasPrev}
              ocrArtifact={getOcrArtifact(activeFrame?.id)}
              ocrStatus={ocrStatus}
              onRunOcr={runOcrForFrame}
              onSaveAndNext={saveAndNext}
              onSetStatus={setSampleStatus}
              onGoNext={goToNext}
              onGoPrev={goToPrev}
              shortcuts={shortcuts}
            />
          </>
        )}
      </main>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        shortcuts={shortcuts}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Slice 7 — Dataset setup wizard, also used to edit an existing corpus */}
      <DatasetSetupWizard
        isOpen={isSetupWizardOpen}
        datasetInfo={datasetInfo}
        lockSampleIdPrefix={encounters.length > 0}
        onComplete={handleSetupComplete}
        isEditing={datasetInfo.isSetupComplete === true}
        onClose={() => setIsSetupWizardOpen(false)}
      />

      {/* Corpus Export (Slice 6) */}
      <ExportDialog
        isOpen={isExportOpen}
        checks={exportValidation.checks}
        canExport={exportValidation.canExport}
        sampleCount={exportableCount}
        isExporting={isExporting}
        progressLabel={exportProgressLabel}
        errorMessage={exportError}
        onExport={(format) => void runExport(format)}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
  );
}
export default App;
