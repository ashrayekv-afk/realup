# Bilateral import repair — 7.1

## Confirmed defects

The archive adapter installed after the original parser replaced its legacy
filename route. Legacy eye/date information could therefore be ignored, forcing
manual association or leaving a blank study. Converted-page discovery also only
ran its title-only fallback when it had zero complete eye pairs: a successful
pair could suppress unmatched reports from the other eye.

The longitudinal review rendered only the intersection of eyes found in both
visits. In the screenshot's earlier-OS/later-OD+OS situation, the later OD values
were present in memory but had no input grid. The numeric payload then included
only the visible paired eye. This was a UI/import-routing issue, not a new model
behavior.

## Implementation

`report_discovery.js` collects complete named groups and separately processes
remaining pages. Legacy OD/OS filenames provide eye and validated examination
timestamps; current PdfReport groups retain their complete source page lists.
Focused eye-region OCR supplements title-strip OCR. Descriptors retain original
paths locally so existing report-map and numerical-source links still work.

Partial reports keep labeled available measurements, flagged for verification.
Missing measurements stay null. Unrecognized legacy groups retain their source
pages and blank six-field cards. A generic archive with no identifiable reports
still offers explicit source association; it does not fabricate numeric inputs.

Anonymous pages are paired only when a unique topometric/Belin pair has a common
printed eye and folder scope. Repeated same-eye candidates and conflicting labels
remain separate for source confirmation. Unknown eyes are never assigned by
assuming every pair of studies must be bilateral. Source selection requires the
operator to verify one patient, one eye and one examination.

`bilateral_review.js` renders both eyes, all available visits, missing-source
cards and unassigned input grids. Selected eyes default to OD+OS. The gate requires
six verified values per selected eye/visit and valid per-eye intervals. The
numeric payload's existing allowlist remains in force. Optional exclusion of one
eye is explicit and does not remove its recovered values.

Visit-specific recovery reuses the already-open local archive and prepopulates
source associations. Matching source identities preserve corrected measurements
and verification. Changed associations invalidate calculation state. Cancelling
source recovery preserves the previous inputs; changing the uploaded file or
clearing the patient still clears the complete source state.

## Completed checks

- Production import routing with controlled OCR covers current, legacy,
  decoded and mixed pages; missing header laterality; one identified eye plus
  unmatched reports; partial measurement recovery; missing report titles;
  same-eye repeats; folder boundaries; offline OCR; cancellation and edit retention.
- Three previously supplied real ZIPs each decoded 26 JPEG report pages into
  two complete named source groups with examination timestamps.
- The production JavaScript crops/parsers were run with native Tesseract on
  the previously supplied January and March ZIPs. Both eyes were recovered in
  both visits; 22/24 values were returned. ARTmax in OS was not automatically
  recovered at either visit and remains blank for source verification. This is
  not a claim of universal OCR accuracy or browser Tesseract parity.
- Production review/verification/submission functions ran in a minimal DOM
  harness: the screenshot's missing-earlier-OD condition retains later-OD inputs
  and blocks silent one-eye submission; complete pairs show 24 inputs and send
  both eyes. Explicit exclusions, edits, verification, interval persistence,
  unknown eyes, same-day blocks, baseline mode and source-recovery cancellation
  were checked. Recovery preserves examination seconds.
- Existing trajectory logic/UI and source-map identity tests passed again.
- Package/runtime comparison confirms the scoring artifacts and computational
  modules are unchanged; interface/export version labels are updated.

## Limits and source coverage

The exact two ZIPs depicted in the September 25 screenshot were not attached to
this request. Their particular layouts cannot be certified from the screenshot.
The root-code defects above were reproduced and corrected, but unreadable or
ambiguous source pages can still require review. No full browser or live
Streamlit end-to-end deployment was run; browser installation was unavailable.

All source ZIPs, source images, native OCR output and private research rows stay
out of the GitHub distribution. Tests use synthetic inputs; optional real-archive
checks accept local paths without including the source data in the package.

## Run

```bash
node tests/test_bilateral_import.cjs
node tests/test_bilateral_review.cjs
node tests/test_trajectory.cjs
node tests/test_trajectory_ui.cjs
python tools/verify_package.py
```

Optional: pass the three earlier supplied 26-page JPEG ZIP paths as arguments
to `test_bilateral_import.cjs` to repeat the source-group checks. This optional
check asserts their known page counts; it does not run OCR or validate new layouts.
