import { useState, useRef } from 'react';
import { useFieldSession, GalleryView } from './hooks/useFieldSession';
import { Header } from './components/Header';
import { EncounterGallery } from './components/EncounterGallery';
import { AnnotationCockpit } from './components/AnnotationCockpit';
import { DeduplicationReview } from './components/DeduplicationReview';
import { RecordingImporter } from './components/RecordingImporter';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { DatasetSettingsModal } from './components/DatasetSettingsModal';
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
    setSamplingConfig,
    previewSamplingGrid,
    runFrameExtraction,
    cancelExtraction,
    removeRecording,
  } = useFieldSession();

  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isDatasetSettingsOpen, setIsDatasetSettingsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const hiddenUploadInputRef = useRef<HTMLInputElement>(null);

  // Slice 6 — corpus export. Reads the live session state; writes nothing back.
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

  if (isLoading) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--accent-sky)', fontSize: '0.95rem', fontFamily: 'var(--font-mono)' }}>
          Loading field session...
        </div>
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
        onOpenDatasetSettings={() => setIsDatasetSettingsOpen(true)}
        onLoadSampleBatch={loadSampleBatch}
        onClearSession={clearSession}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        onTriggerUpload={handleTriggerUpload}
        exportableCount={exportableCount}
        exportBlockers={exportBlockers}
        onOpenExport={() => setIsExportOpen(true)}
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
          />
        )}
      </main>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Dataset Settings Modal */}
      <DatasetSettingsModal
        isOpen={isDatasetSettingsOpen}
        datasetInfo={datasetInfo}
        onSave={updateDatasetMetadata}
        onClose={() => setIsDatasetSettingsOpen(false)}
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
