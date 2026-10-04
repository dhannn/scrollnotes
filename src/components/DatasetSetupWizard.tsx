
import React, { useState, useEffect } from 'react';
import {
  Compass,
  Target,
  Video,
  Images,
  ArrowRight,
  ArrowLeft,
  Check,
  Tag,
  X,
} from 'lucide-react';
import type { DatasetInfo } from '../types/schema';

/**
 * Dataset setup wizard (Slice 7 §5)
 * --------------------------------
 * A dataset is the FIRST-CLASS object of this tool, so defining one is the first
 * thing a researcher does. The wizard is a modal stack rather than a route: the
 * app is a single-view workstation and adding react-router for four steps would be
 * a dependency it does not need (§4).
 *
 * The researcher never leaves the app (§38). Step 3 explains the two ingest
 * routes and then HANDS OFF to the destination view rather than launching the
 * import itself — import logic belongs to Sessions/RecordingImporter, not here.
 */

export type IngestRoute = 'recording' | 'images';

export interface SetupResult {
  name: string;
  version: string;
  description: string;
  targetMin: number;
  targetMax: number;
  sampleIdPrefix: string;
  /** Which view the researcher should land on after setup. */
  route: IngestRoute;
}

interface DatasetSetupWizardProps {
  datasetInfo: DatasetInfo;
  /** True when samples already exist, which locks the ID prefix (§21). */
  lockSampleIdPrefix: boolean;
  onComplete: (result: SetupResult) => void;
  /** Re-opening setup to edit an existing dataset. */
  isEditing?: boolean;
  /** False renders nothing; the onboarding gate uses an always-open wizard. */
  isOpen?: boolean;
  /** Close request from the overlay / X button. Ignored during onboarding. */
  onClose?: () => void;
}

const STEPS = ['Identity', 'Scale', 'Ingest', 'Review'] as const;

export const DatasetSetupWizard: React.FC<DatasetSetupWizardProps> = ({
  datasetInfo,
  lockSampleIdPrefix,
  onComplete,
  isEditing = false,
  isOpen = true,
  onClose,
}) => {
  // The parent's `isOpen` is the single source of truth. An earlier version kept a
  // local `dismissed` flag, which both latched shut on first close AND sat before the
  // form state hooks below — an early `return null` above `useState` breaks the Rules
  // of Hooks, so opening the wizard changed the hook count and crashed the app.
  const [step, setStep] = useState(0);
  const [name, setName] = useState(datasetInfo.name);
  const [version, setVersion] = useState(datasetInfo.version);
  const [description, setDescription] = useState(datasetInfo.description);
  const [targetMin, setTargetMin] = useState(datasetInfo.targetMin ?? 150);
  const [targetMax, setTargetMax] = useState(datasetInfo.targetMax ?? 200);
  const [prefix, setPrefix] = useState(datasetInfo.sampleIdPrefix || 'ugc');
  const [route, setRoute] = useState<IngestRoute>('recording');

  const trimmedName = name.trim();
  const trimmedVersion = version.trim();
  const canContinue = trimmedName.length > 0 && trimmedVersion.length > 0;
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    onComplete({
      name: trimmedName || 'Untitled Dataset',
      version: trimmedVersion || 'v0.1',
      description: description.trim(),
      targetMin: Math.max(1, Math.min(targetMin, targetMax)),
      targetMax: Math.max(1, Math.max(targetMin, targetMax)),
      sampleIdPrefix: lockSampleIdPrefix
        ? datasetInfo.sampleIdPrefix
        : prefix.trim() || 'ugc',
      route,
    });
  };

  // Re-seed the form from current dataset values on every OPEN, so editing always
  // reflects what is stored rather than a stale first-mount snapshot.
  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setName(datasetInfo.name);
    setVersion(datasetInfo.version);
    setDescription(datasetInfo.description);
    setTargetMin(datasetInfo.targetMin ?? 150);
    setTargetMax(datasetInfo.targetMax ?? 200);
    setPrefix(datasetInfo.sampleIdPrefix || 'ugc');
  }, [isOpen]);

  // All hooks are above this line — returning early before them breaks the Rules of Hooks.
  if (!isOpen) return null;

  // During onboarding the wizard is a gate and cannot be dismissed; once the dataset
  // exists it behaves like any other dialog.
  const requestClose = () => {
    if (!isEditing) return;
    onClose?.();
  };

  return (
    <div
      className="modal-overlay setup-overlay"
      onClick={requestClose}
    >
      <div
        className="modal-dialog setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Dataset setup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Compass size={18} style={{ color: 'var(--accent-cyan)' }} />
            <h3 className="modal-title">
              {isEditing ? 'Dataset Settings' : 'Define your corpus'}
            </h3>
          </div>
          {isEditing && (
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={requestClose}
              aria-label="Close dataset settings"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Step rail */}
        <div className="setup-steps" role="list">
          {STEPS.map((label, i) => (
            <div
              key={label}
              role="listitem"
              className={`setup-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            >
              <span className="setup-step-index">{i < step ? <Check size={11} /> : i + 1}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>

        <div className="modal-body setup-body">
          {step === 0 && (
            <div className="setup-pane">
              <h4 className="setup-pane-title">What are you building?</h4>
              <p className="setup-pane-lede">
                Scrollnotes keeps research data on this machine only (§35). Nothing is
                uploaded, and every sample keeps a link back to the frame it came from.
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="setup-name">
                  <span>Dataset name</span>
                </label>
                <input
                  id="setup-name"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Social Media UGC Benchmark"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="setup-version">
                  <span>Version</span>
                </label>
                <input
                  id="setup-version"
                  className="form-input"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="v0.1"
                />
              </div>
              <div className="form-group">
                <label className="form-label"><span>Research purpose</span></label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What will this corpus be used to evaluate? This is copied into the exported manifest."
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="setup-pane">
              <h4 className="setup-pane-title">Scale and identity</h4>
              <div className="form-group">
                <label className="form-label" htmlFor="setup-target-min">
                  <Target size={13} />
                  <span>Intended corpus size</span>
                </label>
                <div className="setup-range-row">
                  <input
                    id="setup-target-min"
                    type="number"
                    className="form-input"
                    value={targetMin}
                    min={1}
                    max={10000}
                    onChange={(e) => setTargetMin(parseInt(e.target.value) || 1)}
                    aria-label="Minimum intended samples"
                  />
                  <span className="setup-range-dash">to</span>
                  <input
                    type="number"
                    className="form-input"
                    value={targetMax}
                    min={1}
                    max={10000}
                    onChange={(e) => setTargetMax(parseInt(e.target.value) || 1)}
                    aria-label="Maximum intended samples"
                  />
                </div>
                <span className="form-helper">
                  A planning range, not a quota. Fieldwork rarely hits a predicted number,
                  and building 120 careful samples is a legitimate outcome — it gets
                  recorded in the manifest rather than blocked.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="setup-prefix">
                  <Tag size={13} />
                  <span>Sample ID prefix</span>
                </label>
                <input
                  id="setup-prefix"
                  className="form-input"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  disabled={lockSampleIdPrefix}
                />
                {lockSampleIdPrefix ? (
                  <span className="form-helper">
                    Locked: samples already exist, and changing the prefix would break
                    sample-ID stability (§21).
                  </span>
                ) : (
                  <span className="form-helper">
                    Yields {(prefix.trim() || 'ugc')}-000001, {(prefix.trim() || 'ugc')}-000002…
                  </span>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="setup-pane">
              <h4 className="setup-pane-title">How will you capture encounters?</h4>
              <p className="setup-pane-lede">
                Both routes produce identical samples. A recording is a provenance
                container, not a platform category — one recording may contain Reddit,
                TikTok, Instagram and X in sequence (§5).
              </p>
              <div className="setup-route-grid">
                <button
                  type="button"
                  className={`setup-route ${route === 'recording' ? 'selected' : ''}`}
                  onClick={() => setRoute('recording')}
                  aria-pressed={route === 'recording'}
                >
                  <Video size={18} />
                  <span className="setup-route-title">Import a recording</span>
                  <span className="setup-route-desc">
                    Screen-record your browsing, then sample frames at a fixed interval.
                    Recommended: provenance and timestamps stay automatic.
                  </span>
                </button>
                <button
                  type="button"
                  className={`setup-route ${route === 'images' ? 'selected' : ''}`}
                  onClick={() => setRoute('images')}
                  aria-pressed={route === 'images'}
                >
                  <Images size={18} />
                  <span className="setup-route-title">Drop pre-extracted images</span>
                  <span className="setup-route-desc">
                    Already have screenshots? Drop them straight into the gallery.
                    Useful when frames were extracted by an external script.
                  </span>
                </button>
              </div>
              <p className="setup-pane-lede">
                Heavy transcription is a desktop task. On a small screen you can set up,
                curate, flag and export — but the annotation cockpit is built for a
                keyboard and a large display.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="setup-pane">
              <h4 className="setup-pane-title">Ready to create this corpus</h4>
              <dl className="setup-review">
                <div><dt>Name</dt><dd>{trimmedName || 'Untitled Dataset'}</dd></div>
                <div><dt>Version</dt><dd>{trimmedVersion || 'v0.1'}</dd></div>
                <div><dt>Intended size</dt><dd>{targetMin}–{targetMax} samples (advisory)</dd></div>
                <div>
                  <dt>ID prefix</dt>
                  <dd>{lockSampleIdPrefix ? datasetInfo.sampleIdPrefix : (prefix.trim() || 'ugc')}</dd>
                </div>
                <div>
                  <dt>Starts in</dt>
                  <dd>
                    {route === 'recording'
                      ? 'Sessions — import a recording'
                      : 'Gallery — drop images'}
                  </dd>
                </div>
                {description.trim() && (
                  <div><dt>Purpose</dt><dd>{description.trim()}</dd></div>
                )}
              </dl>
              <p className="setup-pane-lede">
                You can change any of this later from the header. The corpus starts in{' '}
                <strong>Draft</strong> and advances on its own as you curate, annotate and
                export — you will not need to set its status by hand.
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer setup-footer">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
          ) : (
            <span />
          )}
          {isLast ? (
            <button type="button" className="btn btn-primary" onClick={finish} disabled={!canContinue}>
              <Check size={14} />
              <span>{isEditing ? 'Save changes' : 'Create corpus'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep(step + 1)}
              disabled={!canContinue}
            >
              <span>Continue</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
