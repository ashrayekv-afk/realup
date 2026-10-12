# Second local OCR reader — 7.9

## Processing and acceptance

1. Existing report discovery identifies eye, examination and labelled field regions. Existing primary OCR, independent printed-source checks and mathematical checks run first.
2. Unresolved fields with a bound numeric box and label get a second pass using `tessdata_best` English LSTM weights. It rereads the label and four numeric image variants with the literal decimal token intact. No candidate value is supplied to steer recognition.
3. Automatic acceptance requires at least two matching secondary numeric readings at OCR confidence ≥85; a matching secondary label at ≥85; a supporting primary numeric read and label at ≥80; and no competing secondary value at ≥60 or primary value at ≥80. Confidence cutoffs are engineering heuristics, not calibrated error probabilities.
4. The complete original integrity rules run again. A distinct printed report disagreeing, an ARTmax identity conflict, or an anatomical/field consistency failure prevents automatic confirmation. ARTmax uses the rounded thickness/PPImax relationship; it is not inferred from an unverified denominator.
5. Remaining exceptions show candidate buttons above the source crop. A deliberate candidate selection confirms the displayed value only when no live consistency warning remains. Typing, a missing crop or a mathematical conflict still requires explicit acknowledgement. Relevant edits revoke stale confirmation.

Two models inspecting one crop remain **one printed source**. The badge is **Two readers agree**, not an assertion of independent source verification. Both readers share Tesseract LSTM architecture and may make correlated errors. This does not independently verify the eye, examination date or patient identity; existing association gates remain.

## Runtime

- Primary model is unchanged at `ocr_data/eng.traineddata`.
- Added model is `tessdata_best` English, tag `4.1.0`, bundled in `ocr_second/eng.traineddata`.
- SHA-256: `8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba`.
- Tesseract.js/core remain pinned at 7.0.0. The secondary float model uses the portable non-SIMD LSTM core: browser testing found a missing DotProductSSE function in the automatically selected relaxed-SIMD build. This trades speed for compatibility on this small exception-only pass.
- One lazy worker is reused and secondary jobs are serialized. Model caches cannot substitute primary weights. Initialization times out after 45 seconds; failures fall back to manual review. Clearing the patient terminates the worker and invalidates pending results.
- No external AI API, credentials or report-image upload. Static OCR runtime files still load from their pinned CDN; model bytes are served with the app. Numeric calculator inputs still go to the Streamlit backend under the existing privacy policy.

## Verification limits

Regression tests cover matching and conflicting readings, strict decimal parsing, label binding, independent-source accounting, mathematical vetoes, worker lifecycle, candidate precision and UI confirmation. A real browser synthetic crop exercise checks runtime model compatibility and conservative fallback. It is not a clinical extraction-accuracy study. No original Pentacam report ZIP was available in this update to measure the change in manual-review frequency.

Validate on a representative labelled set of supported exports before relying on the automatic confirmation rate. OCR agreement is useful evidence, but cannot guarantee correctness or 6/6 extraction for every report.
