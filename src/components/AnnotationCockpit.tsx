import React from 'react';
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
import { TouchActionBar } from './TouchActionBar';
import type { ShortcutDef } from '../services/shortcuts';

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
  /** Slice 7 §10.5 — the live registry, so the touch bar mirrors the key map. */
  shortcuts: ShortcutDef[];
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
  shortcuts,
}) => {
  // Slice 7 §7 — keyboard handling moved to the central registry in App.tsx. Keeping a
  // local listener here meant Esc and the navigation keys were bound in several places.

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

      {/* Slice 7 §10.5 — coarse-pointer equivalents of the keyboard map. */}
      <TouchActionBar
        shortcuts={shortcuts}
        disabled={{ prev: !hasPrev, next: !hasNext }}
      />
    </div>
  );
};
