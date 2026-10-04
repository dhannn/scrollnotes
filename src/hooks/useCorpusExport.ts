import { useCallback, useMemo, useState } from 'react';
import {
  buildAnnotationsCsv,
  buildAnnotationsJsonl,
  buildExportBundle,
  bundleToZipEntries,
  selectExportableSamples,
  type ExportBundle,
} from '../services/export';
import { validateForExport } from '../services/exportValidation';
import { createZip, downloadBytes } from '../services/zip';
import type {
  DatasetInfo,
  DedupConfig,
  DedupRecord,
  EncounterSample,
  ExportFormat,
  ExportValidation,
  ExtractionRun,
  FrameRecord,
  OcrArtifact,
  RecordingRecord,
} from '../types/schema';

interface UseCorpusExportInput {
  dataset: DatasetInfo;
  encounters: EncounterSample[];
  frames: Map<string, FrameRecord>;
  ocrArtifacts: Map<string, OcrArtifact>;
  dedupConfig: DedupConfig;
  dedupRecords: Map<string, DedupRecord>;
  recordings: RecordingRecord[];
  extractionRuns: ExtractionRun[];
}

const encoder = new TextEncoder();

/**
 * Corpus export (Slice 6)
 * -----------------------
 * Owns the export dialog's state and performs the actual export.
 *
 * Splitting this out of useFieldSession keeps that hook focused on the field session
 * itself. All of the heavy lifting (serialisation, zipping, validation) lives in pure
 * services; this hook only sequences it and reports progress, because the UI must never
 * freeze while 200 images are encoded.
 *
 * Export is explicit and local (AGENTS section 35): it reads the in-memory session, builds
 * a bundle, and triggers a download. Nothing is uploaded and nothing in IndexedDB changes.
 */
export function useCorpusExport(input: UseCorpusExportInput) {
  const [isExporting, setIsExporting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastBundle, setLastBundle] = useState<ExportBundle | null>(null);

  /**
   * The pre-export checklist. Recomputed from current state so the dialog always reflects
   * the session as it is right now, not as it was when the dialog opened.
   */
  const validation: ExportValidation = useMemo(
    () =>
      validateForExport({
        encounters: input.encounters,
        frameIds: new Set(input.frames.keys()),
        ocrFrameIds: new Set(input.ocrArtifacts.keys()),
        dedupRecords: input.dedupRecords,
        dataset: input.dataset,
        extractionRuns: [...input.extractionRuns.values()],
      }),
    [
      input.encounters,
      input.frames,
      input.ocrArtifacts,
      input.dedupRecords,
      input.dataset,
      input.extractionRuns,
    ]
  );

  /** How many samples would actually ship right now. */
  const exportableCount = useMemo(
    () => selectExportableSamples(input.encounters).length,
    [input.encounters]
  );

  const resetStatus = useCallback(() => {
    setErrorMessage(null);
    setProgressLabel(undefined);
  }, []);
/**
   * Build the bundle and download it in the requested format.
   *
   * Errors are surfaced as a readable sentence rather than a thrown DOMException
   * (AGENTS section 39): the researcher needs to know whether data was lost, and here
   * nothing is lost, the download simply did not happen.
   */
  const runExport = useCallback(
    async (format: ExportFormat) => {
      if (isExporting) return;
      setIsExporting(true);
      setErrorMessage(null);

      try {
        const total = exportableCount;
        setProgressLabel(`Preparing ${total} sample${total === 1 ? '' : 's'}...`);

        const bundle = buildExportBundle({
          dataset: input.dataset,
          encounters: input.encounters,
          frames: input.frames,
          ocrArtifacts: input.ocrArtifacts,
          dedupConfig: input.dedupConfig,
          dedupRecords: input.dedupRecords,
          recordings: input.recordings,
          extractionRuns: [...input.extractionRuns.values()],
          exportedAt: new Date().toISOString(),
        });

        setLastBundle(bundle);

        if (bundle.annotations.length === 0) {
          setErrorMessage(
            'Nothing to export. Annotate at least one sample, and make sure its frame image is still stored.'
          );
          return;
        }

        if (bundle.imageErrors.length > 0) {
          // Not fatal: export what is intact and report exactly what could not be read.
          setProgressLabel(
            `${bundle.imageErrors.length} image(s) could not be read and were excluded.`
          );
        }

        const stem = bundle.filenameStem;

        if (format === 'jsonl') {
          setProgressLabel('Writing annotations.jsonl...');
          const text = buildAnnotationsJsonl(bundle.annotations);
          downloadBytes(encoder.encode(text), `${stem}-annotations.jsonl`, 'application/x-ndjson');
          return;
        }

        if (format === 'csv') {
          setProgressLabel('Writing annotations.csv...');
          const text = buildAnnotationsCsv(bundle.annotations);
          downloadBytes(encoder.encode(text), `${stem}-annotations.csv`, 'text/csv');
          return;
        }

        setProgressLabel(`Compressing ${bundle.images.length} image(s)...`);
        // Yield once so the progress state paints before the synchronous zip build.
        await new Promise((resolve) => setTimeout(resolve, 16));
        const zipBytes = createZip(bundleToZipEntries(bundle));
        downloadBytes(zipBytes, `${stem}.zip`, 'application/zip');
      } catch (err) {
        console.error('Corpus export failed:', err);
        setErrorMessage(
          'The dataset could not be written to a file. Nothing was lost: your annotations are still saved locally. Try again, or use the JSONL format if the problem persists.'
        );
      } finally {
        setIsExporting(false);
        setProgressLabel(undefined);
      }
    },
    [isExporting, exportableCount, input]
  );

  return {
    validation,
    exportableCount,
    isExporting,
    progressLabel,
    errorMessage,
    lastBundle,
    runExport,
    resetStatus,
  };
}