# Scrollnotes

*A fieldwork instrument for documenting, annotating, and curating social-media UGC.*

Scrollnotes is a local-first React application for building a curated, provenance-preserving
corpus of social-media user-generated content. Researchers import frames or recordings, run
Tesseract OCR as preprocessing evidence, curate candidates, write human ground truth, and
export a reproducible dataset (`images/` + `annotations.jsonl` + `ocr.jsonl` + `manifest.json`).

## Principles

- **Human annotation is ground truth.** OCR is a suggestion, never an authority, and never
  overwrites existing annotation.
- **Recordings are provenance containers, not semantic categories.** Platform is a sample-level
  property, verified from what is actually visible.
- **Nothing is silently discarded.** Deduplication is conservative and reversible.

See `AGENTS.md` for the full product specification.

## Tech

React 19 · TypeScript · Vite · IndexedDB (via `idb`) · `tesseract.js` OCR

## Getting started

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

## Verification suites

Each development slice has a runnable verification script:

```bash
npm run verify           # all slices
npm run verify:slice1    # annotation prototype
npm run verify:slice2    # dataset management
npm run verify:slice3    # OCR
npm run verify:slice4    # deduplication
npm run verify:slice5    # recording / frame extraction
npm run verify:slice6    # export
```

## Privacy

All data stays local. No telemetry, no analytics, no third-party image hosting, no automatic
upload. Export is always explicit.