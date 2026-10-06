import React, { useState, useEffect } from 'react';
import { FrameRecord, Provenance } from '../types/schema';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Sparkles } from 'lucide-react';

interface ImageViewerProps {
  frame: FrameRecord | null;
  provenance: Provenance;
  sampleId: string;
  totalIndexStr: string;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  frame,
  provenance,
  sampleId,
  totalIndexStr,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isHighContrast, setIsHighContrast] = useState<boolean>(false);

  // Reset zoom & pan when sample changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [sampleId]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 4));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const handleActualSize = () => {
    setZoom(1.5);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="visual-stage">
      {/* Top Toolbar */}
      <div className="stage-toolbar">
        <div className="stage-sample-badge">
          <span>SAMPLE:</span>
          <strong>{sampleId}</strong>
          <span style={{ color: 'var(--text-dim)' }}>({totalIndexStr})</span>
        </div>

        <div className="stage-tools">
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            disabled={zoom <= 0.5}
          >
            <ZoomOut size={15} />
          </button>
          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', minWidth: '40px', textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleZoomIn}
            title="Zoom In (+)"
            disabled={zoom >= 4}
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleResetZoom}
            title="Fit to Screen"
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleActualSize}
            title="Inspect 1.5x"
          >
            <Maximize2 size={15} />
          </button>
          <button
            className={`btn btn-ghost btn-icon btn-sm ${isHighContrast ? 'btn-primary' : ''}`}
            onClick={() => setIsHighContrast(!isHighContrast)}
            title="Toggle OCR Contrast Mode"
          >
            <Sparkles size={15} />
          </button>
        </div>
      </div>

      {/* Main Viewport Stage */}
      <div
        className={`stage-viewport ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {frame && frame.dataUrl ? (
          <img
            src={frame.dataUrl}
            alt={sampleId}
            className="stage-image"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              filter: isHighContrast ? 'contrast(135%) brightness(110%)' : 'none',
            }}
            draggable={false}
          />
        ) : (
          <div style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
            {frame ? 'Loading frame…' : 'No visual frame available'}
          </div>
        )}
      </div>

      {/* Provenance Footer Strip */}
      <div className="provenance-strip">
        <span>FRAME: {provenance.frameFilename || 'frame_source'}</span>
        {provenance.timestampMs !== undefined && (
          <span>TIME: {(provenance.timestampMs / 1000).toFixed(1)}s</span>
        )}
        {provenance.recordingId && <span>REC: {provenance.recordingId}</span>}
      </div>
    </div>
  );
};
