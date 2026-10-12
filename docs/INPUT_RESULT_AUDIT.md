> Deployment-only packaging note: this document is retained from the original release. Preview images, development tests and raw evidence logs referenced here are in the original full archive, not this 58-file upload. Runtime app files are unchanged.

# Input-to-result audit

## Release 4.1 addendum

The original 4.0 audit below is retained as historical background. Release 4.1 preserves its snapshot/feature checks and adds one-click submission directly from step 3. OS Kmax 60.7 remains tested through the named model feature and explanation. The bottom report gallery now follows the same eye/visit/repeat selection as those measurements. Unknown quality and treatment status no longer block calculation and are not asserted to be acceptable or untreated; their warnings remain in the result. See the current TEST_REPORT.md for 107 checks and their actual limits.


## Observed discrepancy

The supplied purple-interface screenshots show **OS Kmax = 60.7 D** in the confirmed Measurements panel (`IMG_5261.jpeg`), but **OS Baseline Kmax = 37.10** in Main reasons (`IMG_5265.jpeg`). Those are different values. The associated old OD/OS scores were 13/100 and 8/100.

The images establish a visible mismatch, not which historical request actually reached the deployed model. The historical session, full request/response logs, and the exact historical model bundle were not available together. The precise historical cause and validity of those old scores cannot be conclusively reconstructed from the screenshots alone.

The recovered older Python interface only replaced its integrated payload after submission and had no corresponding complete dirty-state lifecycle. A stale payload is therefore a plausible failure path, not a proven retrospective diagnosis. Extraction errors, mismatched selected studies, or stale cached results must also be considered.

## Changes implemented

### Browser review → submitted values

The current editable review controls are read again immediately before sending values. A manually edited field is saved to its selected study and must be verified. Calculation no longer relies on a cached `state.payload` that predates the latest edit. Eye and visit fields have separate identities.

Source changes, reprocessing, analysis-mode changes, and reset events invalidate imported results. Switching to manual entry clears the old source-derived form rather than silently accepting uncommitted source edits. No empty numerical field is converted to zero or replaced with a training median.

### Submitted values → model features

The frozen model is evaluated by feature **name and declared source**, not dictionary position. The audit independently reconstructs every input feature from the canonical submitted snapshot. It checks first/latest mapping, laterality, elapsed-time units, and change directions against the frozen model specification.

The browser also compares the response's canonical case, model hash, feature set, and actual explanation values against the submission it is awaiting. A response with changed inputs, unexpected features, or a different model identifier is withheld.

### Model output → explanation, report, and reset

Reasons use the actual feature values consumed by the same model call. First-minus-later and later-minus-first features are explicitly labelled. An altered explanation value raises a mismatch instead of presenting a plausible-looking explanation.

A full SHA-256 snapshot identifier and model hash are attached to each result. PDFs and exports are produced from the audited result snapshot, not from later-edited controls. Pending requests carry a revision/nonce; late responses cannot restore a changed eye's score. Editing one eye invalidates that eye without changing the other eye's unchanged result. New patient clears both and removes numerical geometry.

## Regression evidence

The numeric-only screenshot fixture used:

| Eye | A | B | C | Kmax | BAD-D | ARTmax |
|---|---:|---:|---:|---:|---:|---:|
| OD | 6.01 | 4.17 | 330 | 66.8 | 15.12 | 50 |
| OS | 6.46 | 4.87 | 457 | 60.7 | 10.67 | 175 |

Age 56 was taken from the visible source form. Quality, treatment, and confirmation switches in tests were **test preconditions, not asserted patient facts**. Test outputs are not clinical reassessments.

Passed tests confirmed:

- OS **60.7** reaches the reviewed source, submitted payload, named model feature, and explanation unchanged.
- A deliberately stale cached source payload containing **37.1** is replaced by the current verified edit **60.7** before import.
- A deliberately corrupted explanation containing **37.1** is rejected by Python and browser checks.
- Laterality, key order, first/latest mapping, per-eye edits, delayed responses, dirty source selection, and reset behavior do not silently reuse the wrong snapshot.

See `TEST_REPORT.md` and `test_evidence/` for test counts and recorded output. The browser transport was simulated; the real Streamlit transport remains a deployment smoke-test item.

## Model and visual preservation are separate

This release restores the purple layout and bilateral workflow while preserving the **latest recovered v3 model artifacts**. It does not recreate the older v11.2 scores. The two JSON model artifacts and the inference module are unchanged byte-for-byte; 300 synthetic cases produced identical predictions and explanations against v3.

No age adjustment, score inflation, retraining, new calibration, new AUC calculation, or clinical severity remapping was performed. “Very stable phenotype” and a purported prediction-reliability percentage were not copied back as validated conclusions.
