import React, { useEffect } from 'react';
import {
  EncounterSample,
  FrameRecord,
  Platform,
  EncounterStatus,
  SampleMetadata,
  GroundTruthItem,
  OcrArtifact,
  OcrStatus,
} from '../types/schema';
import { ImageViewer } from './ImageViewer';
import { GroundTruthForm } from './GroundTruthForm';

interface AnnotationCockpitProps {
  encounter: EncounterSample | null;
  frame: FrameRecord | null;
  totalEncounters: number;
  currentIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  ocrArtifact: OcrArtifact | null;
  ocrStatus: OcrStatus;
  onSaveAndNext: (
    sampleId: string,
    fields: {
      platform: Platform;
      items: GroundTruthItem[];
      metadata: SampleMetadata;
    }
  ) => void;
  onRunOcr: (frameId: string) => void;
  onSetStatus: (sampleId: string, status: EncounterStatus, advance: boolean) => void;
  onGoNext: () => void;
  onGoPrev: () => void;
}

export const AnnotationCockpit: React.FC<AnnotationCockpitProps> = ({
  encounter,
  frame,
  totalEncounters,
  currentIndex,
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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        if (encounter) {
          const form = document.querySelector('form.form-scroll-area') as HTMLFormElement;
          if (form) {
            form.requestSubmit();
          }
        }
      }

      if (!isInput) {
        if (e.key === 'ArrowLeft' && hasPrev) {
          e.preventDefault();
          onGoPrev();
        } else if (e.key === 'ArrowRight' && hasNext) {
          e.preventDefault();
          onGoNext();
        } else if (e.key.toLowerCase() === 'r' && encounter) {
          e.preventDefault();
          onSetStatus(encounter.sampleId, 'rejected', true);
        } else if (e.key.toLowerCase() === 's' && encounter) {
          e.preventDefault();
          onSetStatus(encounter.sampleId, 'skipped', true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [encounter, hasNext, hasPrev, onGoNext, onGoPrev, onSetStatus]);

  if (!encounter) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        No active encounter selected. Select a frame from the gallery to begin.
      </div>
    );
  }

  const totalIndexStr = `${currentIndex + 1} of ${totalEncounters}`;

  return (
    <div className="cockpit-container">
      {/* Left Stage: Frame Visual Evidence */}
      <ImageViewer
        frame={frame}
        provenance={encounter.provenance}
        sampleId={encounter.sampleId}
        totalIndexStr={totalIndexStr}
      />

      {/* Right Panel: Human Ground Truth Multi-Item Stack Cockpit */}
      <GroundTruthForm
        encounter={encounter}
        hasNext={hasNext}
        hasPrev={hasPrev}
        ocrArtifact={ocrArtifact}
        ocrStatus={ocrStatus}
        onRunOcr={onRunOcr}
        onSaveAndNext={onSaveAndNext}
        onSetStatus={onSetStatus}
        onGoNext={onGoNext}
        onGoPrev={onGoPrev}
      />
    </div>
  );
};
